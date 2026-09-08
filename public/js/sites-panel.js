import { api, geocode, locateBrowser } from './api.js';
import { CATEGORIES, NEAR_ME_RADIUS_KM, SITE_SORTS, STATUSES } from './constants.js';
import { $, absoluteTime, formValues, relativeTime, setOptions, toast } from './ui.js';

const PAGE_SIZE = 1000;
const MAX_SITES = 10000;

/** Sidebar list + editor dialog for sites. Map is notified through callbacks. */
export function createSitesPanel({ mapView, currentUser }) {
  const list = $('#site-list');
  const dialog = $('#site-dialog');
  const form = $('#site-form');
  const errorBox = $('#site-error');
  let sites = [];
  let directory = [];
  let selectedId = null;
  let nearMe = null;

  setOptions($('#filter-category'), Object.entries(CATEGORIES).map(([key, value]) => [key, value.label]), { placeholder: 'All categories' });
  setOptions($('#filter-status'), Object.entries(STATUSES), { placeholder: 'All statuses' });
  setOptions($('#site-sort'), Object.entries(SITE_SORTS), { selected: 'name' });
  setOptions($('#form-category'), Object.entries(CATEGORIES).map(([key, value]) => [key, value.label]));
  setOptions($('#form-status'), Object.entries(STATUSES));
  $('#recycle-bin-row').hidden = currentUser.role !== 'admin';

  function currentFilters() {
    const params = { sort: $('#site-sort').value };
    const q = $('#search').value.trim();
    const category = $('#filter-category').value;
    const status = $('#filter-status').value;
    if (q) params.q = q;
    if (category) params.category = category;
    if (status) params.status = status;
    if ($('#filter-mine').checked) params.assignedTo = currentUser.id;
    if (currentUser.role === 'admin' && $('#show-deleted').checked) params.includeDeleted = 'true';
    if (nearMe) {
      params.nearLat = nearMe.lat;
      params.nearLng = nearMe.lng;
      params.radiusKm = nearMe.radiusKm;
      params.sort = 'distance';
    }
    return params;
  }

  function renderRow(site) {
    const item = document.createElement('li');
    const isDeleted = Boolean(site.deletedAt);
    item.className = `site-item${site.id === selectedId ? ' selected' : ''}${isDeleted ? ' deleted' : ''}`;
    item.tabIndex = 0;
    item.dataset.id = site.id;

    const title = document.createElement('div');
    title.className = 'title';
    const name = document.createElement('span');
    name.textContent = site.name;
    const right = document.createElement('span');
    right.className = 'row gap';
    const badge = document.createElement('span');
    badge.className = `badge ${site.status}`;
    badge.textContent = isDeleted ? 'Deleted' : STATUSES[site.status] ?? site.status;
    right.append(badge);

    if (isDeleted) {
      right.append(actionButton('Restore', `Restore ${site.name}`, () => restore(site)));
    } else {
      right.append(actionButton('Edit', `Edit ${site.name}`, () => openEditor(site)));
    }
    title.append(name, right);

    const sub = document.createElement('div');
    sub.className = 'sub';
    const distance = site.distanceKm === undefined ? '' : ` · ${site.distanceKm.toFixed(1)} km`;
    sub.textContent =
      `${CATEGORIES[site.category]?.label ?? site.category} · ` +
      `${site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`}${distance}`;

    const meta = document.createElement('div');
    meta.className = 'sub meta';
    const assignee = site.assignedToName ? `${site.assignedToName}` : 'Unassigned';
    meta.textContent = `${assignee} · updated ${relativeTime(site.updatedAt)}`;
    meta.title = absoluteTime(site.updatedAt);

    item.append(title, sub, meta);
    item.addEventListener('click', () => select(site.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select(site.id);
      }
    });
    return item;
  }

  function actionButton(label, ariaLabel, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost small edit-btn';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
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
 fix-sidebar-keyboard-access
    for (const site of sites) {
      const item = document.createElement('li');
      item.setAttribute('tabindex', '0')
      item.setAttribute('role', 'button')
      item.setAttribute('aria-selected', site.id === selectedId ? 'true' : 'false');
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
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select(site.id);
        }
      });
      item.addEventListener('dblclick', () => openEditor(site));
      list.append(item);

    list.append(...sites.map(renderRow));
  }

  async function renderStats() {
    try {
      const { stats } = await api.siteStats();
      const totals = { active: 0, planned: 0, inactive: 0 };
      for (const row of stats) totals[row.status] = (totals[row.status] ?? 0) + row.count;
      const strip = $('#site-stats');
      strip.replaceChildren(
        ...Object.entries(totals).map(([status, count]) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `stat-chip ${status}`;
          chip.textContent = `${STATUSES[status]} ${count}`;
          chip.addEventListener('click', () => {
            $('#filter-status').value = $('#filter-status').value === status ? '' : status;
            refresh();
          });
          return chip;
        }),
      );
    } catch {
      // A stats hiccup must not blank the list; the counts simply stay stale.
 main
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
      const [result, people] = await Promise.all([
        fetchAllSites(currentFilters()),
        directory.length ? Promise.resolve({ users: directory }) : api.directory(),
      ]);
      directory = people.users;
      sites = result.sites;
      if (result.total > sites.length) {
        toast(`Showing ${sites.length} of ${result.total} sites — narrow the filters to see the rest`, true);
      }
      renderList();
      mapView.render(sites.filter((site) => !site.deletedAt));
      if (fit) mapView.fitAll(sites);
      await renderStats();
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
      if (form.elements[key] && key !== 'assignedTo') form.elements[key].value = value ?? '';
    }
    setOptions(
      $('#form-assigned'),
      directory.map((user) => [user.id, user.name]),
      { placeholder: 'Unassigned', selected: site?.assignedTo ?? '' },
    );
    $('#site-meta').textContent = site
      ? `Updated ${relativeTime(site.updatedAt)} by ${site.updatedByName ?? 'unknown'}`
      : '';
    $('#site-meta').title = site ? absoluteTime(site.updatedAt) : '';
    dialog.showModal();
  }

  async function submitEditor(event) {
    event.preventDefault();
    const { id, assignedTo, ...rest } = formValues(form);
    const data = { ...rest, assignedTo: assignedTo === '' ? null : Number(assignedTo) };
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
    if (!id || !window.confirm(`Delete “${site?.name ?? 'this site'}”? Admins can restore it from the recycle bin.`)) return;
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

  async function restore(site) {
    try {
      await api.restoreSite(site.id);
      toast(`Restored ${site.name}`);
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function locateAddress() {
    const address = form.elements.address.value.trim();
    if (!address) {
      errorBox.textContent = 'Enter an address first';
      return;
    }
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

  async function toggleNearMe() {
    if (nearMe) {
      nearMe = null;
      $('#near-me').classList.remove('active');
      mapView.clearHere();
      await refresh({ fit: true });
      return;
    }
    try {
      const position = await locateBrowser();
      nearMe = { ...position, radiusKm: NEAR_ME_RADIUS_KM };
      $('#near-me').classList.add('active');
      mapView.showHere(position, NEAR_ME_RADIUS_KM);
      await refresh();
      toast(`Sites within ${NEAR_ME_RADIUS_KM} km`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  form.addEventListener('submit', submitEditor);
  $('#cancel-btn').addEventListener('click', () => dialog.close());
  $('#delete-btn').addEventListener('click', deleteCurrent);
  $('#geocode-btn').addEventListener('click', locateAddress);
  $('#add-btn').addEventListener('click', () => openEditor());
  $('#near-me').addEventListener('click', toggleNearMe);
  $('#site-sort').addEventListener('change', () => refresh());
  $('#filter-mine').addEventListener('change', () => refresh());
  $('#show-deleted').addEventListener('change', () => refresh());

  return { refresh, select, openEditor, getSites: () => sites.filter((site) => !site.deletedAt) };
}
