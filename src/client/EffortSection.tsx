/**
 * Thinking-effort section content: per-model reasoning-effort editor over the
 * `llm-pi-ai` settings namespace, driven entirely through the browser
 * settings wire face (api.settings.describe / api.settings.update). State
 * derives from the redacted raw user layer, so each saved model's levels are
 * preserved and unrelated models are never rewritten.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import css from './EffortSection.module.css'

/** The llm-pi-ai settings namespace this section edits. */
export const LLM_PI_AI_NS = 'llm-pi-ai'

/** The pi-ai thinking levels a profile may declare, in escalation order. */
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type Level = (typeof LEVELS)[number]
interface LevelDraft { on: boolean; wire: string }
type Mode = 'none' | 'off' | 'custom'
interface ModelDraft { mode: Mode; levels: Record<Level, LevelDraft> }

/** One model's stored reasoningEfforts: false = non-reasoning, dict = levels, null/undefined = inherit. */
type StoredEfforts = false | Record<string, string | null> | null | undefined

interface ModelRow { id: string; name: string; reasoningEfforts: StoredEfforts }
interface ProviderGroup {
  provider: string
  displayName: string
  reasoning?: string
  models: ModelRow[]
}

interface SectionState {
  status: 'loading' | 'ready' | 'error'
  providers: ProviderGroup[]
  user: unknown
  mergedValue: unknown
  revision: number
  error: string | null
}

type Change =
  | { provider: string; model: string; op: 'unset' }
  | { provider: string; model: string; op: 'set'; reasoningEfforts: false | Record<string, string | null> }
  | { provider: string; op: 'unsetDefault' }
  | { provider: string; op: 'setDefault'; reasoning: Level }

export interface EffortSectionProps { api: IApiClient }

const keyOf = (p: string, m: string): string => `${p}\u0000${m}`

function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Default custom levels: off, high, max are checked by default.
 * off gets null wire (send nothing); high and max use their level name as wire.
 */
const DEFAULT_CUSTOM_LEVELS: ReadonlySet<Level> = new Set<Level>(['off', 'high', 'max'])

function defaultLevels(): Record<Level, LevelDraft> {
  return Object.fromEntries(LEVELS.map((l) => {
    if (l === 'off') return [l, { on: true, wire: '' }] as const
    if (DEFAULT_CUSTOM_LEVELS.has(l)) return [l, { on: true, wire: l }] as const
    return [l, { on: false, wire: l }] as const
  })) as Record<Level, LevelDraft>
}

function levelsFromDict(dict: Record<string, string | null>): Record<Level, LevelDraft> {
  const base = defaultLevels()
  const next = {} as Record<Level, LevelDraft>
  for (const l of LEVELS) {
    if (l in dict) {
      const val = dict[l]
      next[l] = { on: true, wire: val === null ? '' : String(val) }
    } else {
      const baseL = base[l]
      next[l] = baseL ? { ...baseL, on: false } : { on: false, wire: '' }
    }
  }
  return next
}

function origKeyOf(v: StoredEfforts): string {
  if (v === false) return 'FALSE'
  if (v === null || v === undefined) return 'NONE'
  const o: Record<string, string | null> = {}
  for (const key of Object.keys(v)) {
    const val = v[key]
    if (val !== undefined) o[key] = val
  }
  return 'DICT:' + JSON.stringify(o)
}

function dictFromDraft(d: ModelDraft): Record<string, string | null> {
  const o: Record<string, string | null> = {}
  for (const l of LEVELS) {
    const e = d.levels[l]
    if (!e || !e.on) continue
    o[l] = (l === 'off' && (e.wire === '' || e.wire === null || e.wire === undefined)) ? null : String(e.wire)
  }
  return o
}

function draftKeyOf(d: ModelDraft): string {
  if (d.mode === 'none') return 'NONE'
  if (d.mode === 'off') return 'FALSE'
  return 'DICT:' + JSON.stringify(dictFromDraft(d))
}

function draftFromStored(v: StoredEfforts): ModelDraft {
  const levels = defaultLevels()
  if (v === false) return { mode: 'off', levels }
  if (v === null || v === undefined) return { mode: 'none', levels }
  return { mode: 'custom', levels: levelsFromDict(v) }
}

