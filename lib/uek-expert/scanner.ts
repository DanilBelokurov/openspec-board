import { promises as fs } from "fs";
import path from "path";
import {
  ensureLogDir,
  promptPathForLogFile,
  spawnGigacodeWithLog,
} from "@/lib/process-logger";
import { readUekExpertState, writeUekExpertState, makeUekPrKey, type UekPullRequest } from "./state";

const SCAN_PROMPT_PATH = path.join(
  process.cwd(),
  "templates",
  "uek-expert",
  "list-my-pull-requests.md",
);
const SCAN_LOG_NAME = "uek-expert.scan.log";

/**
 * Result of a single scan attempt — both the persisted snapshot
 * of the UEK-expert state and the metadata the API/UI needs to
 * show progress to the user.
 */
export interface UekScanResult {
  ok: boolean;
  error?: string;
  /** Snapshot of pullRequests after the scan (whether successful or not). */
  pullRequests: Record<string, UekPullRequest>;
  /** ISO timestamp of the scan attempt, regardless of outcome. */
  scannedAt: string;
  /** Number of PRs the MCP returned during this scan (when ok). */
  fetched?: number;
}

/**
 * Run the bitbucket-mcp scan through gigacode. The caller picks
 * the working dir (`--add-dir`); we use the sdd-board project
 * root so the gigacode run has no stale worktree context to
 * confuse it.
 *
 * Side effects:
 *   - writes `<sdd>/.sdd-board/logs/uek-expert.scan.log`
 *   - updates `.sdd-board/uek-expert.json` with the merged snapshot
 *
 * Note: even when the scan fails we still record `lastScannedAt`
 * and `lastScanError` so the UI can show that a scan was attempted.
 */
export async function scanUekPullRequests(): Promise<UekScanResult> {
  const scannedAt = new Date().toISOString();
  await ensureLogDir();
  const logFile = path.join(process.cwd(), ".sdd-board", "logs", SCAN_LOG_NAME);
  const promptFile = promptPathForLogFile(logFile);

  const previous = await readUekExpertState();

  let prompt: string;
  try {
    prompt = await fs.readFile(SCAN_PROMPT_PATH, "utf-8");
  } catch (e) {
    const message = `Не найден шаблон ${SCAN_PROMPT_PATH}: ${String(e)}`;
    await writeUekExpertState({
      ...previous,
      lastScannedAt: scannedAt,
      lastScanError: message,
    });
    return {
      ok: false,
      error: message,
      pullRequests: previous.pullRequests,
      scannedAt,
    };
  }

  await fs.writeFile(promptFile, prompt, { flag: "w" });
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (uek-expert scan)`,
      `# prompt-file: ${promptFile}`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir .`,
      "",
    ].join("\n"),
    { flag: "w" },
  );

  const result = spawnGigacodeWithLog({
    argv: ["--prompt", prompt],
    logFile,
    addDir: process.cwd(),
    approvalMode: "auto-edit",
  });

  // We wait for the gigacode process to exit so the caller (the
  // POST /api/uek-expert/scan handler, or the watcher tick) gets
  // the final state. The process is detached internally but we
  // still hold its exit promise.
  const { exitCode } = await result.promise;
  if (exitCode !== 0) {
    const message = `gigacode exited with code ${exitCode}; see ${logFile}`;
    const next = {
      ...previous,
      lastScannedAt: scannedAt,
      lastScanError: message,
    };
    await writeUekExpertState(next);
    return {
      ok: false,
      error: message,
      pullRequests: previous.pullRequests,
      scannedAt,
    };
  }

  // Parse the LAST JSON object on the last non-empty line of the
  // log. gigacode is told in the template to emit exactly one
  // such line; we look for it defensively in case it adds a
  // trailing newline.
  let rawLog: string;
  try {
    rawLog = await fs.readFile(logFile, "utf-8");
  } catch (e) {
    const message = `Не удалось прочитать ${logFile}: ${String(e)}`;
    await writeUekExpertState({
      ...previous,
      lastScannedAt: scannedAt,
      lastScanError: message,
    });
    return {
      ok: false,
      error: message,
      pullRequests: previous.pullRequests,
      scannedAt,
    };
  }

  const parsed = extractJsonPayload(rawLog);
  if (!parsed.ok) {
    const message = `Не удалось распарсить JSON-ответ gigacode: ${parsed.error}`;
    await writeUekExpertState({
      ...previous,
      lastScannedAt: scannedAt,
      lastScanError: message,
    });
    return {
      ok: false,
      error: message,
      pullRequests: previous.pullRequests,
      scannedAt,
    };
  }

  const incoming = parsed.pullRequests;
  const merged: Record<string, UekPullRequest> = { ...previous.pullRequests };
  for (const pr of incoming) {
    const key = makeUekPrKey(pr.repository, pr.id);
    const previousEntry = merged[key];
    merged[key] = {
      id: pr.id,
      title: pr.title,
      url: pr.url,
      repository: pr.repository,
      author: pr.author,
      reviewerStatus: pr.reviewerStatus,
      state: pr.state,
      firstSeenAt: previousEntry?.firstSeenAt ?? scannedAt,
      fetchedAt: scannedAt,
      // Preserve user-chosen column from a prior entry. Newly-
      // discovered PRs land in `null` and the UI shows them in
      // the "Новые" column.
      column: previousEntry?.column ?? null,
    };
  }
  await writeUekExpertState({
    pullRequests: merged,
    lastScannedAt: scannedAt,
    lastScanError: null,
  });
  return {
    ok: true,
    pullRequests: merged,
    scannedAt,
    fetched: incoming.length,
  };
}

