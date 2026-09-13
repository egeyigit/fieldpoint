import { toCsv as writeCsv } from '../lib/csv.js';

const HEADERS = ['id', 'name', 'address', 'lat', 'lng', 'category', 'status', 'notes', 'assignedToName', 'createdAt', 'updatedAt'];

export function toCsv(rows) {
  return writeCsv(HEADERS, rows);
}