function groupsFromValue(value: unknown): ProviderGroup[] {
  const providers = (value as { providers?: unknown } | undefined)?.providers
  if (!providers || typeof providers !== 'object') return []
  const providerMap = providers as Record<string, unknown>
  const groups: ProviderGroup[] = []
  for (const provider of Object.keys(providerMap)) {
    const profile = providerMap[provider]
    if (!profile || typeof profile !== 'object') continue
    const prof = profile as Record<string, unknown>
    const models = Array.isArray(prof.models) ? prof.models as unknown[] : []
    if (models.length === 0) continue
    const rows: ModelRow[] = models
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).id === 'string')
      .map((m) => ({
        id: String(m.id),
        name: typeof m.name === 'string' && (m.name as string).length > 0 ? m.name as string : String(m.id),
        reasoningEfforts: m.reasoningEfforts === undefined ? null : m.reasoningEfforts as StoredEfforts,
      }))
    if (rows.length === 0) continue
    const reasoning = prof.reasoning
    groups.push({
      provider,
      displayName: typeof prof.displayName === 'string' && (prof.displayName as string).length > 0
        ? prof.displayName as string
        : provider,
      ...isLevel(reasoning) ? { reasoning } : {},
      models: rows,
    })
  }
  return groups
}

function rebuildUserSection(
  user: unknown,
  mergedValue: unknown,
  changes: readonly Change[],
): Record<string, unknown> {
  const providersRaw = (user as { providers?: unknown } | undefined)?.providers
  const providers = providersRaw && typeof providersRaw === 'object' ? providersRaw as Record<string, unknown> : {}
  const mergedProvidersRaw = (mergedValue as { providers?: unknown } | undefined)?.providers
  const mergedProviders = mergedProvidersRaw && typeof mergedProvidersRaw === 'object'
    ? mergedProvidersRaw as Record<string, unknown> : {}
  const next: Record<string, unknown> = {}
  const nextProviders: Record<string, unknown> = {}
  for (const provider of Object.keys(providers)) {
    const profile = providers[provider]
    if (!profile || typeof profile !== 'object') continue
    const np: Record<string, unknown> = {}
    for (const key of Object.keys(profile as Record<string, unknown>)) {
      if (key === 'models') continue
      np[key] = (profile as Record<string, unknown>)[key]
    }
    const models = Array.isArray((profile as { models?: unknown }).models) ? (profile as { models: unknown[] }).models : []
    const nms = models.map((m) => ({ ...m as Record<string, unknown> }))
    np.models = nms
    nextProviders[provider] = np
  }
  next.providers = nextProviders
  for (const c of changes) {
    if ('model' in c) {
      const np = nextProviders[c.provider]
      const nms = np && Array.isArray((np as { models?: unknown }).models) ? (np as { models: Record<string, unknown>[] }).models : []
      const idx = nms.findIndex((m) => m && typeof m === 'object' && m.id === c.model)
      const target = idx < 0 ? undefined : nms[idx]
      if (target === undefined) throw new Error(`no configured model "${c.provider}/${c.model}"`)
      if (c.op === 'unset') delete target.reasoningEfforts
      else target.reasoningEfforts = c.reasoningEfforts
    } else if (c.op === 'setDefault') {
      const existing = nextProviders[c.provider]
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        const ep = existing as Record<string, unknown>
        ep.reasoning = c.reasoning
        if (!Array.isArray(ep.models)) {
          const mergedProfile = mergedProviders[c.provider]
          const mergedModels = mergedProfile && typeof mergedProfile === 'object'
            ? (mergedProfile as Record<string, unknown>).models : undefined
          if (Array.isArray(mergedModels)) ep.models = mergedModels.map((m: unknown) => ({ ...(m as Record<string, unknown>) }))
        }
      } else {
        const entry: Record<string, unknown> = { reasoning: c.reasoning }
        const mergedProfile = mergedProviders[c.provider]
        const mergedModels = mergedProfile && typeof mergedProfile === 'object'
          ? (mergedProfile as Record<string, unknown>).models : undefined
        if (Array.isArray(mergedModels)) entry.models = mergedModels.map((m: unknown) => ({ ...(m as Record<string, unknown>) }))
        nextProviders[c.provider] = entry
      }
    } else {
      const existing = nextProviders[c.provider]
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        delete (existing as Record<string, unknown>).reasoning
      }
    }
  }
  return next
}

/** Check if a model matches a search term (case-insensitive substring). */
function matchesSearch(name: string, id: string, term: string): boolean {
  if (term.length === 0) return true
  const lower = term.toLowerCase()
  return name.toLowerCase().includes(lower) || id.toLowerCase().includes(lower)
}

