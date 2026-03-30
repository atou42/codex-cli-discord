const {
  deriveWorkspaceSummary,
  isStageAccessible,
  getPreviewStageCopy,
  getCharacterCardState,
  getCurrentResultState,
  getAnimateMotionState,
} = require("../public/workspace-state");

describe("workspace state derivations", () => {
  it("keeps Preview locked when a character only has failed jobs and no completed spritesheets", () => {
    const workspaceSummary = deriveWorkspaceSummary({
      jobs: [
        {
          id: "job_failed_walk",
          status: "failed",
          error: "Could not read video duration.",
          createdAt: "2026-03-30T10:00:00.000Z",
          request: {
            action: "walk",
            requestKind: "standard",
          },
        },
      ],
      spritesheets: [],
    });

    expect(isStageAccessible("preview", { hasSelectedCharacter: true, workspaceSummary })).toBe(false);
    expect(getPreviewStageCopy({ workspaceSummary })).toMatchObject({
      title: "Preview stays locked",
      subtitle: "The last render failed. Retry the motion from Animate to unlock Preview.",
      nextStepLabel: "Retry in Animate",
    });
  });

  it("marks failed and zero-output characters differently from ready characters", () => {
    const failedSummary = deriveWorkspaceSummary({
      jobs: [
        {
          id: "job_failed_walk",
          status: "failed",
          error: "Could not read video duration.",
          createdAt: "2026-03-30T10:00:00.000Z",
        },
      ],
      spritesheets: [],
    });
    const emptySummary = deriveWorkspaceSummary({
      jobs: [],
      spritesheets: [],
    });
    const readySummary = deriveWorkspaceSummary({
      jobs: [],
      spritesheets: [{ id: "ss_walk_1" }],
    });

    expect(getCharacterCardState({ workspaceSummary: failedSummary })).toMatchObject({
      badgeStatus: "failed",
      badgeLabel: "failed",
      stateLabel: "Open",
    });
    expect(getCharacterCardState({ workspaceSummary: emptySummary })).toMatchObject({
      badgeStatus: "idle",
      badgeLabel: "base only",
      stateLabel: "Open",
    });
    expect(getCharacterCardState({ workspaceSummary: readySummary, isSelected: true })).toMatchObject({
      badgeStatus: "succeeded",
      badgeLabel: "ready",
      stateLabel: "Loaded",
    });
  });

  it("surfaces a failed current-result state instead of collapsing it into no result", () => {
    const workspaceSummary = deriveWorkspaceSummary({
      jobs: [
        {
          id: "job_failed_walk",
          status: "failed",
          error: "Could not read video duration.",
          createdAt: "2026-03-30T10:00:00.000Z",
        },
      ],
      spritesheets: [],
    });

    expect(getCurrentResultState({ workspaceSummary })).toMatchObject({
      kind: "failed",
      title: "Last render failed",
      description: "Could not read video duration.",
      primaryAction: "Retry in Animate",
    });
  });

  it("marks an Animate motion as failed when its latest job failed and no sheet exists", () => {
    const motionState = getAnimateMotionState({
      motionKey: "standard:walk",
      jobs: [
        {
          id: "job_failed_walk",
          status: "failed",
          error: "Could not read video duration.",
          createdAt: "2026-03-30T10:00:00.000Z",
          request: {
            action: "walk",
            requestKind: "standard",
          },
        },
      ],
      spritesheets: [],
    });

    expect(motionState).toMatchObject({
      kind: "failed",
      title: "Last render failed",
      description: "Could not read video duration.",
      factLabel: "Failure recorded",
    });
  });
});
