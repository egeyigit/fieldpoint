import { HttpError } from '../../middleware/errors.js';

/**
 * Reads the whole request body up to maxBytes. Rejects with 413 once the cap is
 * exceeded so a large upload cannot exhaust memory.
 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        aborted = true;
        reject(new HttpError(413, 'File too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!aborted) reject(error);
    });
  });
}

function boundaryFrom(contentType) {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  return (match[1] ?? match[2]).trim();
}

function parseDisposition(headerBlock) {
  const result = {};
  const nameMatch = /name="([^"]*)"/i.exec(headerBlock);
  if (nameMatch) result.name = nameMatch[1];
  const fileMatch = /filename="([^"]*)"/i.exec(headerBlock);
  if (fileMatch) result.filename = fileMatch[1];
  const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerBlock);
  if (typeMatch) result.contentType = typeMatch[1].trim();
  return result;
}

/**
 * Parses a multipart/form-data body and returns the first file part found:
 * { filename, contentType, data }. Throws HttpError(400) when the request is
 * not a well-formed multipart upload with a file part.
 */
export async function parseSingleFile(req, { maxBytes }) {
  const boundary = boundaryFrom(req.headers['content-type']);
  if (!boundary) throw new HttpError(400, 'Expected multipart/form-data');
  const body = await readBody(req, maxBytes);
  const delimiter = Buffer.from(`--${boundary}`);
  const separator = Buffer.from('\r\n\r\n');

  let cursor = body.indexOf(delimiter);
  while (cursor !== -1) {
    const partStart = cursor + delimiter.length;
    if (body.slice(partStart, partStart + 2).toString() === '--') break;
    const headerStart = partStart + 2; // skip trailing CRLF after boundary
    const headerEnd = body.indexOf(separator, headerStart);
    if (headerEnd === -1) break;
    const headerBlock = body.slice(headerStart, headerEnd).toString('utf8');
    const disposition = parseDisposition(headerBlock);
    const contentStart = headerEnd + separator.length;
    const next = body.indexOf(delimiter, contentStart);
    if (next === -1) break;
    const content = body.slice(contentStart, next - 2); // drop trailing CRLF
    if (disposition.filename) {
      return { filename: disposition.filename, contentType: disposition.contentType ?? '', data: content };
    }
    cursor = next;
  }

  throw new HttpError(400, 'No file part in upload');
}
