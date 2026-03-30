const STAGE_ORDER = ["character", "animate", "preview", "spritesheets"];
const STAGE_LABELS = {
  character: "Character",
  animate: "Animate",
  preview: "Preview",
  spritesheets: "Spritesheets",
};
const ACTION_COPY = {
  idle: "Ambient loop with soft breathing and a stable silhouette.",
  walk: "Primary workflow with one long looping cycle for a production sheet.",
  run: "Higher-energy cycle with stronger stretch and lift.",
  dash: "Short burst with anticipation, drive, and a clean skid finish.",
  jump: "Single arc with takeoff, apex, and landing.",
  fall: "Air-to-ground drop with a readable brace and impact settle.",
  crouch: "Low defensive loop that holds up cleanly in side view.",
  slide: "Grounded evasive move with a long low profile across the lane.",
  hurt: "One-shot recoil for damage, stagger, or interruption states.",
  attack: "One-shot impact move with a clean finish frame.",
};
const previewRuntimeApi = window.AutoSpritePreviewRuntime;
if (!previewRuntimeApi) {
  throw new Error("Preview runtime helpers failed to load.");
}
const {
  buildPreviewRuntimeCatalog,
  pickDefaultPreviewComparisonSheetId,
  pickAnimateInspectorTarget,
  mapPreviewComparisonFrameIndex,
  resolvePreviewRuntimeAction,
  isOneShotPreviewAction,
} = previewRuntimeApi;
const workspaceStateApi = window.AutoSpriteWorkspaceState;
if (!workspaceStateApi) {
  throw new Error("Workspace state helpers failed to load.");
}
const {
  deriveWorkspaceSummary,
  isStageAccessible: deriveStageAccessibility,
  getPreviewStageCopy,
  getCharacterCardState,
  getCurrentResultState,
  getAnimateMotionState,
} = workspaceStateApi;
const TOKEN_STORAGE_KEY = "autosprite.netaToken";
const PREVIEW_SCENES = [
  {
    id: "meadow",
    label: "Moss Field",
    skyTop: "#31465f",
    skyMid: "#24354a",
    skyBottom: "#17212d",
    orbColor: "rgba(216, 161, 93, 0.16)",
    orbX: 0.18,
    orbY: 0.22,
    orbRadius: 0.16,
    ridgeColor: "rgba(124, 150, 179, 0.18)",
    hillColor: "rgba(82, 108, 132, 0.3)",
    groundTop: "#26311f",
    groundBottom: "#101710",
    laneColor: "rgba(255, 225, 187, 0.1)",
    stripColor: "rgba(58, 79, 52, 0.4)",
    propKind: "shrub",
    propColor: "rgba(72, 99, 61, 0.42)",
  },
  {
    id: "dunes",
    label: "Amber Dunes",
    skyTop: "#694c37",
    skyMid: "#4c3329",
    skyBottom: "#20151a",
    orbColor: "rgba(255, 203, 142, 0.18)",
    orbX: 0.78,
    orbY: 0.24,
    orbRadius: 0.13,
    ridgeColor: "rgba(205, 148, 102, 0.17)",
    hillColor: "rgba(133, 96, 67, 0.28)",
    groundTop: "#5b3f2a",
    groundBottom: "#21160f",
    laneColor: "rgba(255, 233, 190, 0.12)",
    stripColor: "rgba(112, 82, 53, 0.34)",
    propKind: "cactus",
    propColor: "rgba(88, 103, 80, 0.36)",
  },
  {
    id: "ruins",
    label: "Ruined Causeway",
    skyTop: "#33455a",
    skyMid: "#253346",
    skyBottom: "#151c2a",
    orbColor: "rgba(170, 196, 225, 0.16)",
    orbX: 0.72,
    orbY: 0.18,
    orbRadius: 0.1,
    ridgeColor: "rgba(113, 133, 156, 0.18)",
    hillColor: "rgba(66, 82, 102, 0.32)",
    groundTop: "#3b4341",
    groundBottom: "#121718",
    laneColor: "rgba(211, 222, 236, 0.1)",
    stripColor: "rgba(84, 96, 108, 0.34)",
    propKind: "pillar",
    propColor: "rgba(96, 107, 121, 0.4)",
  },
  {
    id: "moonkeep",
    label: "Moonlit Keep",
    skyTop: "#2a3148",
    skyMid: "#171e32",
    skyBottom: "#0c101b",
    orbColor: "rgba(215, 230, 255, 0.22)",
    orbX: 0.22,
    orbY: 0.16,
    orbRadius: 0.1,
    ridgeColor: "rgba(92, 112, 166, 0.17)",
    hillColor: "rgba(47, 57, 84, 0.34)",
    groundTop: "#23322a",
    groundBottom: "#0b100d",
    laneColor: "rgba(189, 208, 255, 0.08)",
    stripColor: "rgba(55, 81, 67, 0.3)",
    propKind: "pine",
    propColor: "rgba(74, 100, 84, 0.34)",
  },
];
const PREVIEW_SCENE_WORLD_WIDTH = 2400;
const PREVIEW_SCENE_MOVE_SPEED = 280;
const PREVIEW_SCENE_VERTICAL_SPEED = 0.24;
const PREVIEW_SCENE_JUMP_VELOCITY = 560;
const PREVIEW_SCENE_GRAVITY = 1320;

const state = {
  generationBackend: "unknown",
  netaToken: "",
  netaUser: null,
  characters: [],
  selectedCharacterId: null,
  selectingCharacterId: null,
  characterLoadErrorId: null,
  selectedCharacter: null,
  supportedActions: [],
  poses: [],
  customAnimations: [],
  spritesheets: [],
  jobs: [],
  currentStage: "character",
  currentAnimatePanel: "select",
  selectedStandardActionIds: [],
  selectedCustomActionIds: [],
  animateFocusedMotionKey: null,
  animatePreviewSheetId: null,
  animatePreviewFrameIndex: 0,
  animatePreviewLastTick: 0,
  animatePreviewTimer: null,
  pendingPreview: null,
  activePreview: null,
  previewSheetImage: null,
  previewAtlas: null,
  previewLoopStart: 0,
  previewLoopEnd: 0,
  previewFps: 12,
  previewFrameIndex: 0,
  previewLastTick: 0,
  previewPaused: false,
  previewCompareId: null,
  previewSceneId: null,
  previewScenePlayerX: 320,
  previewSceneBaseYRatio: 0.74,
  previewSceneJumpOffset: 0,
  previewSceneJumpVelocity: 0,
  previewSceneFacing: 1,
  previewSceneKeys: {
    left: false,
    right: false,
    up: false,
    down: false,
  },
  previewSceneModifiers: {
    sprint: false,
    crouch: false,
  },
  previewRuntimeCatalog: {},
  previewRuntimeAssets: {},
  previewRuntimeAssetLoads: {},
  previewRuntimeActionId: null,
  previewRuntimeFrameIndex: 0,
  previewRuntimeLastTick: 0,
  previewRuntimeCompleted: false,
  previewRuntimeMode: "idle",
  previewRuntimePendingActionId: null,
  previewRuntimeLockedActionId: null,
  previewRenderLastTick: 0,
  previewActionMessage: "",
  exportsActionMessage: "",
  previewActionError: false,
  exportsActionError: false,
  selectingSpritesheetId: null,
  redoingSpritesheetId: null,
  workspaceStatusMessage: "",
  workspaceStatusError: false,
  pollTimer: null,
  previewTimer: null,
};

const elements = {
  backendBadge: document.querySelector("#backend-badge"),
  authForm: document.querySelector("#auth-form"),
  authToken: document.querySelector("#auth-token"),
  authMessage: document.querySelector("#auth-message"),
  authSummary: document.querySelector("#auth-summary"),
  createForm: document.querySelector("#create-character-form"),
  createMessage: document.querySelector("#create-message"),
  characterList: document.querySelector("#character-list"),
  workspaceTitle: document.querySelector("#workspace-title"),
  workspaceSubtitle: document.querySelector("#workspace-subtitle"),
  workspaceStatusMessage: document.querySelector("#workspace-status-message"),
  currentStageLabel: document.querySelector("#current-stage-label"),
  currentQueueLabel: document.querySelector("#current-queue-label"),
  nextStepLabel: document.querySelector("#next-step-label"),
  analysisCard: document.querySelector("#analysis-card"),
  stageTabs: Array.from(document.querySelectorAll(".stage-tab[data-stage]")),
  stagePanels: Array.from(document.querySelectorAll("[data-stage-panel]")),
  animateTabs: Array.from(document.querySelectorAll(".animate-subtab[data-animate-panel]")),
  animatePanels: Array.from(document.querySelectorAll(".animate-panel")),
  newCharacterButton: document.querySelector("#new-character-button"),
  poseForm: document.querySelector("#pose-form"),
  poseMessage: document.querySelector("#pose-message"),
  poseList: document.querySelector("#pose-list"),
  customForm: document.querySelector("#custom-animation-form"),
  customMessage: document.querySelector("#custom-message"),
  customMode: document.querySelector("#custom-mode"),
  customLoop: document.querySelector("#custom-loop"),
  customFirstPose: document.querySelector("#custom-first-pose"),
  customLastPose: document.querySelector("#custom-last-pose"),
  customList: document.querySelector("#custom-animation-list"),
  generateForm: document.querySelector("#generate-form"),
  actionList: document.querySelector("#action-list"),
  generateButton: document.querySelector("#generate-button"),
  generateMessage: document.querySelector("#generate-message"),
  generateSummaryTitle: document.querySelector("#generate-summary-title"),
  generateSummaryCopy: document.querySelector("#generate-summary-copy"),
  animateConsequenceSummary: document.querySelector("#animate-consequence-summary"),
  animateSelectionChips: document.querySelector("#animate-selection-chips"),
  animatePreviewCharacter: document.querySelector("#animate-preview-character"),
  animatePreviewCanvas: document.querySelector("#animate-preview-canvas"),
  animatePreviewMeta: document.querySelector("#animate-preview-meta"),
  animateOpenPreview: document.querySelector("#animate-open-preview"),
  jobList: document.querySelector("#job-list"),
  previewJobList: document.querySelector("#preview-job-list"),
  exportsJobList: document.querySelector("#exports-job-list"),
  previewResultList: document.querySelector("#preview-result-list"),
  spritesheetList: document.querySelector("#spritesheet-list"),
  characterThumbnail: document.querySelector("#character-thumbnail"),
  characterPlaceholder: document.querySelector("#character-placeholder"),
  statPoses: document.querySelector("#stat-poses"),
  statCustom: document.querySelector("#stat-custom"),
  statExports: document.querySelector("#stat-exports"),
  workspaceActionButtons: document.querySelector("#workspace-action-buttons"),
  workspaceCurrentResult: document.querySelector("#workspace-current-result"),
  previewSceneShell: document.querySelector("#preview-scene-shell"),
  previewSceneCanvas: document.querySelector("#preview-scene-canvas"),
  previewCanvas: document.querySelector("#preview-canvas"),
  previewCompareCanvas: document.querySelector("#preview-compare-canvas"),
  previewSheetCanvas: document.querySelector("#preview-sheet-canvas"),
  previewMeta: document.querySelector("#preview-meta"),
  previewPrimaryMeta: document.querySelector("#preview-primary-meta"),
  previewCompareMeta: document.querySelector("#preview-compare-meta"),
  previewCompareSwitcher: document.querySelector("#preview-compare-switcher"),
  previewActionMessage: document.querySelector("#preview-action-message"),
  previewEmptyState: document.querySelector("#preview-empty-state"),
  previewDeck: document.querySelector(".preview-deck"),
  previewTimeline: document.querySelector(".preview-timeline"),
  previewWorkspaceActions: document.querySelector(".preview-workspace__actions"),
  previewPlayToggle: document.querySelector("#preview-play-toggle"),
  previewPlayToggleSecondary: document.querySelector("#preview-play-toggle-secondary"),
  previewSelectVersion: document.querySelector("#preview-select-version"),
  previewRedoMotion: document.querySelector("#preview-redo-motion"),
  previewDownloadPackage: document.querySelector("#preview-download-package"),
  previewScenePicker: document.querySelector("#preview-scene-picker"),
  previewToExports: document.querySelector("#preview-to-exports"),
  previewFrameScrub: document.querySelector("#preview-frame-scrub"),
  previewRangeStart: document.querySelector("#preview-range-start"),
  previewRangeEnd: document.querySelector("#preview-range-end"),
  previewFps: document.querySelector("#preview-fps"),
  previewFrameReadout: document.querySelector("#preview-frame-readout"),
  previewLoopReadout: document.querySelector("#preview-loop-readout"),
  previewFpsReadout: document.querySelector("#preview-fps-readout"),
  previewOutputReadout: document.querySelector("#preview-output-readout"),
  previewAtlasReadout: document.querySelector("#preview-atlas-readout"),
  previewDimensionsReadout: document.querySelector("#preview-dimensions-readout"),
  previewSheetReadout: document.querySelector("#preview-sheet-readout"),
  previewSceneReadout: document.querySelector("#preview-scene-readout"),
  previewMotionReadout: document.querySelector("#preview-motion-readout"),
  previewPositionReadout: document.querySelector("#preview-position-readout"),
  exportsActionMessage: document.querySelector("#exports-action-message"),
  exportsDownloadPackage: document.querySelector("#exports-download-package"),
};

const previewSceneContext = elements.previewSceneCanvas.getContext("2d");
const animatePreviewContext = elements.animatePreviewCanvas.getContext("2d");
const previewContext = elements.previewCanvas.getContext("2d");
const previewCompareContext = elements.previewCompareCanvas.getContext("2d");
const previewSheetContext = elements.previewSheetCanvas.getContext("2d");
previewSceneContext.imageSmoothingEnabled = false;
animatePreviewContext.imageSmoothingEnabled = false;
previewContext.imageSmoothingEnabled = false;
previewCompareContext.imageSmoothingEnabled = false;
previewSheetContext.imageSmoothingEnabled = false;

