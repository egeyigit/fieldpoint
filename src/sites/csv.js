const HEADERS = ['id', 'name', 'address', 'lat', 'lng', 'category', 'status', 'notes', 'assignedToName', 'createdAt', 'updatedAt'];

/** Neutralises spreadsheet formula injection, then quotes a single CSV cell. */
export function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Renders rows to CSV text with a leading header line, one column per header key. */
export function toCsvRows(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => escapeCsvCell(row[key])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function toCsv(rows) {
  return toCsvRows(HEADERS, rows);
}
