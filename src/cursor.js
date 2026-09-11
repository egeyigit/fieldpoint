import { HttpError } from './middleware/errors.js';

/**
 * Opaque keyset cursor utilities.
 *
 * A cursor is a base-64url JSON array whose elements mirror the ORDER BY
 * columns of the query that produced it.  The final element is always the
 * primary-key id so every cursor is unique even when the sort key repeats.
 */

export function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(opaque) {
  try {
    const parsed = JSON.parse(Buffer.from(opaque, 'base64url').toString());
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
}

/**
 * Build a keyset WHERE clause for "seek past this cursor".
 *
 * @param {object} opts
 * @param {string[]} opts.columns  SQL column expressions in ORDER BY order
 * @param {string[]} opts.directions  'ASC' | 'DESC' per column
 * @param {any[]}    opts.values   decoded cursor values (same length as columns)
 * @returns {{ sql: string, params: any[] }}
 *
 * For a two-column order `(a DESC, id DESC)` the clause is:
 *   (a < ? OR (a = ? AND id < ?))
 * For ASC the operator flips to `>`.
 *
 * NULL-aware: a NULL sort key sorts after everything in ASC and before
 * everything in DESC (matching SQLite default), so the comparisons use
 * IS NULL / IS NOT NULL guards.
 */
export function keysetWhereClause({ columns, directions, values }) {
  const parts = [];
  const params = [];

  for (let depth = 0; depth < columns.length; depth++) {
    const eqs = [];
    const eqParams = [];
    // All preceding columns must be equal
    for (let j = 0; j < depth; j++) {
      if (values[j] === null) {
        eqs.push(`${columns[j]} IS NULL`);
      } else {
        eqs.push(`${columns[j]} = ?`);
        eqParams.push(values[j]);
      }
    }
    // The column at `depth` must be strictly past the cursor value
    const col = columns[depth];
    const dir = directions[depth];
    const val = values[depth];
    let cmp;
    if (val === null) {
      // cursor value is NULL
      if (dir === 'ASC') {
        // NULL sorts last in ASC (SQLite default) — nothing comes after NULL
        // so this branch cannot match; skip entirely
        continue;
      } else {
        // NULL sorts first in DESC — everything non-NULL comes after
        cmp = `${col} IS NOT NULL`;
      }
    } else {
      if (dir === 'ASC') {
        // next value must be greater, OR be NULL (NULL sorts after non-NULL in ASC)
        cmp = `(${col} > ? OR ${col} IS NULL)`;
        eqParams.push(val);
      } else {
        // next value must be smaller; NULLs never match
        cmp = `(${col} < ? AND ${col} IS NOT NULL)`;
        eqParams.push(val);
      }
    }
    const conjunction = [...eqs, cmp].join(' AND ');
    parts.push(`(${conjunction})`);
    params.push(...eqParams);
  }

  if (parts.length === 0) return { sql: '1=0', params: [] };
  return { sql: parts.join(' OR '), params };
}
