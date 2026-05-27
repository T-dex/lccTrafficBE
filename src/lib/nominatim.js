/**
 * Nominatim usage policy: max ~1 request/second on the public instance.
 * Serialize outbound calls and cache geocode results to avoid 429 in production.
 */

const USER_AGENT = process.env.USER_AGENT || "AltaDriveEstimator/1.0";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const MIN_INTERVAL_MS = Number(process.env.NOMINATIM_MIN_INTERVAL_MS) || 1100;
const GEOCODE_CACHE_MS = Number(process.env.GEOCODE_CACHE_MS) || 24 * 60 * 60 * 1000;

let lastCallAt = 0;
let chain = Promise.resolve();

/** One Nominatim request at a time, spaced apart. */
export function nominatimFetch(url, init = {}) {
  const run = async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastCallAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return fetch(url, {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...init.headers,
      },
    });
  };
  const next = chain.then(run, run);
  chain = next.catch(() => {});
  return next;
}

/** @type {Map<string, { value: { lat: number, lon: number, label: string }, expiresAt: number }>} */
const geocodeCache = new Map();

function cacheKey(address) {
  return address.trim().toLowerCase();
}

/**
 * @param {string} address
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ lat: number, lon: number, label: string }>}
 */
export async function geocodeAddress(address, signal) {
  const key = cacheKey(address);
  const hit = geocodeCache.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.value;
  }

  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    countrycodes: "us",
  });
  const r = await nominatimFetch(`${NOMINATIM}?${params}`, { signal });
  if (r.status === 429) {
    const err = new Error(
      "Geocoding rate limit exceeded (Nominatim). Wait a moment and try again, or pick an address from the suggestions list.",
    );
    err.status = 429;
    throw err;
  }
  if (!r.ok) {
    const err = new Error(`Geocode ${r.status}`);
    err.status = r.status >= 400 && r.status < 600 ? r.status : 502;
    throw err;
  }
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length) {
    const err = new Error(`Could not geocode address: ${address}`);
    err.status = 400;
    throw err;
  }
  const value = {
    lat: parseFloat(rows[0].lat),
    lon: parseFloat(rows[0].lon),
    label: rows[0].display_name || address,
  };
  geocodeCache.set(key, { value, expiresAt: Date.now() + GEOCODE_CACHE_MS });
  return value;
}
