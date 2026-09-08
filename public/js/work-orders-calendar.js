import { WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from './constants.js';
import { $, todayIso } from './ui.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const RANGE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Parse a YYYY-MM-DD string as a local calendar date (no timezone shift). */
function parseIso(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Format a Date as YYYY-MM-DD in local time, matching the API's due-date shape. */
function toIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Monday of the week containing `date`. */
function startOfWeek(date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - offset);
  return copy;
}

/**
 * Month/week calendar for work orders. Orders sit on their due date, coloured
 * by priority; undated orders live in a side rail. Drag-and-drop and a keyboard
 * "pick up / drop" flow both reschedule through `onReschedule(id, dueDate)`.
 */
export function createWorkOrderCalendar({ onOpen, onReschedule }) {
  const grid = $('#wo-cal-grid');
  const unscheduled = $('#wo-unscheduled-list');
  const label = $('#wo-cal-label');
  let mode = 'month';
  let anchor = parseIso(todayIso());
  let orders = [];
  let picked = null;

  function days() {
    if (mode === 'week') {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
    }
    const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = startOfWeek(firstOfMonth);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
  }

  function labelText() {
    if (mode === 'week') {
      const cells = days();
      return `${RANGE_FORMAT.format(cells[0])} \u2013 ${RANGE_FORMAT.format(cells[6])}`;
    }
    return MONTH_FORMAT.format(anchor);
  }

  function chip(order) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `wo-chip priority-${order.priority}`;
    item.draggable = true;
    item.dataset.id = String(order.id);
    item.textContent = order.title;
    item.title = `${order.title} \u2014 ${WORK_ORDER_PRIORITIES[order.priority] ?? order.priority} \u00b7 ${WORK_ORDER_STATUSES[order.status] ?? order.status}`;
    item.addEventListener('click', () => onOpen(order));
    item.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', String(order.id));
      event.dataTransfer.effectAllowed = 'move';
    });
    return item;
  }

  function setPicked(order, element) {
    if (picked && picked.element) picked.element.classList.remove('picked');
    if (order) {
      picked = { order, element };
      element.classList.add('picked');
    } else {
      picked = null;
    }
  }

  function keyChip(order) {
    const item = chip(order);
    item.addEventListener('keydown', (event) => {
      // Space picks the order up; Enter opens it (default click handles that).
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        setPicked(picked && picked.order.id === order.id ? null : order, item);
      }
    });
    return item;
  }

  function drop(target, dueDate) {
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      target.classList.add('drop-target');
    });
    target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      target.classList.remove('drop-target');
      const id = Number(event.dataTransfer.getData('text/plain'));
      if (id) onReschedule(id, dueDate);
    });
    target.addEventListener('click', (event) => {
      // Clicking empty space in a picked-up state drops the order there.
      if (picked && event.target === target) {
        const id = picked.order.id;
        setPicked(null);
        onReschedule(id, dueDate);
      }
    });
  }

  function render(next = orders) {
    orders = next;
    label.textContent = labelText();
    grid.replaceChildren();
    grid.classList.toggle('week', mode === 'week');

    for (const name of WEEKDAYS) {
      const head = document.createElement('div');
      head.className = 'wo-cal-head';
      head.textContent = name;
      grid.append(head);
    }

    const today = todayIso();
    const thisMonth = anchor.getMonth();
    for (const date of days()) {
      const iso = toIso(date);
      const cell = document.createElement('div');
      cell.className = 'wo-cal-cell';
      if (iso === today) cell.classList.add('today');
      if (mode === 'month' && date.getMonth() !== thisMonth) cell.classList.add('other-month');

      const dayLabel = document.createElement('div');
      dayLabel.className = 'wo-cal-daynum';
      dayLabel.textContent = String(date.getDate());
      cell.append(dayLabel);

      for (const order of orders.filter((o) => o.dueDate === iso)) {
        cell.append(keyChip(order));
      }
      drop(cell, iso);
      grid.append(cell);
    }

    unscheduled.replaceChildren();
    const undated = orders.filter((order) => !order.dueDate);
    if (undated.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Everything is scheduled.';
      unscheduled.append(empty);
    } else {
      for (const order of undated) {
        const item = document.createElement('li');
        item.append(keyChip(order));
        unscheduled.append(item);
      }
    }
    drop(unscheduled, null);
  }

  function shift(direction) {
    if (mode === 'week') {
      anchor = new Date(anchor.getTime() + direction * 7 * DAY_MS);
    } else {
      anchor = new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
    }
    render();
  }

  function setMode(next) {
    mode = next;
    $('#wo-cal-month').classList.toggle('active', next === 'month');
    $('#wo-cal-month').setAttribute('aria-selected', String(next === 'month'));
    $('#wo-cal-week').classList.toggle('active', next === 'week');
    $('#wo-cal-week').setAttribute('aria-selected', String(next === 'week'));
    render();
  }

  $('#wo-cal-prev').addEventListener('click', () => shift(-1));
  $('#wo-cal-next').addEventListener('click', () => shift(1));
  $('#wo-cal-today').addEventListener('click', () => {
    anchor = parseIso(todayIso());
    render();
  });
  $('#wo-cal-month').addEventListener('click', () => setMode('month'));
  $('#wo-cal-week').addEventListener('click', () => setMode('week'));

  return { render };
}
