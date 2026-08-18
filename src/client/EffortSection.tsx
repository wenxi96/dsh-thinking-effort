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
  /** Provider-level default reasoning level, when one is configured. */
  reasoning?: string
  models: ModelRow[]
}

interface SectionState {
  status: 'loading' | 'ready' | 'error'
  providers: ProviderGroup[]
  /** Raw user layer (for rebuildUserSection). */
  user: unknown
  /** Merged value (base + user), for models backfill in rebuildUserSection. */
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

/** Narrow an arbitrary stored value to a known pi-ai level. */
function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value)
}

/** Levels a model is known to support, when its stored efforts say so; undefined when unknowable. */
function knownSupportedLevels(efforts: StoredEfforts): Set<Level> | undefined {
  if (efforts === false) return new Set<Level>(['off'])
  if (typeof efforts !== 'object' || efforts === null) return undefined
  return new Set(Object.keys(efforts).filter((key): key is Level => isLevel(key)))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function defaultLevels(): Record<Level, LevelDraft> {
  return Object.fromEntries(LEVELS.map((l) => l === 'off'
    ? [l, { on: true, wire: '' }] as const
    : [l, { on: l === 'high', wire: l }] as const,
  )) as Record<Level, LevelDraft>
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

/**
 * Rebuild the user section for one save. Every model keeps ALL its stored
 * fields (reasoningEfforts included) so untouched models are preserved; the
 * applied changes then overwrite or remove the reasoningEfforts of exactly
 * the models being saved.
 */
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
  // Copy user-layer providers (deep-copy models so later mutations don't leak).
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
  // Ensure every provider touched by a setDefault/unsetDefault change carries
  // the models list from the merged (base+user) value when the user layer has
  // none — a provider-level shallow merge replaces the whole provider object,
  // so writing only { reasoning } would erase the models.
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
        // Backfill models from the merged view when the user layer had none.
        if (!Array.isArray(ep.models)) {
          const mergedProfile = mergedProviders[c.provider]
          const mergedModels = mergedProfile && typeof mergedProfile === 'object'
            ? (mergedProfile as Record<string, unknown>).models : undefined
          if (Array.isArray(mergedModels)) ep.models = mergedModels.map((m: unknown) => ({ ...(m as Record<string, unknown>) }))
        }
      } else {
        const entry: Record<string, unknown> = { reasoning: c.reasoning }
        // Backfill models from the merged view for a brand-new provider entry.
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

/**
 * The settings section body.
 * @param props - the settings wire face supplied by the plugin.
 */
export function EffortSection({ api }: EffortSectionProps) {
  const [state, setState] = useState<SectionState>({
    status: 'loading', providers: [], user: undefined, mergedValue: undefined, revision: -1, error: null,
  })
  const [drafts, setDrafts] = useState<Record<string, ModelDraft>>({})
  const [orig, setOrig] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  /** Per-provider default level draft; undefined = not set on that provider. */
  const [defaults, setDefaults] = useState<Record<string, Level | undefined>>({})
  /** Last absorbed per-provider default level, for dirty comparison. */
  const [origDefaults, setOrigDefaults] = useState<Record<string, Level | undefined>>({})
  /** Global default level baked into providers lacking their own, on save; undefined = off. */
  const [globalDefault, setGlobalDefault] = useState<Level | undefined>(undefined)

  const absorb = useCallback((providers: ProviderGroup[], freshUser: unknown, freshMergedValue: unknown, freshRevision: number) => {
    const d: Record<string, ModelDraft> = {}
    const o: Record<string, string> = {}
    const pd: Record<string, Level | undefined> = {}
    const po: Record<string, Level | undefined> = {}
    let inferredGlobal: Level | undefined = undefined
    let allSame = true
    for (let i = 0; i < providers.length; i++) {
      const g = providers[i]!
      const level = isLevel(g.reasoning) ? g.reasoning : undefined
      pd[g.provider] = level
      po[g.provider] = level
      if (i === 0) inferredGlobal = level
      else if (inferredGlobal !== level) allSame = false
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
    setGlobalDefault(allSame && providers.length > 0 ? inferredGlobal : undefined)
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

  /** Providers whose effective default (explicit ?: global) differs from what is stored. */
  const providerDirty = useMemo(() => {
    const s = new Set<string>()
    for (const g of state.providers) {
      const orig = origDefaults[g.provider]
      const effective = defaults[g.provider] ?? globalDefault
      if (orig !== effective) s.add(g.provider)
    }
    return s
  }, [state.providers, origDefaults, defaults, globalDefault])

  /** Providers where the effective default is known-unsupported by some listed model. */
  const riskyModelsByProvider = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const g of state.providers) {
      const effective = defaults[g.provider] ?? globalDefault
      if (effective === undefined) continue
      const bad: string[] = []
      for (const row of g.models) {
        const supported = knownSupportedLevels(row.reasoningEfforts)
        if (supported !== undefined && !supported.has(effective)) bad.push(row.name)
      }
      if (bad.length > 0) m[g.provider] = bad
    }
    return m
  }, [state.providers, defaults, globalDefault])

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

  const resetModel = (k: string): void => setDrafts((prev): Record<string, ModelDraft> => {
    const cur = prev[k]
    return { ...prev, [k]: { mode: 'none', levels: cur ? cur.levels : defaultLevels() } }
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
    // Provider-level defaults: explicit per-provider choice wins over the global
    // default; a provider without either gets its stored default removed.
    for (const p of providerDirty) {
      const effective = defaults[p] ?? globalDefault
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
  }, [api, modelDirty, providerDirty, drafts, defaults, globalDefault, state.user, state.revision, absorb])

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
          <span className={css.hint}>按提供商逐项配置默认思考档位与每个模型的思考档位；线网拼写可单独修改。全局默认会在保存时应用到未单独设置的提供方。保存后写回 settings.yaml。</span>
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
      <div className={css.global}>
        <span className={css.globalLabel}>全局默认</span>
        {renderChips(globalDefault, (next) => setGlobalDefault(next))}
        <span className={css.pending}>
          {globalDefault === undefined
            ? '未设置——不自动应用'
            : '保存时应用到未单独设置默认档位的提供方'}
        </span>
      </div>
      {state.providers.length === 0
        ? <p className={css.note}>未配置任何含显式 models 列表的提供方。</p>
        : (
          <div className={css.groups}>
            {state.providers.map((g) => (
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
                      {defaults[g.provider] === undefined && globalDefault !== undefined ? (
                        <span className={css.pending}>将应用全局 {globalDefault}</span>
                      ) : null}
                      {defaults[g.provider] !== undefined && providerDirty.has(g.provider) ? (
                        <span className={css.dirty}>已修改</span>
                      ) : null}
                      {riskyModelsByProvider[g.provider] !== undefined ? (
                        <span className={css.warnText}>
                          ⚠ 部分模型不支持该档位：{riskyModelsByProvider[g.provider]?.join('、')}
                        </span>
                      ) : null}
                    </div>
                    {g.models.length === 0 ? null : (
                      <div className={css.modelList}>
                        {g.models.map((m) => renderModel(g.provider, m))}
                      </div>
                    )}
                  </>
                )}
              </section>
            ))}
          </div>
        )}
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
                    checked={d.levels[lv].on}
                    onChange={(e) => updateLevel(key, lv, { on: e.target.checked })}
                  />
                  <span className={css.levelName}>{lv}</span>
                  <input
                    type="text"
                    className={css.wire}
                    value={d.levels[lv].wire}
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