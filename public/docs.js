// Renders the served OpenAPI document at /docs using DOM APIs only, so nothing
// here needs inline scripts, eval, or a remote bundle the CSP would block.
const root = document.getElementById('docs');

function text(tag, className, value) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}

function renderOperation(method, path, op) {
  const card = text('div', 'op');
  const head = text('div', 'op-head');
  head.append(text('span', 'method', method));
  head.append(text('span', 'path', path));
  if (op.summary) head.append(text('span', 'summary', op.summary));
  const secured = Array.isArray(op.security) ? op.security.length > 0 : true;
  head.append(text('span', 'auth', secured ? 'fp_session cookie' : 'public'));
  card.append(head);

  const responses = op.responses || {};
  const list = text('ul', 'responses');
  for (const [status, res] of Object.entries(responses)) {
    list.append(text('li', null, `${status} — ${res.description || ''}`));
  }
  if (list.childElementCount) card.append(list);
  return card;
}

async function main() {
  let doc;
  try {
    doc = await (await fetch('/api/openapi.json')).json();
  } catch (error) {
    root.replaceChildren(text('p', null, 'Could not load the API contract.'));
    return;
  }

  const frag = document.createDocumentFragment();
  frag.append(text('h1', null, doc.info?.title || 'API'));
  frag.append(text('p', 'subtitle', doc.info?.description || ''));

  const byTag = new Map();
  for (const [path, item] of Object.entries(doc.paths || {})) {
    for (const [method, op] of Object.entries(item)) {
      if (method === 'parameters') continue;
      const tag = (op.tags && op.tags[0]) || 'other';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ method, path, op });
    }
  }

  for (const [tag, ops] of byTag) {
    frag.append(text('h2', null, tag));
    for (const { method, path, op } of ops) {
      frag.append(renderOperation(method, path, op));
    }
  }

  root.replaceChildren(frag);
}

main();
