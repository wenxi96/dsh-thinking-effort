# Changelog

All notable changes to this project will be documented in this file.

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
