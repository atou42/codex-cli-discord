(function bootstrapWorkspaceState(globalObject) {
  function toTimestamp(value) {
    const timestamp = Date.parse(String(value || ""));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function sortNewestFirst(records) {
    return [...(Array.isArray(records) ? records : [])].sort(
      (left, right) => toTimestamp(right?.createdAt || right?.updatedAt) - toTimestamp(left?.createdAt || left?.updatedAt),
    );
  }

  function countJobsByStatus(jobs, status) {
    return (Array.isArray(jobs) ? jobs : []).filter((job) => job?.status === status).length;
  }

  function getLatestJob(jobs) {
    return sortNewestFirst(jobs)[0] || null;
  }

  function getLatestFailedJob(jobs) {
    return sortNewestFirst(jobs).find((job) => job?.status === "failed") || null;
  }

  function deriveWorkspaceSummary({ jobs = [], spritesheets = [] } = {}) {
    const completedSpritesheetCount = Array.isArray(spritesheets) ? spritesheets.length : 0;
    const queuedJobCount = countJobsByStatus(jobs, "queued");
    const runningJobCount = countJobsByStatus(jobs, "running");
    const failedJobCount = countJobsByStatus(jobs, "failed");
    const succeededJobCount = countJobsByStatus(jobs, "succeeded");
    const latestJob = getLatestJob(jobs);
    const latestFailedJob = getLatestFailedJob(jobs);

    return {
      completedSpritesheetCount,
      queuedJobCount,
      runningJobCount,
      activeJobCount: queuedJobCount + runningJobCount,
      failedJobCount,
      succeededJobCount,
      latestJobStatus: latestJob?.status || (completedSpritesheetCount > 0 ? "succeeded" : "idle"),
      latestFailureMessage: latestFailedJob?.error || null,
      hasPreview: completedSpritesheetCount > 0,
      hasExports: completedSpritesheetCount > 0,
    };
  }

  function isStageAccessible(stage, { hasSelectedCharacter = false, workspaceSummary = null } = {}) {
    const summary = workspaceSummary || deriveWorkspaceSummary();

    if (stage === "character") {
      return true;
    }

    if (stage === "animate") {
      return Boolean(hasSelectedCharacter);
    }

    if (stage === "preview" || stage === "spritesheets") {
      return Boolean(hasSelectedCharacter) && summary.completedSpritesheetCount > 0;
    }

    return false;
  }

  function getPreviewStageCopy({ workspaceSummary = null } = {}) {
    const summary = workspaceSummary || deriveWorkspaceSummary();

    if (summary.completedSpritesheetCount > 0) {
      return {
        title: "Inspect the generated motion",
        subtitle: "Watch the sheet as an animation, tighten the loop range, and confirm the timing before export.",
        nextStepLabel: "Open exports",
      };
    }

    if (summary.activeJobCount > 0) {
      return {
        title: "Preview stays locked",
        subtitle: "Preview unlocks after the first spritesheet finishes.",
        nextStepLabel: "Wait for render",
      };
    }

    if (summary.failedJobCount > 0) {
      return {
        title: "Preview stays locked",
        subtitle: "The last render failed. Retry the motion from Animate to unlock Preview.",
        nextStepLabel: "Retry in Animate",
      };
    }

    return {
      title: "Preview stays locked",
      subtitle: "Generate the first motion in Animate to unlock Preview.",
      nextStepLabel: "Open Animate",
    };
  }

  function getCharacterCardState({
    workspaceSummary = null,
    isSelected = false,
    isLoading = false,
    hasLoadError = false,
  } = {}) {
    const summary = workspaceSummary || deriveWorkspaceSummary();

    if (hasLoadError) {
      return {
        badgeStatus: "failed",
        badgeLabel: "error",
        stateLabel: "Retry",
      };
    }

    if (isLoading) {
      return {
        badgeStatus: "running",
        badgeLabel: "loading",
        stateLabel: "Loading",
      };
    }

    if (summary.completedSpritesheetCount > 0) {
      return {
        badgeStatus: "succeeded",
        badgeLabel: "ready",
        stateLabel: isSelected ? "Loaded" : "Open",
      };
    }

    if (summary.runningJobCount > 0) {
      return {
        badgeStatus: "running",
        badgeLabel: "rendering",
        stateLabel: isSelected ? "Loaded" : "Open",
      };
    }

    if (summary.queuedJobCount > 0) {
      return {
        badgeStatus: "queued",
        badgeLabel: "queued",
        stateLabel: isSelected ? "Loaded" : "Open",
      };
    }

    if (summary.failedJobCount > 0) {
      return {
        badgeStatus: "failed",
        badgeLabel: "failed",
        stateLabel: isSelected ? "Loaded" : "Open",
      };
    }

    return {
      badgeStatus: "idle",
      badgeLabel: "base only",
      stateLabel: isSelected ? "Loaded" : "Open",
    };
  }

  function getCurrentResultState({ workspaceSummary = null, primarySheet = null } = {}) {
    const summary = workspaceSummary || deriveWorkspaceSummary();

    if (primarySheet) {
      return {
        kind: "ready",
        title: "Current result ready",
        description: null,
        primaryAction: "Open Preview",
      };
    }

    if (summary.activeJobCount > 0) {
      return {
        kind: "running",
        title: "Render in progress",
        description: "A queued job is still running. The first completed sheet will appear here automatically.",
        primaryAction: "Open Animate",
      };
    }

    if (summary.failedJobCount > 0) {
      return {
        kind: "failed",
        title: "Last render failed",
        description: summary.latestFailureMessage || "The latest generation failed before a spritesheet was created.",
        primaryAction: "Retry in Animate",
      };
    }

    return {
      kind: "empty",
      title: "No motion rendered yet",
      description: "Open Animate and generate the first walk cycle for this character.",
      primaryAction: "Open Animate",
    };
  }

  function getJobMotionKey(job) {
    const request = job?.request || {};
    if (request.requestKind === "custom" || request.action === "custom") {
      return request.customAnimationId ? `custom:${request.customAnimationId}` : null;
    }

    return request.action ? `standard:${request.action}` : null;
  }

  function getAnimateMotionState({ motionKey = null, jobs = [], spritesheets = [] } = {}) {
    const motionSheets = (Array.isArray(spritesheets) ? spritesheets : []).filter((sheet) => {
      if (!sheet || !motionKey) {
        return false;
      }

      if (sheet.variantKey && sheet.variantKey === motionKey) {
        return true;
      }

      if (motionKey.startsWith("standard:")) {
        return sheet.requestKind !== "custom" && sheet.kind === motionKey.slice("standard:".length);
      }

      if (motionKey.startsWith("custom:")) {
        return sheet.requestKind === "custom" && sheet.customAnimationId === motionKey.slice("custom:".length);
      }

      return false;
    });

    if (motionSheets.length > 0) {
      return {
        kind: "ready",
        title: "Current result",
        description: null,
        factLabel: "Ready",
      };
    }

    const motionJobs = sortNewestFirst(jobs).filter((job) => getJobMotionKey(job) === motionKey);
    const latestMotionJob = motionJobs[0] || null;

    if (latestMotionJob?.status === "failed") {
      return {
        kind: "failed",
        title: "Last render failed",
        description: latestMotionJob.error || "The latest generation failed before a spritesheet was created.",
        factLabel: "Failure recorded",
      };
    }

    if (latestMotionJob?.status === "running" || latestMotionJob?.status === "queued") {
      return {
        kind: "pending",
        title: "Render in progress",
        description: "The next completed sheet for this motion will land here automatically.",
        factLabel: "Render in progress",
      };
    }

    return {
      kind: "empty",
      title: "Pending result",
      description: "No current sheet exists for this motion yet. Generate the batch and the result will land here.",
      factLabel: "Waiting for first render",
    };
  }

  const api = {
    deriveWorkspaceSummary,
    isStageAccessible,
    getPreviewStageCopy,
    getCharacterCardState,
    getCurrentResultState,
    getJobMotionKey,
    getAnimateMotionState,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalObject.AutoSpriteWorkspaceState = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
