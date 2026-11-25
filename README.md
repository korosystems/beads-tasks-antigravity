# Beads Tasks

Inspect and manage Beads issues in Antigravity using interactive MCP Apps cards, a full-page board, and a clickable side panel. [简体中文](README.zh-CN.md)

## Prerequisites

- Antigravity App / CLI / IDE
- Node.js >= 18
- `bd` (Beads CLI) installed and available on PATH

## Install

Preferred Marketplace installation:

```sh
agy plugin install https://github.com/korosystems/beads-tasks-antigravity
```

For a local checkout, run `agy plugin install ./beads-tasks-antigravity`. Alternatively run `./scripts/install.sh` from this directory to copy the plugin to `~/.gemini/config/plugins/beads-tasks`; use `--symlink` for live development or `--uninstall` to remove it. Build first using `npm ci --prefix mcp` and `node scripts/build-mcp.mjs` when building from source.

## Features

- Inspect issue details, dependencies and notes; update status, priority, labels and notes.
- `show_task_card`, `show_task_batch` and `open_tasks_board` render interactive views.
- Open individual issues or a review queue via `sidecar://beads-tasks/tasks/` links.

## Zero-Config Usage

Open a Beads repository in Antigravity and ask to inspect its issues. The official Antigravity `sidecar_sdk` supplies the conversation context; the plugin resolves workspace paths through the host `agentapi` metadata and uses the Beads CLI for issue data, with no direct database access. Project configuration is optional.

## Multi-Project Config

Optionally create `~/.config/beads-tasks/projects.json`:

```json
{"activeProject":"work","projects":[{"id":"work","name":"Work","repo":"/path/to/repo"}]}
```

Each project can also specify `bdDir`; links and tools accept `project` or `repo` to select another workspace.

## Built-in Settings Page

Open settings in the board or side panel to control whether replies include side panel links. The setting persists in `~/.config/beads-tasks/settings.json`; the hook communicates changes to the assistant.

## Environment Variables

- `BD_BIN`: path to the Beads CLI.
- `BEADS_TASKS_PROJECTS_FILE`, `BEADS_TASKS_SETTINGS_FILE`: override configuration paths.
- `BEADS_TASKS_HOOK_STATE_DIR`: override the hook's per-conversation state directory.
- `BEADS_TASKS_MCP_APP_HTML`: override the bundled MCP app HTML.
- `AGENTAPI_BIN`, `ANTIGRAVITY_AGENTAPI_EXE`: override host API executable discovery.
- `ANTIGRAVITY_PLUGINS_DIR`: override the manual installation directory.

## Testing

```sh
npm ci --prefix mcp
node scripts/build-mcp.mjs
node --test sidecars/tasks/tests/*.test.mjs mcp/tests/*.test.mjs
agy plugin validate --strict .
```

## Support

Report issues at https://github.com/korosystems/beads-tasks-antigravity/issues.

## License

MIT; see [LICENSE](LICENSE).
