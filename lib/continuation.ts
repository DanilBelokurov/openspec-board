import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { readState, updateTask } from "./state";
import {
  ensureLogDir,
  processLogPath,
  spawnGigacodeWithLog,
} from "./process-logger";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd: opts?.cwd, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `${cmd} ${args.join(" ")} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

// Workflow schema passed explicitly to the openspec instructions call.
// Must match the schema used by `openspec new change` in
// app/api/changes/route.ts.
const SCHEMA = "spec-driven-with-adr";

// Prompt template from the user spec — the {json} placeholder is
// substituted with the raw stdout of `openspec instructions proposal
// --change <tag> --json`. Kept verbatim because the assistant is
// expected to follow it as-is (parse JSON fields, write to the
// resolvedOutputPath).
const PROPOSAL_PROMPT_TEMPLATE = `Parse the JSON. The key fields are:
  - \`context\`: Project background (constraints for you - do NOT include in output)
  - \`rules\`: Artifact-specific rules (constraints for you - do NOT include in output)
  - \`template\`: The structure to use for your output file
  - \`instruction\`: Schema-specific guidance
  - \`resolvedOutputPath\`: Resolved path or pattern to write the artifact
  - \`dependencies\`: Completed artifacts to read for context
Create the artifact file:
  - Read any completed dependency files for context
  - Use \`template\` as the structure - fill in its sections
  - Apply \`context\` and \`rules\` as constraints when writing - but do NOT copy them into the file
  - Write to the \`resolvedOutputPath\` specified in instructions. If it is a glob pattern, choose the concrete file path using the schema instruction and the change's context
"{json}"`;

/**
 * Drive the analyst-mode proposal-creation pipeline to completion.
 *
 * The pipeline is split across three auto-triggered steps, each guarded
 * by a disk-side-effect flag (per `feedback/auto-trigger-from-observed-lifecycle.md`):
 *
 *   step 1 (handled by POST /api/changes):
 *     `openspec new change <tag> --description <desc>` in worktree.
 *     produces: <worktree>/changes/<tag>/.openspec.yaml
 *
 *   step 2 (this function, when .openspec.yaml present but proposal.md
 *     not yet):
 *     `openspec instructions proposal --change <tag> --json` in worktree,
 *     then `gigacode --approval-mode=auto-edit --add-dir <worktree>
 *     --prompt <template-with-json>`.
 *     produces: <worktree>/changes/<tag>/proposal.md
 *
 *   step 3 (this function, when proposal.md present but not yet committed):
 *     synchronous `git -C <worktree> add . && git -C <worktree> commit -m ...`.
 *     Side-effect: a new commit on the feature branch. Idempotent via
 *     `committedAt`.
 *
 * Safe to call on every render and from the background watcher —
 * each step has its own idempotency flag.
 *
 * Returns the list of changeNames whose state was advanced this tick.
 */
export async function triggerContinueIfNeeded(
  openspecDir: string,
): Promise<string[]> {
  const state = await readState();
  const triggered: string[] = [];
  const now = new Date().toISOString();
  await ensureLogDir();

  for (const [changeName, task] of Object.entries(state.tasks)) {
    if (task.stage !== "proposal") continue;
    if (!task.openspecWorktreePath) continue;
    const changePath = path.join(
      task.openspecWorktreePath,
      "openspec",
      "changes",
      changeName,
    );
    if (!(await exists(changePath))) continue;
    if (!(await exists(path.join(changePath, ".openspec.yaml")))) continue;

    const proposalExists = await exists(path.join(changePath, "proposal.md"));

    if (proposalExists) {
      // Step 3: commit.
      if (task.committedAt) continue;
      const ok = await commitProposalChange(task, changeName);
      if (ok) triggered.push(changeName);
      continue;
    }

    // Step 2: openspec instructions → gigacode --prompt.
    if (task.gigacodeContinuePid) continue;
    const spawned = await spawnProposalGigacode(task, changeName, changePath);
    if (spawned) triggered.push(changeName);
  }
  return triggered;
}

