import type { TaskEntry } from "./state";

export type StageStatusResult = {
  stage: string;
  /**
   * True when (a) no pipeline process is alive for the current
   * stage, (b) the stage's artifact exists on disk, and (c) no
   * fatal exit-code was recorded for the current stage.
   *
   * This is the same boolean `app/changes/[tag]/page.tsx` uses to
   * gate the "Подтвердить" button — extracted so the polling
   * endpoint and the page render agree on what "ready" means.
   */
  ready: boolean;
  /**
   * True when the most recent create/update process for the
   * current stage exited with a non-zero code. Mirrors the
   * `currentStageError` block in `app/changes/[tag]/page.tsx`.
   */
  error: boolean;
  /**
   * True when at least one pipeline PID for the current stage is
   * still alive. The UI uses this to render the spinner rather
   * than an error.
   */
  pipelineRunning: boolean;
  /**
   * True when the task currently has a cascade armed
   * (cascadeTargetStage + cascadeFromStage + cascadeComment all
   * set). Helps the polling UI display a "Cascade running" badge
   * without having to refetch the full task entry.
   */
  hasCascade: boolean;
};

type AliveCheck = (pid: number) => boolean;

/**
 * Compute the readiness/error/running flags for a task's current
 * stage. Pulled out of `app/changes/[tag]/page.tsx` so the
 * polling endpoint can answer "should the user be redirected to
 * the board?" with the same logic the page itself uses to gate
 * the confirm button.
 *
 * `isAlive` is injected so tests can supply a deterministic
 * check (no process spawning required).
 *
 * `artifactReady` is supplied by the caller after the file-system
 * check (`isStageReady` / `isPlanTasksReady`) — those touch the
 * disk and are too noisy to run on every unit test.
 */
export function computeStageStatus(
  task: TaskEntry,
  isAlive: AliveCheck,
  artifactReady: boolean,
): StageStatusResult {
  const pipelineRunning = isPipelineRunning(task, isAlive);
  const error = hasStageError(task);
  const hasCascade = Boolean(
    task.cascadeTargetStage && task.cascadeFromStage && task.cascadeComment,
  );
  const ready = !pipelineRunning && !error && artifactReady;
  return {
    stage: task.stage,
    ready,
    error,
    pipelineRunning,
    hasCascade,
  };
}

/**
 * Mirror of the `pipelineRunning` block in
 * `app/changes/[tag]/page.tsx` (around lines 329-345 in that
 * file). True when at least one of the current-stage PIDs is
 * still alive.
 */
function isPipelineRunning(task: TaskEntry, isAlive: AliveCheck): boolean {
  switch (task.stage) {
    case "proposal":
      return (
        alive(task.openspecNewPid, isAlive) ||
        alive(task.gigacodeContinuePid, isAlive) ||
        alive(task.proposalUpdatePid, isAlive)
      );
    case "delta-spec":
      return (
        alive(task.deltaSpecCreatePid, isAlive) ||
        alive(task.deltaSpecUpdatePid, isAlive)
      );
    case "design":
      return (
        alive(task.designCreatePid, isAlive) ||
        alive(task.designUpdatePid, isAlive)
      );
    case "adr":
      return (
        alive(task.adrCreatePid, isAlive) ||
        alive(task.adrUpdatePid, isAlive)
      );
    case "plan":
      return (
        alive(task.planCreatePid, isAlive) ||
        alive(task.planUpdatePid, isAlive)
      );
    default:
      return false;
  }
}

/**
 * Mirror of the `currentStageError` block in
 * `app/changes/[tag]/page.tsx`. True when the most recent
 * create/update process for the current stage has already
 * terminated and exited non-zero. We deliberately check only
 * the exit code (not "alive") so a long-running process that
 * eventually fails still surfaces as an error once it exits.
 */
function hasStageError(task: TaskEntry): boolean {
  switch (task.stage) {
    case "proposal":
      return (
        (task.openspecNewExitCode != null && task.openspecNewExitCode !== 0) ||
        (task.gigacodeContinueExitCode != null &&
          task.gigacodeContinueExitCode !== 0)
      );
    case "delta-spec":
      return (
        task.deltaSpecCreateExitCode != null &&
        task.deltaSpecCreateExitCode !== 0
      );
    case "design":
      return (
        task.designCreateExitCode != null && task.designCreateExitCode !== 0
      );
    case "adr":
      return task.adrCreateExitCode != null && task.adrCreateExitCode !== 0;
    case "plan":
      return task.planCreateExitCode != null && task.planCreateExitCode !== 0;
    default:
      return false;
  }
}

function alive(pid: number | null | undefined, isAlive: AliveCheck): boolean {
  return pid != null && isAlive(pid);
}
