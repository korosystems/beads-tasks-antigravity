export const MAX_FIND_MARKS = 2000;

export function normalizeFindQuery(raw) {
  return String(raw ?? '').trim();
}

export function findTextRanges(text, query, options = {}) {
  const source = String(text ?? '');
  const needle = normalizeFindQuery(query);
  if (!source || !needle) {
    return { ranges: [], truncated: false };
  }

  const caseSensitive = options?.caseSensitive === true;
  const maxMatches =
    Number.isFinite(options?.maxMatches) && options.maxMatches >= 0
      ? Math.floor(options.maxMatches)
      : Infinity;

  const haystack = caseSensitive ? source : source.toLowerCase();
  const target = caseSensitive ? needle : needle.toLowerCase();

  if (!target) {
    return { ranges: [], truncated: false };
  }

  const ranges = [];
  let cursor = 0;
  let truncated = false;

  while (cursor <= haystack.length - target.length) {
    const idx = haystack.indexOf(target, cursor);
    if (idx === -1) break;
    if (ranges.length >= maxMatches) {
      truncated = true;
      break;
    }
    const end = idx + target.length;
    ranges.push({ start: idx, end });
    cursor = end;
  }

  return { ranges, truncated };
}

export function splitTextByMatches(text, query, options = {}) {
  const source = String(text ?? '');
  const { ranges, truncated } = findTextRanges(source, query, options);
  if (!ranges.length) {
    return {
      segments: source ? [{ text: source, matched: false }] : [],
      truncated,
    };
  }

  const segments = [];
  let pos = 0;
  for (const { start, end } of ranges) {
    if (start > pos) {
      segments.push({ text: source.slice(pos, start), matched: false });
    }
    segments.push({ text: source.slice(start, end), matched: true });
    pos = end;
  }
  if (pos < source.length) {
    segments.push({ text: source.slice(pos), matched: false });
  }

  return { segments, truncated };
}

export function nextMatchIndex(currentIndex, total, delta = 1) {
  if (!Number.isFinite(total) || total <= 0) return -1;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= total) {
    return delta < 0 ? total - 1 : 0;
  }
  return (((currentIndex + delta) % total) + total) % total;
}

export function shouldHandleFindShortcut(
  eventLike,
  { isEditable = false, findOpen = false, hasQuery = false } = {},
) {
  if (!eventLike) return null;
  if (eventLike.isComposing || eventLike.keyCode === 229) return null;

  const key = typeof eventLike.key === 'string' ? eventLike.key : '';
  const lower = key.toLowerCase();
  const metaOrCtrl = Boolean(eventLike.metaKey || eventLike.ctrlKey);
  const alt = Boolean(eventLike.altKey);
  const shift = Boolean(eventLike.shiftKey);

  if (metaOrCtrl && !alt && lower === 'f') {
    return 'open';
  }
  if (metaOrCtrl && !alt && lower === 'g') {
    return findOpen && hasQuery ? (shift ? 'prev' : 'next') : null;
  }
  if (key === 'F3' && !metaOrCtrl && !alt) {
    return findOpen && hasQuery ? (shift ? 'prev' : 'next') : null;
  }
  if (key === '/' && !metaOrCtrl && !alt && !isEditable) {
    return 'open';
  }
  if (key === 'Escape' && findOpen && !metaOrCtrl && !alt) {
    return 'close';
  }
  return null;
}
