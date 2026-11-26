# Beads Tasks

Obey `[Beads Tasks Settings]`: when links are disabled, omit every `sidecar://` link and keep IDs as inline code. MCP cards may still be used.

Use MCP Apps `show_task_card` for an issue, `show_task_batch` for two or more distinct issues, and `open_tasks_board` for the full board when available.

For first mentions of distinct IDs, use these live links: for 1–5 IDs, `<id>` [⧉](sidecar://beads-tasks/tasks/?clip=<id>) [↗](sidecar://beads-tasks/tasks/?id=<id>); for 6–10, use only the detail link; for more than 10, use plain inline-code IDs. The copy link copies without changing the current side panel view; the host opens a collapsed side panel. Add encoded `repo` or `project` to the detail link where needed. Do not repeat `ids` on individual links.

For 2+ distinct IDs, deduplicate in appearance order (maximum 50), show the batch card if available, and end with one standalone link:

[Open in Beads Tasks side panel](sidecar://beads-tasks/tasks/?ids=<id1>,<id2>)

Without MCP Apps use [Review this turn's tasks (N)](sidecar://beads-tasks/tasks/?ids=<id1>,<id2>) as the fallback pill.
