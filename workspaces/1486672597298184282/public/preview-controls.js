(function bootstrapPreviewControls(globalObject) {
  const DEFAULT_PREVIEW_SCENE_CONSTANTS = Object.freeze({
    worldWidth: 1920,
    moveSpeed: 340,
    verticalSpeed: 0.16,
    gravity: 1480,
    jumpVelocity: 540,
  });

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizePreviewLoopSelection({ start = 0, end = 0, changedEdge = "start" } = {}) {
    let normalizedStart = Number(start);
    let normalizedEnd = Number(end);

    if (!Number.isFinite(normalizedStart)) {
      normalizedStart = 0;
    }

    if (!Number.isFinite(normalizedEnd)) {
      normalizedEnd = 0;
    }

    if (changedEdge === "start" && normalizedStart > normalizedEnd) {
      normalizedEnd = normalizedStart;
    }

    if (changedEdge === "end" && normalizedEnd < normalizedStart) {
      normalizedStart = normalizedEnd;
    }

    return {
      start: normalizedStart,
      end: normalizedEnd,
      frameIndex: Math.min(normalizedStart, normalizedEnd),
    };
  }

  function shouldCapturePreviewKeyboard({
    currentStage = null,
    hasActivePreview = false,
    targetTagName = "",
    isContentEditable = false,
    hasTarget = true,
  } = {}) {
    if (currentStage !== "preview" || !hasActivePreview) {
      return false;
    }

    if (!hasTarget) {
      return true;
    }

    const normalizedTagName = String(targetTagName || "").toUpperCase();
    return !["INPUT", "TEXTAREA", "SELECT"].includes(normalizedTagName) && !Boolean(isContentEditable);
  }

  function getPreviewKeyMapping(key) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    if (normalizedKey === "a" || normalizedKey === "arrowleft") {
      return "left";
    }
    if (normalizedKey === "d" || normalizedKey === "arrowright") {
      return "right";
    }
    if (normalizedKey === "w" || normalizedKey === "arrowup") {
      return "up";
    }
    if (normalizedKey === "s" || normalizedKey === "arrowdown") {
      return "down";
    }
    return null;
  }

  function canStartPreviewJump({
    hasActivePreview = false,
    currentStage = null,
    jumpOffset = 0,
    jumpVelocity = 0,
  } = {}) {
    if (!hasActivePreview || currentStage !== "preview") {
      return false;
    }

    return Number(jumpOffset) === 0 && Number(jumpVelocity) === 0;
  }

  function stepPreviewSceneState(
    {
      playerX = 320,
      baseYRatio = 0.74,
      jumpOffset = 0,
      jumpVelocity = 0,
      facing = 1,
    } = {},
    {
      left = false,
      right = false,
      up = false,
      down = false,
    } = {},
    deltaSeconds = 0,
    constants = DEFAULT_PREVIEW_SCENE_CONSTANTS,
  ) {
    const safeDeltaSeconds = Math.max(Number(deltaSeconds) || 0, 0);
    const horizontalInput = Number(Boolean(right)) - Number(Boolean(left));
    const verticalInput = Number(Boolean(down)) - Number(Boolean(up));

    let nextPlayerX = Number(playerX) || 0;
    let nextBaseYRatio = Number(baseYRatio) || 0.74;
    let nextJumpOffset = Number(jumpOffset) || 0;
    let nextJumpVelocity = Number(jumpVelocity) || 0;
    let nextFacing = Number(facing) === -1 ? -1 : 1;

    if (horizontalInput !== 0) {
      nextPlayerX = clamp(
        nextPlayerX + horizontalInput * constants.moveSpeed * safeDeltaSeconds,
        0,
        constants.worldWidth,
      );
      nextFacing = horizontalInput < 0 ? -1 : 1;
    }

    if (verticalInput !== 0) {
      nextBaseYRatio = clamp(
        nextBaseYRatio + verticalInput * constants.verticalSpeed * safeDeltaSeconds,
        0.58,
        0.82,
      );
    }

    if (nextJumpOffset > 0 || nextJumpVelocity !== 0) {
      nextJumpOffset = Math.max(0, nextJumpOffset + nextJumpVelocity * safeDeltaSeconds);
      nextJumpVelocity -= constants.gravity * safeDeltaSeconds;

      if (nextJumpOffset === 0 && nextJumpVelocity < 0) {
        nextJumpVelocity = 0;
      }
    }

    return {
      playerX: nextPlayerX,
      baseYRatio: nextBaseYRatio,
      jumpOffset: nextJumpOffset,
      jumpVelocity: nextJumpVelocity,
      facing: nextFacing,
    };
  }

  const api = {
    DEFAULT_PREVIEW_SCENE_CONSTANTS,
    normalizePreviewLoopSelection,
    shouldCapturePreviewKeyboard,
    getPreviewKeyMapping,
    canStartPreviewJump,
    stepPreviewSceneState,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalObject.AutoSpritePreviewControls = api;
})(typeof window !== "undefined" ? window : globalThis);
