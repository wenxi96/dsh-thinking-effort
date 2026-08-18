# dsh-thinking-effort

[English](README.md) | [中文](README.zh-CN.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a **Thinking Effort** settings section to the Web GUI, letting you visually configure per-provider default and per-model reasoning-effort for every `llm-pi-ai` route.

## Features

- **Per-provider default** reasoning-effort chip selector (writes `providers.<provider>.reasoning`).
- **Global default** (baked into every provider without its own on save).
- **Per-model** reasoning-effort editor: three modes — 不设置 (unset) / 不推理 (non-reasoning) / 自定义档位 (custom levels).
- Seven platform thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.
- Editable wire spellings per level (the string actually sent as `reasoning_effort` to the provider endpoint).
- 恢复默认 / 全选 / 清空 controls, dirty badge, sticky header.
- Inline ⚠ risk warning when the effective default is unsupported by some listed model.

## Requirements

- DeepSeek Harness (`dsh`) with a `dsh web` profile.
- Node.js ≥ 22.

## Install

### From npm (recommended)

```sh
dsh plugin add @wenxi96/dsh-thinking-effort
```

### From GitHub

```sh
# Pin a tag (recommended for reproducibility)
dsh plugin add github:wenxi96/dsh-thinking-effort#v0.1.0

# pnpm ≥10 requires build permission for git dependencies — add this to
# ~/.dsh/profiles/<profile>/pnpm-workspace.yaml, then re-run add:
onlyBuiltDependencies:
  - '@wenxi96/dsh-thinking-effort'
```

### From a local clone

```sh
cd dsh-thinking-effort
npm install && npm run build
dsh plugin add .
```

## Usage

After installing, add the loader row to your web profile's composition. The recommended way is through `cordis.patch.yml` in your profile directory (`~/.dsh/profiles/<name>/cordis.patch.yml`):

```yaml
# (append to your existing list)
- insert:
    - id: ui-thinking-effort
      name: '@wenxi96/dsh-thinking-effort'
```

> **Important:** the `name` value must be the full scoped package name, **single-quoted** — a bare name or unquoted `@`-prefix will cause YAML parse or module-not-found errors on boot.

Restart `dsh web`, then open **Settings → 思考程度** (the think icon in the left nav).

## How it works

The section reads and writes the `llm-pi-ai` settings namespace through the browser settings wire face (`connection.api.settings`), so no host-side RPC or restart is needed to see changes.

- **Per-provider default** → writes `llm-pi-ai.providers.<p>.reasoning` (pi-ai uses it as the fallback when no explicit effort is specified on a request).
- **Per-model reasoningEfforts** → writes `llm-pi-ai.providers.<p>.models.<id>.reasoningEfforts` (the capability dictionary of available levels and their wire spellings).
- **Global default** → on save, bakes the chosen level into every provider that has no explicit default.

## License

MIT
