/** Thin fetch wrapper: same-origin, JSON, cookie auth, typed errors. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (response.status === 204) return null;
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.error ?? `Request failed (${response.status})`;
    const detail = payload?.details?.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new ApiError(response.status, detail ? `${message} — ${detail}` : message, payload?.details);
  }
  return payload;
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (data) => request('POST', '/api/auth/login', data),
  register: (data) => request('POST', '/api/auth/register', data),
  logout: () => request('POST', '/api/auth/logout'),
  search: (q) => request('GET', `/api/search?${new URLSearchParams({ q })}`),
  listSites: (params) => request('GET', `/api/sites?${new URLSearchParams(params)}`),
  siteStats: () => request('GET', '/api/sites/stats'),
  createSite: (data) => request('POST', '/api/sites', data),
  updateSite: (id, data) => request('PATCH', `/api/sites/${id}`, data),
  deleteSite: (id) => request('DELETE', `/api/sites/${id}`),
  restoreSite: (id) => request('POST', `/api/sites/${id}/restore`),
  listWorkOrders: (params) => request('GET', `/api/work-orders?${new URLSearchParams(params)}`),
  getWorkOrder: (id) => request('GET', `/api/work-orders/${id}`),
  createWorkOrder: (data) => request('POST', '/api/work-orders', data),
  updateWorkOrder: (id, data) => request('PATCH', `/api/work-orders/${id}`, data),
  deleteWorkOrder: (id) => request('DELETE', `/api/work-orders/${id}`),
  addWorkOrderComment: (id, body) => request('POST', `/api/work-orders/${id}/comments`, { body }),
  directory: () => request('GET', '/api/users/directory'),
  listUsers: () => request('GET', '/api/users'),
  updateUser: (id, data) => request('PATCH', `/api/users/${id}`, data),
  audit: () => request('GET', '/api/users/audit?limit=50'),
};

/** Browser geolocation as a promise, with a human-readable failure message. */
export function locateBrowser({ timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser cannot report your location'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy }),
      (error) => {
        const messages = {
          1: 'Location permission denied',
          2: 'Location is unavailable right now',
          3: 'Timed out while finding your location',
        };
        reject(new Error(messages[error.code] ?? 'Could not determine your location'));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** Public geocoder (OpenStreetMap Nominatim). Rate-limited upstream: 1 req/s. */
export async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Geocoding service unavailable');
  const [hit] = await response.json();
  if (!hit) throw new Error('Address not found');
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}
