export function formatBeadNotesForDisplay(notes) {
  if (typeof notes !== 'string' || !notes.trim()) return '';
  return notes.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '');
}
