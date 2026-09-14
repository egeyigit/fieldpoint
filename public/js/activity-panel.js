import { api } from './api.js';
import { $, absoluteTime, relativeTime } from './ui.js';

const PAGE_SIZE = 50;
const NOTE_EXCERPT = 120;

export function createActivityPanel({ onFocusSite = () => {} }) {
  const list = $('#activity-list');
  const count = $('#activity-count');
  const errorBox = $('#activity-error');
  const moreButton = $('#activity-more');
  let offset = 0;
  let total = 0;

  async function refresh() {
    offset = 0;
    list.replaceChildren();
    await loadPage();
  }

  async function loadPage() {
    errorBox.textContent = '';
    try {
      const result = await api.listAllVisits({ limit: PAGE_SIZE, offset });
      total = result.total;
      count.textContent = `${total} visit${total === 1 ? '' : 's'}`;
      if (offset === 0 && result.visits.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'No visits logged yet.';
        list.append(empty);
      } else {
        list.append(...result.visits.map(renderVisit));
      }
      offset += result.visits.length;
      moreButton.hidden = offset >= total;
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  function renderVisit(visit) {
    const item = document.createElement('li');
    const heading = document.createElement('div');
    heading.className = 'row between';

    const site = document.createElement('button');
    site.type = 'button';
    site.className = 'ghost small';
    site.textContent = visit.siteName;
    site.addEventListener('click', () => onFocusSite(visit.siteId));
    heading.append(site);

    if (visit.rating) {
      const rating = document.createElement('span');
      rating.className = 'visit-rating';
      rating.textContent = '★'.repeat(visit.rating);
      heading.append(rating);
    }
    item.append(heading);

    const meta = document.createElement('div');
    const author = document.createElement('b');
    author.textContent = visit.userName;
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = ` · ${relativeTime(visit.visitedAt)}`;
    when.title = absoluteTime(visit.visitedAt);
    meta.append(author, when);
    item.append(meta);

    if (visit.note) {
      const note = document.createElement('div');
      note.textContent = visit.note.length > NOTE_EXCERPT
        ? `${visit.note.slice(0, NOTE_EXCERPT)}…`
        : visit.note;
      item.append(note);
    }
    return item;
  }

  moreButton.addEventListener('click', () => loadPage());

  return { refresh };
}
