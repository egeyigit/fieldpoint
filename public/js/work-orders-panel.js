import { api } from './api.js';
import { WORK_ORDER_PRIORITIES, WORK_ORDER_SORTS, WORK_ORDER_STATUSES } from './constants.js';
import { $, absoluteTime, relativeTime, setOptions, todayIso, toast } from './ui.js';

const DONE_STATUSES = new Set(['done', 'cancelled']);

/**
 * Work-order list, editor and comment thread. Sites are passed in rather than
 * fetched again so the two panels always agree on what exists.
 */
export function createWorkOrdersPanel({ currentUser, getSites, getTemplates = () => [], onFocusSite }) {
  const list = $('#wo-list');
  const dialog = $('#wo-dialog');
  const form = $('#wo-form');
  const errorBox = $('#wo-error');
  const commentList = $('#wo-comments');
  const commentForm = $('#wo-comment-form');
  const checklistBox = $('#wo-checklist');
  let openTimeLog = null;
  let orders = [];
  let directory = [];
  let openOrderId = null;

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
    // A template only applies at creation: an existing order owns its checklist.
    $('#wo-template-row').hidden = Boolean(order);
    if (!order) {
      setOptions($('#wo-template'), getTemplates().map((row) => [row.id, row.name]), { placeholder: 'No template' });
    }
  }

  function renderChecklist(items, progress) {
    checklistBox.replaceChildren();
    $('#wo-checklist-progress').textContent = progress.total
      ? `${progress.done}/${progress.total} done`
      : 'No checklist items';
    for (const item of items) {
      const row = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = item.isDone;
      box.addEventListener('change', () => toggleItem(item, box));
      const text = document.createElement('span');
      text.textContent = item.text;
      if (item.isDone) text.className = 'muted done';
      label.append(box, text);
      row.append(label);
      if (item.isDone && item.doneByName) {
        const who = document.createElement('span');
        who.className = 'muted mono';
        who.textContent = ` ${item.doneByName} · ${relativeTime(item.doneAt)}`;
        row.append(who);
      }
      checklistBox.append(row);
    }
  }

  async function toggleItem(item, box) {
    try {
      const result = await api.setChecklistItem(openOrderId, item.id, box.checked);
      renderChecklist(
        (await api.getWorkOrder(openOrderId)).checklist,
        result.progress,
      );
    } catch (error) {
      box.checked = item.isDone;
      errorBox.textContent = error.message;
    }
  }

  function renderTimer(timeLogs, totalMinutes, estimateDeltaMinutes) {
    openTimeLog = timeLogs.find((log) => log.endedAt === null && log.userId === currentUser.id) ?? null;
    $('#wo-timer').textContent = openTimeLog ? 'Stop timer' : 'Start timer';
    $('#wo-timer').classList.toggle('active', Boolean(openTimeLog));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    $('#wo-time-total').textContent = totalMinutes
      ? `${hours ? `${hours}h ` : ''}${minutes}m logged`
      : 'No time logged';
    // Nothing to show when there is no estimate: a zero delta would mislead.
    const estimate = $('#wo-estimate-delta');
    if (estimate) {
      if (estimateDeltaMinutes == null) {
        estimate.textContent = '';
        estimate.hidden = true;
      } else {
        estimate.hidden = false;
        if (estimateDeltaMinutes === 0) {
          estimate.textContent = 'on estimate';
        } else {
          const over = estimateDeltaMinutes > 0;
          estimate.textContent = `${Math.abs(estimateDeltaMinutes)}m ${over ? 'over' : 'under'} estimate`;
        }
      }
    }
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
    checklistBox.replaceChildren();
    dialog.showModal();
    if (order) await loadDetail(order.id);
  }

  /** One request feeds the comments, the checklist and the timer. */
  async function loadDetail(id) {
    try {
      const detail = await api.getWorkOrder(id);
      renderComments(detail.comments);
      renderChecklist(detail.checklist, {
        total: detail.checklist.length,
        done: detail.checklist.filter((item) => item.isDone).length,
      });
      renderTimer(detail.timeLogs, detail.totalMinutes, detail.estimateDeltaMinutes);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  function renderComments(comments) {
    {
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
        const templateId = $('#wo-template').value;
        await api.createWorkOrder({
          ...payload,
          templateId: templateId === '' ? null : Number(templateId),
        });
        toast('Work order created');
      }
      dialog.close();
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
      await loadDetail(openOrderId);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#wo-delete').addEventListener('click', async () => {
    if (!openOrderId || !window.confirm('Delete this work order and its comments?')) return;
    try {
      await api.deleteWorkOrder(openOrderId);
      dialog.close();
      toast('Work order deleted');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#wo-checklist-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.target.elements.text;
    const text = input.value.trim();
    if (!text || !openOrderId) return;
    try {
      await api.addChecklistItem(openOrderId, text);
      input.value = '';
      await loadDetail(openOrderId);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#wo-timer').addEventListener('click', async () => {
    if (!openOrderId) return;
    errorBox.textContent = '';
    try {
      if (openTimeLog) {
        await api.stopTimer(openOrderId);
        toast('Timer stopped');
      } else {
        await api.startTimer(openOrderId);
        toast('Timer running');
      }
      await loadDetail(openOrderId);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#wo-cancel').addEventListener('click', () => dialog.close());
  $('#wo-add').addEventListener('click', () => openEditor());
  for (const id of ['#wo-filter-status', '#wo-filter-priority', '#wo-sort', '#wo-filter-mine', '#wo-filter-open']) {
    $(id).addEventListener('change', refresh);
  }

  return { refresh, openEditor };
}
