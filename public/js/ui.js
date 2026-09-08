const TOAST_MS = 2600;
let toastTimer = null;

export const $ = (selector, root = document) => root.querySelector(selector);

export function toast(message, isError = false) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('err', isError);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.hidden = true), TOAST_MS);
}

export function fillSelect(select, entries, { keepFirst = false } = {}) {
  const first = keepFirst ? select.firstElementChild : null;
  select.replaceChildren(...(first ? [first] : []));
  for (const [value, label] of entries) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

export function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const RELATIVE_UNITS = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

/** Human-readable "3 hours ago" style string, or '' when the timestamp is unusable. */
export function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (absolute >= size || unit === 'second') {
      return RELATIVE.format(Math.round(seconds / size), unit);
    }
  }
  return '';
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
