import { DEFAULT_ADDRESS } from "./constants";

const GEOCODE_ALIASES: Record<string, string> = {
  "downtown salt lake city, ut": DEFAULT_ADDRESS,
  "downtown salt lake city": DEFAULT_ADDRESS,
  "downtown slc": DEFAULT_ADDRESS,
  "downtown slc, ut": DEFAULT_ADDRESS,
  "mormon temple, salt lake city, ut": "Temple Square, Salt Lake City, UT",
  "mormon temple": "Temple Square, Salt Lake City, UT",
  "salt lake temple, salt lake city, ut": "Temple Square, Salt Lake City, UT",
};

export function resolveForGeocode(address: string): string {
  const key = address.trim().toLowerCase();
  return GEOCODE_ALIASES[key] ?? address;
}
