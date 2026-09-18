# dsh-thinking-effort

[English](README.md) | [中文](README.zh-CN.md)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，在 Web GUI 的设置页添加**思考程度**分页，可按提供商和模型可视化配置 `llm-pi-ai` 路由的推理档位。

## 功能

- **每提供商默认档位**芯片选择器（写 `providers.<provider>.reasoning`）。
- **全局默认**（保存时烘焙进所有未单独设置的提供商）。
- **每模型**推理档位编辑器：三态 —— 不设置 / 不推理 / 自定义档位。
- 七档平台思考级别：`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。
- 每档可独立编辑线网拼写（即实际发送给端点的 `reasoning_effort` 字符串）。
- 恢复默认 / 全选 / 清空、脏标记、粘性头部。
- 当有效默认档位不被某些已列出模型支持时，内联 ⚠ 风险告警。

## 前提

- DeepSeek Harness (`dsh`)，并有 `dsh web` 的 profile。
- Node.js ≥ 22。

## 安装

### 从 npm 安装（推荐）

```sh
dsh plugin add @chengwd96/dsh-thinking-effort
```

### 从 GitHub 安装

```sh
# 锁定 tag（推荐，可复现）
dsh plugin add github:wenxi96/dsh-thinking-effort#v0.1.4

# pnpm ≥10 要求对 git 依赖的构建脚本单独授权——将以下内容写入
# ~/.dsh/profiles/<profile>/pnpm-workspace.yaml，然后重新运行 add：
onlyBuiltDependencies:
  - '@chengwd96/dsh-thinking-effort'
```

### 从本地检出安装

```sh
cd dsh-thinking-effort
npm install && npm run build
dsh plugin add .
```

## 使用

安装后，需要把 loader 行加入 web profile 的组合配置。推荐方式是编辑 profile 目录下的 `cordis.patch.yml`（`~/.dsh/profiles/<name>/cordis.patch.yml`）：

```yaml
# （追加到你已有的列表末尾）
- insert:
    - id: ui-thinking-effort
      name: '@chengwd96/dsh-thinking-effort'
```

> **重要：** `name` 的值必须是带引号的完整包名 —— 不带引号的 `@` 前缀会导致 YAML 解析或模块找不到错误。

重启 `dsh web`，然后打开**设置 → 思考程度**（左侧导航栏的思考图标）。

## 工作原理

该分页通过浏览器 settings wire face（`ctx.remote.settings`）读写 `llm-pi-ai` settings 命名空间，所以无需 host 端 RPC 或重启即可生效。

- **每提供商默认** → 写 `llm-pi-ai.providers.<p>.reasoning`（pi-ai 在请求未显式指定档位时用它作为兜底）。
- **每模型 reasoningEfforts** → 写 `llm-pi-ai.providers.<p>.models.<id>.reasoningEfforts`（可用档位及其线网拼写的能力字典）。
- **全局默认** → 保存时烘焙进所有未单独设置默认档位的提供商。

## 许可

MIT
