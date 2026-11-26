---
name: beads-task-links
description: Format Beads issue links and use interactive Beads Tasks cards and side panel navigation in Antigravity.
---

# Beads task links

Follow any `[Beads Tasks Settings]` system message. If links are disabled, omit all `sidecar://` links and keep IDs as inline code; MCP cards remain available. Resume links when enabled.

Use `show_task_card` for an interactive issue, `show_task_batch` for a batch of two or more distinct IDs, and `open_tasks_board` for the full-page board when MCP Apps are available.

The side panel URL is `sidecar://beads-tasks/tasks/`. Query parameters are `id` (one issue), `ids` (comma-separated review queue, up to 50), `clip=<id>` (copy without changing the current side panel view when `id` and `ids` are absent; legacy `id=<id>&clip=1` and `copy=1` copy and open detail), `title` (batch title), `repo` (repository path), and `project` (configured project ID). URL-encode parameter values as needed. Use `repo` or `project` to select another project.

For the first mention of each distinct ID:

- 1–5 IDs: `<id>` [⧉](sidecar://beads-tasks/tasks/?clip=<id>) [↗](sidecar://beads-tasks/tasks/?id=<id>)
- 6–10 IDs: `<id>` [↗](sidecar://beads-tasks/tasks/?id=<id>)
- More than 10: use plain inline-code IDs.

Do not attach `ids` to individual links. Subsequent mentions can be plain inline code. For two or more distinct IDs, deduplicate in appearance order, cap at 50, and call `show_task_batch` if available. End the response with a single live link on its own line:

[Open in Beads Tasks side panel](sidecar://beads-tasks/tasks/?ids=<id1>,<id2>)

If MCP Apps are unavailable use the fallback pill instead:

[Review this turn's tasks (N)](sidecar://beads-tasks/tasks/?ids=<id1>,<id2>)

Append `repo`, `project`, or `title` as appropriate. Never wrap live links in code fences in an actual response.