export function EffortSection({ api }: EffortSectionProps) {
  const [state, setState] = useState<SectionState>({
    status: 'loading', providers: [], user: undefined, mergedValue: undefined, revision: -1, error: null,
  })
  const [drafts, setDrafts] = useState<Record<string, ModelDraft>>({})
  const [orig, setOrig] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [defaults, setDefaults] = useState<Record<string, Level | undefined>>({})
  const [origDefaults, setOrigDefaults] = useState<Record<string, Level | undefined>>({})
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({})
  /** Provider currently showing the batch-configure modal; null = closed. */
  const [batchProvider, setBatchProvider] = useState<string | null>(null)
  /** Batch modal draft state. */
  const [batchMode, setBatchMode] = useState<Mode>('custom')
  const [batchLevels, setBatchLevels] = useState<Record<Level, LevelDraft>>(defaultLevels())

  const absorb = useCallback((providers: ProviderGroup[], freshUser: unknown, freshMergedValue: unknown, freshRevision: number) => {
    const d: Record<string, ModelDraft> = {}
    const o: Record<string, string> = {}
    const pd: Record<string, Level | undefined> = {}
    const po: Record<string, Level | undefined> = {}
    for (let i = 0; i < providers.length; i++) {
      const g = providers[i]!
      const level = isLevel(g.reasoning) ? g.reasoning : undefined
      pd[g.provider] = level
      po[g.provider] = level
      for (const m of g.models) {
        const k = keyOf(g.provider, m.id)
        d[k] = draftFromStored(m.reasoningEfforts)
        o[k] = origKeyOf(m.reasoningEfforts)
      }
    }
    setDrafts(d)
    setOrig(o)
    setDefaults(pd)
    setOrigDefaults(po)
    setState((prev) => ({ ...prev, providers, user: freshUser, mergedValue: freshMergedValue, revision: freshRevision, error: null }))
  }, [])

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const response = await api.settings.describe({})
        if (!response.result.ok) throw new Error(response.result.error.message)
        const view = response.result.value.namespaces.find((v) => v.ns === LLM_PI_AI_NS)
        if (view === undefined) throw new Error('llm-pi-ai settings are unavailable')
        if (!alive) return
        const groups = groupsFromValue(view.value)
        absorb(groups, view.user, view.value, view.revision)
        setState((prev) => ({ ...prev, status: 'ready' }))
      } catch (error) {
        if (alive) setState((prev) => ({ ...prev, status: 'error', error: messageOf(error) }))
      }
    }
    void load()
    return () => { alive = false }
  }, [api, absorb])

  const modelDirty = useMemo(() => {
    const s = new Set<string>()
    for (const k of Object.keys(drafts)) {
      const d = drafts[k]
      if (d !== undefined && orig[k] !== draftKeyOf(d)) s.add(k)
    }
    return s
  }, [drafts, orig])

  const providerDirty = useMemo(() => {
    const s = new Set<string>()
    for (const g of state.providers) {
      const orig = origDefaults[g.provider]
      const effective = defaults[g.provider]
      if (orig !== effective) s.add(g.provider)
    }
    return s
  }, [state.providers, origDefaults, defaults])

  const setMode = (k: string, mode: Mode): void => setDrafts((prev): Record<string, ModelDraft> => {
    const cur = prev[k]
    return { ...prev, [k]: { mode, levels: cur ? cur.levels : defaultLevels() } }
  })

  const updateLevel = (k: string, level: Level, patch: Partial<LevelDraft>): void => setDrafts((prev): Record<string, ModelDraft> => {
    const cur = prev[k]
    const base = cur?.levels ?? defaultLevels()
    const levels = { ...base, [level]: { ...base[level], ...patch } }
    return { ...prev, [k]: cur === undefined ? { mode: 'none', levels } : { ...cur, levels } }
  })

  const setAllLevels = (k: string, on: boolean): void => setDrafts((prev): Record<string, ModelDraft> => {
    const cur = prev[k]
    const base = cur?.levels ?? defaultLevels()
    const n = {} as Record<Level, LevelDraft>
    for (const l of LEVELS) {
      const baseL = base[l]
      n[l] = baseL ? { ...baseL, on } : { on, wire: '' }
    }
    return { ...prev, [k]: cur === undefined ? { mode: 'none', levels: n } : { ...cur, levels: n } }
  })

  const clearLevels = (k: string): void => setDrafts((prev): Record<string, ModelDraft> => {
    const cur = prev[k]
    const base = cur?.levels ?? defaultLevels()
    const n = {} as Record<Level, LevelDraft>
    for (const l of LEVELS) {
      const baseL = base[l]
      n[l] = baseL ? { ...baseL, on: false } : { on: false, wire: '' }
    }
    return { ...prev, [k]: cur === undefined ? { mode: 'none', levels: n } : { ...cur, levels: n } }
  })

  /** Reset one model to the defaultLevels() template (off/high/max checked, original wires). */
  const resetModel = (k: string): void => setDrafts((prev): Record<string, ModelDraft> => {
    return { ...prev, [k]: { mode: 'custom', levels: defaultLevels() } }
  })

  const toggleGroup = (provider: string): void => setCollapsed((prev) => ({ ...prev, [provider]: !prev[provider] }))

  const saveAll = useCallback(async (): Promise<void> => {
    if (modelDirty.size === 0 && providerDirty.size === 0) return
    setSaving(true)
    setNotice(null)
    const changes: Change[] = []
    for (const k of modelDirty) {
      const sep = k.indexOf('\u0000')
      const provider = k.slice(0, sep)
      const model = k.slice(sep + 1)
      const d = drafts[k]
      if (d === undefined) continue
      if (d.mode === 'none') changes.push({ provider, model, op: 'unset' })
      else if (d.mode === 'off') changes.push({ provider, model, op: 'set', reasoningEfforts: false })
      else changes.push({ provider, model, op: 'set', reasoningEfforts: dictFromDraft(d) })
    }
    for (const p of providerDirty) {
      const effective = defaults[p]
      if (effective === undefined) changes.push({ provider: p, op: 'unsetDefault' })
      else changes.push({ provider: p, op: 'setDefault', reasoning: effective })
    }
    if (changes.length === 0) {
      setSaving(false)
      return
    }
    try {
      const next = rebuildUserSection(state.user, state.mergedValue, changes)
      const response = await api.settings.update({
        ns: LLM_PI_AI_NS,
        patch: next,
        expectedRevision: state.revision,
      })
      if (!response.result.ok) throw new Error(response.result.error.message)
      const view = response.result.value
      absorb(groupsFromValue(view.value), view.user, view.value, view.revision)
      setNotice({ kind: 'ok', text: '已保存' })
    } catch (error) {
      setNotice({ kind: 'err', text: messageOf(error) })
    } finally {
      setSaving(false)
    }
  }, [api, modelDirty, providerDirty, drafts, defaults, state.user, state.mergedValue, state.revision, absorb])

  /** Open the batch-configure modal for a provider. */
  const openBatch = (provider: string): void => {
    setBatchProvider(provider)
    setBatchMode('custom')
    setBatchLevels(defaultLevels())
  }

  /** Apply batch config to all models of the current provider. */
  const applyBatch = (): void => {
    if (batchProvider === null) return
    const g = state.providers.find((pg) => pg.provider === batchProvider)
    if (g === undefined) return
    setDrafts((prev): Record<string, ModelDraft> => {
      const next = { ...prev }
      for (const m of g.models) {
        const k = keyOf(batchProvider, m.id)
        if (batchMode === 'none') next[k] = { mode: 'none', levels: prev[k]?.levels ?? defaultLevels() }
        else if (batchMode === 'off') next[k] = { mode: 'off', levels: prev[k]?.levels ?? defaultLevels() }
        else next[k] = { mode: 'custom', levels: { ...batchLevels } }
      }
      return next
    })
    setBatchProvider(null)
  }

  if (state.status === 'loading') {
    return (
      <div className={css.wrap}>
        <div className={css.head}>
          <h3 className={css.title}>模型思考程度</h3>
          <span className={css.hint}>加载中…</span>
        </div>
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className={css.wrap}>
        <div className={css.head}>
          <h3 className={css.title}>模型思考程度</h3>
          <span className={`${css.hint} ${css.err}`}>加载失败: {state.error}</span>
        </div>
      </div>
    )
  }

  const dirtyCount = modelDirty.size + providerDirty.size
  const renderChips = (
    value: Level | undefined,
    onPick: (next: Level | undefined) => void,
  ) => (
    <div className={css.chips} role="radiogroup" aria-label="默认思考程度">
      <button
        type="button"
        className={value === undefined ? `${css.chip} ${css.chipActive}` : css.chip}
        onClick={() => onPick(undefined)}
      >不设置</button>
      {LEVELS.map((lv) => (
        <button
          key={lv}
          type="button"
          className={value === lv ? `${css.chip} ${css.chipActive}` : css.chip}
          onClick={() => onPick(lv)}
        >{lv}</button>
      ))}
    </div>
  )
  return (
    <div className={css.wrap}>
      <div className={css.head}>
        <h3 className={css.title}>模型思考程度</h3>
        <div className={css.bar}>
          <span className={css.hint}>按提供商逐项配置每个模型的思考档位与默认档位；线网拼写可单独修改。保存后写回 settings.yaml。</span>
          <div className={css.barRight}>
            {notice ? (
              <span className={notice.kind === 'ok' ? css.ok : css.err}>{notice.text}</span>
            ) : null}
            <button
              className={css.save}
              disabled={saving || dirtyCount === 0}
              onClick={() => void saveAll()}
            >
              {dirtyCount > 0 ? `保存更改 (${dirtyCount})` : '保存更改'}
            </button>
          </div>
        </div>
      </div>
      {state.providers.length === 0
        ? <p className={css.note}>未配置任何含显式 models 列表的提供方。</p>
        : (
          <div className={css.groups}>
            {state.providers.map((g) => {
              const term = searchTerms[g.provider] ?? ''
              const filtered = term.length > 0
                ? g.models.filter((m) => matchesSearch(m.name, m.id, term))
                : g.models
              return (
                <section key={g.provider} className={css.group}>
                  <button
                    type="button"
                    className={css.groupHead}
                    onClick={() => toggleGroup(g.provider)}
                    aria-expanded={!collapsed[g.provider]}
                  >
                    <span className={css.groupTitle}>{g.displayName}</span>
                    <span className={css.groupChevron}>{collapsed[g.provider] ? '▸' : '▾'}</span>
                  </button>
                  {collapsed[g.provider] ? null : (
                    <>
                      <div className={css.providerRow}>
                        <span className={css.providerLabel}>默认档位</span>
                        {renderChips(defaults[g.provider], (next) =>
                          setDefaults((prev) => ({ ...prev, [g.provider]: next })))}
                        {defaults[g.provider] !== undefined && providerDirty.has(g.provider) ? (
                          <span className={css.dirty}>已修改</span>
                        ) : null}
                        <button type="button" className={css.btn} disabled={saving} onClick={() => openBatch(g.provider)}>一键配置</button>
                      </div>
                      <div className={css.searchRow}>
                        <input
                          type="text"
                          className={css.searchInput}
                          placeholder="搜索模型名称或 ID…"
                          value={term}
                          onChange={(e) => setSearchTerms((prev) => ({ ...prev, [g.provider]: e.target.value }))}
                        />
                        {term.length > 0 ? (
                          <span className={css.searchCount}>{filtered.length} / {g.models.length}</span>
                        ) : null}
                      </div>
                      {filtered.length === 0
                        ? <p className={css.note}>无匹配模型。</p>
                        : (
                          <div className={css.modelList}>
                            {filtered.map((m) => renderModel(g.provider, m))}
                          </div>
                        )}
                    </>
                  )}
                </section>
              )
            })}
          </div>
        )}
      {/* Batch configure modal */}
      {batchProvider !== null ? (() => {
        const g = state.providers.find((pg) => pg.provider === batchProvider)
        if (g === undefined) return null
        return (
          <div className={css.modalOverlay} onClick={() => setBatchProvider(null)}>
            <div className={css.modal} onClick={(e) => e.stopPropagation()}>
              <h4 className={css.modalTitle}>一键配置 — {g.displayName}</h4>
              <p className={css.modalHint}>选择配置模式，点击「应用」覆盖该提供商下所有 {g.models.length} 个模型。</p>
              <div className={css.modes}>
                <label className={css.radio}>
                  <input type="radio" name="batch-mode" checked={batchMode === 'none'} onChange={() => setBatchMode('none')} />
                  <span>不设置</span>
                </label>
                <label className={css.radio}>
                  <input type="radio" name="batch-mode" checked={batchMode === 'off'} onChange={() => setBatchMode('off')} />
                  <span>不推理</span>
                </label>
                <label className={css.radio}>
                  <input type="radio" name="batch-mode" checked={batchMode === 'custom'} onChange={() => setBatchMode('custom')} />
                  <span>自定义档位</span>
                </label>
                {batchMode === 'custom' ? (
                  <div className={css.modesTools}>
                    <button type="button" className={css.mini} onClick={() => {
                      const n = {} as Record<Level, LevelDraft>
                      for (const l of LEVELS) n[l] = { on: true, wire: l === 'off' ? '' : l }
                      setBatchLevels(n)
                    }}>全选</button>
                    <button type="button" className={css.mini} onClick={() => {
                      const n = {} as Record<Level, LevelDraft>
                      for (const l of LEVELS) n[l] = { on: false, wire: l === 'off' ? '' : l }
                      setBatchLevels(n)
                    }}>清空</button>
                    <button type="button" className={css.mini} onClick={() => setBatchLevels(defaultLevels())}>恢复默认</button>
                  </div>
                ) : null}
              </div>
              {batchMode === 'custom' ? (
                <div className={css.customBody}>
                  <div className={css.levels}>
                    {LEVELS.map((lv) => (
                      <label key={lv} className={css.level}>
                        <input
                          type="checkbox"
                          checked={batchLevels[lv]?.on ?? false}
                          onChange={(e) => setBatchLevels((prev) => ({
                            ...prev,
                            [lv]: { ...prev[lv]!, on: e.target.checked },
                          }))}
                        />
                        <span className={css.levelName}>{lv}</span>
                        <input
                          type="text"
                          className={css.wire}
                          value={batchLevels[lv]?.wire ?? ''}
                          placeholder={lv === 'off' ? '留空=不发送' : '线网拼写'}
                          onChange={(e) => setBatchLevels((prev) => ({
                            ...prev,
                            [lv]: { ...prev[lv]!, wire: e.target.value },
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className={css.modalActions}>
                <button type="button" className={css.btn} onClick={() => setBatchProvider(null)}>取消</button>
                <button type="button" className={css.save} onClick={applyBatch}>应用到所有模型</button>
              </div>
            </div>
          </div>
        )
      })() : null}
    </div>
  )

  function renderModel(p: string, m: ModelRow) {
    const key = keyOf(p, m.id)
    const d = drafts[key]
    if (d === undefined) return null
    const radioName = `mode-${p}-${m.id}`
    return (
      <div key={key} className={css.model}>
        <div className={css.modelHead}>
          <span className={css.modelName}>{m.name}</span>
          <span className={css.modelId}>{m.id}</span>
          {modelDirty.has(key) ? <span className={css.dirty}>已修改</span> : null}
          <button className={css.btn} disabled={saving} onClick={() => resetModel(key)}>恢复默认</button>
        </div>
        <div className={css.modes}>
          <label className={css.radio}>
            <input type="radio" name={radioName} checked={d.mode === 'none'} onChange={() => setMode(key, 'none')} />
            <span>不设置</span>
          </label>
          <label className={css.radio}>
            <input type="radio" name={radioName} checked={d.mode === 'off'} onChange={() => setMode(key, 'off')} />
            <span>不推理</span>
          </label>
          <label className={css.radio}>
            <input type="radio" name={radioName} checked={d.mode === 'custom'} onChange={() => setMode(key, 'custom')} />
            <span>自定义档位</span>
          </label>
          {d.mode === 'custom' ? (
            <div className={css.modesTools}>
              <button type="button" className={css.mini} disabled={saving} onClick={() => setAllLevels(key, true)}>全选</button>
              <button type="button" className={css.mini} disabled={saving} onClick={() => clearLevels(key)}>清空</button>
            </div>
          ) : null}
        </div>
        {d.mode === 'custom' ? (
          <div className={css.customBody}>
            <div className={css.levels}>
              {LEVELS.map((lv) => (
                <label key={lv} className={css.level}>
                  <input
                    type="checkbox"
                    checked={d.levels[lv]?.on ?? false}
                    onChange={(e) => updateLevel(key, lv, { on: e.target.checked })}
                  />
                  <span className={css.levelName}>{lv}</span>
                  <input
                    type="text"
                    className={css.wire}
                    value={d.levels[lv]?.wire ?? ''}
                    placeholder={lv === 'off' ? '留空=不发送' : '线网拼写'}
                    onChange={(e) => updateLevel(key, lv, { wire: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }
}