/**
 * Find the LAST line in the log that parses as the
 * `{ "pullRequests": [...] }` payload. gigacode prefixes every
 * line with `[<ts>] [out|err] …` so we strip the tag first.
 */
function extractJsonPayload(
  rawLog: string,
): { ok: true; pullRequests: ScanIncomingPr[] } | { ok: false; error: string } {
  const lines = rawLog.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripLogTag(lines[i]).trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line);
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { pullRequests?: unknown }).pullRequests)
      ) {
        const prs = (parsed as { pullRequests: unknown[] }).pullRequests
          .map((raw): ScanIncomingPr | null => normaliseIncoming(raw))
          .filter((p): p is ScanIncomingPr => p !== null);
        return { ok: true, pullRequests: prs };
      }
    } catch {
      // try the previous line — it might just be a non-JSON
      // status line that ended in `{`
    }
  }
  return { ok: false, error: "В логе нет строки с JSON-результатом" };
}

function stripLogTag(line: string): string {
  // Match `[2025-…] [out] <rest>` (with the trailing space the
  // logger always emits).
  const match = line.match(/^\[[^\]]+\] \[[^\]]+\] ?(.*)$/);
  return match ? match[1] : line;
}

interface ScanIncomingPr {
  id: string;
  title: string;
  url: string;
  repository: string;
  author: string;
  reviewerStatus: "APPROVED" | "UNAPPROVED" | "NEEDS_WORK";
  state: "OPEN" | "DECLINED" | "MERGED";
}

function normaliseIncoming(raw: unknown): ScanIncomingPr | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ScanIncomingPr>;
  if (
    typeof r.id !== "string" ||
    typeof r.title !== "string" ||
    typeof r.url !== "string" ||
    typeof r.repository !== "string" ||
    typeof r.author !== "string"
  ) {
    return null;
  }
  return {
    id: r.id,
    title: r.title,
    url: r.url,
    repository: r.repository,
    author: r.author,
    reviewerStatus:
      r.reviewerStatus === "APPROVED" ||
      r.reviewerStatus === "NEEDS_WORK" ||
      r.reviewerStatus === "UNAPPROVED"
        ? r.reviewerStatus
        : "UNAPPROVED",
    state:
      r.state === "OPEN" || r.state === "DECLINED" || r.state === "MERGED"
        ? r.state
        : "OPEN",
  };
}
