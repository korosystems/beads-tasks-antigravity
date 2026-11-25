# Beads Tasks

通过 Antigravity 的 MCP Apps 交互卡片、全页面看板和可点击侧栏查看并管理 Beads 问题。[English](README.md)

## 前置要求

- Antigravity App / CLI / IDE
- Node.js >= 18
- 已安装且位于 PATH 的 `bd`（Beads CLI）

## 安装

首选 Marketplace 安装：

```sh
agy plugin install https://github.com/korosystems/beads-tasks-antigravity
```

本地目录可用 `agy plugin install ./beads-tasks-antigravity`。也可在本目录运行 `./scripts/install.sh`，复制到 `~/.gemini/config/plugins/beads-tasks`；使用 `--symlink` 进行实时开发，或使用 `--uninstall` 卸载。从源码构建时先运行 `npm ci --prefix mcp` 和 `node scripts/build-mcp.mjs`。

## 功能

- 查看问题详情、依赖及备注，更新状态、优先级、标签和备注。
- 使用 `show_task_card`、`show_task_batch` 和 `open_tasks_board` 展示交互视图。
- 使用 `sidecar://beads-tasks/tasks/` 链接打开单个问题或批量审核队列。

## 零配置使用

在 Antigravity 中打开 Beads 仓库并要求查看问题。官方 Antigravity `sidecar_sdk` 提供会话上下文；插件通过宿主 `agentapi` 元数据解析工作区路径，并通过 Beads CLI 获取问题数据，无需直接访问数据库。项目配置为可选项。

## 多项目配置

可选创建 `~/.config/beads-tasks/projects.json`：

```json
{"activeProject":"work","projects":[{"id":"work","name":"Work","repo":"/path/to/repo"}]}
```

项目还可指定 `bdDir`；链接及工具可通过 `project` 或 `repo` 选择其他工作区。

## 内置设置页面

在看板或侧栏打开设置，控制回复是否包含侧栏链接。设置保存在 `~/.config/beads-tasks/settings.json`，hook 会将变化通知助手。

## 环境变量

- `BD_BIN`：Beads CLI 路径。
- `BEADS_TASKS_PROJECTS_FILE`、`BEADS_TASKS_SETTINGS_FILE`：覆盖配置文件路径。
- `BEADS_TASKS_HOOK_STATE_DIR`：覆盖 hook 会话状态目录。
- `BEADS_TASKS_MCP_APP_HTML`：覆盖打包的 MCP 应用 HTML。
- `AGENTAPI_BIN`、`ANTIGRAVITY_AGENTAPI_EXE`：覆盖宿主 API 可执行文件的查找。
- `ANTIGRAVITY_PLUGINS_DIR`：覆盖手动安装目录。

## 测试

```sh
npm ci --prefix mcp
node scripts/build-mcp.mjs
node --test sidecars/tasks/tests/*.test.mjs mcp/tests/*.test.mjs
agy plugin validate --strict .
```

## 支持

问题反馈：https://github.com/korosystems/beads-tasks-antigravity/issues。

## 许可证

MIT，参见 [LICENSE](LICENSE)。
