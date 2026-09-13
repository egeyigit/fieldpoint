import { api } from './api.js';
import { WORK_ORDER_PRIORITIES } from './constants.js';
import { $, relativeTime, setOptions, toast } from './ui.js';

/**
 * Recurring maintenance: the schedules that generate work orders, and the
 * templates they instantiate. Read-only for members; admins get the forms.
 */
export function createMaintenancePanel({ currentUser, getSites }) {
  const isAdmin = currentUser.role === 'admin';
  const scheduleList = $('#schedule-list');
  const templateList = $('#template-list');
  const errorBox = $('#maint-error');
  let templates = [];

  $('#schedule-form').hidden = !isAdmin;
  $('#template-form').hidden = !isAdmin;
  $('#run-maintenance').hidden = !isAdmin;

  setOptions($('#schedule-priority'), Object.entries(WORK_ORDER_PRIORITIES), { selected: 'normal' });

  function renderSchedules(schedules) {
    scheduleList.replaceChildren();
    $('#schedule-count').textContent = `${schedules.length} schedule${schedules.length === 1 ? '' : 's'}`;
    if (schedules.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No recurring maintenance yet.';
      scheduleList.append(empty);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const schedule of schedules) {
      const item = document.createElement('li');
      item.className = `wo-item${schedule.nextDueDate <= today ? ' overdue' : ''}`;

      const title = document.createElement('div');
      title.className = 'title';
      const name = document.createElement('span');
      name.textContent = schedule.title;
      const badge = document.createElement('span');
      badge.className = `badge priority-${schedule.priority}`;
      badge.textContent = WORK_ORDER_PRIORITIES[schedule.priority] ?? schedule.priority;
      title.append(name, badge);

      const sub = document.createElement('div');
      sub.className = 'sub';
      const every = schedule.intervalDays === 1 ? 'every day' : `every ${schedule.intervalDays} days`;
      sub.textContent = `${schedule.siteName} · ${every} · next ${schedule.nextDueDate}`;

      const meta = document.createElement('div');
      meta.className = 'sub meta';
      meta.textContent = schedule.lastGeneratedAt
        ? `last generated ${relativeTime(schedule.lastGeneratedAt)}`
        : 'never generated';

      item.append(title, sub, meta);
      if (isAdmin) item.append(removeButton(`Delete ${schedule.title}`, () => removeSchedule(schedule)));
      scheduleList.append(item);
    }
  }

  function renderTemplates(rows) {
    templateList.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No templates yet.';
      templateList.append(empty);
      return;
    }
    for (const template of rows) {
      const item = document.createElement('li');
      item.className = 'wo-item';
      const title = document.createElement('div');
      title.className = 'title';
      const name = document.createElement('span');
      name.textContent = template.name;
      title.append(name);
      const sub = document.createElement('div');
      sub.className = 'sub';
      const minutes = template.estimatedMinutes ? ` · ~${template.estimatedMinutes} min` : '';
      sub.textContent = `${template.items.length} checklist item${template.items.length === 1 ? '' : 's'}${minutes}`;
      item.append(title, sub);
      if (isAdmin) item.append(removeButton(`Delete ${template.name}`, () => removeTemplate(template)));
      templateList.append(item);
    }
  }

  function removeButton(label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost small edit-btn';
    button.textContent = 'Delete';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', handler);
    return button;
  }

  async function refresh() {
    errorBox.textContent = '';
    try {
      const [schedules, templateResult] = await Promise.all([api.listSchedules(), api.listTemplates()]);
      templates = templateResult.templates;
      renderSchedules(schedules.schedules);
      renderTemplates(templates);
      setOptions($('#schedule-site'), getSites().map((site) => [site.id, site.name]), { placeholder: 'Select a site' });
      setOptions($('#schedule-template'), templates.map((row) => [row.id, row.name]), { placeholder: 'No template' });
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  async function removeSchedule(schedule) {
    if (!window.confirm(`Delete the schedule “${schedule.title}”? Work orders it already created are kept.`)) return;
    try {
      await api.deleteSchedule(schedule.id);
      toast('Schedule deleted');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  async function removeTemplate(template) {
    if (!window.confirm(`Delete the template “${template.name}”?`)) return;
    try {
      await api.deleteTemplate(template.id);
      toast('Template deleted');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  $('#schedule-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    const form = event.target;
    const templateId = $('#schedule-template').value;
    try {
      await api.createSchedule({
        siteId: Number($('#schedule-site').value),
        title: form.elements.title.value.trim(),
        intervalDays: Number(form.elements.intervalDays.value),
        nextDueDate: form.elements.nextDueDate.value,
        priority: $('#schedule-priority').value,
        templateId: templateId === '' ? null : Number(templateId),
      });
      form.reset();
      toast('Schedule created');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#template-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    const form = event.target;
    const items = form.elements.items.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      await api.createTemplate({
        name: form.elements.name.value.trim(),
        title: form.elements.title.value.trim(),
        items,
      });
      form.reset();
      toast('Template created');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#run-maintenance').addEventListener('click', async () => {
    errorBox.textContent = '';
    try {
      const { created } = await api.runMaintenance();
      toast(created.length ? `Generated ${created.length} work order(s)` : 'Nothing was due');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  return { refresh, getTemplates: () => templates };
}
