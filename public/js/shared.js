import { CATEGORIES } from './constants.js';
import { relativeTime } from './ui.js';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

async function boot() {
  try {
    const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1) ?? '');
    const response = await fetch(`/api/shared/${encodeURIComponent(token)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'This share link is not available');
    render(payload.collection);
  } catch (error) {
    document.querySelector('#shared-error').textContent = error.message;
  }
}

function render(collection) {
  document.title = `${collection.name} · FieldPoint`;
  document.querySelector('#shared-title').textContent = collection.name;
  document.querySelector('#shared-description').textContent = collection.description;
  document.querySelector('#shared-owner').textContent = `Shared by ${collection.ownerName}`;
  document.querySelector('#shared-content').hidden = false;
  renderList(collection.sites);
  renderMap(collection.sites);
}

function renderList(sites) {
  const list = document.querySelector('#shared-sites');
  if (sites.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'This collection has no visible sites.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...sites.map((site) => {
    const item = document.createElement('li');
    item.className = 'site-item';
    const title = document.createElement('div');
    title.className = 'title';
    const name = document.createElement('span');
    name.textContent = site.name;
    const badge = document.createElement('span');
    badge.className = `badge ${site.status}`;
    badge.textContent = site.status;
    title.append(name, badge);
    const address = document.createElement('div');
    address.className = 'sub';
    address.textContent = site.address || `${site.lat.toFixed(4)}, ${site.lng.toFixed(4)}`;
    const meta = document.createElement('div');
    meta.className = 'sub';
    meta.textContent = `${CATEGORIES[site.category]?.label ?? site.category} · pinned ${relativeTime(site.pinnedAt)}`;
    item.append(title, address, meta);
    return item;
  }));
}

function renderMap(sites) {
  const map = L.map('shared-map').setView([39.5, -98.35], 4);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
  const points = [];
  for (const site of sites) {
    const color = CATEGORIES[site.category]?.color ?? CATEGORIES.other.color;
    const icon = L.divIcon({
      className: '',
      html: `<div class="marker-pin" style="background:${color}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8],
    });
    const popup = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = site.name;
    const address = document.createElement('div');
    address.textContent = site.address || '—';
    popup.append(name, address);
    L.marker([site.lat, site.lng], { icon, title: site.name }).bindPopup(popup).addTo(map);
    points.push([site.lat, site.lng]);
  }
  if (points.length > 0) map.fitBounds(points, { padding: [24, 24], maxZoom: 14 });
}

boot();
