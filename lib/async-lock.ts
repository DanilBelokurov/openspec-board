/**
 * Lightweight per-key mutex — serialise critical sections that
 * would otherwise race when called concurrently (e.g. the
 * watcher's `mergeRemoteFeatureScan` and the manual ↻'s
 * `mergeRemoteFeatureScan` starting within the same tick, or
 * `writeState` colliding with `updateTask`).
 *
 * Why not p-limit / async-mutex? — single dependency, no
 * registry-of-keys gymnastics, and the queue depth never
 * exceeds 1 per key in this app (a follow-up call simply
 * waits for the in-flight one to finish). Implementation is
 * a Map<key, Promise> where the next caller `await`s the
 * tail of the previous call's promise chain.
 *
 * Usage:
 *
 *   await runExclusive("remote-scan", async () => {
 *     await mergeRemoteFeatureScan(...);
 *   });
 *
 * Each key is independent — `runExclusive("scan-a", ...)`
 * and `runExclusive("scan-b", ...)` do not block each other.
 * Two concurrent `runExclusive("scan-a", ...)` calls run
 * strictly one-after-the-other, the second waiting on the
 * first's tail.
 */

const tails = new Map<string, Promise<unknown>>();

export async function runExclusive<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  // We deliberately swallow prev's rejection: a failed prior
  // run must not poison the chain and lock subsequent callers
  // out of the critical section forever.
  const next = prev.catch(() => undefined).then(fn);
  tails.set(key, next);
  // Garbage-collect the tail once it settles so the Map
  // doesn't grow unbounded across an app lifetime.
  next.finally(() => {
    if (tails.get(key) === next) tails.delete(key);
  });
  return next;
}

/**
 * Test-only: drop the in-memory queue. Production code should
 * never need this — the Map self-clears via the `finally`
 * above — but unit tests want a clean slate between cases.
 */
export function _resetExclusiveForTests(): void {
  tails.clear();
}