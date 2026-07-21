import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), ".sdd-board", "logs");

export type QwenStep = "new" | "continue";

export async function ensureLogDir(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

export function qwenLogPath(changeName: string, step: QwenStep): string {
  return path.join(LOG_DIR, `${changeName}.${step}.log`);
}

interface SpawnWithLogOptions {
  argv: string[];
  logFile: string;
  header?: string;
}

interface SpawnWithLogResult {
  pid: number;
  promise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * Spawn qwen detached with stdout/stderr piped to a log file.
 * Resolves a promise on the 'close' event with the exit code/signal.
 * The process is unref()'d so it survives parent exit.
 */
export function spawnQwenWithLog(opts: SpawnWithLogOptions): SpawnWithLogResult {
  const out = createWriteStream(opts.logFile, { flags: "a" });
  const err = createWriteStream(opts.logFile, { flags: "a" });

  // If header provided, write a small banner at the top of the log
  if (opts.header) {
    out.write(`# ${opts.header}\n# argv: ${opts.argv.join(" ")}\n\n`);
  }

  const child = require("child_process").spawn("qwen", opts.argv, {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (child.stdout) child.stdout.pipe(out);
  if (child.stderr) child.stderr.pipe(err);

  const promise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        out.end();
        err.end();
        resolve({ exitCode: code, signal });
      });
      child.on("error", (spawnErr: Error) => {
        out.write(`\n[spawn error] ${spawnErr.message}\n`);
        err.end();
        resolve({ exitCode: -1, signal: null });
      });
    },
  );

  child.unref();
  return { pid: child.pid ?? 0, promise };
}