function statusClass(status) {
  return `status status--${status}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function formatFrameDimensions(sheet) {
  const width = Number(sheet?.frameWidth || 0);
  const height = Number(sheet?.frameHeight || 0);
  if (width > 0 && height > 0) {
    return `${width}x${height}px`;
  }
  if (width > 0) {
    return `${width}px`;
  }
  return "unknown size";
}

function formatVersionLabel(sheet) {
  const versionNumber = Number(sheet?.versionNumber || 1);
  return `V${versionNumber}`;
}

function formatShortDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function getCharacterSourceLabel(character) {
  if (!character) {
    return "Unknown source";
  }

  if (character.sourceType === "upload") {
    return "Uploaded art";
  }

  if (character.sourceType === "generate") {
    return character.generationBackend === "neta" ? "Generated with Neta" : "Generated art";
  }

  return "Character source";
}

function getPrimarySpritesheet() {
  return state.spritesheets.find((sheet) => sheet.isSelectedVersion) || state.spritesheets[0] || null;
}

function getWorkspaceSummary() {
  if (!state.selectedCharacter) {
    return deriveWorkspaceSummary();
  }

  return deriveWorkspaceSummary({
    jobs: state.jobs,
    spritesheets: state.spritesheets,
  });
}

function getCharacterWorkspaceSummary(character) {
  return character?.workspaceSummary || deriveWorkspaceSummary();
}

function syncSelectedCharacterWorkspaceSummary() {
  if (!state.selectedCharacterId) {
    return;
  }

  const workspaceSummary = deriveWorkspaceSummary({
    jobs: state.jobs,
    spritesheets: state.spritesheets,
  });

  if (state.selectedCharacter) {
    state.selectedCharacter = {
      ...state.selectedCharacter,
      workspaceSummary,
    };
  }

  state.characters = state.characters.map((character) =>
    character.id === state.selectedCharacterId
      ? {
          ...character,
          workspaceSummary,
        }
      : character,
  );
}

function setWorkspaceStatusMessage(message, isError = false) {
  state.workspaceStatusMessage = message;
  state.workspaceStatusError = isError;
  if (!elements.workspaceStatusMessage) {
    return;
  }

  elements.workspaceStatusMessage.textContent = message;
  elements.workspaceStatusMessage.style.color = isError ? "var(--color-danger)" : "var(--color-muted)";
}

function clearWorkspaceStatusMessage() {
  setWorkspaceStatusMessage("");
}

function getSelectedVersionChipMarkup(sheet) {
  if (!sheet?.isSelectedVersion) {
    return "";
  }

  return `<span class="version-chip version-chip--active">Current export</span>`;
}

function renderActionMessages() {
  if (elements.previewActionMessage) {
    elements.previewActionMessage.textContent = state.previewActionMessage;
    elements.previewActionMessage.style.color = state.previewActionError ? "var(--color-danger)" : "var(--color-muted)";
  }

  if (elements.exportsActionMessage) {
    elements.exportsActionMessage.textContent = state.exportsActionMessage;
    elements.exportsActionMessage.style.color = state.exportsActionError ? "var(--color-danger)" : "var(--color-muted)";
  }
}

function setActionMessage(message) {
  state.previewActionMessage = message;
  state.exportsActionMessage = message;
  state.previewActionError = false;
  state.exportsActionError = false;
  renderActionMessages();
}

function setActionError(message) {
  state.previewActionMessage = message;
  state.exportsActionMessage = message;
  state.previewActionError = true;
  state.exportsActionError = true;
  renderActionMessages();
}

function clearActionMessages() {
  state.previewActionMessage = "";
  state.exportsActionMessage = "";
  state.previewActionError = false;
  state.exportsActionError = false;
  renderActionMessages();
}

function getMotionJobs(motionKey) {
  if (!motionKey) {
    return [];
  }

  const actionId = motionKey.startsWith("standard:") ? motionKey.slice("standard:".length) : null;
  const customAnimationId = motionKey.startsWith("custom:") ? motionKey.slice("custom:".length) : null;

  return state.jobs.filter((job) => {
    const request = job?.request || {};
    if (motionKey.startsWith("standard:")) {
      return request.requestKind !== "custom" && request.action === actionId;
    }

    if (motionKey.startsWith("custom:")) {
      return request.requestKind === "custom" && request.customAnimationId === customAnimationId;
    }

    return false;
  });
}

function getCharacterExportUrl() {
  if (!state.selectedCharacterId || state.spritesheets.length === 0) {
    return "";
  }

  return `/api/characters/${encodeURIComponent(state.selectedCharacterId)}/export-package`;
}

function triggerCharacterExportDownload() {
  const exportUrl = getCharacterExportUrl();
  if (!exportUrl) {
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = exportUrl;
  anchor.rel = "noopener";
  anchor.download = "";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function getPreviewFrameCount() {
  return Array.isArray(state.previewAtlas?.frames) ? state.previewAtlas.frames.length : 0;
}

function getPreviewLoopBounds() {
  return {
    loopStart: Math.min(state.previewLoopStart, state.previewLoopEnd),
    loopEnd: Math.max(state.previewLoopStart, state.previewLoopEnd),
  };
}

function getCurrentPreviewFrame() {
  if (!state.previewAtlas || !Array.isArray(state.previewAtlas.frames)) {
    return null;
  }

  return state.previewAtlas.frames[state.previewFrameIndex] || null;
}

function getSpritesheetById(spritesheetId) {
  if (!spritesheetId) {
    return null;
  }

  if (state.activePreview?.id === spritesheetId) {
    return state.activePreview;
  }

  return state.spritesheets.find((sheet) => sheet.id === spritesheetId) || null;
}

function getPreviewVersionGroup(sheet = state.activePreview) {
  if (!sheet?.variantKey) {
    return [];
  }

  return state.spritesheets.filter((item) => item.variantKey === sheet.variantKey);
}

function buildStandardMotionKey(kind) {
  return kind ? `standard:${kind}` : null;
}

function buildCustomMotionKey(customAnimationId) {
  return customAnimationId ? `custom:${customAnimationId}` : null;
}

function getSelectedAnimateMotionKeys() {
  return [
    ...state.selectedStandardActionIds.map((actionId) => buildStandardMotionKey(actionId)),
    ...state.selectedCustomActionIds.map((customAnimationId) => buildCustomMotionKey(customAnimationId)),
  ].filter(Boolean);
}

function getAnimateMotionLabel(motionKey) {
  if (!motionKey) {
    return "No motion selected";
  }

  if (motionKey.startsWith("standard:")) {
    const actionId = motionKey.slice("standard:".length);
    const action = state.supportedActions.find((item) => item.id === actionId);
    return action?.label || actionId;
  }

  if (motionKey.startsWith("custom:")) {
    const customAnimationId = motionKey.slice("custom:".length);
    const animation = state.customAnimations.find((item) => item.id === customAnimationId);
    return animation?.name || "Custom action";
  }

  return motionKey;
}

function getAnimateMotionPrompt(motionKey) {
  if (!motionKey) {
    return "";
  }

  if (motionKey.startsWith("standard:")) {
    const actionId = motionKey.slice("standard:".length);
    return ACTION_COPY[actionId] || "";
  }

  if (motionKey.startsWith("custom:")) {
    const customAnimationId = motionKey.slice("custom:".length);
    return state.customAnimations.find((item) => item.id === customAnimationId)?.prompt || "";
  }

  return "";
}

function getAnimateMotionSheets(motionKey) {
  if (!motionKey) {
    return [];
  }

  return state.spritesheets.filter((sheet) => {
    if (!sheet) {
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
}

function getAnimateInspectorTarget() {
  return pickAnimateInspectorTarget({
    selectedStandardActionIds: state.selectedStandardActionIds,
    selectedCustomActionIds: state.selectedCustomActionIds,
    spritesheets: state.spritesheets,
    focusedMotionKey: state.animateFocusedMotionKey,
  });
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load spritesheet image."));
    image.src = url;
  });
}

function buildPreviewAssetRecord(detail, atlas, image) {
  return {
    id: detail.id,
    kind: detail.kind,
    name: detail.name,
    detail,
    atlas,
    image,
  };
}

function cachePreviewRuntimeAsset(detail, atlas, image) {
  const asset = buildPreviewAssetRecord(detail, atlas, image);
  state.previewRuntimeAssets[detail.id] = asset;
  return asset;
}

async function loadPreviewRuntimeAsset(detail) {
  if (!detail?.id) {
    return null;
  }

  const cachedAsset = state.previewRuntimeAssets[detail.id];
  if (cachedAsset) {
    return cachedAsset;
  }

  if (state.activePreview?.id === detail.id && state.previewSheetImage && state.previewAtlas) {
    return cachePreviewRuntimeAsset(state.activePreview, state.previewAtlas, state.previewSheetImage);
  }

  if (!state.previewRuntimeAssetLoads[detail.id]) {
    state.previewRuntimeAssetLoads[detail.id] = (async () => {
      try {
        const atlas = await fetchJson(detail.atlasUrl);
        const image = await loadImageElement(detail.sheetUrl);
        return cachePreviewRuntimeAsset(detail, atlas, image);
      } finally {
        delete state.previewRuntimeAssetLoads[detail.id];
      }
    })();
  }

  return state.previewRuntimeAssetLoads[detail.id];
}

function rebuildPreviewRuntimeCatalog() {
  state.previewRuntimeCatalog = buildPreviewRuntimeCatalog(state.spritesheets);
}

function getPreviewRuntimeAvailableActionIds() {
  const actionIds = Object.keys(state.previewRuntimeCatalog);
  if (state.activePreview?.kind && !actionIds.includes(state.activePreview.kind)) {
    actionIds.push(state.activePreview.kind);
  }
  return actionIds;
}

function getPreviewRuntimeFallbackActionId() {
  const availableActionIds = getPreviewRuntimeAvailableActionIds();
  if (state.previewRuntimeActionId && availableActionIds.includes(state.previewRuntimeActionId)) {
    return state.previewRuntimeActionId;
  }
  if (state.activePreview?.kind && availableActionIds.includes(state.activePreview.kind)) {
    return state.activePreview.kind;
  }
  return availableActionIds[0] || null;
}

function getPreviewRuntimeSheetSummary(actionId) {
  if (!actionId) {
    return null;
  }

  if (state.previewRuntimeCatalog[actionId]) {
    return state.previewRuntimeCatalog[actionId];
  }

  if (state.activePreview?.kind === actionId) {
    return state.activePreview;
  }

  return null;
}

function getPreviewRuntimeAsset(actionId) {
  const summary = getPreviewRuntimeSheetSummary(actionId);
  if (!summary) {
    return null;
  }

  return state.previewRuntimeAssets[summary.id] || null;
}

function ensurePreviewRuntimeAsset(actionId) {
  const summary = getPreviewRuntimeSheetSummary(actionId);
  if (!summary) {
    return null;
  }

  const cachedAsset = state.previewRuntimeAssets[summary.id];
  if (cachedAsset) {
    return cachedAsset;
  }

  void loadPreviewRuntimeAsset(summary)
    .then(() => {
      drawCurrentPreviewFrame();
    })
    .catch((error) => {
      console.error(`Failed to load preview runtime asset ${summary.id}`, error);
    });

  return null;
}

function primePreviewRuntimeAssets() {
  for (const actionId of getPreviewRuntimeAvailableActionIds()) {
    ensurePreviewRuntimeAsset(actionId);
  }
}

function syncPreviewCompareId() {
  if (!state.activePreview?.id) {
    state.previewCompareId = null;
    return;
  }

  const versionGroup = getPreviewVersionGroup(state.activePreview);
  const currentCompare = getSpritesheetById(state.previewCompareId);
  const isCurrentCompareValid =
    currentCompare &&
    currentCompare.id !== state.activePreview.id &&
    currentCompare.variantKey === state.activePreview.variantKey;

  if (isCurrentCompareValid) {
    return;
  }

  state.previewCompareId = pickDefaultPreviewComparisonSheetId(versionGroup, state.activePreview.id);
}

function getPreviewCompareSheet() {
  syncPreviewCompareId();
  return getSpritesheetById(state.previewCompareId);
}

function getPreviewCompareAsset() {
  const compareSheet = getPreviewCompareSheet();
  if (!compareSheet) {
    return null;
  }

  return state.previewRuntimeAssets[compareSheet.id] || null;
}

function schedulePreviewCompareAssetLoad() {
  const compareSheet = getPreviewCompareSheet();
  if (!compareSheet) {
    return;
  }

  void loadPreviewRuntimeAsset(compareSheet)
    .then(() => {
      renderPreviewComparePanel();
      drawCurrentPreviewFrame();
    })
    .catch((error) => {
      console.error(`Failed to load compare preview asset ${compareSheet.id}`, error);
    });
}

function setPreviewCanvasSize(canvas, width, height) {
  const safeWidth = Math.max(Math.floor(Number(width) || 0), 1);
  const safeHeight = Math.max(Math.floor(Number(height) || 0), 1);

  if (canvas.width !== safeWidth) {
    canvas.width = safeWidth;
  }

  if (canvas.height !== safeHeight) {
    canvas.height = safeHeight;
  }
}

function drawAssetFrameToCanvas({ canvas, context, detail, atlas, image, frameIndex }) {
  const width = detail?.frameWidth || 320;
  const height = detail?.frameHeight || 400;
  setPreviewCanvasSize(canvas, width, height);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  const frames = Array.isArray(atlas?.frames) ? atlas.frames : [];
  if (!image || frames.length === 0) {
    return null;
  }

  const safeFrameIndex = clamp(frameIndex, 0, frames.length - 1);
  const frame = frames[safeFrameIndex];
  const source = frame?.frame;
  if (!source) {
    return null;
  }

  context.drawImage(image, source.x, source.y, source.w, source.h, 0, 0, canvas.width, canvas.height);
  return {
    frame,
    frameCount: frames.length,
    frameIndex: safeFrameIndex,
  };
}

function buildPreviewCompareFacts(sheet, detailLabel) {
  const facts = [
    formatFrameDimensions(sheet),
    `${sheet.frameCount} frames`,
    `${sheet.columns} cols · ${sheet.rows} rows`,
    detailLabel,
  ];

  return facts.map((value) => `<span>${escapeHtml(value)}</span>`).join("");
}

function renderPreviewComparePanel() {
  if (!elements.previewPrimaryMeta || !elements.previewCompareMeta || !elements.previewCompareSwitcher) {
    return;
  }

  if (!state.activePreview) {
    elements.previewPrimaryMeta.innerHTML = `<p class="muted">No focus version loaded.</p>`;
    elements.previewCompareMeta.innerHTML = `<p class="muted">Redo a motion to unlock comparison.</p>`;
    elements.previewCompareSwitcher.innerHTML = `<p class="muted">No alternate versions yet.</p>`;
    return;
  }

  const orderedVersionGroup = [...getPreviewVersionGroup(state.activePreview)].sort(
    (left, right) =>
      Number(right.versionNumber || 0) - Number(left.versionNumber || 0) ||
      String(right.createdAt || "").localeCompare(String(left.createdAt || "")),
  );
  const compareSheet = getPreviewCompareSheet();
  const compareAsset = getPreviewCompareAsset();
  const alternateSheets = orderedVersionGroup.filter((sheet) => sheet.id !== state.activePreview.id);

  elements.previewPrimaryMeta.innerHTML = `
    <div class="preview-compare-meta__top">
      <div>
        <p class="eyebrow">Focus version</p>
        <h4>${escapeHtml(state.activePreview.name)} · ${escapeHtml(formatVersionLabel(state.activePreview))}</h4>
      </div>
      <div class="preview-picker__meta">
        <span class="version-chip">Focus</span>
        ${getSelectedVersionChipMarkup(state.activePreview)}
      </div>
    </div>
    <p class="muted">This is the frame driving playback, loop tuning, and the stage preview.</p>
    <div class="preview-meta__facts">
      ${buildPreviewCompareFacts(
        state.activePreview,
        state.activePreview.isSelectedVersion ? "Current export version" : "Preview only",
      )}
    </div>
  `;

  if (alternateSheets.length === 0) {
    elements.previewCompareSwitcher.innerHTML = `<p class="muted">Redo this motion once to compare versions here.</p>`;
    elements.previewCompareMeta.innerHTML = `
      <div class="preview-compare-meta__top">
        <div>
          <p class="eyebrow">Compare version</p>
          <h4>No alternate version yet</h4>
        </div>
      </div>
      <p class="muted">The next redo for this same motion will appear here automatically.</p>
      <div class="preview-meta__facts">
        <span>${escapeHtml(formatFrameDimensions(state.activePreview))}</span>
        <span>Waiting for redo</span>
      </div>
    `;
    return;
  }

  elements.previewCompareSwitcher.innerHTML = alternateSheets
    .map((sheet) => {
      const isActive = compareSheet?.id === sheet.id;
      const label = sheet.isSelectedVersion ? `${formatVersionLabel(sheet)} export` : formatVersionLabel(sheet);
      return `
        <button
          class="preview-version-switch ${isActive ? "is-active" : ""}"
          type="button"
          data-preview-compare-id="${escapeHtml(sheet.id)}"
        >
          ${escapeHtml(label)}
        </button>
      `;
    })
    .join("");

  if (!compareSheet) {
    elements.previewCompareMeta.innerHTML = `
      <div class="preview-compare-meta__top">
        <div>
          <p class="eyebrow">Compare version</p>
          <h4>Select another version</h4>
        </div>
      </div>
      <p class="muted">Pick a redo version above to compare it against the current focus sheet.</p>
    `;
    return;
  }

  const compareExportButtonLabel = compareSheet.isSelectedVersion
    ? "Current export version"
    : state.selectingSpritesheetId === compareSheet.id
      ? "Using version..."
      : "Use for export";

  elements.previewCompareMeta.innerHTML = `
    <div class="preview-compare-meta__top">
      <div>
        <p class="eyebrow">Compare version</p>
        <h4>${escapeHtml(compareSheet.name)} · ${escapeHtml(formatVersionLabel(compareSheet))}</h4>
      </div>
      <div class="preview-picker__meta">
        <span class="version-chip">Compare</span>
        ${getSelectedVersionChipMarkup(compareSheet)}
      </div>
    </div>
    <p class="muted">${
      compareAsset
        ? "Frame sync follows the active loop scrub, so you can check silhouette, timing, and crop changes directly."
        : "Loading atlas and pixels for this version."
    }</p>
    <div class="preview-meta__facts">
      ${buildPreviewCompareFacts(compareSheet, compareSheet.isSelectedVersion ? "Current export version" : "Preview only")}
    </div>
    <div class="preview-compare-actions">
      <button class="btn btn-secondary" type="button" data-preview-id="${escapeHtml(compareSheet.id)}">
        Make focus version
      </button>
      <button
        class="btn btn-secondary"
        type="button"
        data-select-spritesheet-id="${escapeHtml(compareSheet.id)}"
        ${compareSheet.isSelectedVersion || state.selectingSpritesheetId === compareSheet.id ? "disabled" : ""}
      >
        ${escapeHtml(compareExportButtonLabel)}
      </button>
    </div>
  `;
}

function getCurrentRuntimePreviewAsset() {
  return getPreviewRuntimeAsset(state.previewRuntimeActionId) || ensurePreviewRuntimeAsset(state.previewRuntimeActionId);
}

function getCurrentRuntimePreviewFrame() {
  const runtimeAsset = getCurrentRuntimePreviewAsset();
  if (!runtimeAsset || !Array.isArray(runtimeAsset.atlas?.frames) || runtimeAsset.atlas.frames.length === 0) {
    return null;
  }

  state.previewRuntimeFrameIndex = clamp(state.previewRuntimeFrameIndex, 0, runtimeAsset.atlas.frames.length - 1);
  return {
    asset: runtimeAsset,
    frame: runtimeAsset.atlas.frames[state.previewRuntimeFrameIndex] || runtimeAsset.atlas.frames[0],
  };
}

function getPreviewRuntimeLabel() {
  const runtimeAsset = getCurrentRuntimePreviewAsset();
  if (runtimeAsset?.detail?.name) {
    return runtimeAsset.detail.name;
  }

  if (state.activePreview?.name) {
    return state.activePreview.name;
  }

  return "No preview loaded";
}

function setPreviewRuntimeAction(actionId, mode = "idle") {
  if (!actionId) {
    return;
  }

  const asset = ensurePreviewRuntimeAsset(actionId);
  if (!asset && state.previewRuntimeActionId !== actionId) {
    return;
  }

  if (state.previewRuntimeActionId !== actionId) {
    state.previewRuntimeActionId = actionId;
    state.previewRuntimeFrameIndex = 0;
    state.previewRuntimeLastTick = 0;
    state.previewRuntimeCompleted = false;
  }

  state.previewRuntimeMode = mode;
}

function queuePreviewRuntimeAction(actionId) {
  state.previewRuntimePendingActionId = actionId;
  startPreviewLoop();
}

function getPreviewScene() {
  return PREVIEW_SCENES.find((scene) => scene.id === state.previewSceneId) || PREVIEW_SCENES[0];
}

function pickRandomPreviewSceneId() {
  return PREVIEW_SCENES[Math.floor(Math.random() * PREVIEW_SCENES.length)].id;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function focusPreviewSceneShell() {
  if (state.currentStage !== "preview" || !elements.previewSceneShell) {
    return;
  }

  elements.previewSceneShell.focus({ preventScroll: true });
}

function selectedActionCount() {
  return state.selectedStandardActionIds.length + state.selectedCustomActionIds.length;
}

function activeJobCount() {
  return state.jobs.filter((job) => job.status === "queued" || job.status === "running").length;
}

function pruneSelections() {
  const standardIds = new Set(state.supportedActions.map((action) => action.id));
  const customIds = new Set(state.customAnimations.map((animation) => animation.id));
  state.selectedStandardActionIds = state.selectedStandardActionIds.filter((actionId) => standardIds.has(actionId));
  state.selectedCustomActionIds = state.selectedCustomActionIds.filter((actionId) => customIds.has(actionId));
}

function stageIsAccessible(stage) {
  return deriveStageAccessibility(stage, {
    hasSelectedCharacter: Boolean(state.selectedCharacter),
    workspaceSummary: getWorkspaceSummary(),
  });
}

function getQueueLabel() {
  if (!state.selectedCharacter) {
    return "No character";
  }

  const queued = state.jobs.filter((job) => job.status === "queued").length;
  const running = state.jobs.filter((job) => job.status === "running").length;
  const ready = state.jobs.filter((job) => job.status === "succeeded").length;

  if (queued === 0 && running === 0 && ready === 0) {
    return "Idle";
  }

  if (queued === 0 && running === 0) {
    return `${ready} ready`;
  }

  return `${running} running · ${queued} queued`;
}

function getNextStepLabel() {
  const workspaceSummary = getWorkspaceSummary();
  if (!state.selectedCharacter) {
    return "Upload or generate a base character";
  }

  if (state.currentStage === "character") {
    return "Open Animate";
  }

  if (state.currentStage === "animate") {
    return selectedActionCount() > 0 ? "Generate walk sheet" : "Choose motions";
  }

  if (state.currentStage === "preview") {
    return getPreviewStageCopy({ workspaceSummary }).nextStepLabel;
  }

  return "Download files";
}

function getStageSubtitle() {
  const workspaceSummary = getWorkspaceSummary();
  if (!state.selectedCharacter) {
    return "Upload or generate one character, choose the motions, preview the result, and export production-ready sheets.";
  }

  if (state.currentStage === "character") {
    return state.selectedCharacter.characterDescription || "Base art is loaded. Check the source character, then jump into Animate, Preview, or Exports.";
  }

  if (state.currentStage === "animate") {
    return "Start with the long side-view walk cycle first for a side-scrolling game. Use pose and custom action tools only after the base sheet is close.";
  }

  if (state.currentStage === "preview") {
    return getPreviewStageCopy({ workspaceSummary }).subtitle;
  }

  return "Download the PNG spritesheet and JSON atlas for each finished motion.";
}

function ensureAccessibleStage() {
  if (stageIsAccessible(state.currentStage)) {
    return;
  }

  if (stageIsAccessible("animate")) {
    state.currentStage = "animate";
    return;
  }

  state.currentStage = "character";
}

function setStage(stage, { force = false } = {}) {
  if (!force && !stageIsAccessible(stage)) {
    return;
  }

  if (stage !== "preview") {
    clearPreviewSceneKeys();
    stopPreviewLoop();
  }

  if (stage !== "animate") {
    stopAnimatePreviewLoop();
  }

  state.currentStage = stage;
  renderStageShell();

  if (stage === "preview" && state.spritesheets.length > 0 && !state.activePreview) {
    void loadPreview(state.spritesheets[0].id);
    return;
  }

  if (stage === "preview") {
    if (state.activePreview) {
      drawCurrentPreviewFrame();
      startPreviewLoop();
    }
    focusPreviewSceneShell();
  }

  if (stage === "animate") {
    renderAnimateConsequencePanel();
    startAnimatePreviewLoop();
  }
}

function setAnimatePanel(panel) {
  state.currentAnimatePanel = panel;

  for (const tab of elements.animateTabs) {
    const isActive = tab.dataset.animatePanel === panel;
    tab.classList.toggle("is-active", isActive);
  }

  for (const panelElement of elements.animatePanels) {
    const isActive = panelElement.id === `animate-panel-${panel}`;
    panelElement.classList.toggle("hidden", !isActive);
    panelElement.hidden = !isActive;
  }
}

async function fetchJson(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.netaToken) {
    headers.set("x-neta-token", state.netaToken);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  let body;
  try {
    body = await response.json();
  } catch (_error) {
    throw new Error(`Invalid JSON response from ${url}`);
  }

  if (!response.ok) {
    const message = body?.error?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }

  return body;
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.style.color = isError ? "var(--color-danger)" : "var(--color-muted)";
}

function clearBuildMessages() {
  setMessage(elements.poseMessage, "");
  setMessage(elements.customMessage, "");
  setMessage(elements.generateMessage, "");
}

function renderAuthState() {
  const backendLabel = state.generationBackend === "neta" ? "Neta" : state.generationBackend;
  elements.backendBadge.textContent = `${backendLabel} backend`;
  elements.backendBadge.dataset.backend = state.generationBackend;

  if (state.generationBackend !== "neta") {
    elements.authSummary.innerHTML = `<p class="muted">Current backend: ${escapeHtml(backendLabel)}. Token is not required.</p>`;
    return;
  }

  if (state.netaUser) {
    elements.authSummary.innerHTML = `
      <div class="auth-user">
        <p><strong>${escapeHtml(state.netaUser.nickName || "Connected account")}</strong></p>
        <p class="muted">${escapeHtml(state.netaUser.email || state.netaUser.uuid)}</p>
      </div>
    `;
    return;
  }

  if (state.netaToken) {
    elements.authSummary.innerHTML = `<p class="muted">Token saved locally. Click connect to verify it before generating.</p>`;
    return;
  }

  elements.authSummary.innerHTML = `<p class="muted">Generation runs through Neta. Paste your token here before using prompt character, prompt pose, or spritesheet generation.</p>`;
}

function renderWorkspaceHeader() {
  elements.workspaceTitle.textContent = state.selectedCharacter ? state.selectedCharacter.name : "Create a character to begin.";
  elements.workspaceSubtitle.textContent = getStageSubtitle();
  setWorkspaceStatusMessage(state.workspaceStatusMessage, state.workspaceStatusError);

  if (elements.currentStageLabel) {
    elements.currentStageLabel.textContent = STAGE_LABELS[state.currentStage];
  }
  if (elements.currentQueueLabel) {
    elements.currentQueueLabel.textContent = getQueueLabel();
  }
  if (elements.nextStepLabel) {
    elements.nextStepLabel.textContent = getNextStepLabel();
  }

  renderWorkspaceActionDeck();
  renderWorkspaceCurrentResultCard();
}

function renderWorkspaceSummary() {
  elements.statPoses.textContent = String(state.poses.length);
  elements.statCustom.textContent = String(state.customAnimations.length);
  elements.statExports.textContent = String(state.spritesheets.length);

  const imageUrl = state.selectedCharacter?.thumbnailUrl || state.selectedCharacter?.baseImageUrl || "";
  if (imageUrl) {
    elements.characterThumbnail.src = imageUrl;
    elements.characterThumbnail.alt = `${state.selectedCharacter.name} thumbnail`;
    elements.characterThumbnail.classList.remove("hidden");
    elements.characterPlaceholder.classList.add("hidden");
  } else {
    elements.characterThumbnail.removeAttribute("src");
    elements.characterThumbnail.alt = "";
    elements.characterThumbnail.classList.add("hidden");
    elements.characterPlaceholder.classList.remove("hidden");
  }

  renderWorkspaceHeader();
}

function renderWorkspaceActionDeck() {
  if (!elements.workspaceActionButtons) {
    return;
  }

  if (!state.selectedCharacter) {
    elements.workspaceActionButtons.innerHTML = `<p class="muted">Select a character to open its source art, motion build, preview, and exports.</p>`;
    return;
  }

  const primarySheet = getPrimarySpritesheet();
  const workspaceSummary = getWorkspaceSummary();
  const previewLabel = primarySheet
    ? `${primarySheet.name} · ${formatVersionLabel(primarySheet)}`
    : workspaceSummary.failedJobCount > 0
      ? "Last render failed"
      : workspaceSummary.activeJobCount > 0
        ? "Waiting for first render"
        : "No render yet";

  elements.workspaceActionButtons.innerHTML = `
    <button
      class="project-action-button ${state.currentStage === "character" ? "is-active" : ""}"
      type="button"
      data-workspace-stage="character"
    >
      <strong>Base art</strong>
      <span>Inspect the source character</span>
    </button>
    <button
      class="project-action-button ${state.currentStage === "animate" ? "is-active" : ""}"
      type="button"
      data-workspace-stage="animate"
    >
      <strong>Animate</strong>
      <span>Pick motions and generate</span>
    </button>
    <button
      class="project-action-button ${state.currentStage === "preview" ? "is-active" : ""}"
      type="button"
      data-workspace-preview-current="${primarySheet ? escapeHtml(primarySheet.id) : ""}"
      ${primarySheet ? "" : "disabled"}
    >
      <strong>Current result</strong>
      <span>${escapeHtml(previewLabel)}</span>
    </button>
    <button
      class="project-action-button ${state.currentStage === "spritesheets" ? "is-active" : ""}"
      type="button"
      data-workspace-stage="spritesheets"
      ${stageIsAccessible("spritesheets") ? "" : "disabled"}
    >
      <strong>Exports</strong>
      <span>${stageIsAccessible("spritesheets") ? "Open finished sheets" : "No exports yet"}</span>
    </button>
  `;
}

function renderWorkspaceCurrentResultCard() {
  if (!elements.workspaceCurrentResult) {
    return;
  }

  if (!state.selectedCharacter) {
    elements.workspaceCurrentResult.innerHTML = `
      <p class="eyebrow">Current result</p>
      <h3>Select a character</h3>
      <p class="muted">The latest render and quick continue actions will appear here.</p>
    `;
    return;
  }

  const primarySheet = getPrimarySpritesheet();
  const workspaceSummary = getWorkspaceSummary();
  const currentResultState = getCurrentResultState({
    workspaceSummary,
    primarySheet,
  });
  if (!primarySheet) {
    elements.workspaceCurrentResult.innerHTML = `
      <p class="eyebrow">Current result</p>
      <h3>${escapeHtml(currentResultState.title)}</h3>
      <p class="muted">${escapeHtml(currentResultState.description)}</p>
      <div class="result-card__links">
        <button class="btn btn-secondary" type="button" data-workspace-stage="animate">${escapeHtml(currentResultState.primaryAction)}</button>
      </div>
    `;
    return;
  }

  const updatedLabel = formatShortDate(primarySheet.updatedAt || primarySheet.createdAt || state.selectedCharacter.updatedAt);

  elements.workspaceCurrentResult.innerHTML = `
    <p class="eyebrow">${escapeHtml(primarySheet.isSelectedVersion ? "Current export" : "Latest render")}</p>
    <div class="workspace-result-card__body">
      <img
        class="workspace-result-card__thumbnail"
        src="${escapeHtml(primarySheet.sheetUrl)}"
        alt="${escapeHtml(primarySheet.name)} spritesheet preview"
      />
      <div class="workspace-result-card__copy">
        <h3>${escapeHtml(primarySheet.name)} · ${escapeHtml(formatVersionLabel(primarySheet))}</h3>
        <p class="muted">${primarySheet.frameCount} frames · ${escapeHtml(formatFrameDimensions(primarySheet))}</p>
        <div class="preview-meta__facts">
          <span class="${statusClass(primarySheet.status)}">${escapeHtml(primarySheet.status)}</span>
          <span>${escapeHtml(`${primarySheet.columns} cols`)}</span>
          <span>${escapeHtml(updatedLabel)}</span>
          <span>${escapeHtml(primarySheet.isSelectedVersion ? "Selected for export" : "Preview only")}</span>
        </div>
      </div>
    </div>
    <div class="result-card__links">
      <button class="btn btn-secondary" type="button" data-workspace-preview-current="${escapeHtml(primarySheet.id)}">Open Preview</button>
      <button class="btn btn-secondary" type="button" data-workspace-stage="spritesheets">Open Exports</button>
      <button class="btn btn-secondary" type="button" data-workspace-export-package ${getCharacterExportUrl() ? "" : "disabled"}>
        Download package
      </button>
    </div>
  `;
}

function renderCharacters() {
  if (state.characters.length === 0) {
    elements.characterList.innerHTML = `<p class="muted">No characters yet. Upload one or generate one on the Character stage.</p>`;
    return;
  }

  elements.characterList.innerHTML = state.characters
    .map((character) => {
      const notes = character.analysis?.notes?.length ? `<p class="muted">${escapeHtml(character.analysis.notes[0])}</p>` : "";
      const isSelected = character.id === state.selectedCharacterId;
      const isLoading = character.id === state.selectingCharacterId;
      const hasLoadError = character.id === state.characterLoadErrorId;
      const cardState = getCharacterCardState({
        workspaceSummary: getCharacterWorkspaceSummary(character),
        isSelected,
        isLoading,
        hasLoadError,
      });
      const sourceLabel = `${getCharacterSourceLabel(character)} · ${formatShortDate(character.updatedAt || character.createdAt)}`;
      return `
        <article class="character-card ${isSelected ? "is-selected" : ""}" data-character-id="${escapeHtml(character.id)}">
          <div class="character-card__top">
            <img class="character-card__thumbnail" src="${escapeHtml(character.thumbnailUrl || character.baseImageUrl)}" alt="${escapeHtml(character.name)}" />
            <span class="${statusClass(cardState.badgeStatus)}">${escapeHtml(cardState.badgeLabel)}</span>
          </div>
          <div class="character-card__row">
            <div>
              <h3>${escapeHtml(character.name)}</h3>
              <p class="muted">${character.isHumanoid ? "Humanoid motion" : "Wide-body motion"}</p>
            </div>
          </div>
          <div class="character-card__footer">
            <span class="character-card__meta">${escapeHtml(sourceLabel)}</span>
            <span class="character-card__state">${escapeHtml(cardState.stateLabel)}</span>
          </div>
          ${notes}
        </article>
      `;
    })
    .join("");
}

function renderAnalysisCard(character) {
  if (state.currentStage !== "character" || !character?.analysis) {
    elements.analysisCard.classList.add("hidden");
    if (state.currentStage !== "character") {
      elements.analysisCard.innerHTML = "";
    }
    return;
  }

  const notes = character.analysis.notes.length
    ? `<ul>${character.analysis.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
    : `<p class="muted">Input looks stable enough for standard motion generation.</p>`;

  elements.analysisCard.classList.remove("hidden");
  elements.analysisCard.innerHTML = `
    <p class="eyebrow">Input analysis</p>
    <h3>${character.analysis.isHumanoidGuess ? "Humanoid silhouette" : "Wide silhouette"}</h3>
    <p class="muted">Coverage ${Math.round(character.analysis.silhouetteCoverage * 100)}% · Aspect ${character.analysis.aspectRatio}</p>
    ${notes}
  `;
}

function renderPoses() {
  if (!state.selectedCharacter) {
    elements.poseList.innerHTML = `<p class="muted">Select a character first.</p>`;
    return;
  }

  if (state.poses.length === 0) {
    elements.poseList.innerHTML = `<p class="muted">No poses yet.</p>`;
    return;
  }

  elements.poseList.innerHTML = state.poses
    .map(
      (pose) => `
        <article class="mini-card">
          <img src="${escapeHtml(pose.imageUrl)}" alt="${escapeHtml(pose.name)}" />
          <div>
            <p><strong>${escapeHtml(pose.name)}</strong></p>
            <p class="muted">${escapeHtml(pose.sourceType)}${pose.prompt ? ` · ${escapeHtml(pose.prompt)}` : ""}</p>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderCustomAnimations() {
  if (!state.selectedCharacter) {
    elements.customList.innerHTML = `<p class="muted">Select a character first.</p>`;
    return;
  }

  if (state.customAnimations.length === 0) {
    elements.customList.innerHTML = `<p class="muted">No custom actions yet.</p>`;
    return;
  }

  elements.customList.innerHTML = state.customAnimations
    .map((item) => {
      const modeLabel = item.mode.replaceAll("_", " ");
      return `
        <article class="mini-card mini-card--no-image">
          <div>
            <p><strong>${escapeHtml(item.name)}</strong></p>
            <p class="muted">${escapeHtml(modeLabel)} · ${item.loop ? "loop" : "one-shot"}</p>
            <p class="muted">${escapeHtml(item.prompt)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateCustomPoseOptions() {
  const currentFirst = elements.customFirstPose.value;
  const currentLast = elements.customLastPose.value;
  const options = [`<option value="">None</option>`]
    .concat(state.poses.map((pose) => `<option value="${escapeHtml(pose.id)}">${escapeHtml(pose.name)}</option>`))
    .join("");

  elements.customFirstPose.innerHTML = options;
  elements.customLastPose.innerHTML = options;

  if (currentFirst) {
    elements.customFirstPose.value = currentFirst;
  }
  if (currentLast) {
    elements.customLastPose.value = currentLast;
  }
}

function renderGenerateSummary() {
  const count = selectedActionCount();
  const missingToken = state.generationBackend === "neta" && !state.netaToken;
  const hasCharacter = Boolean(state.selectedCharacter);

  if (!hasCharacter) {
    elements.generateSummaryTitle.textContent = "Select a character";
    elements.generateSummaryCopy.textContent = "Upload or choose a character to unlock motion selection.";
  } else if (count === 0) {
    elements.generateSummaryTitle.textContent = "Nothing selected";
    elements.generateSummaryCopy.textContent = "Choose one or more motions to unlock generation.";
  } else if (
    count === 1 &&
    state.selectedCustomActionIds.length === 0 &&
    state.selectedStandardActionIds.length === 1 &&
    state.selectedStandardActionIds[0] === "walk"
  ) {
    elements.generateSummaryTitle.textContent = "Walk cycle ready";
    elements.generateSummaryCopy.textContent = "Generate one long 48-frame walk sheet first.";
  } else {
    elements.generateSummaryTitle.textContent = `${pluralize(count, "motion")} selected`;
    elements.generateSummaryCopy.textContent = `${pluralize(count, "job")} will enter the queue when you generate.`;
  }

  elements.generateButton.disabled = !hasCharacter || missingToken || count === 0;
  elements.generateButton.textContent =
    count === 1 && state.selectedStandardActionIds[0] === "walk" && state.selectedCustomActionIds.length === 0
      ? "Generate walk spritesheet"
      : count > 0
        ? `Generate ${pluralize(count, "spritesheet")}`
        : "Generate spritesheets";

  renderAnimateConsequencePanel();
}

function stopAnimatePreviewLoop() {
  if (state.animatePreviewTimer) {
    cancelAnimationFrame(state.animatePreviewTimer);
    state.animatePreviewTimer = null;
  }
}

function setAnimatePreviewCharacterVisible(visible) {
  if (!elements.animatePreviewCharacter || !elements.animatePreviewCanvas) {
    return;
  }

  elements.animatePreviewCharacter.classList.toggle("hidden", !visible);
  elements.animatePreviewCanvas.classList.toggle("hidden", visible);
}

function syncAnimateInspectorTarget() {
  const target = getAnimateInspectorTarget();
  state.animateFocusedMotionKey = target.motionKey;

  if (state.animatePreviewSheetId !== target.sheetId) {
    state.animatePreviewSheetId = target.sheetId;
    state.animatePreviewFrameIndex = 0;
    state.animatePreviewLastTick = 0;
  }

  return target;
}

function scheduleAnimatePreviewAssetLoad(sheet) {
  if (!sheet) {
    return;
  }

  void loadPreviewRuntimeAsset(sheet)
    .then(() => {
      if (state.currentStage === "animate") {
        renderAnimateConsequencePanel();
        drawAnimatePreviewFrame();
        startAnimatePreviewLoop();
      }
    })
    .catch((error) => {
      console.error(`Failed to load animate preview asset ${sheet.id}`, error);
    });
}

function drawAnimatePreviewFrame() {
  if (!elements.animatePreviewCanvas) {
    return;
  }

  const target = syncAnimateInspectorTarget();
  const sheet = getSpritesheetById(target.sheetId);
  const asset = sheet ? state.previewRuntimeAssets[sheet.id] || null : null;

  if (!sheet || !asset) {
    animatePreviewContext.clearRect(0, 0, elements.animatePreviewCanvas.width, elements.animatePreviewCanvas.height);
    return;
  }

  drawAssetFrameToCanvas({
    canvas: elements.animatePreviewCanvas,
    context: animatePreviewContext,
    detail: sheet,
    atlas: asset.atlas,
    image: asset.image,
    frameIndex: state.animatePreviewFrameIndex,
  });
}

function drawAnimatePreviewLoopFrame(timestamp) {
  if (state.currentStage !== "animate") {
    state.animatePreviewTimer = null;
    return;
  }

  const target = syncAnimateInspectorTarget();
  const sheet = getSpritesheetById(target.sheetId);
  const asset = sheet ? state.previewRuntimeAssets[sheet.id] || null : null;
  const frameCount = Array.isArray(asset?.atlas?.frames) ? asset.atlas.frames.length : 0;

  if (!sheet || !asset || frameCount === 0) {
    state.animatePreviewTimer = null;
    return;
  }

  const stepMs = 1000 / 12;
  if (state.animatePreviewLastTick === 0) {
    state.animatePreviewLastTick = timestamp;
    state.animatePreviewFrameIndex = clamp(state.animatePreviewFrameIndex, 0, frameCount - 1);
  } else if (timestamp - state.animatePreviewLastTick >= stepMs) {
    state.animatePreviewLastTick = timestamp;
    state.animatePreviewFrameIndex = state.animatePreviewFrameIndex >= frameCount - 1 ? 0 : state.animatePreviewFrameIndex + 1;
  }

  drawAnimatePreviewFrame();
  state.animatePreviewTimer = requestAnimationFrame(drawAnimatePreviewLoopFrame);
}

function startAnimatePreviewLoop() {
  if (state.currentStage !== "animate" || state.animatePreviewTimer) {
    return;
  }

  const target = syncAnimateInspectorTarget();
  const sheet = getSpritesheetById(target.sheetId);
  const asset = sheet ? state.previewRuntimeAssets[sheet.id] || null : null;
  const frameCount = Array.isArray(asset?.atlas?.frames) ? asset.atlas.frames.length : 0;

  if (!sheet || !asset || frameCount === 0) {
    return;
  }

  state.animatePreviewLastTick = 0;
  state.animatePreviewTimer = requestAnimationFrame(drawAnimatePreviewLoopFrame);
}

function renderAnimateConsequencePanel() {
  if (
    !elements.animateConsequenceSummary ||
    !elements.animateSelectionChips ||
    !elements.animatePreviewCharacter ||
    !elements.animatePreviewMeta ||
    !elements.animateOpenPreview
  ) {
    return;
  }

  const selectedMotionKeys = getSelectedAnimateMotionKeys();
  const target = syncAnimateInspectorTarget();
  const targetSheet = getSpritesheetById(target.sheetId);
  const targetPrompt = getAnimateMotionPrompt(target.motionKey);
  const readySelectionCount = selectedMotionKeys.filter((motionKey) => getAnimateMotionSheets(motionKey).length > 0).length;

  if (!state.selectedCharacter) {
    elements.animateConsequenceSummary.innerHTML = `<p class="muted">Select a character to unlock motion planning.</p>`;
    elements.animateSelectionChips.innerHTML = "";
    elements.animatePreviewMeta.innerHTML = `<p class="muted">No character selected yet.</p>`;
    elements.animateOpenPreview.disabled = true;
    elements.animateOpenPreview.dataset.previewId = "";
    elements.animatePreviewCharacter.removeAttribute("src");
    elements.animatePreviewCharacter.alt = "";
    setAnimatePreviewCharacterVisible(true);
    stopAnimatePreviewLoop();
    return;
  }

  const previewImageUrl = state.selectedCharacter.thumbnailUrl || state.selectedCharacter.baseImageUrl || "";
  if (previewImageUrl) {
    elements.animatePreviewCharacter.src = previewImageUrl;
    elements.animatePreviewCharacter.alt = `${state.selectedCharacter.name} character art`;
  } else {
    elements.animatePreviewCharacter.removeAttribute("src");
    elements.animatePreviewCharacter.alt = "";
  }

  if (selectedMotionKeys.length === 0) {
    elements.animateConsequenceSummary.innerHTML = `
      <p class="muted">Choose motions to see what the next batch adds and to reopen any current result for that motion.</p>
      <div class="preview-meta__facts">
        <span>No batch selected</span>
        <span>${escapeHtml(getQueueLabel())}</span>
      </div>
    `;
    elements.animateSelectionChips.innerHTML = "";
    elements.animatePreviewMeta.innerHTML = `
      <p class="eyebrow">Current source</p>
      <h3>${escapeHtml(state.selectedCharacter.name)}</h3>
      <p class="muted">The right pane will switch from base art to a live motion preview as soon as you pick a motion that already has a sheet.</p>
    `;
    elements.animateOpenPreview.disabled = true;
    elements.animateOpenPreview.dataset.previewId = "";
    setAnimatePreviewCharacterVisible(true);
    stopAnimatePreviewLoop();
    return;
  }

  elements.animateConsequenceSummary.innerHTML = `
    <p class="muted">${pluralize(selectedActionCount(), "motion")} ready. Generating now adds ${pluralize(selectedActionCount(), "job")} to the queue.</p>
    <div class="preview-meta__facts">
      <span>${escapeHtml(getQueueLabel())}</span>
      <span>${pluralize(readySelectionCount, "selected motion")} already have results</span>
      <span>${pluralize(Math.max(selectedActionCount() - readySelectionCount, 0), "selected motion")} still need a first render</span>
    </div>
  `;

  elements.animateSelectionChips.innerHTML = selectedMotionKeys
    .map((motionKey) => {
      const motionSheets = getAnimateMotionSheets(motionKey);
      const readySheet = motionSheets.find((sheet) => sheet.isSelectedVersion) || motionSheets[0] || null;
      const isActive = motionKey === target.motionKey;
      return `
        <button
          class="animate-selection-chip ${isActive ? "is-active" : ""}"
          type="button"
          data-animate-motion-key="${escapeHtml(motionKey)}"
        >
          <strong>${escapeHtml(getAnimateMotionLabel(motionKey))}</strong>
          <span>${escapeHtml(readySheet ? `${formatVersionLabel(readySheet)} ready` : "Not generated yet")}</span>
        </button>
      `;
    })
    .join("");

  if (!target.motionKey) {
    elements.animatePreviewMeta.innerHTML = `<p class="muted">No motion selected yet.</p>`;
    elements.animateOpenPreview.disabled = true;
    elements.animateOpenPreview.dataset.previewId = "";
    setAnimatePreviewCharacterVisible(true);
    stopAnimatePreviewLoop();
    return;
  }

  if (!targetSheet) {
    const motionState = getAnimateMotionState({
      motionKey: target.motionKey,
      jobs: getMotionJobs(target.motionKey),
      spritesheets: state.spritesheets,
    });
    elements.animatePreviewMeta.innerHTML = `
      <p class="eyebrow">${escapeHtml(motionState.title)}</p>
      <h3>${escapeHtml(getAnimateMotionLabel(target.motionKey))}</h3>
      <p class="muted">${escapeHtml(motionState.description || targetPrompt || "No current sheet exists for this motion yet. Generate the batch and the result will land here.")}</p>
      <div class="preview-meta__facts">
        <span>${escapeHtml(motionState.factLabel)}</span>
        <span>${escapeHtml(`${pluralize(getAnimateMotionSheets(target.motionKey).length, "saved version")}`)}</span>
      </div>
    `;
    elements.animateOpenPreview.disabled = true;
    elements.animateOpenPreview.dataset.previewId = "";
    setAnimatePreviewCharacterVisible(true);
    stopAnimatePreviewLoop();
    return;
  }

  const targetVersions = getAnimateMotionSheets(target.motionKey).length;
  const previewAsset = state.previewRuntimeAssets[targetSheet.id] || null;

  elements.animatePreviewMeta.innerHTML = `
    <p class="eyebrow">Current result</p>
    <h3>${escapeHtml(getAnimateMotionLabel(target.motionKey))} · ${escapeHtml(formatVersionLabel(targetSheet))}</h3>
    <p class="muted">${
      previewAsset
        ? "This is the current result for the selected motion. Reopen it in Preview when you need loop tuning or version approval."
        : "Loading the current result for this motion."
    }</p>
    <div class="preview-meta__facts">
      <span>${escapeHtml(formatFrameDimensions(targetSheet))}</span>
      <span>${escapeHtml(`${targetSheet.frameCount} frames`)}</span>
      <span>${escapeHtml(`${pluralize(targetVersions, "saved version")}`)}</span>
      <span>${escapeHtml(targetSheet.isSelectedVersion ? "Current export version" : "Preview only")}</span>
    </div>
  `;

  elements.animateOpenPreview.disabled = false;
  elements.animateOpenPreview.dataset.previewId = targetSheet.id;
  setAnimatePreviewCharacterVisible(false);

  if (!previewAsset) {
    scheduleAnimatePreviewAssetLoad(targetSheet);
    stopAnimatePreviewLoop();
    animatePreviewContext.clearRect(0, 0, elements.animatePreviewCanvas.width, elements.animatePreviewCanvas.height);
    return;
  }

  drawAnimatePreviewFrame();
  startAnimatePreviewLoop();
}

function updateCustomFormState() {
  const hasCharacter = Boolean(state.selectedCharacter);
  const mode = elements.customMode.value;
  const loop = elements.customLoop.checked;

  elements.customForm.querySelector("button[type='submit']").disabled = !hasCharacter;
  elements.poseForm.querySelector("button[type='submit']").disabled = !hasCharacter;

  const firstRequired = mode !== "auto";
  const lastEnabled = mode === "first_and_last_frame";
  const lastRequired = mode === "first_and_last_frame" && !loop;

  elements.customFirstPose.disabled = !firstRequired;
  elements.customLastPose.disabled = !lastEnabled || loop;
  elements.customFirstPose.required = firstRequired;
  elements.customLastPose.required = lastRequired;

  renderGenerateSummary();
}

function renderActionList() {
  pruneSelections();

  if (!state.selectedCharacter) {
    state.selectedStandardActionIds = [];
    state.selectedCustomActionIds = [];
    elements.actionList.innerHTML = `<p class="muted">Select a character first.</p>`;
    renderGenerateSummary();
    return;
  }

  const standardItems = [...state.supportedActions]
    .sort((left, right) => {
      if (left.id === "walk") {
        return -1;
      }
      if (right.id === "walk") {
        return 1;
      }
      return 0;
    })
    .map((action) => {
      const checked = state.selectedStandardActionIds.includes(action.id) ? "checked" : "";
      const copy = ACTION_COPY[action.id] || action.motionPrompt;
      return `
        <label class="action-card">
          <input type="checkbox" name="action-standard" value="${escapeHtml(action.id)}" ${checked} />
          <span class="action-card__kind">${action.loop ? "Loop" : "One shot"}</span>
          <strong>${escapeHtml(action.label)}</strong>
          <p class="muted">${escapeHtml(copy)}</p>
          <p class="muted">${action.defaultFrameCount} frames</p>
        </label>
      `;
    })
    .join("");

  const customItems = state.customAnimations.length
    ? state.customAnimations
        .map((item) => {
          const checked = state.selectedCustomActionIds.includes(item.id) ? "checked" : "";
          return `
            <label class="action-card action-card--custom">
              <input type="checkbox" name="action-custom" value="${escapeHtml(item.id)}" ${checked} />
              <span class="action-card__kind">Custom</span>
              <strong>${escapeHtml(item.name)}</strong>
              <p class="muted">${escapeHtml(item.prompt)}</p>
              <p class="muted">${item.mode.replaceAll("_", " ")} · ${item.loop ? "loop" : "one-shot"}</p>
            </label>
          `;
        })
        .join("")
    : `<p class="muted">No saved custom actions yet.</p>`;

  elements.actionList.innerHTML = `
    <div class="action-group">
      <p class="eyebrow">Standard actions</p>
      <div class="action-group__tiles">${standardItems}</div>
    </div>
    <div class="action-group">
      <p class="eyebrow">Custom actions</p>
      <div class="action-group__tiles">${customItems}</div>
    </div>
  `;

  renderGenerateSummary();
  renderAnimateConsequencePanel();
}

function buildJobListMarkup(emptyMessage) {
  if (!state.selectedCharacter) {
    return `<p class="muted">Select a character first.</p>`;
  }

  if (state.jobs.length === 0) {
    return `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
  }

  return state.jobs
    .map((job) => {
      const steps = job.steps
        .map((step) => `<span class="${statusClass(step.status)}">${escapeHtml(step.label)}</span>`)
        .join(" ");
      const title =
        job.request.requestKind === "custom"
          ? job.request.label
          : state.supportedActions.find((action) => action.id === job.request.action)?.label || job.request.action;

      return `
        <article class="job-card">
          <div class="character-card__row">
            <div>
              <h3>${escapeHtml(title)}</h3>
              <p class="muted">${escapeHtml(job.error || "Tracking motion build and sheet export.")}</p>
            </div>
            <span class="${statusClass(job.status)}">${escapeHtml(job.status)}</span>
          </div>
          <div class="result-card__links">${steps}</div>
        </article>
      `;
    })
    .join("");
}

function renderAllJobLists() {
  const sidebarMarkup = buildJobListMarkup("No generation jobs yet.");
  const previewMarkup = buildJobListMarkup("No preview jobs yet.");
  const exportsMarkup = buildJobListMarkup("No export jobs yet.");

  if (elements.jobList) {
    elements.jobList.innerHTML = sidebarMarkup;
  }
  if (elements.previewJobList) {
    elements.previewJobList.innerHTML = previewMarkup;
  }
  if (elements.exportsJobList) {
    elements.exportsJobList.innerHTML = exportsMarkup;
  }
}

function renderPreviewPickers() {
  if (!state.selectedCharacter) {
    elements.previewResultList.innerHTML = `<p class="muted">Select a character first.</p>`;
    return;
  }

  if (state.spritesheets.length === 0) {
    const workspaceSummary = getWorkspaceSummary();
    const previewCopy = getPreviewStageCopy({ workspaceSummary });
    const currentResultState = getCurrentResultState({ workspaceSummary });
    const message = currentResultState.kind === "failed" ? currentResultState.description : previewCopy.subtitle;
    elements.previewResultList.innerHTML = `<p class="muted">${message}</p>`;
    return;
  }

  elements.previewResultList.innerHTML = state.spritesheets
    .map((sheet) => {
      const isActive = state.activePreview?.id === sheet.id;
      return `
        <button class="preview-picker ${isActive ? "is-active" : ""}" type="button" data-preview-id="${escapeHtml(sheet.id)}">
          <strong>${escapeHtml(sheet.name)} · ${escapeHtml(formatVersionLabel(sheet))}</strong>
          <p class="muted">${sheet.frameCount} frames · ${formatFrameDimensions(sheet)}</p>
          <div class="preview-picker__meta">
            <span class="${statusClass(sheet.status)}">${escapeHtml(sheet.status)}</span>
            ${getSelectedVersionChipMarkup(sheet)}
          </div>
        </button>
      `;
    })
    .join("");
}

function renderPreviewSceneButtons() {
  if (!elements.previewScenePicker) {
    return;
  }

  const hasPreview = Boolean(state.activePreview);
  const currentScene = state.previewSceneId || PREVIEW_SCENES[0].id;

  elements.previewScenePicker.innerHTML = PREVIEW_SCENES.map((scene) => {
    const isActive = currentScene === scene.id;
    return `
      <button
        class="preview-scene-chip ${isActive ? "is-active" : ""}"
        type="button"
        data-preview-scene-id="${escapeHtml(scene.id)}"
        ${hasPreview ? "" : "disabled"}
      >
        ${escapeHtml(scene.label)}
      </button>
    `;
  }).join("");
}

function renderSpritesheets() {
  const canExportPackage = Boolean(getCharacterExportUrl());
  if (elements.exportsDownloadPackage) {
    elements.exportsDownloadPackage.disabled = !canExportPackage;
  }

  if (!state.selectedCharacter) {
    elements.spritesheetList.innerHTML = `<p class="muted">Create or select a character to see results.</p>`;
    return;
  }

  if (state.spritesheets.length === 0) {
    elements.spritesheetList.innerHTML = `<p class="muted">No generated spritesheets yet.</p>`;
    return;
  }

  elements.spritesheetList.innerHTML = state.spritesheets
    .map(
      (sheet) => `
        <article class="result-card" data-spritesheet-id="${escapeHtml(sheet.id)}">
          <div class="result-card__header">
            <div>
              <h3>${escapeHtml(sheet.name)}</h3>
              <p class="muted">${escapeHtml(formatVersionLabel(sheet))} · ${sheet.frameCount} frames · ${formatFrameDimensions(sheet)} · ${sheet.columns} columns</p>
            </div>
            <span class="${statusClass(sheet.status)}">${escapeHtml(sheet.status)}</span>
          </div>
          ${sheet.isSelectedVersion ? `<div class="result-card__badges">${getSelectedVersionChipMarkup(sheet)}</div>` : ""}
          <img src="${escapeHtml(sheet.sheetUrl)}" alt="${escapeHtml(sheet.name)} spritesheet preview" />
          <div class="result-card__links">
            <button class="button button--primary" type="button" data-preview-id="${escapeHtml(sheet.id)}">Preview</button>
            <button
              class="button button--secondary"
              type="button"
              data-redo-spritesheet-id="${escapeHtml(sheet.id)}"
              ${state.redoingSpritesheetId === sheet.id ? "disabled" : ""}
            >
              ${state.redoingSpritesheetId === sheet.id ? "Redoing..." : "Redo"}
            </button>
            <button
              class="button button--secondary"
              type="button"
              data-select-spritesheet-id="${escapeHtml(sheet.id)}"
              ${sheet.isSelectedVersion || state.selectingSpritesheetId === sheet.id ? "disabled" : ""}
            >
              ${
                sheet.isSelectedVersion
                  ? "Current export version"
                  : state.selectingSpritesheetId === sheet.id
                    ? "Using version..."
                    : "Use for export"
              }
            </button>
            <a class="link-chip" href="${escapeHtml(sheet.sheetUrl)}" download>PNG spritesheet</a>
            <a class="link-chip" href="${escapeHtml(sheet.atlasUrl)}" download>JSON atlas</a>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderPreviewControls() {
  const hasPreview = Boolean(state.activePreview && state.previewAtlas);
  const frameCount = hasPreview ? getPreviewFrameCount() : 0;
  const maxIndex = Math.max(frameCount - 1, 0);
  const scene = getPreviewScene();

  elements.previewFrameScrub.max = String(maxIndex);
  elements.previewRangeStart.max = String(maxIndex);
  elements.previewRangeEnd.max = String(maxIndex);
  elements.previewFrameScrub.disabled = !hasPreview;
  elements.previewRangeStart.disabled = !hasPreview;
  elements.previewRangeEnd.disabled = !hasPreview;
  elements.previewFps.disabled = !hasPreview;
  elements.previewPlayToggle.disabled = !hasPreview;
  elements.previewPlayToggleSecondary.disabled = !hasPreview;
  if (elements.previewSelectVersion) {
    elements.previewSelectVersion.disabled = !hasPreview || state.selectingSpritesheetId === state.activePreview?.id;
    elements.previewSelectVersion.textContent = !hasPreview
      ? "Approve for export"
      : state.selectingSpritesheetId === state.activePreview?.id
        ? "Approving..."
        : state.activePreview?.isSelectedVersion
          ? "Open exports"
          : "Approve for export";
  }
  if (elements.previewRedoMotion) {
    elements.previewRedoMotion.disabled = !hasPreview || state.redoingSpritesheetId === state.activePreview?.id;
    elements.previewRedoMotion.textContent =
      state.redoingSpritesheetId === state.activePreview?.id ? "Redoing..." : "Redo motion";
  }
  if (elements.previewDownloadPackage) {
    elements.previewDownloadPackage.disabled = !getCharacterExportUrl();
  }
  elements.previewToExports.disabled = !stageIsAccessible("spritesheets");

  if (!hasPreview) {
    elements.previewFrameScrub.value = "0";
    elements.previewRangeStart.value = "0";
    elements.previewRangeEnd.value = "0";
    elements.previewFrameReadout.textContent = "Frame 0 / 0";
    elements.previewLoopReadout.textContent = "Frames 0 to 0";
    elements.previewFpsReadout.textContent = `${state.previewFps} FPS`;
    elements.previewOutputReadout.textContent = "Unknown export";
    elements.previewAtlasReadout.textContent = "No atlas";
    elements.previewDimensionsReadout.textContent = "Unknown size";
    elements.previewSheetReadout.textContent = "No atlas loaded";
    elements.previewSceneReadout.textContent = "Awaiting a generated result";
    elements.previewMotionReadout.textContent = "No preview loaded";
    elements.previewPositionReadout.textContent = "Waiting on input";
    elements.previewPlayToggle.textContent = "Pause loop";
    elements.previewPlayToggleSecondary.textContent = "Pause";
    renderActionMessages();
    return;
  }

  const { loopStart, loopEnd } = getPreviewLoopBounds();
  state.previewFrameIndex = Math.min(Math.max(state.previewFrameIndex, 0), maxIndex);

  elements.previewFrameScrub.value = String(state.previewFrameIndex);
  elements.previewRangeStart.value = String(loopStart);
  elements.previewRangeEnd.value = String(loopEnd);
  elements.previewFps.value = String(state.previewFps);
  elements.previewFrameReadout.textContent = `Frame ${state.previewFrameIndex + 1} / ${frameCount}`;
  elements.previewLoopReadout.textContent = `Frames ${loopStart + 1} to ${loopEnd + 1}`;
  elements.previewFpsReadout.textContent = state.previewPaused ? `Paused at ${state.previewFps} FPS` : `${state.previewFps} FPS live`;
  elements.previewOutputReadout.textContent = `${formatFrameDimensions(state.activePreview)} · ${state.activePreview.frameCount} frames`;
  elements.previewAtlasReadout.textContent = `${state.activePreview.columns} cols · ${state.activePreview.rows} rows`;
  elements.previewDimensionsReadout.textContent = formatFrameDimensions(state.activePreview);
  elements.previewSheetReadout.textContent = `${state.previewFrameIndex + 1} selected · ${state.activePreview.columns}x${state.activePreview.rows}`;
  elements.previewSceneReadout.textContent = scene.label;
  elements.previewMotionReadout.textContent = `${getPreviewRuntimeLabel()} · ${state.previewPaused ? "paused" : "live"}`;
  elements.previewPositionReadout.textContent = `${Math.round((state.previewScenePlayerX / PREVIEW_SCENE_WORLD_WIDTH) * 100)}% across · ${
    state.previewSceneJumpOffset > 0 ? "airborne" : "grounded"
  }`;
  elements.previewPlayToggle.textContent = state.previewPaused ? "Resume loop" : "Pause loop";
  elements.previewPlayToggleSecondary.textContent = state.previewPaused ? "Resume" : "Pause";
  renderActionMessages();
}

function renderPreviewAvailabilityState() {
  if (!elements.previewEmptyState || !elements.previewDeck || !elements.previewTimeline || !elements.previewWorkspaceActions) {
    return;
  }

  const hasPreview = Boolean(state.activePreview && state.previewAtlas && state.previewSheetImage);
  elements.previewEmptyState.classList.toggle("hidden", hasPreview);
  elements.previewDeck.classList.toggle("hidden", !hasPreview);
  elements.previewTimeline.classList.toggle("hidden", !hasPreview);
  elements.previewWorkspaceActions.classList.toggle("hidden", !hasPreview);

  if (hasPreview) {
    return;
  }

  const workspaceSummary = getWorkspaceSummary();
  const previewCopy = getPreviewStageCopy({ workspaceSummary });
  const currentResultState = getCurrentResultState({ workspaceSummary });
  const leadMessage =
    currentResultState.kind === "failed" ? currentResultState.description : previewCopy.subtitle;
  const followupMessage = currentResultState.kind === "failed" ? previewCopy.subtitle : "";
  const buttonLabel = currentResultState.primaryAction || "Open Animate";

  elements.previewEmptyState.innerHTML = `
    <div class="preview-empty-state__copy">
      <p class="eyebrow">Preview unavailable</p>
      <h3>${escapeHtml(previewCopy.title)}</h3>
      <p class="muted">${escapeHtml(leadMessage)}</p>
      ${followupMessage ? `<p class="muted">${escapeHtml(followupMessage)}</p>` : ""}
    </div>
    <div class="result-card__links">
      <button class="btn btn-secondary" type="button" data-workspace-stage="animate">${escapeHtml(buttonLabel)}</button>
    </div>
  `;
}

function renderStageShell() {
  ensureAccessibleStage();
  renderWorkspaceHeader();
  renderAnalysisCard(state.selectedCharacter);

  for (const tab of elements.stageTabs) {
    const stage = tab.dataset.stage;
    const isActive = stage === state.currentStage;
    const isAccessible = stageIsAccessible(stage);

    tab.classList.toggle("is-active", isActive);
    tab.classList.toggle("is-locked", !isAccessible);
    tab.disabled = !isAccessible;
  }

  for (const panel of elements.stagePanels) {
    const isActive = panel.dataset.stagePanel === state.currentStage;
    panel.classList.toggle("hidden", !isActive);
    panel.hidden = !isActive;
  }

  if (state.currentStage !== "animate") {
    stopAnimatePreviewLoop();
  }

  renderAnimateConsequencePanel();
  renderPreviewComparePanel();
  renderPreviewControls();
  renderPreviewAvailabilityState();

  if (state.currentStage === "preview" && state.spritesheets.length > 0 && !state.activePreview) {
    void loadPreview(state.spritesheets[0].id);
  }
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function refreshPollingState() {
  if (!state.selectedCharacterId) {
    return;
  }

  await Promise.all([loadJobs(state.selectedCharacterId), loadSpritesheets(state.selectedCharacterId)]);
  if (activeJobCount() === 0) {
    stopPolling();
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(() => {
    void refreshPollingState().catch((error) => {
      stopPolling();
      setMessage(elements.generateMessage, error.message, true);
    });
  }, 1200);
}

async function loadHealth() {
  const payload = await fetchJson("/api/health");
  state.generationBackend = payload.generationBackend || "unknown";
  renderAuthState();
  updateCustomFormState();
}

async function verifyNetaToken() {
  if (state.generationBackend !== "neta") {
    state.netaUser = null;
    renderAuthState();
    setMessage(elements.authMessage, "Token is not required with the current backend.");
    return;
  }

  if (!state.netaToken) {
    state.netaUser = null;
    renderAuthState();
    setMessage(elements.authMessage, "Paste a token first.", true);
    return;
  }

  setMessage(elements.authMessage, "Checking token...");
  try {
    const payload = await fetchJson("/api/neta/me");
    state.netaUser = payload.user || null;
    renderAuthState();
    updateCustomFormState();
    setMessage(elements.authMessage, "Token connected.");
  } catch (error) {
    state.netaUser = null;
    renderAuthState();
    updateCustomFormState();
    setMessage(elements.authMessage, error.message, true);
  }
}

async function loadCharacters() {
  const payload = await fetchJson("/api/characters");
  state.characters = payload.characters;
  renderCharacters();
  renderWorkspaceSummary();

  if (!state.selectedCharacterId && state.characters.length > 0) {
    await selectCharacter(state.characters[0].id);
  }
}

async function loadSupportedActions() {
  const payload = await fetchJson("/api/supported-actions");
  state.supportedActions = payload.actions;
  if (
    state.selectedCharacter &&
    state.selectedStandardActionIds.length === 0 &&
    state.selectedCustomActionIds.length === 0 &&
    state.supportedActions.some((action) => action.id === "walk")
  ) {
    state.selectedStandardActionIds = ["walk"];
  }
  renderActionList();
}

async function selectCharacter(characterId, { preferredStage = "character" } = {}) {
  const clickedCharacter = state.characters.find((character) => character.id === characterId) || null;
  state.selectingCharacterId = characterId;
  state.characterLoadErrorId = null;
  clearWorkspaceStatusMessage();
  renderCharacters();

  try {
    const [character, posesPayload, customAnimationsPayload, spritesheetsPayload, jobsPayload] = await Promise.all([
      fetchJson(`/api/characters/${characterId}`),
      fetchJson(`/api/characters/${characterId}/poses`),
      fetchJson(`/api/characters/${characterId}/custom-animations`),
      fetchJson(`/api/characters/${characterId}/spritesheets`),
      fetchJson(`/api/jobs?characterId=${encodeURIComponent(characterId)}`),
    ]);

    state.selectedCharacterId = characterId;
    state.selectedCharacter = character;
    state.poses = posesPayload.poses;
    state.customAnimations = customAnimationsPayload.customAnimations;
    state.spritesheets = spritesheetsPayload.spritesheets;
    state.jobs = jobsPayload.jobs;
    state.selectedStandardActionIds = state.supportedActions.some((action) => action.id === "walk") ? ["walk"] : [];
    state.selectedCustomActionIds = [];
    state.pendingPreview = null;
    state.selectingCharacterId = null;
    state.characterLoadErrorId = null;
    clearBuildMessages();
    clearActionMessages();
    clearWorkspaceStatusMessage();

    const workspaceSummary = deriveWorkspaceSummary({
      jobs: state.jobs,
      spritesheets: state.spritesheets,
    });
    state.characters = state.characters.map((item) =>
      item.id === characterId
        ? {
            ...item,
            ...character,
            workspaceSummary,
          }
        : item,
    );

    rebuildPreviewRuntimeCatalog();
    resetPreview(getPreviewStageCopy({ workspaceSummary }).subtitle);
    renderAnalysisCard(state.selectedCharacter);
    renderWorkspaceSummary();
    renderCharacters();
    renderPoses();
    renderCustomAnimations();
    renderAllJobLists();
    renderPreviewPickers();
    renderSpritesheets();
    renderActionMessages();
    renderActionList();
    updateCustomPoseOptions();
    updateCustomFormState();

    if (state.spritesheets.length > 0) {
      await loadPreview(state.spritesheets[0].id);
    }

    renderActionList();
    setAnimatePanel("select");
    setStage(preferredStage, { force: true });

    if (activeJobCount() > 0) {
      startPolling();
    } else {
      stopPolling();
    }
  } catch (error) {
    state.selectingCharacterId = null;
    state.characterLoadErrorId = characterId;
    renderCharacters();
    renderWorkspaceHeader();
    setWorkspaceStatusMessage(
      `Could not load ${clickedCharacter?.name || "that character"}. ${error.message}`,
      true,
    );
  }
}

async function loadPoses(characterId) {
  const payload = await fetchJson(`/api/characters/${characterId}/poses`);
  state.poses = payload.poses;
  renderPoses();
  renderWorkspaceSummary();
  updateCustomPoseOptions();
  updateCustomFormState();
}

async function loadCustomAnimations(characterId) {
  const payload = await fetchJson(`/api/characters/${characterId}/custom-animations`);
  state.customAnimations = payload.customAnimations;
  renderCustomAnimations();
  renderWorkspaceSummary();
  renderActionList();
}

async function loadSpritesheets(characterId) {
  const payload = await fetchJson(`/api/characters/${characterId}/spritesheets`);
  state.spritesheets = payload.spritesheets;
  if (state.activePreview) {
    const refreshedActivePreview = state.spritesheets.find((sheet) => sheet.id === state.activePreview.id);
    if (refreshedActivePreview) {
      state.activePreview = { ...state.activePreview, ...refreshedActivePreview };
    }
  }
  syncSelectedCharacterWorkspaceSummary();
  rebuildPreviewRuntimeCatalog();
  renderCharacters();
  renderPreviewPickers();
  renderSpritesheets();
  renderWorkspaceSummary();
  renderStageShell();
  renderAnimateConsequencePanel();

  if (state.spritesheets.length === 0) {
    resetPreview(getPreviewStageCopy({ workspaceSummary: getWorkspaceSummary() }).subtitle);
    return;
  }

  if (state.pendingPreview) {
    const pendingSheet = state.pendingPreview.sheetId
      ? state.spritesheets.find((sheet) => sheet.id === state.pendingPreview.sheetId)
      : null;

    if (pendingSheet) {
      state.pendingPreview = null;
      await loadPreview(pendingSheet.id);
      return;
    }
  }

  if (!state.activePreview || !state.spritesheets.some((sheet) => sheet.id === state.activePreview.id)) {
    await loadPreview(state.spritesheets[0].id);
    return;
  }

  syncPreviewCompareId();
  primePreviewRuntimeAssets();
  schedulePreviewCompareAssetLoad();
  renderAnimateConsequencePanel();
  renderPreviewComparePanel();
  drawCurrentPreviewFrame();
}

async function loadJobs(characterId) {
  const payload = await fetchJson(`/api/jobs?characterId=${encodeURIComponent(characterId)}`);
  state.jobs = payload.jobs;

  if (state.pendingPreview?.jobId) {
    const matchedJob = state.jobs.find((job) => job.id === state.pendingPreview.jobId || job.jobId === state.pendingPreview.jobId);
    if (matchedJob?.resultIds?.[0]) {
      state.pendingPreview.sheetId = matchedJob.resultIds[0];
    }
  }

  syncSelectedCharacterWorkspaceSummary();
  renderCharacters();
  renderAllJobLists();
  renderWorkspaceHeader();
  renderPreviewPickers();
  renderStageShell();
}

async function selectSpritesheetVersion(spritesheetId, { openExports = false } = {}) {
  if (!state.selectedCharacterId || !spritesheetId) {
    return;
  }

  state.selectingSpritesheetId = spritesheetId;
  setActionMessage("Updating the current export version...");
  renderPreviewControls();
  renderPreviewComparePanel();
  renderSpritesheets();

  try {
    await fetchJson(`/api/characters/${state.selectedCharacterId}/spritesheets/${spritesheetId}/select`, {
      method: "POST",
    });
    await loadSpritesheets(state.selectedCharacterId);
    await loadPreview(spritesheetId);
    setStage(openExports ? "spritesheets" : "preview", { force: true });
    setActionMessage(openExports ? "Current export version approved and opened in exports." : "Current export version updated.");
  } catch (error) {
    setActionError(error.message);
  } finally {
    state.selectingSpritesheetId = null;
    renderPreviewControls();
    renderPreviewComparePanel();
    renderSpritesheets();
  }
}

async function redoSpritesheetVersion(spritesheetId) {
  if (!state.selectedCharacterId || !spritesheetId) {
    return;
  }

  state.redoingSpritesheetId = spritesheetId;
  setActionMessage("Submitting a redo job for this motion...");
  renderPreviewControls();
  renderPreviewComparePanel();
  renderSpritesheets();

  try {
    const response = await fetchJson(`/api/characters/${state.selectedCharacterId}/spritesheets/${spritesheetId}/redo`, {
      method: "POST",
    });
    state.pendingPreview = response.workflow
      ? {
          jobId: response.workflow.jobId,
          sheetId: null,
        }
      : null;
    await loadJobs(state.selectedCharacterId);
    setStage("preview", { force: true });
    startPolling();
    setActionMessage("Redo job started. Preview will switch when the new version finishes.");
  } catch (error) {
    setActionError(error.message);
  } finally {
    state.redoingSpritesheetId = null;
    renderPreviewControls();
    renderPreviewComparePanel();
    renderSpritesheets();
  }
}

function stopPreviewLoop() {
  if (state.previewTimer) {
    cancelAnimationFrame(state.previewTimer);
    state.previewTimer = null;
  }
}

function clearPreviewSceneKeys() {
  state.previewSceneKeys.left = false;
  state.previewSceneKeys.right = false;
  state.previewSceneKeys.up = false;
  state.previewSceneKeys.down = false;
  state.previewSceneModifiers.sprint = false;
  state.previewSceneModifiers.crouch = false;
}

function clearPreviewRuntimeState({ keepCatalog = false, keepAssets = false } = {}) {
  state.previewRuntimeActionId = null;
  state.previewRuntimeFrameIndex = 0;
  state.previewRuntimeLastTick = 0;
  state.previewRuntimeCompleted = false;
  state.previewRuntimeMode = "idle";
  state.previewRuntimePendingActionId = null;
  state.previewRuntimeLockedActionId = null;

  if (!keepCatalog) {
    state.previewRuntimeCatalog = {};
  }

  if (!keepAssets) {
    state.previewRuntimeAssets = {};
    state.previewRuntimeAssetLoads = {};
  }
}

function resetPreviewSceneState({ randomizeScene = false } = {}) {
  if (randomizeScene || !state.previewSceneId) {
    state.previewSceneId = pickRandomPreviewSceneId();
  }

  state.previewScenePlayerX = 320;
  state.previewSceneBaseYRatio = 0.74;
  state.previewSceneJumpOffset = 0;
  state.previewSceneJumpVelocity = 0;
  state.previewSceneFacing = 1;
  state.previewRenderLastTick = 0;
  clearPreviewSceneKeys();
  clearPreviewRuntimeState({ keepCatalog: true, keepAssets: true });
}

function triggerPreviewJump() {
  if (!state.activePreview || state.currentStage !== "preview") {
    return;
  }

  if (state.previewSceneJumpOffset > 0 || state.previewSceneJumpVelocity !== 0) {
    return;
  }

  state.previewSceneJumpVelocity = PREVIEW_SCENE_JUMP_VELOCITY;
  startPreviewLoop();
}

function updatePreviewSceneState(deltaSeconds) {
  if (!state.activePreview) {
    return;
  }

  const horizontalInput = Number(state.previewSceneKeys.right) - Number(state.previewSceneKeys.left);
  const verticalInput = Number(state.previewSceneKeys.down) - Number(state.previewSceneKeys.up);

  if (horizontalInput !== 0) {
    state.previewScenePlayerX = clamp(
      state.previewScenePlayerX + horizontalInput * PREVIEW_SCENE_MOVE_SPEED * deltaSeconds,
      0,
      PREVIEW_SCENE_WORLD_WIDTH,
    );
    state.previewSceneFacing = horizontalInput < 0 ? -1 : 1;
  }

  if (verticalInput !== 0) {
    state.previewSceneBaseYRatio = clamp(
      state.previewSceneBaseYRatio + verticalInput * PREVIEW_SCENE_VERTICAL_SPEED * deltaSeconds,
      0.58,
      0.82,
    );
  }

  if (state.previewSceneJumpOffset > 0 || state.previewSceneJumpVelocity !== 0) {
    state.previewSceneJumpOffset = Math.max(0, state.previewSceneJumpOffset + state.previewSceneJumpVelocity * deltaSeconds);
    state.previewSceneJumpVelocity -= PREVIEW_SCENE_GRAVITY * deltaSeconds;

    if (state.previewSceneJumpOffset === 0 && state.previewSceneJumpVelocity < 0) {
      state.previewSceneJumpVelocity = 0;
    }
  }
}

function isPreviewSceneGrounded() {
  return state.previewSceneJumpOffset === 0 && state.previewSceneJumpVelocity === 0;
}

function syncPreviewRuntimeActionState() {
  const availableActionIds = getPreviewRuntimeAvailableActionIds();
  if (availableActionIds.length === 0) {
    return;
  }

  if (!isPreviewSceneGrounded() && state.previewRuntimeLockedActionId) {
    state.previewRuntimeLockedActionId = null;
    state.previewRuntimeCompleted = false;
  }

  if (state.previewRuntimeLockedActionId && state.previewRuntimeCompleted) {
    state.previewRuntimeLockedActionId = null;
  }

  const horizontalInput = Number(state.previewSceneKeys.right) - Number(state.previewSceneKeys.left);
  const nextRuntimeAction = resolvePreviewRuntimeAction({
    availableActionIds,
    fallbackActionId: getPreviewRuntimeFallbackActionId(),
    lockedActionId: state.previewRuntimeLockedActionId,
    pendingActionId: state.previewRuntimePendingActionId,
    isGrounded: isPreviewSceneGrounded(),
    jumpVelocity: state.previewSceneJumpVelocity,
    horizontalInput,
    sprintPressed: state.previewSceneModifiers.sprint,
    crouchPressed: state.previewSceneModifiers.crouch,
  });

  const previousActionId = state.previewRuntimeActionId;
  setPreviewRuntimeAction(nextRuntimeAction.actionId, nextRuntimeAction.mode);

  if (state.previewRuntimeActionId === nextRuntimeAction.actionId) {
    if (nextRuntimeAction.consumePendingAction) {
      state.previewRuntimePendingActionId = null;
    }

    if (
      previousActionId !== state.previewRuntimeActionId &&
      isOneShotPreviewAction(state.previewRuntimeActionId)
    ) {
      state.previewRuntimeLockedActionId = state.previewRuntimeActionId;
    }
  }
}

function updatePreviewRuntimePlayback(timestamp) {
  const runtimeAsset = getCurrentRuntimePreviewAsset();
  if (!runtimeAsset || !Array.isArray(runtimeAsset.atlas?.frames) || runtimeAsset.atlas.frames.length === 0) {
    return;
  }

  if (state.previewPaused) {
    state.previewRuntimeLastTick = 0;
    return;
  }

  const stepMs = 1000 / state.previewFps;
  const frameCount = runtimeAsset.atlas.frames.length;
  const isLoop = Boolean(runtimeAsset.atlas.meta?.loop);

  if (state.previewRuntimeLastTick === 0) {
    state.previewRuntimeLastTick = timestamp;
    state.previewRuntimeFrameIndex = clamp(state.previewRuntimeFrameIndex, 0, frameCount - 1);
    return;
  }

  if (timestamp - state.previewRuntimeLastTick < stepMs) {
    return;
  }

  state.previewRuntimeLastTick = timestamp;

  if (isLoop) {
    state.previewRuntimeFrameIndex = state.previewRuntimeFrameIndex >= frameCount - 1 ? 0 : state.previewRuntimeFrameIndex + 1;
    state.previewRuntimeCompleted = false;
    return;
  }

  if (state.previewRuntimeFrameIndex >= frameCount - 1) {
    state.previewRuntimeFrameIndex = frameCount - 1;
    state.previewRuntimeCompleted = true;
    return;
  }

  state.previewRuntimeFrameIndex += 1;
  state.previewRuntimeCompleted = state.previewRuntimeFrameIndex >= frameCount - 1;
}

function drawContainedPreviewFrame(context, canvas, image, source, options = {}) {
  if (!image || !source?.w || !source?.h) {
    return null;
  }

  const padding = options.padding ?? 0;
  const maxWidth = Math.max(canvas.width - padding * 2, 1);
  const maxHeight = Math.max(canvas.height - padding * 2, 1);
  const scale = Math.min(maxWidth / source.w, maxHeight / source.h);
  const drawWidth = source.w * scale;
  const drawHeight = source.h * scale;
  const x =
    options.centerX != null ? options.centerX - drawWidth / 2 : options.x != null ? options.x : (canvas.width - drawWidth) / 2;
  const y =
    options.bottom != null
      ? options.bottom - drawHeight
      : options.y != null
        ? options.y
        : (canvas.height - drawHeight) / 2;

  if (!options.onlyMeasure) {
    context.save();
    if (options.flipX) {
      context.scale(-1, 1);
      context.drawImage(image, source.x, source.y, source.w, source.h, -(x + drawWidth), y, drawWidth, drawHeight);
    } else {
      context.drawImage(image, source.x, source.y, source.w, source.h, x, y, drawWidth, drawHeight);
    }
    context.restore();
  }
  return { x, y, width: drawWidth, height: drawHeight };
}

function clearPreviewSurfaces() {
  previewContext.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
  previewCompareContext.clearRect(0, 0, elements.previewCompareCanvas.width, elements.previewCompareCanvas.height);
  previewSceneContext.clearRect(0, 0, elements.previewSceneCanvas.width, elements.previewSceneCanvas.height);
  previewSheetContext.clearRect(0, 0, elements.previewSheetCanvas.width, elements.previewSheetCanvas.height);
}

function drawPreviewSceneProps(context, scene, width, floorTop, cameraX) {
  const spacing = scene.propKind === "pillar" ? 210 : 170;
  const baseOffset = (cameraX * 0.42) % spacing;

  context.fillStyle = scene.propColor;

  for (let x = -baseOffset - 48; x < width + spacing; x += spacing) {
    if (scene.propKind === "shrub") {
      context.beginPath();
      context.arc(x + 36, floorTop + 22, 16, 0, Math.PI * 2);
      context.arc(x + 56, floorTop + 16, 20, 0, Math.PI * 2);
      context.arc(x + 78, floorTop + 24, 14, 0, Math.PI * 2);
      context.fill();
      continue;
    }

    if (scene.propKind === "cactus") {
      context.fillRect(x + 40, floorTop - 20, 16, 58);
      context.fillRect(x + 24, floorTop, 12, 24);
      context.fillRect(x + 60, floorTop - 6, 12, 28);
      continue;
    }

    if (scene.propKind === "pillar") {
      context.fillRect(x + 42, floorTop - 52, 22, 88);
      context.fillRect(x + 34, floorTop - 56, 38, 10);
      context.fillRect(x + 36, floorTop + 26, 34, 10);
      context.fillStyle = "rgba(38, 47, 58, 0.38)";
      context.fillRect(x + 47, floorTop - 18, 2, 24);
      context.fillRect(x + 55, floorTop + 4, 2, 18);
      context.fillStyle = scene.propColor;
      continue;
    }

    if (scene.propKind === "pine") {
      context.beginPath();
      context.moveTo(x + 44, floorTop - 44);
      context.lineTo(x + 20, floorTop + 12);
      context.lineTo(x + 68, floorTop + 12);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(x + 44, floorTop - 70);
      context.lineTo(x + 24, floorTop - 10);
      context.lineTo(x + 64, floorTop - 10);
      context.closePath();
      context.fill();
      context.fillRect(x + 40, floorTop + 12, 8, 26);
    }
  }
}

function drawPreviewScene() {
  const canvas = elements.previewSceneCanvas;
  const context = previewSceneContext;
  const scene = getPreviewScene();
  const runtimeFrame = getCurrentRuntimePreviewFrame();
  const width = canvas.width;
  const height = canvas.height;
  const horizon = height * 0.58;
  const floorTop = height * 0.76;
  const baseY = clamp(height * state.previewSceneBaseYRatio, floorTop - 68, floorTop + 20);
  const cameraX = clamp(state.previewScenePlayerX - width * 0.34, 0, PREVIEW_SCENE_WORLD_WIDTH - width * 0.4);
  const laneOffset = (cameraX * 0.7) % 96;
  const spriteCenterX = clamp(state.previewScenePlayerX - cameraX, width * 0.2, width * 0.74);

  context.clearRect(0, 0, width, height);

  const skyGradient = context.createLinearGradient(0, 0, 0, height);
  skyGradient.addColorStop(0, scene.skyTop);
  skyGradient.addColorStop(0.45, scene.skyMid);
  skyGradient.addColorStop(1, scene.skyBottom);
  context.fillStyle = skyGradient;
  context.fillRect(0, 0, width, height);

  if (scene.id === "moonkeep") {
    context.fillStyle = "rgba(220, 230, 255, 0.55)";
    for (let index = 0; index < 14; index += 1) {
      const starX = ((index * 91) + 40) % width;
      const starY = 46 + ((index * 37) % 150);
      context.fillRect(starX, starY, 2, 2);
    }
  }

  context.fillStyle = scene.orbColor;
  context.beginPath();
  context.arc(width * scene.orbX, height * scene.orbY, height * scene.orbRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = scene.ridgeColor;
  context.beginPath();
  context.moveTo(0, height);
  context.lineTo(0, horizon);
  context.quadraticCurveTo(width * 0.12, horizon - (scene.id === "dunes" ? 40 : 82), width * 0.32, horizon - 18);
  context.quadraticCurveTo(width * 0.52, horizon + (scene.id === "dunes" ? 52 : 30), width * 0.72, horizon - 24);
  context.quadraticCurveTo(width * 0.88, horizon - (scene.id === "moonkeep" ? 86 : 62), width, horizon + 10);
  context.lineTo(width, height);
  context.closePath();
  context.fill();

  context.fillStyle = scene.hillColor;
  context.beginPath();
  context.moveTo(0, height);
  context.lineTo(0, floorTop - 54);
  context.quadraticCurveTo(width * 0.18, floorTop - (scene.id === "ruins" ? 82 : 110), width * 0.38, floorTop - 26);
  context.quadraticCurveTo(width * 0.62, floorTop + 32, width * 0.82, floorTop - (scene.id === "dunes" ? 20 : 42));
  context.quadraticCurveTo(width * 0.92, floorTop - 80, width, floorTop - 14);
  context.lineTo(width, height);
  context.closePath();
  context.fill();

  const floorGradient = context.createLinearGradient(0, floorTop, 0, height);
  floorGradient.addColorStop(0, scene.groundTop);
  floorGradient.addColorStop(1, scene.groundBottom);
  context.fillStyle = floorGradient;
  context.fillRect(0, floorTop, width, height - floorTop);

  context.strokeStyle = scene.laneColor;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, floorTop + 1);
  context.lineTo(width, floorTop + 1);
  context.stroke();

  context.save();
  context.beginPath();
  context.rect(0, floorTop, width, height - floorTop);
  context.clip();
  context.fillStyle = scene.laneColor;
  for (let x = -laneOffset; x < width + 120; x += 96) {
    context.fillRect(x, floorTop + 32, 48, 6);
  }
  context.fillStyle = scene.stripColor;
  for (let x = -laneOffset * 0.6; x < width + 200; x += 142) {
    context.fillRect(x, floorTop + 12, 84, 18);
  }
  context.restore();

  drawPreviewSceneProps(context, scene, width, floorTop, cameraX);

  if (!runtimeFrame?.frame?.frame) {
    return;
  }

  const placement = drawContainedPreviewFrame(context, canvas, runtimeFrame.asset.image, runtimeFrame.frame.frame, {
    padding: 48,
    centerX: spriteCenterX,
    bottom: baseY - state.previewSceneJumpOffset,
    onlyMeasure: true,
  });

  if (placement) {
    context.fillStyle = "rgba(11, 16, 24, 0.38)";
    context.beginPath();
    context.ellipse(placement.x + placement.width / 2, baseY + 12, placement.width * 0.24, 18, 0, 0, Math.PI * 2);
    context.fill();

    if ((state.previewSceneKeys.left || state.previewSceneKeys.right) && state.previewSceneJumpOffset === 0) {
      const dustAnchorX = state.previewSceneFacing < 0 ? placement.x + placement.width * 0.78 : placement.x + placement.width * 0.16;
      const dustBaseY = baseY + 4;
      context.fillStyle = "rgba(255, 225, 187, 0.14)";
      for (let index = 0; index < 3; index += 1) {
        const drift = (laneOffset * 0.14 + index * 20) % 68;
        const direction = state.previewSceneFacing < 0 ? 1 : -1;
        context.beginPath();
        context.arc(dustAnchorX + direction * drift, dustBaseY - index * 10, 4 + index, 0, Math.PI * 2);
        context.fill();
      }
    }

    drawContainedPreviewFrame(context, canvas, runtimeFrame.asset.image, runtimeFrame.frame.frame, {
      padding: 48,
      centerX: spriteCenterX,
      bottom: baseY - state.previewSceneJumpOffset,
      flipX: state.previewSceneFacing < 0,
    });
  }
}

function drawPreviewSheetOverview(frame) {
  const canvas = elements.previewSheetCanvas;
  const context = previewSheetContext;
  const image = state.previewSheetImage;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(14, 19, 29, 0.96)";
  context.fillRect(0, 0, canvas.width, canvas.height);

  if (!image || !frame?.frame) {
    return;
  }

  const padding = 18;
  const scale = Math.min((canvas.width - padding * 2) / image.width, (canvas.height - padding * 2) / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (canvas.width - drawWidth) / 2;
  const offsetY = (canvas.height - drawHeight) / 2;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  context.strokeStyle = "rgba(216, 161, 93, 0.96)";
  context.lineWidth = 3;
  context.strokeRect(
    offsetX + frame.frame.x * scale,
    offsetY + frame.frame.y * scale,
    frame.frame.w * scale,
    frame.frame.h * scale,
  );
}

function drawCurrentPreviewFrame() {
  if (!state.previewSheetImage || !state.previewAtlas || !state.activePreview) {
    clearPreviewSurfaces();
    renderPreviewControls();
    return;
  }

  const frame = getCurrentPreviewFrame();
  if (!frame) {
    return;
  }

  drawAssetFrameToCanvas({
    canvas: elements.previewCanvas,
    context: previewContext,
    detail: state.activePreview,
    atlas: state.previewAtlas,
    image: state.previewSheetImage,
    frameIndex: state.previewFrameIndex,
  });

  const compareSheet = getPreviewCompareSheet();
  const compareAsset = getPreviewCompareAsset();
  if (compareSheet && compareAsset) {
    const compareFrameIndex = mapPreviewComparisonFrameIndex(
      state.previewFrameIndex,
      getPreviewFrameCount(),
      Array.isArray(compareAsset.atlas?.frames) ? compareAsset.atlas.frames.length : 0,
    );
    drawAssetFrameToCanvas({
      canvas: elements.previewCompareCanvas,
      context: previewCompareContext,
      detail: compareSheet,
      atlas: compareAsset.atlas,
      image: compareAsset.image,
      frameIndex: compareFrameIndex,
    });
  } else {
    setPreviewCanvasSize(
      elements.previewCompareCanvas,
      compareSheet?.frameWidth || state.activePreview.frameWidth || 320,
      compareSheet?.frameHeight || state.activePreview.frameHeight || 400,
    );
    previewCompareContext.clearRect(0, 0, elements.previewCompareCanvas.width, elements.previewCompareCanvas.height);
  }

  drawPreviewScene();
  drawPreviewSheetOverview(frame);
  renderPreviewControls();
}

function resetPreview(message = "No generated result yet.") {
  stopPreviewLoop();
  state.activePreview = null;
  state.previewSheetImage = null;
  state.previewAtlas = null;
  state.previewLoopStart = 0;
  state.previewLoopEnd = 0;
  state.previewFrameIndex = 0;
  state.previewLastTick = 0;
  state.previewPaused = false;
  state.previewCompareId = null;
  state.previewSceneId = null;
  state.previewRenderLastTick = 0;
  clearPreviewSceneKeys();
  clearPreviewRuntimeState();
  clearPreviewSurfaces();
  elements.previewMeta.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
  renderPreviewSceneButtons();
  renderPreviewComparePanel();
  renderPreviewControls();
  renderPreviewPickers();
  renderPreviewAvailabilityState();
}

function startPreviewLoop() {
  if (!state.previewSheetImage || !state.previewAtlas || !state.activePreview || state.previewTimer) {
    return;
  }

  state.previewLastTick = 0;
  state.previewRenderLastTick = 0;
  state.previewTimer = requestAnimationFrame(drawPreviewFrame);
}

function setPreviewPaused(paused) {
  state.previewPaused = paused;
  state.previewLastTick = 0;
  startPreviewLoop();
  renderPreviewControls();
  drawCurrentPreviewFrame();
}

function drawPreviewFrame(timestamp) {
  if (!state.previewSheetImage || !state.previewAtlas || !state.activePreview) {
    state.previewTimer = null;
    return;
  }

  const deltaSeconds =
    state.previewRenderLastTick === 0 ? 1 / 60 : clamp((timestamp - state.previewRenderLastTick) / 1000, 1 / 240, 0.05);
  state.previewRenderLastTick = timestamp;

  updatePreviewSceneState(deltaSeconds);
  syncPreviewRuntimeActionState();
  updatePreviewRuntimePlayback(timestamp);

  if (state.previewPaused) {
    state.previewLastTick = 0;
  } else {
    const { loopStart, loopEnd } = getPreviewLoopBounds();
    const stepMs = 1000 / state.previewFps;

    if (state.previewLastTick === 0) {
      state.previewLastTick = timestamp;
      if (state.previewFrameIndex < loopStart || state.previewFrameIndex > loopEnd) {
        state.previewFrameIndex = loopStart;
      }
    } else if (timestamp - state.previewLastTick >= stepMs) {
      state.previewLastTick = timestamp;
      state.previewFrameIndex = state.previewFrameIndex >= loopEnd ? loopStart : state.previewFrameIndex + 1;
    }
  }

  drawCurrentPreviewFrame();
  state.previewTimer = requestAnimationFrame(drawPreviewFrame);
}

function handlePreviewLoadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  resetPreview(message);
}

async function loadPreview(spritesheetId) {
  try {
    const detail = await fetchJson(`/api/spritesheets/${spritesheetId}`);
    const atlas = await fetchJson(detail.atlasUrl);
    if (!Array.isArray(atlas.frames)) {
      throw new Error("Spritesheet atlas is invalid.");
    }
    const image = await loadImageElement(detail.sheetUrl);

    state.activePreview = detail;
    state.previewSheetImage = image;
    state.previewAtlas = atlas;
    state.previewLoopStart = 0;
    state.previewLoopEnd = Math.max(atlas.frames.length - 1, 0);
    state.previewFrameIndex = 0;
    state.previewLastTick = 0;
    state.previewPaused = false;
    resetPreviewSceneState({ randomizeScene: true });
    cachePreviewRuntimeAsset(detail, atlas, image);
    setPreviewRuntimeAction(detail.kind, detail.kind);
    primePreviewRuntimeAssets();
    syncPreviewCompareId();
    renderPreviewComparePanel();
    schedulePreviewCompareAssetLoad();

    elements.previewMeta.innerHTML = `
      <p class="eyebrow">Loaded Result</p>
      <h3>${escapeHtml(detail.name)} · ${escapeHtml(formatVersionLabel(detail))}</h3>
      <p class="muted">${detail.frameCount} frames ready for ${atlas.meta?.loop ? "continuous" : "one-shot"} playback.</p>
      <div class="preview-meta__facts">
        <span>${escapeHtml(formatFrameDimensions(detail))}</span>
        <span>${escapeHtml(`${detail.columns} columns`)}</span>
        <span>${escapeHtml(`${detail.rows} rows`)}</span>
        <span>${escapeHtml(detail.isSelectedVersion ? "Current export version" : "Preview only")}</span>
      </div>
    `;

    renderPreviewSceneButtons();
    renderPreviewPickers();
    renderPreviewAvailabilityState();
    focusPreviewSceneShell();
    drawCurrentPreviewFrame();
    startPreviewLoop();
  } catch (error) {
    handlePreviewLoadError(error);
  }
}

function syncActionSelectionsFromForm() {
  state.selectedStandardActionIds = Array.from(
    elements.generateForm.querySelectorAll("input[name='action-standard']:checked"),
  ).map((input) => input.value);
  state.selectedCustomActionIds = Array.from(
    elements.generateForm.querySelectorAll("input[name='action-custom']:checked"),
  ).map((input) => input.value);
  renderGenerateSummary();
  renderWorkspaceHeader();
}

function updatePreviewLoopFromInputs(changedEdge) {
  if (!state.activePreview || !state.previewAtlas) {
    return;
  }

  const start = Number(elements.previewRangeStart.value);
  const end = Number(elements.previewRangeEnd.value);

  if (changedEdge === "start" && start > end) {
    elements.previewRangeEnd.value = String(start);
  }

  if (changedEdge === "end" && end < start) {
    elements.previewRangeStart.value = String(end);
  }

  state.previewLoopStart = Number(elements.previewRangeStart.value);
  state.previewLoopEnd = Number(elements.previewRangeEnd.value);
  state.previewFrameIndex = Math.min(state.previewLoopStart, state.previewLoopEnd);
  state.previewLastTick = 0;
  drawCurrentPreviewFrame();
}

function updatePreviewFrameFromScrub() {
  if (!state.activePreview || !state.previewAtlas) {
    return;
  }

  state.previewFrameIndex = Number(elements.previewFrameScrub.value);
  state.previewLastTick = 0;
  setPreviewPaused(true);
}

function setPreviewScene(sceneId) {
  if (!PREVIEW_SCENES.some((scene) => scene.id === sceneId)) {
    return;
  }

  state.previewSceneId = sceneId;
  renderPreviewSceneButtons();
  drawCurrentPreviewFrame();
}

function isPreviewKeyboardTarget(target) {
  if (state.currentStage !== "preview" || !state.activePreview) {
    return false;
  }

  if (!(target instanceof HTMLElement)) {
    return true;
  }

  const tagName = target.tagName;
  return !["INPUT", "TEXTAREA", "SELECT"].includes(tagName) && !target.isContentEditable;
}

function getPreviewKeyMapping(key) {
  if (key === "a" || key === "arrowleft") {
    return "left";
  }
  if (key === "d" || key === "arrowright") {
    return "right";
  }
  if (key === "w" || key === "arrowup") {
    return "up";
  }
  if (key === "s" || key === "arrowdown") {
    return "down";
  }
  return null;
}

function maybeQueuePreviewModifierAction(modifierKey, actionId) {
  const availableActionIds = getPreviewRuntimeAvailableActionIds();
  if (!availableActionIds.includes(actionId)) {
    return;
  }

  const horizontalInput = Number(state.previewSceneKeys.right) - Number(state.previewSceneKeys.left);
  if (horizontalInput === 0 || !isPreviewSceneGrounded()) {
    return;
  }

  if (modifierKey === "dash") {
    queuePreviewRuntimeAction("dash");
    return;
  }

  if (modifierKey === "slide") {
    queuePreviewRuntimeAction("slide");
  }
}

document.addEventListener("click", (event) => {
  const workspaceStageButton = event.target.closest("[data-workspace-stage]");
  if (workspaceStageButton) {
    setStage(workspaceStageButton.dataset.workspaceStage, { force: true });
    return;
  }

  const workspacePreviewButton = event.target.closest("[data-workspace-preview-current]");
  if (workspacePreviewButton) {
    const previewId = workspacePreviewButton.dataset.workspacePreviewCurrent;
    if (previewId) {
      setStage("preview", { force: true });
      void loadPreview(previewId);
    }
    return;
  }

  if (event.target.closest("[data-workspace-export-package]")) {
    triggerCharacterExportDownload();
    return;
  }

  const stageButton = event.target.closest(".stage-tab[data-stage]");
  if (stageButton) {
    setStage(stageButton.dataset.stage);
    return;
  }

  const animateButton = event.target.closest(".animate-subtab[data-animate-panel]");
  if (animateButton) {
    setAnimatePanel(animateButton.dataset.animatePanel);
    return;
  }

  if (elements.previewSelectVersion && event.target.closest("#preview-select-version") && state.activePreview) {
    if (state.activePreview.isSelectedVersion) {
      setStage("spritesheets");
    } else {
      void selectSpritesheetVersion(state.activePreview.id, { openExports: true });
    }
    return;
  }

  if (elements.previewRedoMotion && event.target.closest("#preview-redo-motion") && state.activePreview) {
    void redoSpritesheetVersion(state.activePreview.id);
    return;
  }

  const selectVersionButton = event.target.closest("[data-select-spritesheet-id]");
  if (selectVersionButton) {
    void selectSpritesheetVersion(selectVersionButton.dataset.selectSpritesheetId);
    return;
  }

  const redoVersionButton = event.target.closest("[data-redo-spritesheet-id]");
  if (redoVersionButton) {
    void redoSpritesheetVersion(redoVersionButton.dataset.redoSpritesheetId);
    return;
  }

  const previewCompareButton = event.target.closest("[data-preview-compare-id]");
  if (previewCompareButton) {
    state.previewCompareId = previewCompareButton.dataset.previewCompareId;
    renderPreviewComparePanel();
    schedulePreviewCompareAssetLoad();
    drawCurrentPreviewFrame();
    return;
  }

  const animateMotionButton = event.target.closest("[data-animate-motion-key]");
  if (animateMotionButton) {
    state.animateFocusedMotionKey = animateMotionButton.dataset.animateMotionKey || null;
    renderAnimateConsequencePanel();
    drawAnimatePreviewFrame();
    return;
  }

  const previewButton = event.target.closest("[data-preview-id]");
  if (previewButton) {
    setStage("preview");
    void loadPreview(previewButton.dataset.previewId);
    return;
  }

  const previewToggle = event.target.closest("#preview-play-toggle, #preview-play-toggle-secondary");
  if (previewToggle) {
    setPreviewPaused(!state.previewPaused);
    focusPreviewSceneShell();
    return;
  }

  const sceneButton = event.target.closest("[data-preview-scene-id]");
  if (sceneButton) {
    setPreviewScene(sceneButton.dataset.previewSceneId);
    focusPreviewSceneShell();
    return;
  }

  if (event.target.closest("#preview-scene-shell")) {
    focusPreviewSceneShell();
    return;
  }

  const characterCard = event.target.closest(".character-card[data-character-id]");
  if (characterCard) {
    void selectCharacter(characterCard.dataset.characterId);
    return;
  }

  if (elements.newCharacterButton && event.target.closest("#new-character-button")) {
    setStage("character", { force: true });
    return;
  }

  if (elements.previewToExports && event.target.closest("#preview-to-exports")) {
    setStage("spritesheets");
    return;
  }

  if (
    (elements.previewDownloadPackage && event.target.closest("#preview-download-package")) ||
    (elements.exportsDownloadPackage && event.target.closest("#exports-download-package"))
  ) {
    triggerCharacterExportDownload();
    return;
  }

  if (elements.animateOpenPreview && event.target.closest("#animate-open-preview")) {
    const previewId = elements.animateOpenPreview.dataset.previewId;
    if (previewId) {
      setStage("preview");
      void loadPreview(previewId);
    }
    return;
  }
});

elements.generateForm.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.name === "action-standard" || input.name === "action-custom") {
    syncActionSelectionsFromForm();
  }
});

elements.previewRangeStart.addEventListener("input", () => {
  updatePreviewLoopFromInputs("start");
});

elements.previewRangeEnd.addEventListener("input", () => {
  updatePreviewLoopFromInputs("end");
});

elements.previewFrameScrub.addEventListener("input", () => {
  updatePreviewFrameFromScrub();
});

elements.previewFps.addEventListener("input", () => {
  state.previewFps = Number(elements.previewFps.value);
  renderPreviewControls();
});

window.addEventListener("keydown", (event) => {
  if (!isPreviewKeyboardTarget(event.target)) {
    return;
  }

  const normalizedKey = event.key.toLowerCase();
  const mappedKey = getPreviewKeyMapping(normalizedKey);

  if (normalizedKey === "shift") {
    event.preventDefault();
    state.previewSceneModifiers.sprint = true;
    if (!event.repeat) {
      maybeQueuePreviewModifierAction("dash", "dash");
    }
    startPreviewLoop();
    return;
  }

  if (normalizedKey === "c") {
    event.preventDefault();
    state.previewSceneModifiers.crouch = true;
    if (!event.repeat) {
      maybeQueuePreviewModifierAction("slide", "slide");
    }
    startPreviewLoop();
    return;
  }

  if ((normalizedKey === "j" || normalizedKey === "k") && !event.repeat) {
    if (!getPreviewRuntimeAvailableActionIds().includes("attack")) {
      return;
    }
    event.preventDefault();
    queuePreviewRuntimeAction("attack");
    return;
  }

  if (normalizedKey === "h" && !event.repeat) {
    if (!getPreviewRuntimeAvailableActionIds().includes("hurt")) {
      return;
    }
    event.preventDefault();
    queuePreviewRuntimeAction("hurt");
    return;
  }

  if (mappedKey) {
    event.preventDefault();
    state.previewSceneKeys[mappedKey] = true;
    if (!event.repeat && (mappedKey === "left" || mappedKey === "right")) {
      if (state.previewSceneModifiers.sprint) {
        maybeQueuePreviewModifierAction("dash", "dash");
      }
      if (state.previewSceneModifiers.crouch) {
        maybeQueuePreviewModifierAction("slide", "slide");
      }
    }
    startPreviewLoop();
    return;
  }

  if (normalizedKey === " " || normalizedKey === "spacebar" || normalizedKey === "space") {
    event.preventDefault();
    if (!event.repeat) {
      triggerPreviewJump();
    }
  }
});

window.addEventListener("keyup", (event) => {
  const normalizedKey = event.key.toLowerCase();
  const mappedKey = getPreviewKeyMapping(normalizedKey);

  if (normalizedKey === "shift") {
    state.previewSceneModifiers.sprint = false;
    return;
  }

  if (normalizedKey === "c") {
    state.previewSceneModifiers.crouch = false;
    return;
  }

  if (!mappedKey) {
    return;
  }

  state.previewSceneKeys[mappedKey] = false;
});

window.addEventListener("blur", () => {
  clearPreviewSceneKeys();
});

elements.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(elements.createForm);
  const prompt = String(formData.get("prompt") || "").trim();
  const imageFile = formData.get("image");
  const hasImage = imageFile instanceof File && imageFile.size > 0;
  if (!hasImage && !prompt) {
    setMessage(elements.createMessage, "Provide a character image or a prompt.", true);
    return;
  }
  formData.set("isHumanoid", String(document.querySelector("#is-humanoid").checked));
  formData.set("renderStyle", "pixel");
  setMessage(elements.createMessage, "Creating character...");

  try {
    const created = await fetchJson("/api/characters", {
      method: "POST",
      body: formData,
    });
    elements.createForm.reset();
    document.querySelector("#is-humanoid").checked = true;
    setMessage(elements.createMessage, `Created ${created.name}.`);
    await loadCharacters();
    await selectCharacter(created.id, { preferredStage: "animate" });
  } catch (error) {
    setMessage(elements.createMessage, error.message, true);
  }
});

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.netaToken = elements.authToken.value.trim();
  state.netaUser = null;

  if (state.netaToken) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, state.netaToken);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  renderAuthState();
  updateCustomFormState();
  await verifyNetaToken();
});

