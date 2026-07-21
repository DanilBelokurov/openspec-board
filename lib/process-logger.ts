import fs from "fs/promises";
import { createWriteStream } from "fs";
import { spawn, type SpawnOptions } from "child_process";
import path from "path";

const LOG_DIR = path.join(process.cwd(), ".sdd-board", "logs");

// "new" = first step (now `openspec new change`); "continue" = second step
// (still `gigacode /opsx-continue`); "update" = the analyst-initiated
// re-run of the proposal-generation step after editing the request.
// Step name drives only the log filename, not the command — each
// caller picks its own binary.
export type ProposalStep = "new" | "continue" | "update";

export async function ensureLogDir(): Promise<void> {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

// Log filename: `<tag>.<stage>.<step>.log` — the stage segment
// (proposal / delta-spec / design / adr / backlog / ...) lets the
// analyst tell at a glance which pipeline stage the file belongs
// to when several stages accumulate logs for the same change.
export function processLogPath(
  changeName: string,
  step: ProposalStep,
  stage: string,
): string {
  return path.join(LOG_DIR, `${changeName}.${stage}.${step}.log`);
}

export type GigacodeApprovalMode = "auto-edit" | "suggest" | "default";

interface SpawnWithLogOptions {
  /** Binary name (e.g. "gigacode", "openspec"). */
  command: string;
  /** Extra argv elements after the binary. Each element is passed as-is. */
  argv: string[];
  logFile: string;
  header?: string;
  /** Working directory for the spawned process. When omitted, inherits. */
  cwd?: string;
}

/**
 * Gigacode-specific wrapper: builds the final argv as
 *   gigacode <caller-argv> --approval-mode=<mode> --add-dir <addDir>
 * then spawns it detached with stdout/stderr piped to a log file.
 *
 * - caller's argv is the prompt (["--prompt", "<prompt text>"])
 * - `--approval-mode=<mode>` uses the key=value form per user spec
 * - `--add-dir <addDir>` uses a space separator per user spec
 * - the prompt is always a single argv element (so spaces inside the
 *   prompt don't split it into multiple args)
 *
 * Resolves a promise on the 'close' event with the exit code/signal.
 * The process is unref()'d so it survives parent exit.
 */
export function spawnGigacodeWithLog(
  args: {
    argv: string[];
    logFile: string;
    header?: string;
    /** Absolute path passed to gigacode via --add-dir. Should be the
     *  sdd-store root from config (config.openspecDir). */
    addDir: string;
    /** Approval mode passed to gigacode via --approval-mode. */
    approvalMode: GigacodeApprovalMode;
  },
): SpawnWithLogResult {
  // Order: prompt first (the actual command), then flags.
  // Result: gigacode --prompt "<text>" --approval-mode=auto-edit --add-dir <path>
  const finalArgv = [
    ...args.argv,
    `--approval-mode=${args.approvalMode}`,
    "--add-dir",
    args.addDir,
  ];
  return spawnDetachedWithLog({
    command: "gigacode",
    argv: finalArgv,
    logFile: args.logFile,
    header: args.header,
  });
}

interface SpawnWithLogResult {
  pid: number;
  promise: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * Spawn any CLI detached with stdout/stderr piped to a log file.
 * Generic counterpart to `spawnGigacodeWithLog` — used by the openspec CLI
 * step as well as any future background commands.
 *
 * Resolves a promise on the 'close' event with the exit code/signal.
 * The process is unref()'d so it survives parent exit.
 */
export function spawnDetachedWithLog(
  opts: SpawnWithLogOptions,
): SpawnWithLogResult {
  const out = createWriteStream(opts.logFile, { flags: "a" });
  const err = createWriteStream(opts.logFile, { flags: "a" });

  if (opts.header) {
    out.write(
      `# ${opts.header}\n# argv: ${opts.command} ${formatArgv(opts.argv)}\n\n`,
    );
  }

  const spawnOpts: SpawnOptions = {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (opts.cwd) spawnOpts.cwd = opts.cwd;

  const child = spawn(opts.command, opts.argv, spawnOpts);

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

/**
 * Format an argv array for human-readable logging. Elements that contain
 * spaces or quotes are wrapped in double quotes (with embedded quotes
 * escaped) so the log is unambiguous about where one arg starts/ends.
 */
function formatArgv(argv: string[]): string {
  return argv
    .map((a) => {
      if (a === "" || /[\s"\\]/.test(a)) {
        return `"${a.replace(/(["\\])/g, "\\$1")}"`;
      }
      return a;
    })
    .join(" ");
}