async function spawnProposalGigacode(
  task: import("./state").TaskEntry,
  changeName: string,
  changePath: string,
): Promise<boolean> {
  const worktree = task.openspecWorktreePath!;
  // 2a. Get the proposal-generation instructions as JSON.
  let instructionsJson: string;
  try {
    const { stdout } = await run(
      "openspec",
      [
        "instructions",
        "proposal",
        "--change",
        changeName,
        "--json",
        "--schema",
        SCHEMA,
      ],
      { cwd: worktree },
    );
    instructionsJson = stdout;
  } catch (e) {
    console.error(
      `openspec instructions proposal failed for ${changeName}:`,
      e,
    );
    // Mark as error so the UI surfaces it; don't retry forever (the
    // openSpec-new step exit code stays unchanged — this is a separate
    // failure mode we want to make visible).
    await updateTask(changeName, {
      commitError: `openspec instructions: ${(e as Error).message}`,
    });
    return false;
  }

  const prompt = PROPOSAL_PROMPT_TEMPLATE.replace(
    "{json}",
    instructionsJson,
  );

  const logFile = processLogPath(changeName, "continue");
  // Persist the parameters and full prompt to the log file BEFORE
  // spawning gigacode — gigacode's stdout/stderr will be appended
  // after this block. Useful for post-mortem: re-read which exact
  // arguments and prompt the assistant saw.
  await fs.writeFile(
    logFile,
    [
      `# gigacode --prompt (proposal) for ${changeName}`,
      `# add-dir: ${worktree}`,
      `# approval-mode: auto-edit`,
      `# argv: gigacode --prompt <prompt> --approval-mode=auto-edit --add-dir ${worktree}`,
      `# prompt-length: ${prompt.length} chars`,
      `# openspec instructions output-length: ${instructionsJson.length} chars`,
      "",
      "# ----- prompt ----->",
      prompt,
      "# <----- prompt -----",
      "",
    ].join("\n"),
    { flag: "w" },
  );

  let pid: number | null = null;
  try {
    const result = spawnGigacodeWithLog({
      argv: ["--prompt", prompt],
      logFile,
      header: undefined,
      addDir: worktree,
      approvalMode: "auto-edit",
    });
    pid = result.pid || null;
    result.promise
      .then(async ({ exitCode, signal }) => {
        await updateTask(changeName, {
          gigacodeContinueExitCode: exitCode,
          gigacodeContinueExitSignal: signal,
        });
      })
      .catch((e) =>
        console.error(`gigacode-continue exit handler error:`, e),
      );
  } catch (e) {
    console.error(
      `gigacode --prompt spawn threw for ${changeName}:`,
      e,
    );
  }

  if (pid != null) {
    await updateTask(changeName, {
      gigacodeContinuePid: pid,
      gigacodeContinueStartedAt: new Date().toISOString(),
      gigacodeContinueLogPath: logFile,
    });
    return true;
  }
  console.error(
    `Failed to spawn gigacode --prompt for ${changeName}`,
  );
  return false;
}

async function commitProposalChange(
  task: import("./state").TaskEntry,
  changeName: string,
): Promise<boolean> {
  const worktree = task.openspecWorktreePath!;
  const message = buildCommitMessage(task, changeName);
  try {
    await run("git", ["-C", worktree, "add", "."]);
    await run("git", ["-C", worktree, "commit", "-m", message]);
    await updateTask(changeName, {
      committedAt: new Date().toISOString(),
      commitExitCode: 0,
      commitError: undefined,
    });
    return true;
  } catch (e) {
    const err = e as Error;
    console.error(`git commit failed for ${changeName}:`, err);
    // Non-zero exit: surface but DON'T mark as committed — leave the
    // idempotency flag null so a later trigger can retry once the user
    // fixes whatever blocked the commit.
    await updateTask(changeName, {
      commitExitCode: 1,
      commitError: err.message,
    });
    return false;
  }
}

function buildCommitMessage(
  task: import("./state").TaskEntry,
  changeName: string,
): string {
  const title = task.summary.title;
  const description = task.description ?? "";
  const jira = task.jiraUrl ?? "";
  const lines = [
    `[openspec] Add change-proposal: ${title}`,
    "",
    `Tag: ${changeName}`,
  ];
  if (jira) lines.push(`Jira: ${jira}`);
  lines.push("", "Description:", description);
  return lines.join("\n");
}
