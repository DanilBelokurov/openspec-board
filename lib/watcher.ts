/**
 * Background watcher — polls every POLL_MS and triggers /opsx-continue
 * for any proposal-stage task ready for it. Runs only on the server
 * (module-level setInterval is started when this file is first imported
 * from server-side code).
 *
 * Imported for side-effect from app/page.tsx so Next.js dev server starts
 * it automatically after the first request.
 */

import { readConfig } from "./config";
import { triggerContinueIfNeeded } from "./continuation";

const POLL_MS = 5000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let started = false;

async function tick(): Promise<void> {
  try {
    const config = await readConfig();
    if (!config.openspecDir) return;
    await triggerContinueIfNeeded(config.openspecDir);
  } catch (e) {
    console.error("[watcher] tick failed:", e);
  }
}

function startWatcher(): void {
  if (started) return;
  started = true;
  // eslint-disable-next-line no-console
  console.log(`[watcher] polling every ${POLL_MS}ms`);
  // tick immediately, then on interval
  void tick();
  intervalHandle = setInterval(() => {
    void tick();
  }, POLL_MS);
}

function stopWatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
}

// Auto-start on first server-side import
if (typeof window === "undefined") {
  startWatcher();
}

// Best-effort cleanup on process exit (mainly for tests / hot reload)
if (typeof process !== "undefined" && process.on) {
  process.on("beforeExit", () => stopWatcher());
}

export {};