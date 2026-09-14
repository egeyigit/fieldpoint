import { api } from './api.js';
import { $, absoluteTime, formValues, relativeTime, setOptions, todayIso, toast } from './ui.js';

export function createVisitsPanel({ currentUser, onChanged = () => {} }) {
  const section = $('#site-activity');
  const form = $('#visit-form');
  const list = $('#visit-list');
  const errorBox = $('#visit-error');
  let siteId = null;

  setOptions($('#visit-rating'), [[1, '1 ★'], [2, '2 ★'], [3, '3 ★'], [4, '4 ★'], [5, '5 ★']], {
    placeholder: 'No rating',
  });

  async function openSite(site) {
    siteId = site?.id ?? null;
    section.hidden = !site;
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
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost small visit-edit';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => item.replaceWith(renderEditForm(visit)));
      heading.append(edit);
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

  function renderEditForm(visit) {
    const item = document.createElement('li');
    const editForm = document.createElement('form');
    editForm.className = 'visit-edit-form';

    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.name = 'visitedAt';
    dateInput.value = String(visit.visitedAt).slice(0, 10);
    dateInput.required = true;

    const ratingSelect = document.createElement('select');
    ratingSelect.name = 'rating';
    setOptions(ratingSelect, [[1, '1 ★'], [2, '2 ★'], [3, '3 ★'], [4, '4 ★'], [5, '5 ★']], {
      placeholder: 'No rating',
    });
    ratingSelect.value = visit.rating ? String(visit.rating) : '';

    const noteInput = document.createElement('textarea');
    noteInput.name = 'note';
    noteInput.value = visit.note ?? '';

    const actions = document.createElement('div');
    actions.className = 'row';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'small';
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ghost small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => item.replaceWith(renderVisit(visit)));
    actions.append(save, cancel);

    editForm.append(dateInput, ratingSelect, noteInput, actions);
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = formValues(editForm);
      try {
        await api.updateVisit(visit.id, {
          visitedAt: values.visitedAt,
          rating: values.rating ? Number(values.rating) : null,
          note: values.note.trim(),
        });
        toast('Visit updated');
        await refresh();
        await onChanged();
      } catch (error) {
        toast(error.message);
      }
    });

    item.append(editForm);
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
