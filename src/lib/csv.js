function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Renders rows as RFC-4180 CSV using the given ordered header keys. */
export function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => escapeCell(row[key])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
