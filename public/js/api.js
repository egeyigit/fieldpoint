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
  listSites: (params) => request('GET', `/api/sites?${new URLSearchParams(params)}`),
  createSite: (data) => request('POST', '/api/sites', data),
  updateSite: (id, data) => request('PUT', `/api/sites/${id}`, data),
  deleteSite: (id) => request('DELETE', `/api/sites/${id}`),
  listAttachments: (siteId) => request('GET', `/api/sites/${siteId}/attachments`),
  uploadAttachment: (siteId, file) => uploadFile(`/api/sites/${siteId}/attachments`, file),
  attachmentUrl: (siteId, attachmentId) => `/api/sites/${siteId}/attachments/${attachmentId}`,
  deleteAttachment: (siteId, attachmentId) => request('DELETE', `/api/sites/${siteId}/attachments/${attachmentId}`),
  listUsers: () => request('GET', '/api/users'),
  updateUser: (id, data) => request('PATCH', `/api/users/${id}`, data),
  audit: () => request('GET', '/api/users/audit?limit=50'),
};

async function uploadFile(path, file) {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? `Upload failed (${response.status})`, payload?.details);
  }
  return payload;
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
