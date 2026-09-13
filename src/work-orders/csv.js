import { toCsv as writeCsv } from '../lib/csv.js';

const HEADERS = [
  'id', 'title', 'status', 'priority', 'siteName', 'assignedToName',
  'dueDate', 'completedAt', 'createdByName', 'createdAt', 'updatedAt',
];

export function toCsv(rows) {
  return writeCsv(HEADERS, rows);
}
