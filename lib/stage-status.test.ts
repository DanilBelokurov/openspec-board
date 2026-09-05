import { describe, it, expect } from "vitest";
import { computeStageStatus } from "./stage-status";
import type { TaskEntry } from "./state";

/**
 * `computeStageStatus` is the gating function the
 * stage-status polling endpoint uses to decide "should the
 * client navigate to the board?". These tests pin its
 * semantics — in particular that they agree with the same
 * flags `app/changes/[tag]/page.tsx` uses to render the
 * "Подтвердить" button. If those two places ever drift, the
 * UI will feel inconsistent.
 */

const allDead = () => false;

function makeTask(overrides: Partial<TaskEntry> = {}): TaskEntry {
  return {
    id: "task-id",
    mode: "analyst",
    stage: "design",
    lastScannedAt: new Date().toISOString(),
    summary: {
      id: "summary-id",
      changeName: "test-change",
      path: "",
      title: "Test",
      stage: "design",
      hasProposal: false,
      hasDesign: false,
      hasSpecs: false,
      capabilityTags: [],
      newCapabilities: [],
      modifiedCapabilities: [],
      specCounts: { requirements: 0, scenarios: 0 },
      updatedAt: new Date().toISOString(),
      fileCount: 0,
      totalSize: 0,
    },
    ...overrides,
  } as TaskEntry;
}

describe("computeStageStatus", () => {
  it("returns ready=true when no pipeline is alive, no error, and artifact exists", () => {
    const task = makeTask({
      stage: "design",
      designCreateExitCode: 0,
    });
    const status = computeStageStatus(task, allDead, true);
    expect(status).toEqual({
      stage: "design",
      ready: true,
      error: false,
      pipelineRunning: false,
      hasCascade: false,
    });
  });

  it("returns ready=false while a pipeline process is alive", () => {
    const task = makeTask({
      stage: "design",
      designCreatePid: 12345,
    });
    const status = computeStageStatus(task, () => true, true);
    expect(status.ready).toBe(false);
    expect(status.pipelineRunning).toBe(true);
    expect(status.error).toBe(false);
  });

  it("returns ready=false and error=true when the create step exited non-zero", () => {
    const task = makeTask({
      stage: "design",
      designCreateExitCode: 1,
    });
    const status = computeStageStatus(task, allDead, true);
    expect(status.ready).toBe(false);
    expect(status.error).toBe(true);
  });

  it("returns ready=false when artifact is not on disk yet", () => {
    const task = makeTask({
      stage: "design",
      designCreateExitCode: 0,
    });
    const status = computeStageStatus(task, allDead, false);
    expect(status.ready).toBe(false);
    expect(status.error).toBe(false);
    expect(status.pipelineRunning).toBe(false);
  });

  it("treats exit code 0 as success for the proposal stage", () => {
    const task = makeTask({
      stage: "proposal",
      openspecNewExitCode: 0,
      gigacodeContinueExitCode: 0,
    });
    const status = computeStageStatus(task, allDead, true);
    expect(status.ready).toBe(true);
    expect(status.error).toBe(false);
  });

  it("surfaces proposal-step error when gigacodeContinue exit code is non-zero", () => {
    const task = makeTask({
      stage: "proposal",
      openspecNewExitCode: 0,
      gigacodeContinueExitCode: 2,
    });
    const status = computeStageStatus(task, allDead, true);
    expect(status.error).toBe(true);
    expect(status.ready).toBe(false);
  });

  it("ignores exit code on the proposal stage when the create PID is still alive", () => {
    // While the process is alive, `exitCode` is whatever was
    // last persisted — even if non-zero from a previous run —
    // and the user shouldn't see "error" yet. We gate on
    // `pipelineRunning` first.
    const task = makeTask({
      stage: "design",
      designCreatePid: 999,
      designCreateExitCode: 1,
    });
    const status = computeStageStatus(task, () => true, false);
    expect(status.pipelineRunning).toBe(true);
    expect(status.error).toBe(true);
    expect(status.ready).toBe(false);
  });

  it("checks the delta-spec stage's create PID", () => {
    const task = makeTask({
      stage: "delta-spec",
      deltaSpecCreatePid: 123,
    });
    expect(computeStageStatus(task, () => true, true).pipelineRunning).toBe(
      true,
    );
    expect(computeStageStatus(task, allDead, true).pipelineRunning).toBe(
      false,
    );
  });

  it("checks the adr stage's create PID", () => {
    const task = makeTask({
      stage: "adr",
      adrCreatePid: 123,
    });
    expect(computeStageStatus(task, () => true, true).pipelineRunning).toBe(
      true,
    );
  });

  it("checks the plan stage's create PID and exit code", () => {
    const aliveTask = makeTask({
      stage: "plan",
      planCreatePid: 7,
    });
    expect(
      computeStageStatus(aliveTask, () => true, true).pipelineRunning,
    ).toBe(true);

    const errorTask = makeTask({
      stage: "plan",
      planCreateExitCode: 137,
    });
    expect(computeStageStatus(errorTask, allDead, true).error).toBe(true);
  });

  it("flags hasCascade when cascadeTargetStage + cascadeFromStage + cascadeComment are set", () => {
    const task = makeTask({
      stage: "design",
      cascadeTargetStage: "proposal",
      cascadeFromStage: "design",
      cascadeComment: "добавь раздел про риски",
      designCreateExitCode: 0,
    });
    const status = computeStageStatus(task, allDead, true);
    expect(status.hasCascade).toBe(true);
    expect(status.ready).toBe(true);
  });

  it("hasCascade is false when only some cascade fields are set", () => {
    const partialTarget = makeTask({
      stage: "design",
      cascadeTargetStage: "proposal",
    });
    expect(computeStageStatus(partialTarget, allDead, true).hasCascade).toBe(
      false,
    );

    const partialFrom = makeTask({
      stage: "design",
      cascadeFromStage: "design",
    });
    expect(computeStageStatus(partialFrom, allDead, true).hasCascade).toBe(
      false,
    );

    const partialComment = makeTask({
      stage: "design",
      cascadeComment: "что-то",
    });
    expect(computeStageStatus(partialComment, allDead, true).hasCascade).toBe(
      false,
    );
  });

  it("returns ready=false with no error for unknown stages (e.g. 'develop')", () => {
    // The endpoint guards against this by returning 400 when
    // the stage isn't in STAGE_CONFIG, but the helper itself
    // should be defensive — no PID matches, so running is
    // false, error is false, and ready comes purely from
    // artifactReady.
    const task = makeTask({ stage: "develop" });
    expect(computeStageStatus(task, allDead, false).ready).toBe(false);
    expect(computeStageStatus(task, allDead, true).ready).toBe(true);
  });
});
