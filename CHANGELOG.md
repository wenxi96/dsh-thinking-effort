# Changelog

All notable changes to this project will be documented in this file.

## 0.1.5 — 2026-09-29

### Fixed

- The plugin stopped taking effect on DSH 0.2.0-rc.1: its `@deepseek-ai/dsh-*` peers stopped at the 0.1.5 line, and the harness compatibility preflight denies every row whose declared dsh peers exclude the running version, so the Settings 思考程度 section never mounted and the row read as disabled with no error.

### Changed

- `@deepseek-ai/dsh-*` peer ranges now accept `^0.1.5-rc.2 || ^0.2.0-rc.1`, the two harness lines this browser half has been verified against.
- Dev ranges build and typecheck against `^0.2.0-rc.1`.

## 0.1.4 — 2026-09-18

### Fixed

- The 思考程度 settings panel showed `加载失败: Cannot read properties of undefined (reading 'settings')` on DSH 0.1.5-rc.2, where `ConnectionHandle.api` no longer exists and the settings wire face moved to the generated Remote namespace `ctx.remote.settings`.

### Changed

- The browser half now injects `remote` / `remote.settings` and reads `ctx.remote.settings` instead of `connection.api.settings`; `describe()` takes no argument, results are bare `RemoteResult` values, and `update` takes `(ns, patch, expectedRevision)` positionally.
- The client entry types `ctx` as `Context` from `@deepseek-ai/cordis`; `@deepseek-ai/dsh-client-runtime` is retired and no longer a dependency.
- Peer and dev ranges now require `^0.1.5-rc.2` for the DSH packages, so an older harness can no longer satisfy them silently.

## 0.1.0 — 2025-08-17

Initial release (extracted from the DSH monorepo `packages/client/ui-thinking-effort`).

### Features

- Per-provider default reasoning-effort chip selector (writes `providers.<p>.reasoning`).
- Global default reasoning-effort (baked into every provider without its own on save).
- Per-model reasoning-effort editor (three modes: 不设置 / 不推理 / 自定义档位).
- Seven platform thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- Editable wire spellings per level.
- Model-level 恢复默认, per-group 全选/清空, dirty badge.
- Inline risk warning when the effective default is unsupported by some listed model.
- Sticky header with title, hint, and save control.
- Provider collapse with chevron toggle.
- Settings section registered via `settings.section` slot (id `thinking-effort`, order 12, label 思考程度, think nav icon).
