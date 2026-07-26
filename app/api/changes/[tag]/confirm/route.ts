import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  readState,
  updateTask,
  findTaskByTagStrict,
  taskKey,
} from "@/lib/state";
import {
  commitChange,
  isStageReady,
  isPlanTasksReady,
} from "@/lib/continuation";
import { readConfig } from "@/lib/config";
import { listServicesInChange } from "@/lib/openspec-scanner";
import { createWorktree, pickFreeFeatureWorktree } from "@/lib/git";
import { extractJiraId } from "@/lib/jira";
import { resolveRepoLocalPath } from "@/lib/config";

// Each non-plan confirm call is gated on the previous stage
// being ready (artifact on disk). The "next stage" key is what
// we advance the task to on success. The plan stage has its
// own flow (multi-service child creation, see below) and
// intentionally does NOT use this table.
const NEXT_STAGE: Record<string, string> = {
  proposal: "delta-spec",
  "delta-spec": "design",
  design: "adr",
  adr: "done",
  // Developer-mode single-service plan fallback: when the
  // change-proposal has no `tasks/<service>/` subdirectories
  // (i.e. tasks.md sits at the change folder root), the
  // existing plan→develop single-step flow still applies.
  plan: "develop",
};

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { tag: string } },
) {
  // Confirm is mode-aware but mode-strict: we read the current
  // board mode from config and look up the task in that mode
  // only. We never probe the other mode — that would either
  // re-introduce the cross-mode leak findTaskByTag had, or
  // (worse) pick up an analyst-companion task in a terminal
  // stage like "done" and refuse the confirm with 409 even
  // though the developer task in the same tag is sitting there
  // waiting to be confirmed. The mode is determined by the
  // board the user is on, same as page.tsx does it.
  const config = await readConfig();
  const task = await findTaskByTagStrict(config.mode, params.tag);
  if (!task) {
    return NextResponse.json(
      {
        error: `Задача "${params.tag}" не найдена в режиме "${config.mode}"`,
      },
      { status: 404 },
    );
  }
  if (!task.openspecWorktreePath) {
    return NextResponse.json(
      { error: "У задачи не записан openspecWorktreePath" },
      { status: 400 },
    );
  }

  // ── plan stage: multi-service child creation ────────────────
  if (task.stage === "plan" && task.mode === "developer") {
    return await handlePlanConfirm(req, config, task, params.tag);
  }

  // ── all other stages: legacy single-step flow ───────────────
  const nextStage = NEXT_STAGE[task.stage];
  if (!nextStage) {
    return NextResponse.json(
      {
        error: `Задача в статусе "${task.stage}" — подтверждение не предусмотрено`,
      },
      { status: 409 },
    );
  }
  const worktree = task.openspecWorktreePath;
  const changePath = path.join(worktree, "openspec", "changes", params.tag);
  const artifactReady = await checkStageArtifact(
    task.stage,
    worktree,
    params.tag,
  );
  if (!artifactReady) {
    return NextResponse.json(
      {
        error: `Артефакт ещё не создан — ожидаем ${expectedArtifactPath(task.stage, changePath)}`,
      },
      { status: 409 },
    );
  }
  const ok = await commitChange(task, params.tag, task.stage);
  if (!ok) {
    const refreshed = await readState();
    const modeKey = taskKey(task.mode, params.tag);
    const refreshedTask = refreshed.tasks[modeKey];
    const errMsg =
      refreshedTask?.commitError ??
      refreshedTask?.deltaSpecCommitError ??
      refreshedTask?.designCommitError ??
      refreshedTask?.adrCommitError ??
      refreshedTask?.planCommitError ??
      "Не удалось сделать git commit";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
  const updated = await updateTask(task.mode, params.tag, {
    stage: nextStage as import("@/lib/openspec").Stage,
  });
  return NextResponse.json({ ok: true, task: updated });
}

/**
 * Plan-stage confirm: when the change-proposal has per-service
 * `tasks/<service>/` subdirectories, the dev picks a code
 * repo for each one and we spawn a child develop task per
 * selected service. Falls back to the legacy single-step
 * `plan → develop` transition when there are no subdirs (the
 * one-service-at-root case).
 *
 * Per the "1a" rule, services that already have a child task
 * are excluded from re-selection. The parent stays in `plan`
 * after this call; the board hides it only once every service
 * has a child.
 */
async function handlePlanConfirm(
  req: NextRequest,
  config: { openspecDir: string; repos?: Record<string, { localPath?: string }> },
  task: import("@/lib/state").TaskEntry,
  parentTag: string,
) {
  // Parse body. Empty body / no services → fall back to the
  // legacy single-step plan→develop (tasks.md lives at the
  // change folder root, not under any tasks/<service>/ subdir).
  let body: { services?: Record<string, string> } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const services = body.services ?? {};
  const serviceNames = Object.keys(services).filter(
    (s) => services[s] && services[s] !== "skip",
  );

  // 1. Discover services available in tasks/. If the change
  //    has no per-service subdirs, fall back to the legacy
  //    single-step plan→develop.
  const allServices = await listServicesInChange(
    task.openspecWorktreePath!,
    parentTag,
  );
  if (allServices.length === 0) {
    return await legacyPlanToDevelop(task, parentTag);
  }

  // 2. No services selected (all "skip") — keep the parent in
  //    plan and let the dev come back to pick. /confirm is a
  //    no-op when there's nothing to do.
  if (serviceNames.length === 0) {
    return NextResponse.json({
      ok: true,
      note: "Не выбрано ни одного сервиса — задача остаётся в плане",
      createdChildren: [],
    });
  }

  // 3. Validate every service the dev picked is a real one in
  //    tasks/, and every repo name is in config.repos.
  const repos = config.repos ?? {};
  for (const service of serviceNames) {
    if (!allServices.includes(service)) {
      return NextResponse.json(
        {
          error: `Сервис "${service}" не найден в tasks/ — обновите страницу`,
        },
        { status: 400 },
      );
    }
    if (!repos[services[service]]) {
      return NextResponse.json(
        {
          error: `Репозиторий "${services[service]}" для сервиса "${service}" не найден в config.repos`,
        },
        { status: 400 },
      );
    }
  }

  // 4. Resolve the branch name. We reuse the parent's Jira
  //    ticket so all child worktrees for this change share the
  //    same `feature/<JIRA-ID>` branch name across their
  //    respective repos (per the "3a" agreement).
  const jiraId = task.jiraUrl ? extractJiraId(task.jiraUrl) : null;
  if (!jiraId) {
    return NextResponse.json(
      {
        error:
          "Не удалось извлечь Jira id из task.jiraUrl — task не запущен",
      },
      { status: 400 },
    );
  }
  const branch = `feature/${jiraId}`;

  // 5. For each (service, repo) pair, create a worktree in
  //    the code repo. If a worktree creation fails we stop and
  //    return the error — child tasks are NOT yet created at
  //    this point, so no cleanup is needed.
  interface PendingChild {
    service: string;
    repoName: string;
    codeRepoPath: string;
    codeWorktreePath: string;
  }
  const pending: PendingChild[] = [];
  for (const service of serviceNames) {
    const repoName = services[service];
    const codeRepoPath = resolveRepoLocalPath(repoName, repos[repoName]);
    let codeWorktreePath: string;
    try {
      const picked = await pickFreeFeatureWorktree(codeRepoPath, jiraId);
      codeWorktreePath = picked.worktreePath;
      const wt = await createWorktree(codeRepoPath, codeWorktreePath, branch);
      pending.push({
        service,
        repoName,
        codeRepoPath,
        codeWorktreePath: wt.path,
      });
    } catch (e) {
      // Best-effort rollback of the worktrees we already
      // created in this loop.
      for (const p of pending) {
        try {
          await runGit("worktree", ["remove", "--force", p.codeWorktreePath], {
            cwd: p.codeRepoPath,
          });
        } catch {
          /* swallow */
        }
      }
      return NextResponse.json(
        {
          error: `Worktree для "${service}" (${repoName}): ${(e as Error).message}`,
        },
        { status: 500 },
      );
    }
  }

  // 6. Create the child tasks. Composite key per service:
  //    `developer:<service>`. Each child inherits
  //    `openspecWorktreePath` from the parent (where tasks.md
  //    lives) and points to its own code-repo worktree.
  const state = await readState();
  const now = new Date().toISOString();
  const createdChildren: string[] = [];
  for (const p of pending) {
    const childTag = p.service;
    const childKey = taskKey("developer", childTag);
    if (state.tasks[childKey]) {
      // Existing child — keep its state untouched, don't
      // touch the worktree. Just record it in the created
      // list so the parent.childTags update includes it.
      createdChildren.push(childTag);
      continue;
    }
    const child: import("@/lib/state").TaskEntry = {
      id: crypto.randomUUID(),
      mode: "developer",
      stage: "develop",
      lastScannedAt: now,
      summary: {
        id: crypto.randomUUID(),
        changeName: childTag,
        path: "",
        title: childTag,
        stage: "develop",
        hasProposal: false,
        hasDesign: false,
        hasSpecs: false,
        capabilityTags: [],
        newCapabilities: [],
        modifiedCapabilities: [],
        specCounts: { added: 0, modified: 0, removed: 0, scenarios: 0 },
        updatedAt: now,
        fileCount: 0,
        totalSize: 0,
      },
      description: task.description,
      parentTag,
      serviceName: p.service,
      codeRepoPath: p.codeRepoPath,
      codeBranch: branch,
      codeWorktreePath: p.codeWorktreePath,
      openspecWorktreePath: task.openspecWorktreePath,
      jiraUrl: task.jiraUrl,
    };
    state.tasks[childKey] = child;
    createdChildren.push(childTag);
  }
  // Persist state.json atomically via the same write path
  // updateTask uses. We avoid the per-task updateTask loop
  // here so all children land in a single write — no risk of
  // a half-applied state if the process is killed mid-batch.
  const { atomicWriteFile } = await import("@/lib/atomic-write");
  await atomicWriteFile(
    path.join(process.cwd(), ".sdd-board", "state.json"),
    JSON.stringify(state, null, 2) + "\n",
  );

  // 7. Commit tasks.md in the openspec worktree so the next
  //    /confirm call (for the remaining services) and any
  //    sibling task see the up-to-date tree. commitChange
  //    no-ops cleanly when the worktree is already clean.
  await commitChange(task, parentTag, "plan");

  // 8. Update the parent: childTags ∪= createdChildren,
  //    serviceRepos persists the dev's selection.
  const mergedChildTags = Array.from(
    new Set([...(task.childTags ?? []), ...createdChildren]),
  );
  const mergedServiceRepos = {
    ...(task.serviceRepos ?? {}),
    ...Object.fromEntries(
      serviceNames.map((s) => [s, services[s] as string]),
    ),
  };
  await updateTask("developer", parentTag, {
    childTags: mergedChildTags,
    serviceRepos: mergedServiceRepos,
  });

  return NextResponse.json({
    ok: true,
    createdChildren,
    stage: "plan",
    worktrees: pending.map((p) => ({
      service: p.service,
      repo: p.repoName,
      worktree: p.codeWorktreePath,
    })),
  });
}

/**
 * Single-step plan→develop: tasks.md lives at the change
 * folder root, not under tasks/<service>/. The dev isn't
 * using the multi-service child graph, so we just commit
 * tasks.md and transition the parent to develop.
 */
async function legacyPlanToDevelop(
  task: import("@/lib/state").TaskEntry,
  parentTag: string,
) {
  const worktree = task.openspecWorktreePath!;
  const changePath = path.join(worktree, "openspec", "changes", parentTag);
  const artifactReady = await isPlanTasksReady(worktree, parentTag);
  if (!artifactReady) {
    return NextResponse.json(
      {
        error: `Артефакт ещё не создан — ожидаем ${changePath}/ (tasks.md, в т.ч. под tasks/<service>/)`,
      },
      { status: 409 },
    );
  }
  const ok = await commitChange(task, parentTag, "plan");
  if (!ok) {
    const refreshed = await readState();
    const refreshedTask = refreshed.tasks[taskKey(task.mode, parentTag)];
    return NextResponse.json(
      { error: refreshedTask?.planCommitError ?? "Не удалось сделать git commit" },
      { status: 500 },
    );
  }
  const updated = await updateTask("developer", parentTag, {
    stage: "develop" as import("@/lib/openspec").Stage,
  });
  return NextResponse.json({ ok: true, task: updated, stage: "develop" });
}

/**
 * Tiny shell wrapper for the rollback path inside the
 * plan-confirm handler. Kept private — the rest of the file
 * uses the run() helper in lib/continuation.ts for git calls.
 */
async function runGit(
  subcommand: string,
  args: string[],
  opts: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import("child_process");
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", opts.cwd, subcommand, ...args],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`git ${subcommand} failed: ${err.message}\n${stderr}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function expectedArtifactPath(stage: string, changePath: string): string {
  if (stage === "delta-spec") return `${changePath}/specs/`;
  if (stage === "proposal") return `${changePath}/proposal.md`;
  if (stage === "design") return `${changePath}/design.md`;
  if (stage === "adr") return `${changePath}/adr.md`;
  // tasks.md may be at the change folder root or under a
  // per-service subdirectory (tasks/<service>/tasks.md, the
  // layout the openspec instructions `tasks` subcommand emits).
  if (stage === "plan") return `${changePath}/ (tasks.md, в т.ч. под tasks/<service>/)`;
  return changePath;
}

async function checkStageArtifact(
  stage: string,
  worktree: string,
  changeName: string,
): Promise<boolean> {
  if (stage === "delta-spec") {
    return isStageReady(worktree, changeName, {
      stage: "delta-spec",
      instructionsArtifact: "specs",
      artifactSubpath: "specs",
    });
  }
  if (stage === "proposal") {
    return exists(
      path.join(worktree, "openspec", "changes", changeName, "proposal.md"),
    );
  }
  if (stage === "design") {
    return exists(
      path.join(worktree, "openspec", "changes", changeName, "design.md"),
    );
  }
  if (stage === "adr") {
    return exists(
      path.join(worktree, "openspec", "changes", changeName, "adr.md"),
    );
  }
  if (stage === "plan") {
    // tasks.md may live at <change>/tasks.md (single-service
    // change) or <change>/tasks/<service>/tasks.md
    // (multi-service, the layout the openspec instructions
    // `tasks` subcommand emits for this project). Either
    // counts as "ready".
    return isPlanTasksReady(worktree, changeName);
  }
  return false;
}
