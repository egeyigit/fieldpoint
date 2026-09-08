const HEADERS = ['id', 'name', 'address', 'lat', 'lng', 'category', 'status', 'notes', 'assignedToName', 'createdAt', 'updatedAt'];

function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function csvHeaderLine() {
  return HEADERS.join(',');
}

export function csvRowLine(row) {
  return HEADERS.map((key) => escapeCell(row[key])).join(',');
}

export function toCsv(rows) {
  const lines = [csvHeaderLine()];
  for (const row of rows) lines.push(csvRowLine(row));
  return `${lines.join('\r\n')}\r\n`;
}
