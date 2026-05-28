export function truncateForLog(str, maxLen = 80) {
  if (typeof str !== 'string') return String(str);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + `...[${str.length} chars]`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function logBox(title, lines) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ┌─── ${title} ───`);
  for (const line of lines) {
    console.log(`[${ts}] │ ${line}`);
  }
  console.log(`[${ts}] └${'─'.repeat(title.length + 6)}`);
}
