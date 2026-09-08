import { api, geocode } from './api.js';
import { CATEGORIES, STATUSES } from './constants.js';
import { $, fillSelect, formValues, toast } from './ui.js';

const PAGE_SIZE = 1000;
const MAX_SITES = 10000;

/** Sidebar list + editor dialog for sites. State lives here; map is notified via callbacks. */
export function createSitesPanel({ mapView, currentUser }) {
  const list = $('#site-list');
  const dialog = $('#site-dialog');
  const form = $('#site-form');
  const errorBox = $('#site-error');
  let sites = [];
  let selectedId = null;
  const selected = new Set();

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

  function updateBulkBar() {
    const bar = $('#bulk-bar');
    bar.hidden = selected.size === 0;
    $('#bulk-count').textContent = `${selected.size} selected`;
    $('#bulk-delete-btn').hidden = currentUser.role !== 'admin';
    const all = $('#select-all');
    all.checked = sites.length > 0 && selected.size === sites.length;
    all.indeterminate = selected.size > 0 && selected.size < sites.length;
  }

  function renderList() {
    list.replaceChildren();
    for (const id of [...selected]) {
      if (!sites.some((site) => site.id === id)) selected.delete(id);
    }
    $('#site-count').textContent = `${sites.length} site${sites.length === 1 ? '' : 's'}`;
    updateBulkBar();
    $('#export-btn').href = `/api/sites/export.csv?${new URLSearchParams(currentFilters())}`;
    if (sites.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No sites match. Add one with “+ Add site” or right-click the map.';
      list.append(empty);
      return;
    }
    for (const site of sites) {
      const item = document.createElement('li');
      item.className = `site-item${site.id === selectedId ? ' selected' : ''}`;
      item.dataset.id = site.id;
      const title = document.createElement('div');
      title.className = 'title';
      const left = document.createElement('span');
      left.className = 'row gap';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'select-box';
      check.checked = selected.has(site.id);
      check.setAttribute('aria-label', `Select ${site.name}`);
      check.addEventListener('click', (event) => event.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) selected.add(site.id);
        else selected.delete(site.id);
        updateBulkBar();
      });
      const name = document.createElement('span');
      name.textContent = site.name;
      left.append(check, name);
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
      title.append(left, right);
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${CATEGORIES[site.category]?.label ?? site.category} · ${site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`}`;
      item.append(title, sub);
      item.addEventListener('click', () => select(site.id));
      item.addEventListener('dblclick', () => openEditor(site));
      list.append(item);
    }
  }

  function select(id) {
    selectedId = id;
    renderList();
    mapView.focus(id);
  }

  /** Pages through the API until every matching site is loaded (bounded by MAX_SITES). */
  async function fetchAllSites(filters) {
    const collected = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total && collected.length < MAX_SITES) {
      const result = await api.listSites({ ...filters, limit: PAGE_SIZE, offset });
      collected.push(...result.sites);
      total = result.total;
      offset += PAGE_SIZE;
      if (result.sites.length === 0) break;
    }
    return { sites: collected, total };
  }

  async function refresh({ fit = false } = {}) {
    try {
      const result = await fetchAllSites(currentFilters());
      sites = result.sites;
      if (result.total > sites.length) {
        toast(`Showing ${sites.length} of ${result.total} sites — narrow the filters to see the rest`, true);
      }
      renderList();
      mapView.render(sites);
      if (fit) mapView.fitAll(sites);
    } catch (error) {
      toast(error.message, true);
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

  async function applyBulk(changes, confirmMessage) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    try {
      await api.bulkUpdateSites(ids, changes);
      selected.clear();
      toast(`Updated ${ids.length} site${ids.length === 1 ? '' : 's'}`);
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function bulkStatus() {
    const status = window.prompt(`Set status (${Object.keys(STATUSES).join(', ')})`);
    if (status && STATUSES[status]) applyBulk({ status });
    else if (status) toast('Unknown status', true);
  }

  function bulkCategory() {
    const category = window.prompt(`Set category (${Object.keys(CATEGORIES).join(', ')})`);
    if (category && CATEGORIES[category]) applyBulk({ category });
    else if (category) toast('Unknown category', true);
  }

  function bulkAssign() {
    const notes = window.prompt('Assignment note for selected sites');
    if (notes !== null) applyBulk({ notes });
  }

  function toggleSelectAll(event) {
    selected.clear();
    if (event.target.checked) for (const site of sites) selected.add(site.id);
    renderList();
  }

  form.addEventListener('submit', submitEditor);
  $('#cancel-btn').addEventListener('click', () => dialog.close());
  $('#delete-btn').addEventListener('click', deleteCurrent);
  $('#geocode-btn').addEventListener('click', locateAddress);
  $('#add-btn').addEventListener('click', () => openEditor());
  $('#select-all').addEventListener('change', toggleSelectAll);
  $('#bulk-status-btn').addEventListener('click', bulkStatus);
  $('#bulk-category-btn').addEventListener('click', bulkCategory);
  $('#bulk-assign-btn').addEventListener('click', bulkAssign);
  $('#bulk-delete-btn').addEventListener('click', () =>
    applyBulk({ delete: true }, `Delete ${selected.size} selected site(s)? This cannot be undone.`),
  );

  return { refresh, select, openEditor };
}
