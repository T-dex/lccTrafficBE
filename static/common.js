export const STORAGE_KEY = "alta-drive-home";
/** Downtown SLC anchor (100 S & Main) — geocodes reliably */
export const DEFAULT_ADDRESS = "100 S Main St, Salt Lake City, UT";

/** Nominatim-friendly lookup for common labels */
const GEOCODE_ALIASES = {
  "downtown salt lake city, ut": DEFAULT_ADDRESS,
  "downtown salt lake city": DEFAULT_ADDRESS,
  "downtown slc": DEFAULT_ADDRESS,
  "downtown slc, ut": DEFAULT_ADDRESS,
  "mormon temple, salt lake city, ut": "Temple Square, Salt Lake City, UT",
  "mormon temple": "Temple Square, Salt Lake City, UT",
  "salt lake temple, salt lake city, ut": "Temple Square, Salt Lake City, UT",
};

export function resolveForGeocode(address) {
  const key = address.trim().toLowerCase();
  return GEOCODE_ALIASES[key] || address;
}
export const DEBOUNCE_MS = 800;
export const AUTO_REFRESH_MS = 5 * 60 * 1000;

export function getAddress(inputEl) {
  const saved = localStorage.getItem(STORAGE_KEY);
  const value = (inputEl?.value || saved || DEFAULT_ADDRESS).trim();
  if (inputEl && !inputEl.value.trim()) inputEl.value = value;
  return value;
}

export function saveAddress(address) {
  localStorage.setItem(STORAGE_KEY, address);
}

export function shortPlace(label) {
  const parts = label.split(",").map((p) => p.trim());
  if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
  return parts[0] || label;
}

export async function fetchEstimate(
  address,
  { threshold = 90, includeCameras = true, canyon = "lcc" } = {},
) {
  const res = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: resolveForGeocode(address),
      threshold_minutes: threshold,
      include_cameras: includeCameras,
      canyon,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || res.statusText);
  return data;
}
