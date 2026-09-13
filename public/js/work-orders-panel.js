import { api } from './api.js';
import { WORK_ORDER_PRIORITIES, WORK_ORDER_SORTS, WORK_ORDER_STATUSES } from './constants.js';
import { guardDialog } from './dialog-guard.js';
import { $, absoluteTime, relativeTime, setOptions, todayIso, toast } from './ui.js';

const DONE_STATUSES = new Set(['done', 'cancelled']);

/**
 * Work-order list, editor and comment thread. Sites are passed in rather than
 * fetched again so the two panels always agree on what exists.
 */
export function createWorkOrdersPanel({ currentUser, getSites, onFocusSite }) {
  const list = $('#wo-list');
  const dialog = $('#wo-dialog');
  const form = $('#wo-form');
  const errorBox = $('#wo-error');
  const commentList = $('#wo-comments');
  const commentForm = $('#wo-comment-form');
  let orders = [];
  let directory = [];
  let openOrderId = null;

  const draftFields = () => ({
    siteId: $('#wo-site').value,
    title: form.elements.title.value,
    description: form.elements.description.value,
    status: $('#wo-status').value,
    priority: $('#wo-priority').value,
    assignedTo: $('#wo-assigned').value,
    dueDate: form.elements.dueDate.value,
  });

  const guard = guardDialog(dialog, form, {
    key: 'work-order',
    serialize: draftFields,
  });

  setOptions($('#wo-filter-status'), Object.entries(WORK_ORDER_STATUSES), { placeholder: 'Any status' });
  setOptions($('#wo-filter-priority'), Object.entries(WORK_ORDER_PRIORITIES), { placeholder: 'Any priority' });
  setOptions($('#wo-sort'), Object.entries(WORK_ORDER_SORTS), { selected: 'due' });
  setOptions($('#wo-status'), Object.entries(WORK_ORDER_STATUSES));
  setOptions($('#wo-priority'), Object.entries(WORK_ORDER_PRIORITIES), { selected: 'normal' });

  function filters() {
    const query = { sort: $('#wo-sort').value };
    const status = $('#wo-filter-status').value;
    const priority = $('#wo-filter-priority').value;
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if ($('#wo-filter-mine').checked) query.assignedTo = currentUser.id;
    if ($('#wo-filter-open').checked) query.openOnly = 'true';
    return query;
  }

  function isOverdue(order) {
    return Boolean(order.dueDate) && order.dueDate < todayIso() && !DONE_STATUSES.has(order.status);
  }

  function renderList() {
    list.replaceChildren();
    $('#wo-count').textContent = `${orders.length} work order${orders.length === 1 ? '' : 's'}`;
    if (orders.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing here. Create a work order for a site.';
      list.append(empty);
      return;
    }
    for (const order of orders) {
      const item = document.createElement('li');
      item.className = `wo-item${isOverdue(order) ? ' overdue' : ''}`;

      const title = document.createElement('div');
      title.className = 'title';
      const name = document.createElement('span');
      name.textContent = order.title;
      const priority = document.createElement('span');
      priority.className = `badge priority-${order.priority}`;
      priority.textContent = WORK_ORDER_PRIORITIES[order.priority] ?? order.priority;
      title.append(name, priority);

      const meta = document.createElement('div');
      meta.className = 'sub';
      const due = order.dueDate ? `due ${order.dueDate}` : 'no due date';
      const who = order.assignedToName ? `· ${order.assignedToName}` : '· unassigned';
      meta.textContent = `${WORK_ORDER_STATUSES[order.status] ?? order.status} · ${due} ${who}`;

      const site = document.createElement('button');
      site.type = 'button';
      site.className = 'link-btn';
      site.textContent = order.siteName;
      site.title = `Show ${order.siteName} on the map`;
      site.addEventListener('click', (event) => {
        event.stopPropagation();
        onFocusSite(order.siteId);
      });

      item.append(title, meta, site);
      item.addEventListener('click', () => openEditor(order));
      list.append(item);
    }
  }

  async function refresh() {
    try {
      const [result, people] = await Promise.all([api.listWorkOrders(filters()), api.directory()]);
      orders = result.workOrders;
      directory = people.users;
      renderList();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function fillSelects(order) {
    setOptions(
      $('#wo-site'),
      getSites().map((site) => [site.id, site.name]),
      { placeholder: 'Select a site', selected: order?.siteId ?? '' },
    );
    setOptions(
      $('#wo-assigned'),
      directory.map((user) => [user.id, user.name]),
      { placeholder: 'Unassigned', selected: order?.assignedTo ?? '' },
    );
    setOptions($('#wo-status'), Object.entries(WORK_ORDER_STATUSES), { selected: order?.status ?? 'open' });
    setOptions($('#wo-priority'), Object.entries(WORK_ORDER_PRIORITIES), { selected: order?.priority ?? 'normal' });
  }

  async function openEditor(order = null, preset = {}) {
    form.reset();
    errorBox.textContent = '';
    openOrderId = order?.id ?? null;
    $('#wo-dialog-title').textContent = order ? 'Work order' : 'New work order';
    $('#wo-delete').hidden = !(order && currentUser.role === 'admin');
    $('#wo-comment-section').hidden = !order;
    fillSelects(order ?? preset);
    form.elements.title.value = order?.title ?? '';
    form.elements.description.value = order?.description ?? '';
    form.elements.dueDate.value = order?.dueDate ?? '';
    if (preset.siteId) $('#wo-site').value = preset.siteId;
    $('#wo-meta').textContent = order
      ? `Created ${relativeTime(order.createdAt)} by ${order.createdByName ?? 'unknown'}`
      : '';
    $('#wo-meta').title = order ? absoluteTime(order.createdAt) : '';
    commentList.replaceChildren();
    const draft = guard.readDraft();
    if (draft) {
      if (draft.siteId) $('#wo-site').value = draft.siteId;
      form.elements.title.value = draft.title ?? '';
      form.elements.description.value = draft.description ?? '';
      if (draft.status) $('#wo-status').value = draft.status;
      if (draft.priority) $('#wo-priority').value = draft.priority;
      if (draft.assignedTo) $('#wo-assigned').value = draft.assignedTo;
      form.elements.dueDate.value = draft.dueDate ?? '';
    }
    guard.markPristine();
    dialog.showModal();
    if (order) await loadComments(order.id);
  }

  async function loadComments(id) {
    try {
      const { comments } = await api.getWorkOrder(id);
      commentList.replaceChildren(
        ...comments.map((comment) => {
          const item = document.createElement('li');
          const author = document.createElement('b');
          author.textContent = comment.authorName ?? 'removed user';
          const when = document.createElement('span');
          when.className = 'muted';
          when.textContent = ` · ${relativeTime(comment.createdAt)}`;
          when.title = absoluteTime(comment.createdAt);
          const body = document.createElement('div');
          body.textContent = comment.body;
          item.append(author, when, body);
          return item;
        }),
      );
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  function readForm() {
    const assigned = $('#wo-assigned').value;
    return {
      siteId: Number($('#wo-site').value),
      title: form.elements.title.value.trim(),
      description: form.elements.description.value.trim(),
      status: $('#wo-status').value,
      priority: $('#wo-priority').value,
      assignedTo: assigned === '' ? null : Number(assigned),
      dueDate: form.elements.dueDate.value || null,
    };
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    const payload = readForm();
    if (!payload.siteId) {
      errorBox.textContent = 'Choose a site for this work order';
      return;
    }
    try {
      if (openOrderId) {
        const { siteId, ...changes } = payload;
        await api.updateWorkOrder(openOrderId, changes);
        toast('Work order updated');
      } else {
        await api.createWorkOrder(payload);
        toast('Work order created');
      }
      guard.close();
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  commentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = commentForm.elements.body;
    const body = input.value.trim();
    if (!body || !openOrderId) return;
    try {
      await api.addWorkOrderComment(openOrderId, body);
      input.value = '';
      await loadComments(openOrderId);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#wo-delete').addEventListener('click', async () => {
    if (!openOrderId || !window.confirm('Delete this work order and its comments?')) return;
    try {
      await api.deleteWorkOrder(openOrderId);
      guard.close();
      toast('Work order deleted');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#wo-cancel').addEventListener('click', () => guard.requestClose());
  $('#wo-add').addEventListener('click', () => openEditor());
  for (const id of ['#wo-filter-status', '#wo-filter-priority', '#wo-sort', '#wo-filter-mine', '#wo-filter-open']) {
    $(id).addEventListener('change', refresh);
  }

  return { refresh, openEditor };
}
