export function queueNeighbors(id, queue) {
  const ids = Array.isArray(queue?.ids) ? queue.ids : [];
  const index = ids.indexOf(id);
  const visited = new Set(queue?.visitedIds || []);
  return { index, total: ids.length, prev: index > 0 ? ids[index - 1] : '', next: index >= 0 ? (ids[index + 1] || '') : '', visitedCount: ids.filter((item) => visited.has(item)).length };
}

export function shouldHandleQueueShortcut(event, ctx) {
  if (ctx.isEditable || ctx.composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || ctx.view !== 'detail') return null;
  if (ctx.hasQueue && ['ArrowLeft', '[', 'k', 'K'].includes(event.key)) return 'prev';
  if (ctx.hasQueue && ['ArrowRight', ']', 'j', 'J'].includes(event.key)) return 'next';
  if (event.key === 'Escape' && !ctx.findOpen) return 'back';
  if (event.key === 'c' && !ctx.hasSelection) return 'copy';
  return null;
}

export function shouldRestoreSavedQueue(saved, { id, project, repo, conversationId, activeProjectId }) {
  if (!id || !Array.isArray(saved?.ids) || !saved.ids.includes(id)) return false;
  if (String(saved.conversationId || '') !== String(conversationId || '')) return false;
  if (project && project !== (saved.project || saved.activeProjectId)) return false;
  if (repo && repo !== saved.repo) return false;
  if (saved.repo && !repo) return false;
  if (saved.project && !project && activeProjectId !== saved.project) return false;
  if (!project && !saved.project && saved.activeProjectId && activeProjectId !== saved.activeProjectId) return false;
  return true;
}