elements.poseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedCharacterId) {
    return;
  }

  const payload = new FormData(elements.poseForm);
  setMessage(elements.poseMessage, "Creating pose...");

  try {
    const pose = await fetchJson(`/api/characters/${state.selectedCharacterId}/poses`, {
      method: "POST",
      body: payload,
    });
    elements.poseForm.reset();
    setMessage(elements.poseMessage, "Pose created.");
    await loadPoses(state.selectedCharacterId);
    if (elements.customMode.value !== "auto" && !elements.customFirstPose.value) {
      elements.customFirstPose.value = pose.id;
    }
    await loadCustomAnimations(state.selectedCharacterId);
  } catch (error) {
    setMessage(elements.poseMessage, error.message, true);
  }
});

elements.customMode.addEventListener("change", () => {
  updateCustomFormState();
});

elements.customLoop.addEventListener("change", () => {
  updateCustomFormState();
});

elements.customForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedCharacterId) {
    return;
  }

  const payload = {
    name: elements.customForm.querySelector("#custom-name").value.trim(),
    prompt: elements.customForm.querySelector("#custom-prompt").value.trim(),
    mode: elements.customMode.value,
    loop: elements.customLoop.checked,
  };

  const firstPoseId = elements.customFirstPose.value.trim();
  const lastPoseId = elements.customLastPose.value.trim();
  if (!elements.customFirstPose.disabled && firstPoseId) {
    payload.poseId = firstPoseId;
  }
  if (!elements.customLastPose.disabled && lastPoseId) {
    payload.lastFramePoseId = lastPoseId;
  }

  setMessage(elements.customMessage, "Saving custom action...");

  try {
    const created = await fetchJson(`/api/characters/${state.selectedCharacterId}/custom-animations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    elements.customForm.reset();
    elements.customMode.value = "auto";
    elements.customLoop.checked = false;
    setMessage(elements.customMessage, "Custom action saved.");
    await loadCustomAnimations(state.selectedCharacterId);
    state.selectedCustomActionIds = [created.id];
    renderActionList();
    updateCustomFormState();
    setAnimatePanel("select");
  } catch (error) {
    setMessage(elements.customMessage, error.message, true);
  }
});

elements.generateForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.selectedCharacterId) {
    return;
  }

  const animations = [
    ...state.selectedStandardActionIds,
    ...state.selectedCustomActionIds.map((customAnimationId) => ({
      kind: "custom",
      customAnimationId,
    })),
  ];

  if (animations.length === 0) {
    setMessage(elements.generateMessage, "Pick at least one standard or custom action.", true);
    return;
  }

  setMessage(elements.generateMessage, "Submitting generation jobs...");
  try {
    const response = await fetchJson(`/api/characters/${state.selectedCharacterId}/spritesheets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        animations,
      }),
    });
    state.pendingPreview = response.workflows[0]
      ? {
          jobId: response.workflows[0].jobId,
          sheetId: null,
        }
      : null;
    setMessage(elements.generateMessage, `Generation started for ${pluralize(response.workflows.length, "motion")}.`);
    await loadJobs(state.selectedCharacterId);
    setStage("preview", { force: true });
    startPolling();
  } catch (error) {
    setMessage(elements.generateMessage, error.message, true);
  }
});

async function boot() {
  state.netaToken = window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  elements.authToken.value = state.netaToken;
  updateCustomPoseOptions();
  renderAuthState();
  renderWorkspaceSummary();
  renderAllJobLists();
  renderPreviewPickers();
  renderSpritesheets();
  renderActionList();
  renderPreviewSceneButtons();
  renderStageShell();
  setAnimatePanel("select");
  updateCustomFormState();

  await Promise.all([loadHealth(), loadSupportedActions(), loadCharacters()]);

  if (state.generationBackend === "neta" && state.netaToken) {
    await verifyNetaToken();
  }
}

void boot();
