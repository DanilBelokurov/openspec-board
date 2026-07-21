import fs from "fs/promises";
import { createWriteStream } from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), ".sdd-board", "logs");

export type GigacodeStep = "new" | "continue";

export async function ensureLogDir(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

export function processLogPath(
  changeName: string,
  step: GigacodeStep,
): string {
  return path.join(LOG_DIR, `${changeName}.${step}.log`);
}

export type GigacodeApprovalMode = "auto-edit" | "suggest" | "default";

interface SpawnWithLogOptions {
  argv: string[];
  logFile: string;
  header?: string;
  /** Absolute path passed to gigacode via --add-dir. Should be the
   *  sdd-store root from config (config.openspecDir). */
  addDir: string;
  /** Approval mode passed to gigacode via --approval-mode. */
  approvalMode: GigacodeApprovalMode;
}

interface SpawnWithLogResult {
  pid: number;
  promise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * Spawn gigacode detached with stdout/stderr piped to a log file.
 *
 * Builds the final argv as:
 *   gigacode --approval-mode=<mode> --add-dir <addDir> <caller-argv>
 *
 * - `--approval-mode=<mode>` uses the key=value form per user spec
 * - `--add-dir <addDir>` uses a space separator per user spec
 *
 * Resolves a promise on the 'close' event with the exit code/signal.
 * The process is unref()'d so it survives parent exit.
 */
export function spawnGigacodeWithLog(
  opts: SpawnWithLogOptions,
): SpawnWithLogResult {
  const out = createWriteStream(opts.logFile, { flags: "a" });
  const err = createWriteStream(opts.logFile, { flags: "a" });

  const finalArgv = [
    `--approval-mode=${opts.approvalMode}`,
    "--add-dir",
    opts.addDir,
    ...opts.argv,
  ];

  if (opts.header) {
    out.write(`# ${opts.header}\n# argv: gigacode ${finalArgv.join(" ")}\n\n`);
  }

  const child = require("child_process").spawn("gigacode", finalArgv, {
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