import { promises as fs } from "fs";
import path from "path";
import type { UekReviewColumn } from "@/lib/modes";
import { atomicWriteFile } from "@/lib/atomic-write";

/**
 * Persistent state for the UEK-expert review board. Lives in its
 * own file so that openspec-task state and review-board state don't
 * share a JSON document — the review board scans from MCP, while
 * openspec tasks are local worktrees; conflating the two would
 * make concurrent scans race the same file.
 *
 * The file lives at `<process.cwd()>/.sdd-board/uek-expert.json`
 * alongside the openspec config. We don't use the user's
 * `openspecDir` for this — the UEK review board doesn't read
 * anything under openspecDir, so the file is project-local.
 */

export interface UekPullRequest {
  /** Bitbucket PR id (numeric, as a string for stable JSON keys). */
  id: string;
  title: string;
  url: string;
  /** Repository slug ("project/repo") the PR belongs to. */
  repository: string;
  /** Email or display name of the author. */
  author: string;
  /** Raw reviewer status from the bitbucket MCP response. */
  reviewerStatus: "APPROVED" | "UNAPPROVED" | "NEEDS_WORK";
  /** Raw PR state. */
  state: "OPEN" | "DECLINED" | "MERGED";
  /** First time we saw this PR in a scan. */
  firstSeenAt: string;
  /** Most recent scan that included this PR. */
  fetchedAt: string;
  /**
   * Current board column for this PR. `null` means the PR was
   * just observed for the first time and hasn't been placed on
   * the board yet — the UI renders those into the "Новые"
   * column on the fly. Once the user (or a future piece of
   * internal logic) moves it, this stores the chosen column.
   */
  column: UekReviewColumn | null;
}

export interface UekExpertState {
  /** All PRs we've ever seen, keyed by `${repository}:${id}`. */
  pullRequests: Record<string, UekPullRequest>;
  /** Timestamp of the most recent scan attempt (success or failure). */
  lastScannedAt: string | null;
  /** Error message from the most recent failed scan, if any. */
  lastScanError: string | null;
}

const STATE_DIR = path.join(process.cwd(), ".sdd-board");
const STATE_FILE = path.join(STATE_DIR, "uek-expert.json");

const EMPTY_STATE: UekExpertState = {
  pullRequests: {},
  lastScannedAt: null,
  lastScanError: null,
};

export function makeUekPrKey(repository: string, id: string): string {
  return `${repository}:${id}`;
}

export async function readUekExpertState(): Promise<UekExpertState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    if (!raw.trim()) return cloneEmpty();
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch (e: unknown) {
    if (isNoEnt(e)) return cloneEmpty();
    throw e;
  }
}

export async function writeUekExpertState(state: UekExpertState): Promise<void> {
  await atomicWriteFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function cloneEmpty(): UekExpertState {
  return {
    pullRequests: {},
    lastScannedAt: null,
    lastScanError: null,
  };
}

function isNoEnt(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

/**
 * Normalise whatever shape was on disk into the current
 * UekExpertState. Old fields are dropped; missing fields get
 * defaults. We don't try to back-fill `column` from existing
 * legacy fields — null on load means "render as Новые", which is
 * a safe default.
 */
function sanitize(value: unknown): UekExpertState {
  if (!value || typeof value !== "object") return cloneEmpty();
  const obj = value as Partial<UekExpertState>;
  const prs: Record<string, UekPullRequest> = {};
  if (obj.pullRequests && typeof obj.pullRequests === "object") {
    for (const [key, raw] of Object.entries(obj.pullRequests)) {
      const pr = normalisePr(raw);
      if (pr) prs[key] = pr;
    }
  }
  return {
    pullRequests: prs,
    lastScannedAt:
      typeof obj.lastScannedAt === "string" ? obj.lastScannedAt : null,
    lastScanError:
      typeof obj.lastScanError === "string" ? obj.lastScanError : null,
  };
}

function normalisePr(raw: unknown): UekPullRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<UekPullRequest>;
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
    reviewerStatus: normaliseReviewerStatus(r.reviewerStatus),
    state: normaliseState(r.state),
    firstSeenAt:
      typeof r.firstSeenAt === "string" ? r.firstSeenAt : new Date().toISOString(),
    fetchedAt:
      typeof r.fetchedAt === "string" ? r.fetchedAt : new Date().toISOString(),
    column:
      r.column === "new" ||
      r.column === "in-review" ||
      r.column === "rejected" ||
      r.column === "approved"
        ? r.column
        : null,
  };
}

function normaliseReviewerStatus(value: unknown): UekPullRequest["reviewerStatus"] {
  return value === "APPROVED" || value === "NEEDS_WORK" || value === "UNAPPROVED"
    ? value
    : "UNAPPROVED";
}

function normaliseState(value: unknown): UekPullRequest["state"] {
  return value === "OPEN" || value === "DECLINED" || value === "MERGED"
    ? value
    : "OPEN";
}
