const RELATIVE_UNITS = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 days ago" for an ISO timestamp; empty string when there is nothing to show. */
export function relativeTime(isoString) {
  if (!isoString) return '';
  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) return '';
  const elapsed = parsed - Date.now();
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) return relativeFormat.format(Math.round(elapsed / size), unit);
  }
  return relativeFormat.format(Math.round(elapsed / 1000), 'second');
}

export function absoluteTime(isoString) {
  if (!isoString) return '';
  const parsed = Date.parse(isoString);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toLocaleString();
}

/** Today in YYYY-MM-DD, matching the API's due-date format. */
export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
