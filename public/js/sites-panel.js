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
  let origin = null;

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
    if (origin) {
      params.lat = origin.lat;
      params.lng = origin.lng;
      params.radiusKm = Number($('#radius-km').value);
    }
    return params;
  }

  function renderList() {
    list.replaceChildren();
    $('#site-count').textContent = `${sites.length} site${sites.length === 1 ? '' : 's'}`;
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
      const place = site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`;
      const distance = typeof site.distanceKm === 'number' ? ` · ${site.distanceKm.toFixed(1)} km away` : '';
      sub.textContent = `${CATEGORIES[site.category]?.label ?? site.category} · ${place}${distance}`;
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

  function nearMe() {
    if (!('geolocation' in navigator)) {
      return toast('Location is not available on this device', true);
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        origin = { lat: position.coords.latitude, lng: position.coords.longitude };
        $('#clear-near-me-btn').hidden = false;
        mapView.showPosition(origin.lat, origin.lng, position.coords.accuracy);
        refresh();
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied — allow it to search near you'
            : 'Could not determine your location';
        toast(message, true);
      },
    );
  }

  function clearNearMe() {
    origin = null;
    $('#clear-near-me-btn').hidden = true;
    refresh();
  }

  form.addEventListener('submit', submitEditor);
  $('#cancel-btn').addEventListener('click', () => dialog.close());
  $('#delete-btn').addEventListener('click', deleteCurrent);
  $('#geocode-btn').addEventListener('click', locateAddress);
  $('#add-btn').addEventListener('click', () => openEditor());
  $('#near-me-btn').addEventListener('click', nearMe);
  $('#clear-near-me-btn').addEventListener('click', clearNearMe);
  $('#radius-km').addEventListener('change', () => { if (origin) refresh(); });

  return { refresh, select, openEditor };
}
