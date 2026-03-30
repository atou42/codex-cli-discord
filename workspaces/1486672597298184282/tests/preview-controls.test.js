const {
  normalizePreviewLoopSelection,
  shouldCapturePreviewKeyboard,
  getPreviewKeyMapping,
  canStartPreviewJump,
  stepPreviewSceneState,
} = require("../public/preview-controls");

describe("preview control helpers", () => {
  it("keeps the loop range ordered and resets the current frame to the earliest bound", () => {
    expect(
      normalizePreviewLoopSelection({
        start: 7,
        end: 3,
        changedEdge: "start",
      }),
    ).toEqual({
      start: 7,
      end: 7,
      frameIndex: 7,
    });

    expect(
      normalizePreviewLoopSelection({
        start: 9,
        end: 4,
        changedEdge: "end",
      }),
    ).toEqual({
      start: 4,
      end: 4,
      frameIndex: 4,
    });
  });

  it("captures preview keyboard input only for the live preview stage and non-form targets", () => {
    expect(
      shouldCapturePreviewKeyboard({
        currentStage: "preview",
        hasActivePreview: true,
        targetTagName: "div",
        isContentEditable: false,
        hasTarget: true,
      }),
    ).toBe(true);

    expect(
      shouldCapturePreviewKeyboard({
        currentStage: "preview",
        hasActivePreview: true,
        targetTagName: "input",
        isContentEditable: false,
        hasTarget: true,
      }),
    ).toBe(false);

    expect(
      shouldCapturePreviewKeyboard({
        currentStage: "animate",
        hasActivePreview: true,
        targetTagName: "div",
        isContentEditable: false,
        hasTarget: true,
      }),
    ).toBe(false);
  });

  it("maps movement keys consistently across WASD and arrows", () => {
    expect(getPreviewKeyMapping("a")).toBe("left");
    expect(getPreviewKeyMapping("ArrowRight")).toBe("right");
    expect(getPreviewKeyMapping("W")).toBe("up");
    expect(getPreviewKeyMapping("arrowdown")).toBe("down");
    expect(getPreviewKeyMapping("x")).toBe(null);
  });

  it("only allows jumps from an active grounded preview scene", () => {
    expect(
      canStartPreviewJump({
        hasActivePreview: true,
        currentStage: "preview",
        jumpOffset: 0,
        jumpVelocity: 0,
      }),
    ).toBe(true);

    expect(
      canStartPreviewJump({
        hasActivePreview: true,
        currentStage: "preview",
        jumpOffset: 12,
        jumpVelocity: 0,
      }),
    ).toBe(false);

    expect(
      canStartPreviewJump({
        hasActivePreview: false,
        currentStage: "preview",
        jumpOffset: 0,
        jumpVelocity: 0,
      }),
    ).toBe(false);
  });

  it("steps the preview scene through movement, facing, vertical drift, and landing", () => {
    const moved = stepPreviewSceneState(
      {
        playerX: 320,
        baseYRatio: 0.74,
        jumpOffset: 0,
        jumpVelocity: 0,
        facing: 1,
      },
      {
        left: true,
        right: false,
        up: true,
        down: false,
      },
      0.5,
      {
        worldWidth: 1920,
        moveSpeed: 340,
        verticalSpeed: 0.16,
        gravity: 1480,
        jumpVelocity: 540,
      },
    );

    expect(moved.playerX).toBe(150);
    expect(moved.facing).toBe(-1);
    expect(moved.baseYRatio).toBeCloseTo(0.66, 5);

    const landed = stepPreviewSceneState(
      {
        playerX: 320,
        baseYRatio: 0.74,
        jumpOffset: 10,
        jumpVelocity: -60,
        facing: 1,
      },
      {},
      0.5,
      {
        worldWidth: 1920,
        moveSpeed: 340,
        verticalSpeed: 0.16,
        gravity: 1480,
        jumpVelocity: 540,
      },
    );

    expect(landed.jumpOffset).toBe(0);
    expect(landed.jumpVelocity).toBe(0);
  });
});
