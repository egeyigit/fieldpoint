import { CATEGORIES, DEFAULT_VIEW } from './constants.js';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const FOCUS_ZOOM = 15;
const FIT_RETRY_FRAMES = 60;

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function pinIcon(category, status) {
  const color = CATEGORIES[category]?.color ?? CATEGORIES.other.color;
  const opacity = status === 'inactive' ? 0.45 : 1;
  return L.divIcon({
    className: '',
    html: `<div class="marker-pin" style="background:${color};opacity:${opacity}"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -8],
  });
}

/** Wraps Leaflet so the rest of the UI never touches L directly. */
export function createMapView(element, { onSelect, onAddAt }) {
  const map = L.map(element, { zoomControl: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const markers = new Map();

  // The container must be focusable so a dialog opened from the map can return
  // focus here on close; the native <dialog> focus-return does not cover this
  // path because the opener is a map event, not a focused control.
  if (element.tabIndex < 0) element.tabIndex = -1;
  map.on('contextmenu', (event) => {
    element.focus();
    onAddAt(event.latlng.lat, event.latlng.lng);
  });

  // Leaflet only tracks window resizes. The container is laid out by CSS grid and
  // can change size (or be 0×0 on first paint) without a window resize, so
  // re-measure whenever the element itself changes.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => map.invalidateSize({ animate: false })).observe(element);
  }

  function hasSize() {
    const size = map.getSize();
    return size.x > 0 && size.y > 0;
  }

  /** Runs `fn` once the container has a real size; gives up after FIT_RETRY_FRAMES frames. */
  function whenSized(fn, attempt = 0) {
    map.invalidateSize({ animate: false });
    if (hasSize()) return fn();
    if (attempt >= FIT_RETRY_FRAMES) return undefined;
    return requestAnimationFrame(() => whenSized(fn, attempt + 1));
  }

  let hereLayer = null;

  return {
    /** Marks the viewer's own position with an accuracy/radius circle. */
    showHere({ lat, lng }, radiusKm) {
      if (hereLayer) hereLayer.remove();
      hereLayer = L.layerGroup([
        L.circleMarker([lat, lng], { radius: 6, color: '#60a5fa', fillColor: '#60a5fa', fillOpacity: 0.9 }),
        L.circle([lat, lng], { radius: radiusKm * 1000, color: '#60a5fa', weight: 1, fillOpacity: 0.05 }),
      ]).addTo(map);
      map.fitBounds(L.circle([lat, lng], { radius: radiusKm * 1000 }).getBounds().pad(0.1));
    },
    clearHere() {
      if (hereLayer) hereLayer.remove();
      hereLayer = null;
    },
    render(sites) {
      layer.clearLayers();
      markers.clear();
      for (const site of sites) {
        const marker = L.marker([site.lat, site.lng], { icon: pinIcon(site.category, site.status), title: site.name });
        const assignee = site.assignedToName ? ` · ${escapeHtml(site.assignedToName)}` : '';
        marker.bindPopup(
          `<b>${escapeHtml(site.name)}</b><br><span style="opacity:.7">${escapeHtml(site.address || '—')}</span>` +
            `<br><small>${escapeHtml(CATEGORIES[site.category]?.label ?? site.category)} · ${escapeHtml(site.status)}${assignee}</small>`,
        );
        marker.on('click', () => onSelect(site.id));
        marker.addTo(layer);
        markers.set(site.id, marker);
      }
    },
    fitAll(sites) {
      if (sites.length === 0) return;
      const bounds = L.latLngBounds(sites.map((site) => [site.lat, site.lng]));
      whenSized(() => map.fitBounds(bounds.pad(0.2), { maxZoom: 13, animate: false }));
    },
    focus(id) {
      const marker = markers.get(id);
      if (!marker) return;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), FOCUS_ZOOM));
      marker.openPopup();
    },
    invalidate: () => map.invalidateSize(),
  };
}
