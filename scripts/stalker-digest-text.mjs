// Generated summaries may end mid-sentence at their schema's 400-character cap.
// Preserve the stored evidence; display the complete sentences available to read.
export function readableSummary(text) {
  const value = String(text ?? '').trim();
  if (value.length < 380 || /[.!?…]["'”’)\]]*$/.test(value)) return value;
  const endings = [...value.matchAll(/[.!?…]["'”’)\]]*(?=\s|$)/g)];
  const last = endings.at(-1);
  return last ? value.slice(0, last.index + last[0].length) : `${value.replace(/\s+\S*$/, '')}…`;
}
