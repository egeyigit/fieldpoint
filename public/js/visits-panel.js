import { api } from './api.js';
import { $, absoluteTime, formValues, relativeTime, setOptions, todayIso, toast } from './ui.js';

export function createVisitsPanel({ currentUser, onChanged = () => {} }) {
  const section = $('#site-activity');
  const form = $('#visit-form');
  const list = $('#visit-list');
  const errorBox = $('#visit-error');
  let siteId = null;

  const exportLink = document.createElement('a');
  exportLink.className = 'ghost small visit-export';
  exportLink.textContent = 'Export CSV';
  exportLink.setAttribute('download', '');
  form.append(exportLink);

  setOptions($('#visit-rating'), [[1, '1 ★'], [2, '2 ★'], [3, '3 ★'], [4, '4 ★'], [5, '5 ★']], {
    placeholder: 'No rating',
  });

  async function openSite(site) {
    siteId = site?.id ?? null;
    section.hidden = !site;
    exportLink.hidden = !site;
    if (site) exportLink.href = `/api/sites/${site.id}/visits/export.csv`;
    if (!site) return;
    form.reset();
    form.elements.visitedAt.value = todayIso();
    errorBox.textContent = '';
    await refresh();
  }

  async function refresh() {
    if (!siteId) return;
    try {
      const result = await api.listSiteVisits(siteId);
      $('#visit-count').textContent = `${result.total} visit${result.total === 1 ? '' : 's'}`;
      render(result.visits);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  function render(visits) {
    if (visits.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No visits logged yet.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...visits.map(renderVisit));
  }

  function renderVisit(visit) {
    const item = document.createElement('li');
    const heading = document.createElement('div');
    heading.className = 'row between';
    const identity = document.createElement('span');
    const author = document.createElement('b');
    author.textContent = visit.userName;
    const when = document.createElement('span');
    when.className = 'muted';
    when.textContent = ` · ${relativeTime(visit.visitedAt)}`;
    when.title = absoluteTime(visit.visitedAt);
    identity.append(author, when);
    heading.append(identity);
    if (visit.rating) {
      const rating = document.createElement('span');
      rating.className = 'visit-rating';
      rating.textContent = '★'.repeat(visit.rating);
      heading.append(rating);
    }
    if (visit.userId === currentUser.id || currentUser.role === 'admin') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ghost small visit-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => deleteVisit(visit.id));
      heading.append(remove);
    }
    item.append(heading);
    if (visit.note) {
      const note = document.createElement('div');
      note.textContent = visit.note;
      item.append(note);
    }
    return item;
  }

  async function deleteVisit(id) {
    if (!window.confirm('Delete this visit?')) return;
    try {
      await api.deleteVisit(id);
      toast('Visit deleted');
      await refresh();
      await onChanged();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!siteId) return;
    errorBox.textContent = '';
    const values = formValues(form);
    try {
      await api.createVisit(siteId, {
        visitedAt: values.visitedAt,
        rating: values.rating ? Number(values.rating) : null,
        note: values.note.trim(),
      });
      form.elements.note.value = '';
      form.elements.rating.value = '';
      toast('Visit logged');
      await refresh();
      await onChanged();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  return { openSite, refresh };
}
