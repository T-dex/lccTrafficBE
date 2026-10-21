/** Tiny TTL cache. Shares in-flight promises; failures are not cached. */
// ponytail: unbounded Map, add eviction if key space grows (OSRM keys are per-address).
const store = new Map();

export function memo(key, ttlMs, fn) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const promise = fn();
  store.set(key, { promise, expiresAt: Date.now() + ttlMs });
  promise.catch(() => store.get(key)?.promise === promise && store.delete(key));
  return promise;
}
