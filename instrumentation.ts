/**
 * Next.js instrumentation hook — runs ONCE when the Node server
 * boots, before any request handler or page component is invoked.
 *
 * We use it to start the background watcher (`lib/watcher.ts`)
 * in a deterministic place. Previously the watcher was started as
 * a side-effect of the first server-side import of `@/lib/watcher`,
 * which had two failure modes:
 *
 *   1. If the first import came from a route handler on a cold
 *      start, that handler could return its response BEFORE the
 *      watcher's first tick — leaving short-lived child PIDs
 *      (e.g. `git push`, which finishes in ~1.2s) unrecorded in
 *      state.json forever. The UI then thinks the push is still
 *      in flight and locks downstream buttons (PR creation).
 *
 *   2. Different routes imported `@/lib/watcher` independently
 *      (page.tsx, /api/changes, /api/refresh), so the actual
 *      startup time depended on user navigation order. Any
 *      route that didn't trigger one of those imports would
 *      run with a dead watcher.
 *
 * By running here, the watcher's first tick lands well before
 * any user action and the boot order is identical in dev and prod.
 *
 * `experimental.instrumentationHook: true` must be set in
 * next.config.mjs for this file to be picked up.
 *
 * Bundling note (Next.js 14):
 *   Next.js bundles `instrumentation.ts` for BOTH the Node and
 *   the Edge runtime, even though `register()` is a no-op on
 *   edge (see the `NEXT_RUNTIME` guard below). webpack
 *   statically analyses every import — a top-level `import
 *   "./lib/watcher"` pulls `lib/config.ts` → `fs/promises`
 *   into the edge bundle, which then fails with
 *   `Module not found: Can't resolve 'fs'`.
 *
 *   Solution: hold the import behind `require()` and signal to
 *   webpack that the symbol is an external Node module so it
 *   doesn't try to bundle the chain. Inside `register()` we
 *   still execute it on Node only — the runtime guard makes
 *   sure edge never runs this branch.
 *
 *   We also use a relative path (not `@/lib/watcher`) so that
 *   when the dev server runs the compiled bundle via Node ESM,
 *   the resolver sees a real file path. TS path aliases are
 *   webpack-only — Node ESM doesn't honour `paths` from
 *   tsconfig.json, which is why a previous attempt using
 *   `import("@/lib/watcher")` failed at runtime with
 *   `ERR_MODULE_NOT_FOUND: Cannot find package '@/lib'`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startWatcher } = require("./lib/watcher") as typeof import("./lib/watcher");
  startWatcher();
}
