/**
 * Server-side geocoder. Nominatim's usage policy requires an identifying
 * User-Agent and at most one request per second per process; the browser can
 * satisfy neither, so lookups are funneled through here. Results are cached so
 * a repeated query never hits upstream, and calls are serialised through a
 * 1 req/s queue so two rapid clicks still make only one upstream call.
 */
const DEFAULT_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'FieldPoint/1.0 (site & asset map for field operations teams)';
const MIN_INTERVAL_MS = 1000;
const CACHE_MAX = 500;

export class GeocodeUpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GeocodeUpstreamError';
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.url] Upstream search endpoint (GEOCODER_URL).
 * @param {typeof fetch} [options.fetchImpl] Injected for tests.
 * @param {() => number} [options.now] Injected clock for tests.
 * @param {(ms: number) => Promise<void>} [options.sleep] Injected delay for tests.
 */
export function createGeocoder({ url = DEFAULT_URL, fetchImpl = fetch, now = Date.now, sleep = defaultSleep } = {}) {
  const cache = new Map();
  let queue = Promise.resolve();
  let lastCallAt = 0;

  function cacheGet(key) {
    if (!cache.has(key)) return undefined;
    // Refresh LRU recency: delete + re-insert moves the key to the newest slot.
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }

  function cacheSet(key, value) {
    cache.set(key, value);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function fetchUpstream(query) {
    const target = `${url}?format=json&limit=1&q=${encodeURIComponent(query)}`;
    let response;
    try {
      response = await fetchImpl(target, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      });
    } catch (error) {
      throw new GeocodeUpstreamError(`Geocoding upstream request failed: ${error.message}`);
    }
    if (!response.ok) throw new GeocodeUpstreamError(`Geocoding upstream returned ${response.status}`);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new GeocodeUpstreamError('Geocoding upstream returned malformed JSON');
    }
    const [hit] = Array.isArray(body) ? body : [];
    if (!hit) return null;
    return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
  }

  // Serialise upstream calls and hold each new call to at least MIN_INTERVAL_MS
  // after the previous one started, so the burst two clicks produce is spread
  // to one request per second.
  function enqueue(query) {
    const result = queue.then(async () => {
      const wait = lastCallAt + MIN_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);
      lastCallAt = now();
      return fetchUpstream(query);
    });
    // Keep the chain alive even when a call rejects.
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    async geocode(query) {
      const key = query.trim().toLowerCase();
      const cached = cacheGet(key);
      if (cached !== undefined) return cached;
      const value = await enqueue(query);
      cacheSet(key, value);
      return value;
    },
  };
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
