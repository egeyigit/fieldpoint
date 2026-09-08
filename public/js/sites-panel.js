import { api, geocode } from './api.js';
import { CATEGORIES, STATUSES } from './constants.js';
import { $, fillSelect, formValues, toast } from './ui.js';

const VIEWPORT_LIMIT = 1000;
const SIDEBAR_PAGE_SIZE = 50;

/** Sidebar list + editor dialog for sites. State lives here; map is notified via callbacks. */
export function createSitesPanel({ mapView, currentUser }) {
  const list = $('#site-list');
  const dialog = $('#site-dialog');
  const form = $('#site-form');
  const errorBox = $('#site-error');
  let sites = [];
  let total = 0;
  let visiblePages = 1;
  let selectedId = null;
  let inFlight = null;

  fillSelect($('#filter-category'), Object.entries(CATEGORIES).map(([key, value]) => [key, value.label]), { keepFirst: true });
  fillSelect($('#filter-status'), Object.entries(STATUSES), { keepFirst: true });
  fillSelect($('#form-category'), Object.entries(CATEGORIES).map(([key, value]) => [key, value.label]));
  fillSelect($('#form-status'), Object.entries(STATUSES));

  function currentFilters() {
    const params = {};
    const q = $('#search').value.trim();
    const category = $('#filter-category').value;
    const status = $('#filter-status').value;
    if (q) params.q = q;
    if (category) params.category = category;
    if (status) params.status = status;
    return params;
  }

  function renderList() {
    list.replaceChildren();
    $('#site-count').textContent =
      total > sites.length
        ? `${sites.length} of ${total} sites in view`
        : `${sites.length} site${sites.length === 1 ? '' : 's'}`;
    $('#export-btn').href = `/api/sites/export.csv?${new URLSearchParams(currentFilters())}`;
    if (sites.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No sites match. Add one with “+ Add site” or right-click the map.';
      list.append(empty);
      return;
    }
    const shown = sites.slice(0, visiblePages * SIDEBAR_PAGE_SIZE);
    for (const site of shown) {
      const item = document.createElement('li');
      item.className = `site-item${site.id === selectedId ? ' selected' : ''}`;
      item.dataset.id = site.id;
      const title = document.createElement('div');
      title.className = 'title';
      const name = document.createElement('span');
      name.textContent = site.name;
      const badge = document.createElement('span');
      badge.className = `badge ${site.status}`;
      badge.textContent = STATUSES[site.status] ?? site.status;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'ghost small edit-btn';
      edit.textContent = 'Edit';
      edit.setAttribute('aria-label', `Edit ${site.name}`);
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        openEditor(site);
      });
      const right = document.createElement('span');
      right.className = 'row gap';
      right.append(badge, edit);
      title.append(name, right);
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${CATEGORIES[site.category]?.label ?? site.category} · ${site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`}`;
      item.append(title, sub);
      item.addEventListener('click', () => select(site.id));
      item.addEventListener('dblclick', () => openEditor(site));
      list.append(item);
    }
    if (shown.length < sites.length) {
      const more = document.createElement('li');
      more.className = 'site-item more';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost small';
      button.textContent = `Show more (${sites.length - shown.length} remaining)`;
      button.addEventListener('click', () => {
        visiblePages += 1;
        renderList();
      });
      more.append(button);
      list.append(more);
    }
  }

  function select(id) {
    selectedId = id;
    renderList();
    mapView.focus(id);
  }

  async function refresh({ fit = false } = {}) {
    // Cancel any request the user or map has already moved past.
    if (inFlight) inFlight.abort();
    const controller = new AbortController();
    inFlight = controller;
    const params = { ...currentFilters(), limit: VIEWPORT_LIMIT, offset: 0, ...mapView.bounds() };
    try {
      const result = await api.listSites(params, { signal: controller.signal });
      sites = result.sites;
      total = result.total;
      visiblePages = 1;
      renderList();
      mapView.render(sites);
      if (fit) mapView.fitAll(sites);
    } catch (error) {
      // A superseded request was aborted on purpose; the newer one owns the UI.
      if (error.name === 'AbortError') return;
      toast(error.message, true);
    } finally {
      if (inFlight === controller) inFlight = null;
    }
  }

  function openEditor(site = null, preset = {}) {
    form.reset();
    errorBox.textContent = '';
    $('#site-dialog-title').textContent = site ? 'Edit site' : 'New site';
    $('#delete-btn').hidden = !(site && currentUser.role === 'admin');
    const values = site ?? { category: 'client', status: 'active', ...preset };
    for (const [key, value] of Object.entries(values)) {
      if (form.elements[key]) form.elements[key].value = value ?? '';
    }
    dialog.showModal();
  }

  async function submitEditor(event) {
    event.preventDefault();
    const { id, ...data } = formValues(form);
    try {
      if (id) {
        await api.updateSite(id, data);
        toast('Site updated');
      } else {
        await api.createSite(data);
        toast('Site created');
      }
      dialog.close();
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  async function deleteCurrent() {
    const id = form.elements.id.value;
    const site = sites.find((entry) => String(entry.id) === id);
    if (!id || !window.confirm(`Delete “${site?.name ?? 'this site'}”? This cannot be undone.`)) return;
    try {
      await api.deleteSite(id);
      dialog.close();
      selectedId = null;
      toast('Site deleted');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  async function locateAddress() {
    const address = form.elements.address.value.trim();
    if (!address) return (errorBox.textContent = 'Enter an address first');
    errorBox.textContent = '';
    try {
      const hit = await geocode(address);
      form.elements.lat.value = hit.lat.toFixed(6);
      form.elements.lng.value = hit.lng.toFixed(6);
      toast(`Found: ${hit.label}`);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  form.addEventListener('submit', submitEditor);
  $('#cancel-btn').addEventListener('click', () => dialog.close());
  $('#delete-btn').addEventListener('click', deleteCurrent);
  $('#geocode-btn').addEventListener('click', locateAddress);
  $('#add-btn').addEventListener('click', () => openEditor());

  return { refresh, select, openEditor };
}
