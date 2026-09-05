import fs from "fs/promises";
import { createWriteStream } from "fs";
import { spawn, type SpawnOptions } from "child_process";
import path from "path";

const LOG_DIR = path.join(process.cwd(), ".sdd-board", "logs");

// "new" = first step (now `openspec new change`); "continue" = second step
// (still `gigacode /opsx-continue`); "update" = the analyst-initiated
// re-run of the proposal-generation step after editing the request;
// "implement" = the developer-mode TDD GREEN run inside the code-repo
// worktree; "red" = the TDD RED run; "jira-label" = the post-PR
// "apply `sdd` label to the linked Jira issue" step. Step name drives
// only the log filename, not the command — each caller picks its own
// binary.
export type ProposalStep =
  | "new"
  | "continue"
  | "update"
  | "implement"
  | "red"
  | "jira-label";

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

/**
 * Side file for the gigacode prompt. The `.log` is the "what
 * happened" record (timestamps + tagged stdout/stderr). The
 * `.prompt.txt` next to it is the "what was asked" record —
 * the raw prompt fed to gigacode. Keeping them separate lets
 * the dev scroll through the actual output without wading
 * past thousands of prompt lines.
 */
export function processPromptPath(
  changeName: string,
  step: ProposalStep,
  stage: string,
): string {
  return path.join(LOG_DIR, `${changeName}.${stage}.${step}.log.prompt.txt`);
}

/**
 * Generic "prompt file next to this log file" helper for
 * callers that don't go through `processLogPath` (e.g.
 * code-review-graph.ts uses its own per-repo path under
 * `.sdd-board/logs/repos/`).
 */
export function promptPathForLogFile(logFile: string): string {
  return `${logFile}.prompt.txt`;
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
 * Generic counterpart to `spawnGigacodeWithLog` — used by the
 * openspec CLI, the git push spawners, and the code-review-graph
 * gigacode steps.
 *
 * Log file format (assumes the caller has already written the
 * header block with `fs.writeFile(logFile, …, { flag: "w" })`):
 *
 *   <caller-written header — metadata, tasks summary, prompt-file path>
 *
 *   # ----- start of output (<ISO ts>) -----
 *   [#] [out] <line>
 *   [#] [err] <line>
 *   ...
 *   # ----- end of output (<ISO ts>) -----
 *   # exit: <code>
 *   # signal: <signal>
 *   # duration: <Xs|Xm Ys|Xh Ym Zs>
 *
 * Each line of stdout/stderr is prefixed with an ISO timestamp
 * and a source label (`[out]` / `[err]`). Partial lines per
 * stream are buffered so a chunk that doesn't end on a newline
 * is joined with the next chunk before tagging. Using a single
 * write stream (instead of two as before) avoids byte-level
 * interleaving between stdout and stderr — OS write ordering
 * for two independent file handles on the same file is not
 * guaranteed, so the old setup could produce chunks like
 * `Hello[err] warning[out] world` mid-line.
 *
 * The `start` / `end` markers around the output and the exit
 * metadata at the bottom make the log navigable: jump to the
 * body to see what gigacode did, jump to the footer to see
 * the result, jump to the prompt-file path to see what was
 * asked.
 *
 * Resolves a promise on the 'close' event with the exit
 * code/signal. The process is unref()'d so it survives parent
 * exit.
 */
export function spawnDetachedWithLog(
  opts: SpawnWithLogOptions,
): SpawnWithLogResult {
  const logStream = createWriteStream(opts.logFile, { flags: "a" });
  const startTime = Date.now();

  if (opts.header) {
    logStream.write(
      `# ${opts.header}\n# argv: ${opts.command} ${formatArgv(opts.argv)}\n\n`,
    );
  }

  logStream.write(
    `# ----- start of output (${new Date().toISOString()}) -----\n`,
  );

  const spawnOpts: SpawnOptions = {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  };
  if (opts.cwd) spawnOpts.cwd = opts.cwd;

  const child = spawn(opts.command, opts.argv, spawnOpts);

  tagAndWrite("[out]", child.stdout, logStream);
  tagAndWrite("[err]", child.stderr, logStream);

  const promise = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        const ts = new Date().toISOString();
        const duration = formatDuration(Date.now() - startTime);
        logStream.write(
          `# ----- end of output (${ts}) -----\n` +
            `# exit: ${code}\n` +
            `# signal: ${signal ?? "null"}\n` +
            `# duration: ${duration}\n`,
        );
        logStream.end();
        resolve({ exitCode: code, signal });
      });
      child.on("error", (spawnErr: Error) => {
        logStream.write(`\n[spawn error] ${spawnErr.message}\n`);
        logStream.end();
        resolve({ exitCode: -1, signal: null });
      });
    },
  );

  child.unref();
  return { pid: child.pid ?? 0, promise };
}

/**
 * Tag each line of a stdout/stderr stream with an ISO timestamp
 * and a source label, then write to the log file. Buffers partial
 * lines per stream so a chunk boundary that splits a line of
 * gigacode output is joined with the next chunk before tagging.
 */
function tagAndWrite(
  label: string,
  source: NodeJS.ReadableStream | null,
  logStream: NodeJS.WritableStream,
): void {
  if (!source) return;
  source.setEncoding("utf-8");
  let buffer = "";
  source.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    if (lines.length === 0) return;
    const ts = new Date().toISOString();
    const tagged = lines
      .map((line) => `[${ts}] ${label} ${line}\n`)
      .join("");
    logStream.write(tagged);
  });
  source.on("end", () => {
    if (buffer) {
      const ts = new Date().toISOString();
      logStream.write(`[${ts}] ${label} ${buffer}\n`);
      buffer = "";
    }
  });
  source.on("error", (err: Error) => {
    logStream.write(`[stream error] ${label} ${err.message}\n`);
  });
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

/**
 * Format a wall-clock duration in milliseconds as a human-readable
 * string. Used for the `# duration: ...` line in the log footer.
 *
 * - < 60s: "12.3s"
 * - < 60m: "5m 7s"
 * - >= 60m: "1h 12m 4s"
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 100) / 10;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${seconds}s`;
}
