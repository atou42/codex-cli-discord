const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { HttpError, toErrorPayload } = require("./lib/http-error");
const { createPaths } = require("./lib/paths");
const { ensureAppPaths, writeBufferAtomic } = require("./lib/fs-store");
const { createRepositories } = require("./lib/repositories");
const { analyzeCharacterImage, assertReadableImage } = require("./lib/analysis");
const { newId } = require("./lib/id");
const { createNetaClient, DEFAULT_API_BASE_URL } = require("./lib/neta-client");
const {
  annotateSpritesheetsForCharacter,
  getSpritesheetVariantKey,
  withSelectedSpritesheetForCharacter,
} = require("./lib/spritesheet-versions");
const { deriveWorkspaceSummary } = require("../../public/workspace-state");
const {
  ACTION_PRESETS,
  DEFAULT_RENDER_STYLE,
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_WIDTH,
  RESERVED_ACTION_NAMES,
  createPoseFromPrompt,
  getActionPreset,
  getSupportedActions,
} = require("./lib/sprite-engine");
const { createJobRunner } = require("./lib/job-runner");
const { buildCharacterExportPackage } = require("./lib/export-package");

function parseAnimationInput(body) {
  if (Array.isArray(body.actions)) {
    return body.actions;
  }

  if (Array.isArray(body.animations)) {
    return body.animations;
  }

  return [];
}

function normalizeActionRequest(input) {
  const action = String(input || "").trim().toLowerCase();
  if (!action) {
    throw new HttpError(400, "Animation kind is required.", "MISSING_ANIMATIONS");
  }
  return getActionPreset(action) && action;
}

function parseBoundedInteger(value, fallback, { minimum, maximum, code, label }) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new HttpError(400, `${label} must be an integer between ${minimum} and ${maximum}.`, code);
  }
  return parsed;
}

function normalizeName(value) {
  return String(value || "").trim();
}

function parseFrameDimensions(body, preset = null) {
  const defaultFrameWidth = preset?.frameWidth || DEFAULT_FRAME_WIDTH;
  const defaultFrameHeight = preset?.frameHeight || DEFAULT_FRAME_HEIGHT;
  const hasExplicitWidth = body.frameWidth !== undefined && body.frameWidth !== null && body.frameWidth !== "";
  const hasExplicitHeight = body.frameHeight !== undefined && body.frameHeight !== null && body.frameHeight !== "";

  if (hasExplicitWidth || hasExplicitHeight) {
    return {
      frameWidth: parseBoundedInteger(body.frameWidth, defaultFrameWidth, {
        minimum: 192,
        maximum: 1024,
        code: "INVALID_FRAME_WIDTH",
        label: "frameWidth",
      }),
      frameHeight: parseBoundedInteger(body.frameHeight, defaultFrameHeight, {
        minimum: 256,
        maximum: 1280,
        code: "INVALID_FRAME_HEIGHT",
        label: "frameHeight",
      }),
    };
  }

  if (body.frameSize !== undefined && body.frameSize !== null && body.frameSize !== "") {
    const frameSize = parseBoundedInteger(body.frameSize, null, {
      minimum: 64,
      maximum: 1024,
      code: "INVALID_FRAME_SIZE",
      label: "frameSize",
    });
    return {
      frameWidth: frameSize,
      frameHeight: frameSize,
    };
  }

  return {
    frameWidth: defaultFrameWidth,
    frameHeight: defaultFrameHeight,
  };
}

function getRemoteFileExtension(fileUrl, fallback = ".png") {
  try {
    const parsed = new URL(fileUrl);
    return path.extname(parsed.pathname) || fallback;
  } catch (_error) {
    return fallback;
  }
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  throw new HttpError(400, "Boolean field is invalid.", "INVALID_BOOLEAN");
}

function parseCustomMode(value) {
  const normalized = String(value || "").trim();
  const supported = new Set(["auto", "first_frame_only", "first_and_last_frame"]);
  if (!supported.has(normalized)) {
    throw new HttpError(400, "Custom animation mode is invalid.", "INVALID_CUSTOM_MODE");
  }
  return normalized;
}

function parseRenderStyle(value, fallback = DEFAULT_RENDER_STYLE) {
  const normalized = String(value || fallback).trim().toLowerCase();
  const supported = new Set(["pixel", "illustration"]);
  if (!supported.has(normalized)) {
    throw new HttpError(400, "Render style is invalid.", "INVALID_RENDER_STYLE");
  }
  return normalized;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}".`);
  }
  return parsed;
}

function getGenerationBackend(options) {
  return options.generationBackend || process.env.AUTOSPRITE_GENERATION_BACKEND || "neta";
}

function getRequestedNetaToken(request) {
  const token = request.headers["x-neta-token"];
  return typeof token === "string" ? token.trim() : "";
}

function ensureNetaToken(request) {
  const token = getRequestedNetaToken(request);
  if (!token) {
    throw new HttpError(401, "Fill in your Neta token before generating.", "MISSING_NETA_TOKEN");
  }
  return token;
}

function isUnsafePublicHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  );
}

function resolvePublicBaseUrl(request, configuredPublicBaseUrl) {
  const candidate =
    configuredPublicBaseUrl ||
    (() => {
      const host = request.get("x-forwarded-host") || request.get("host");
      const protocol = request.get("x-forwarded-proto") || request.protocol;
      if (!host) {
        return null;
      }
      return `${protocol}://${host}`;
    })();

  if (!candidate) {
    throw new HttpError(
      400,
      "Public base URL is required for Neta generation. Set AUTOSPRITE_PUBLIC_BASE_URL before deploy.",
      "MISSING_PUBLIC_BASE_URL",
    );
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    throw new HttpError(400, "Public base URL is invalid.", "INVALID_PUBLIC_BASE_URL");
  }

  if (isUnsafePublicHost(parsed.hostname)) {
    throw new HttpError(
      400,
      "Neta generation needs a public AUTOSPRITE_PUBLIC_BASE_URL, not localhost.",
      "INVALID_PUBLIC_BASE_URL",
    );
  }

  return parsed.toString().replace(/\/$/, "");
}

function resolveOptionalPublicBaseUrl(request, configuredPublicBaseUrl) {
  if (configuredPublicBaseUrl) {
    return resolvePublicBaseUrl(request, configuredPublicBaseUrl);
  }

  const host = request.get("x-forwarded-host") || request.get("host");
  const protocol = request.get("x-forwarded-proto") || request.protocol;
  if (!host) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(`${protocol}://${host}`);
  } catch (_error) {
    return null;
  }

  if (isUnsafePublicHost(parsed.hostname)) {
    return null;
  }

  return parsed.toString().replace(/\/$/, "");
}

async function createApp(options = {}) {
  const paths = createPaths(options.baseDir || process.cwd());
  await ensureAppPaths(paths);

  const repositories = createRepositories(paths);
  const generationBackend = getGenerationBackend(options);
  const configuredPublicBaseUrl = options.publicBaseUrl || process.env.AUTOSPRITE_PUBLIC_BASE_URL || "";
  const netaApiBaseUrl = options.netaApiBaseUrl || process.env.NETA_API_BASE_URL || DEFAULT_API_BASE_URL;
  const maxConcurrentJobs = parsePositiveInteger(
    options.maxConcurrentJobs ?? process.env.AUTOSPRITE_MAX_CONCURRENT_JOBS,
    1,
  );
  const jobStepDelayMs = parsePositiveInteger(options.jobStepDelayMs, 20);
  const jobRunner = createJobRunner({
    paths,
    repositories,
    generationBackend,
    netaApiBaseUrl,
    maxConcurrentJobs,
    stepDelayMs: jobStepDelayMs,
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 8 * 1024 * 1024,
    },
  });
  const app = express();

  async function listCharacterEntities(type, characterId) {
    return (await repositories.list(type)).filter((item) => item.characterId === characterId);
  }

  async function buildCharacterWorkspaceSummary(characterId) {
    const [jobs, spritesheets] = await Promise.all([
      listCharacterEntities("jobs", characterId),
      listCharacterEntities("spritesheets", characterId),
    ]);

    return deriveWorkspaceSummary({ jobs, spritesheets });
  }

  async function annotateCharacterWithWorkspaceSummary(character) {
    if (!character?.id) {
      return character;
    }

    return {
      ...character,
      workspaceSummary: await buildCharacterWorkspaceSummary(character.id),
    };
  }

  async function annotateCharactersWithWorkspaceSummaries(characters) {
    const [jobs, spritesheets] = await Promise.all([repositories.list("jobs"), repositories.list("spritesheets")]);
    const jobsByCharacterId = new Map();
    const spritesheetsByCharacterId = new Map();

    for (const job of jobs) {
      if (!job?.characterId) {
        continue;
      }
      const items = jobsByCharacterId.get(job.characterId) || [];
      items.push(job);
      jobsByCharacterId.set(job.characterId, items);
    }

    for (const spritesheet of spritesheets) {
      if (!spritesheet?.characterId) {
        continue;
      }
      const items = spritesheetsByCharacterId.get(spritesheet.characterId) || [];
      items.push(spritesheet);
      spritesheetsByCharacterId.set(spritesheet.characterId, items);
    }

    return (Array.isArray(characters) ? characters : []).map((character) => ({
      ...character,
      workspaceSummary: deriveWorkspaceSummary({
        jobs: jobsByCharacterId.get(character.id) || [],
        spritesheets: spritesheetsByCharacterId.get(character.id) || [],
      }),
    }));
  }

  async function mustGetCharacter(characterId) {
    return repositories.mustGet("characters", characterId, "Character");
  }

  async function mustGetPoseForCharacter(characterId, poseId) {
    const pose = await repositories.mustGet("poses", poseId, "Pose");
    if (pose.characterId !== characterId) {
      throw new HttpError(404, "Pose not found.", "NOT_FOUND");
    }
    return pose;
  }

  async function listCharacterSpritesheets(character) {
    return listCharacterEntities("spritesheets", character.id);
  }

  async function listAnnotatedCharacterSpritesheets(character) {
    return annotateSpritesheetsForCharacter(character, await listCharacterSpritesheets(character));
  }

  async function mustGetCharacterSpritesheet(characterId, spritesheetId) {
    const spritesheet = await repositories.mustGet("spritesheets", spritesheetId, "Spritesheet");
    if (spritesheet.characterId !== characterId) {
      throw new HttpError(404, "Spritesheet not found.", "NOT_FOUND");
    }
    return spritesheet;
  }

  function buildRedoDescriptorFromSpritesheet(spritesheet) {
    if (!spritesheet || !spritesheet.id) {
      throw new HttpError(400, "Spritesheet is required to redo a version.", "INVALID_SPRITESHEET");
    }

    if (spritesheet.requestKind === "custom" || spritesheet.kind === "custom") {
      if (!spritesheet.customAnimationId) {
        throw new HttpError(400, "Custom spritesheet is missing its custom animation id.", "INVALID_SPRITESHEET");
      }

      return {
        requestKind: "custom",
        action: "custom",
        label: spritesheet.name,
        prompt: spritesheet.prompt,
        mode: spritesheet.mode || null,
        loop: spritesheet.loop,
        poseId: spritesheet.poseId || null,
        lastFramePoseId: spritesheet.lastFramePoseId || null,
        customAnimationId: spritesheet.customAnimationId,
      };
    }

    const action = normalizeActionRequest(spritesheet.kind);
    return {
      requestKind: "standard",
      action,
      label: ACTION_PRESETS[action].label,
      loop: ACTION_PRESETS[action].loop,
    };
  }

  async function createAnimationWorkflow({
    character,
    descriptor,
    frameCount,
    frameWidth,
    frameHeight,
    netaToken,
    publicBaseUrl,
    redoOfSpritesheetId = null,
  }) {
    const jobId = newId("job");
    const outputId = newId("ss");
    const job = {
      id: jobId,
      jobId,
      type: "animation_generation",
      status: "queued",
      progress: 0,
      error: null,
      characterId: character.id,
      outputId,
      redoOfSpritesheetId,
      request: {
        ...descriptor,
        frameCount,
        frameWidth,
        frameHeight,
        renderStyle: parseRenderStyle(character.renderStyle, DEFAULT_RENDER_STYLE),
      },
      steps: jobRunner.createInitialSteps(),
      resultIds: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    await repositories.save("jobs", job);
    jobRunner.queueAnimationJob(jobId, {
      netaToken,
      publicBaseUrl,
    });

    return {
      jobId,
      kind: descriptor.action,
      name: descriptor.label,
      customAnimationId: descriptor.customAnimationId || null,
      redoOfSpritesheetId,
    };
  }

  async function createPoseRecord({
    characterId,
    name,
    sourceType,
    prompt,
    imagePath,
    imageUrl,
    renderStyle = DEFAULT_RENDER_STYLE,
    generationBackend = null,
    upstreamTaskId = null,
    upstreamArtifactUrl = null,
  }) {
    const pose = {
      id: newId("pose"),
      characterId,
      name,
      sourceType,
      prompt: prompt || null,
      imagePath,
      imageUrl,
      renderStyle,
      generationBackend,
      upstreamTaskId,
      upstreamArtifactUrl,
      createdAt: new Date().toISOString(),
    };
    await repositories.save("poses", pose);
    return pose;
  }

  async function assertUniqueCharacterName(name) {
    const existingCharacters = await repositories.list("characters");
    const duplicate = existingCharacters.find((character) => character.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      throw new HttpError(409, "Character name already exists.", "DUPLICATE_CHARACTER");
    }
  }

  async function downloadRemoteImageBuffer(url, { message, code }) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new HttpError(502, message, code);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await assertReadableImage(buffer);
    return buffer;
  }

  async function createCharacterFromImage({
    name,
    description,
    imageBuffer,
    extension,
    renderStyle = DEFAULT_RENDER_STYLE,
    isHumanoid,
    sourceType,
    prompt = null,
    generationBackend: characterGenerationBackend = null,
    upstreamTaskId = null,
    upstreamArtifactUrl = null,
  }) {
    const analysis = await analyzeCharacterImage(imageBuffer);
    const characterId = newId("char");
    const normalizedExtension = extension || ".png";
    const uploadRelativePath = path.join("runtime", "storage", "uploads", `${characterId}${normalizedExtension}`);
    const uploadAbsolutePath = path.join(paths.baseDir, uploadRelativePath);
    await writeBufferAtomic(uploadAbsolutePath, imageBuffer);

    const character = {
      id: characterId,
      name,
      characterDescription: description || null,
      isHumanoid: typeof isHumanoid === "boolean" ? isHumanoid : analysis.isHumanoidGuess,
      analysis,
      imagePath: uploadRelativePath,
      baseImageUrl: `/files/uploads/${characterId}${normalizedExtension}`,
      thumbnailUrl: `/files/uploads/${characterId}${normalizedExtension}`,
      sourceType,
      prompt: prompt || null,
      renderStyle,
      selectedSpritesheetIdsByVariant: {},
      generationBackend: characterGenerationBackend,
      upstreamTaskId,
      upstreamArtifactUrl,
      createdAt: new Date().toISOString(),
    };

    await repositories.save("characters", character);
    await createPoseRecord({
      characterId: character.id,
      name: "Original",
      sourceType: "original",
      imagePath: uploadRelativePath,
      imageUrl: character.baseImageUrl,
      renderStyle,
      generationBackend: characterGenerationBackend,
      upstreamTaskId,
      upstreamArtifactUrl,
    });

    return character;
  }

  async function createUploadedPose({ character, file, name }) {
    if (!file) {
      throw new HttpError(400, "Pose image is required.", "MISSING_POSE_INPUT");
    }

    if (!file.mimetype.startsWith("image/")) {
      throw new HttpError(400, "Uploaded pose must be an image.", "INVALID_IMAGE");
    }

    await assertReadableImage(file.buffer);
    const poseId = newId("pose");
    const extension = path.extname(file.originalname || ".png") || ".png";
    const poseRelativePath = path.join("runtime", "storage", "poses", `${poseId}${extension}`);
    const poseAbsolutePath = path.join(paths.baseDir, poseRelativePath);
    await writeBufferAtomic(poseAbsolutePath, file.buffer);

    return createPoseRecord({
      characterId: character.id,
      name: name || "Uploaded pose",
      sourceType: "upload",
      imagePath: poseRelativePath,
      imageUrl: `/files/poses/${poseId}${extension}`,
      renderStyle: character.renderStyle || DEFAULT_RENDER_STYLE,
      generationBackend: "upload",
    });
  }

  async function createGeneratedPose({ character, prompt, name }) {
    const posePrompt = normalizeName(prompt);
    if (!posePrompt) {
      throw new HttpError(400, "Pose prompt is required.", "MISSING_POSE_INPUT");
    }

    const poseId = newId("pose");
    const poseRelativePath = path.join("runtime", "storage", "poses", `${poseId}.png`);
    const poseAbsolutePath = path.join(paths.baseDir, poseRelativePath);
    await createPoseFromPrompt({
      characterImagePath: path.join(paths.baseDir, character.imagePath),
      prompt: posePrompt,
      outputPath: poseAbsolutePath,
      frameWidth: 320,
      frameHeight: 400,
      renderStyle: character.renderStyle || DEFAULT_RENDER_STYLE,
    });

    return createPoseRecord({
      characterId: character.id,
      name: name || "Generated pose",
      sourceType: "generate",
      prompt: posePrompt,
      imagePath: poseRelativePath,
      imageUrl: `/files/poses/${poseId}.png`,
      renderStyle: character.renderStyle || DEFAULT_RENDER_STYLE,
      generationBackend: "local",
    });
  }

  async function createGeneratedPoseWithNeta({ character, prompt, name, token, publicBaseUrl }) {
    const posePrompt = normalizeName(prompt);
    if (!posePrompt) {
      throw new HttpError(400, "Pose prompt is required.", "MISSING_POSE_INPUT");
    }

    const poseId = newId("pose");
    const poseRelativePath = path.join("runtime", "storage", "poses", `${poseId}.png`);
    const poseAbsolutePath = path.join(paths.baseDir, poseRelativePath);
    const neta = createNetaClient({
      token,
      apiBaseUrl: netaApiBaseUrl,
    });
    const sourceImageUrl = publicBaseUrl
      ? new URL(character.baseImageUrl, `${publicBaseUrl}/`).toString()
      : (
          await neta.uploadImageFromFile({
            filePath: path.join(paths.baseDir, character.imagePath),
          })
        ).url;
    const result = await neta.generatePoseFromImage({
      imageUrl: sourceImageUrl,
      prompt: posePrompt,
      renderStyle: character.renderStyle || DEFAULT_RENDER_STYLE,
    });

    const imageBuffer = await downloadRemoteImageBuffer(result.imageUrl, {
      message: "Could not download generated pose from Neta.",
      code: "NETA_DOWNLOAD_FAILED",
    });
    await writeBufferAtomic(poseAbsolutePath, imageBuffer);

    return createPoseRecord({
      characterId: character.id,
      name: name || "Generated pose",
      sourceType: "generate",
      prompt: posePrompt,
      imagePath: poseRelativePath,
      imageUrl: `/files/poses/${poseId}.png`,
      renderStyle: character.renderStyle || DEFAULT_RENDER_STYLE,
      generationBackend: "neta",
      upstreamTaskId: result.taskId,
      upstreamArtifactUrl: result.imageUrl,
    });
  }

  async function resolveAnimationDescriptor(character, input) {
    if (typeof input === "string") {
      const action = normalizeActionRequest(input);
      return {
        requestKind: "standard",
        action,
        label: ACTION_PRESETS[action].label,
        loop: ACTION_PRESETS[action].loop,
      };
    }

    if (!input || typeof input !== "object") {
      throw new HttpError(400, "Animation entry is invalid.", "INVALID_ANIMATION");
    }

    if (input.kind === "custom") {
      const customAnimationId = normalizeName(input.customAnimationId);
      if (!customAnimationId) {
        throw new HttpError(400, "Custom animation id is required.", "MISSING_CUSTOM_ANIMATION_ID");
      }

      const customAnimation = await repositories.mustGet("customAnimations", customAnimationId, "Custom animation");
      if (customAnimation.characterId !== character.id) {
        throw new HttpError(404, "Custom animation not found.", "NOT_FOUND");
      }

      return {
        requestKind: "custom",
        action: "custom",
        label: customAnimation.name,
        prompt: customAnimation.prompt,
        mode: customAnimation.mode,
        loop: customAnimation.loop,
        poseId: customAnimation.poseId,
        lastFramePoseId: customAnimation.lastFramePoseId,
        customAnimationId: customAnimation.id,
      };
    }

    const action = normalizeActionRequest(input.kind);
    return {
      requestKind: "standard",
      action,
      label: ACTION_PRESETS[action].label,
      loop: ACTION_PRESETS[action].loop,
    };
  }

  app.use(express.json());
  app.get("/favicon.ico", (_request, response) => {
    response.status(204).end();
  });
  app.use("/files", express.static(paths.storageDir, { fallthrough: false }));
  app.use(express.static(paths.publicDir));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      phase: "phase-2",
      generationBackend,
      maxConcurrentJobs,
      supportedActions: getSupportedActions(),
    });
  });

  app.get("/api/neta/me", async (request, response) => {
    if (generationBackend !== "neta") {
      response.json({
        connected: false,
        backend: generationBackend,
      });
      return;
    }

    const token = ensureNetaToken(request);
    const neta = createNetaClient({
      token,
      apiBaseUrl: netaApiBaseUrl,
    });
    const user = await neta.getCurrentUser();
    response.json({
      connected: true,
      backend: generationBackend,
      user: {
        uuid: user.uuid,
        nickName: user.nick_name || user.name || null,
        avatarUrl: user.avatar_url || null,
        email: user.email || null,
      },
    });
  });

  app.get("/api/supported-actions", (_request, response) => {
    response.json({
      actions: getSupportedActions().map((action) => ({
        id: action,
        ...ACTION_PRESETS[action],
      })),
    });
  });

  app.get("/api/characters", async (_request, response) => {
    const characters = await annotateCharactersWithWorkspaceSummaries(await repositories.list("characters"));
    response.json({ characters });
  });

  app.post("/api/characters", upload.single("image"), async (request, response) => {
    const { file } = request;
    const name = normalizeName(request.body.name);
    const description = normalizeName(request.body.characterDescription);
    const prompt = normalizeName(request.body.prompt);
    const renderStyle = parseRenderStyle(request.body.renderStyle, DEFAULT_RENDER_STYLE);

    if (!name) {
      throw new HttpError(400, "Character name is required.", "MISSING_NAME");
    }

    await assertUniqueCharacterName(name);
    const isHumanoid = request.body.isHumanoid === "false" ? false : null;

    if (file) {
      if (!file.mimetype.startsWith("image/")) {
        throw new HttpError(400, "Uploaded file must be an image.", "INVALID_IMAGE");
      }

      const character = await createCharacterFromImage({
        name,
        description,
        imageBuffer: file.buffer,
        extension: path.extname(file.originalname || ".png") || ".png",
        renderStyle,
        isHumanoid,
        sourceType: "upload",
        generationBackend: "upload",
      });
      response.status(201).json(character);
      return;
    }

    if (prompt) {
      if (generationBackend !== "neta") {
        throw new HttpError(
          400,
          "Prompt character generation is only available with the Neta backend.",
          "PROMPT_CHARACTER_BACKEND_UNAVAILABLE",
        );
      }

      const neta = createNetaClient({
        token: ensureNetaToken(request),
        apiBaseUrl: netaApiBaseUrl,
      });
      const result = await neta.generateCharacterImage({
        prompt,
        renderStyle,
      });
      const imageBuffer = await downloadRemoteImageBuffer(result.imageUrl, {
        message: "Could not download generated character from Neta.",
        code: "NETA_DOWNLOAD_FAILED",
      });
      const character = await createCharacterFromImage({
        name,
        description,
        imageBuffer,
        extension: getRemoteFileExtension(result.imageUrl),
        renderStyle,
        isHumanoid,
        sourceType: "generate",
        prompt,
        generationBackend: "neta",
        upstreamTaskId: result.taskId,
        upstreamArtifactUrl: result.imageUrl,
      });
      response.status(201).json(character);
      return;
    }

    throw new HttpError(400, "Provide a character image or a prompt.", "MISSING_CHARACTER_INPUT");
  });

  app.get("/api/characters/:characterId", async (request, response) => {
    const character = await annotateCharacterWithWorkspaceSummary(await mustGetCharacter(request.params.characterId));
    response.json(character);
  });

  app.get("/api/characters/:characterId/poses", async (request, response) => {
    await mustGetCharacter(request.params.characterId);
    const poses = await listCharacterEntities("poses", request.params.characterId);
    response.json({ poses });
  });

  app.post("/api/characters/:characterId/poses", upload.single("image"), async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const name = normalizeName(request.body.name);
    const prompt = normalizeName(request.body.prompt);

    let pose;
    if (request.file) {
      pose = await createUploadedPose({ character, file: request.file, name });
    } else if (prompt) {
      if (generationBackend === "neta") {
        pose = await createGeneratedPoseWithNeta({
          character,
          prompt,
          name,
          token: ensureNetaToken(request),
          publicBaseUrl: resolveOptionalPublicBaseUrl(request, configuredPublicBaseUrl),
        });
      } else {
        pose = await createGeneratedPose({ character, prompt, name });
      }
    } else {
      throw new HttpError(400, "Provide a pose image or a pose prompt.", "MISSING_POSE_INPUT");
    }

    response.status(201).json(pose);
  });

  app.get("/api/characters/:characterId/custom-animations", async (request, response) => {
    await mustGetCharacter(request.params.characterId);
    const customAnimations = await listCharacterEntities("customAnimations", request.params.characterId);
    response.json({ customAnimations });
  });

  app.post("/api/characters/:characterId/custom-animations", async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const name = normalizeName(request.body.name);
    const prompt = normalizeName(request.body.prompt);
    const mode = parseCustomMode(request.body.mode);
    const loop = parseBoolean(request.body.loop, false);
    let poseId = normalizeName(request.body.poseId) || null;
    let lastFramePoseId = normalizeName(request.body.lastFramePoseId) || null;

    if (!name) {
      throw new HttpError(400, "Custom animation name is required.", "MISSING_CUSTOM_NAME");
    }

    if (RESERVED_ACTION_NAMES.has(name.toLowerCase())) {
      throw new HttpError(400, "Custom animation name cannot reuse a standard action.", "RESERVED_ANIMATION_NAME");
    }

    if (!prompt) {
      throw new HttpError(400, "Custom animation prompt is required.", "MISSING_PROMPT");
    }

    const existingCustomAnimations = await listCharacterEntities("customAnimations", character.id);
    const duplicate = existingCustomAnimations.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      throw new HttpError(409, "Custom animation name already exists.", "DUPLICATE_CUSTOM_ANIMATION");
    }

    if (mode === "auto") {
      poseId = null;
      lastFramePoseId = null;
    }

    if (mode !== "auto" && !poseId) {
      throw new HttpError(400, "A first-frame pose is required for this mode.", "MISSING_FIRST_FRAME_POSE");
    }

    if (mode === "first_frame_only") {
      lastFramePoseId = null;
    }

    if (mode === "first_and_last_frame" && !loop && !lastFramePoseId) {
      throw new HttpError(400, "A last-frame pose is required when loop is off.", "MISSING_LAST_FRAME_POSE");
    }

    if (poseId) {
      await mustGetPoseForCharacter(character.id, poseId);
    }

    if (lastFramePoseId) {
      await mustGetPoseForCharacter(character.id, lastFramePoseId);
    }

    const customAnimation = {
      id: newId("ca"),
      characterId: character.id,
      name,
      prompt,
      mode,
      poseId,
      lastFramePoseId,
      loop,
      createdAt: new Date().toISOString(),
    };

    await repositories.save("customAnimations", customAnimation);
    response.status(201).json(customAnimation);
  });

  app.post("/api/characters/:characterId/spritesheets", async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const requestedAnimations = parseAnimationInput(request.body);

    if (requestedAnimations.length === 0) {
      throw new HttpError(400, "At least one animation is required.", "MISSING_ANIMATIONS");
    }

    if (requestedAnimations.length > 5) {
      throw new HttpError(400, "This MVP supports at most 5 animations at once.", "TOO_MANY_ANIMATIONS");
    }

    const workflows = [];
    const publicBaseUrl =
      generationBackend === "neta" ? resolveOptionalPublicBaseUrl(request, configuredPublicBaseUrl) : null;
    const netaToken = generationBackend === "neta" ? ensureNetaToken(request) : null;

    for (const item of requestedAnimations) {
      const descriptor = await resolveAnimationDescriptor(character, item);
      const preset = descriptor.requestKind === "standard" ? ACTION_PRESETS[descriptor.action] : null;
      const frameCount = parseBoundedInteger(request.body.frameCount, preset?.defaultFrameCount || 20, {
        minimum: 8,
        maximum: 48,
        code: "INVALID_FRAME_COUNT",
        label: "frameCount",
      });
      const { frameWidth, frameHeight } = parseFrameDimensions(request.body, preset);
      const workflow = await createAnimationWorkflow({
        character,
        descriptor,
        frameCount,
        frameWidth,
        frameHeight,
        netaToken,
        publicBaseUrl,
      });
      workflows.push(workflow);
    }

    response.status(202).json({
      characterId: character.id,
      workflows,
    });
  });

  app.get("/api/characters/:characterId/spritesheets", async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const spritesheets = await listAnnotatedCharacterSpritesheets(character);
    response.json({ spritesheets });
  });

  app.post("/api/characters/:characterId/spritesheets/:spritesheetId/redo", async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const sourceSpritesheet = await mustGetCharacterSpritesheet(character.id, request.params.spritesheetId);
    const descriptor = buildRedoDescriptorFromSpritesheet(sourceSpritesheet);
    const publicBaseUrl =
      generationBackend === "neta" ? resolveOptionalPublicBaseUrl(request, configuredPublicBaseUrl) : null;
    const netaToken = generationBackend === "neta" ? ensureNetaToken(request) : null;
    const workflow = await createAnimationWorkflow({
      character,
      descriptor,
      frameCount: sourceSpritesheet.frameCount,
      frameWidth: sourceSpritesheet.frameWidth,
      frameHeight: sourceSpritesheet.frameHeight,
      netaToken,
      publicBaseUrl,
      redoOfSpritesheetId: sourceSpritesheet.id,
    });

    response.status(202).json({
      characterId: character.id,
      workflow,
    });
  });

  app.post("/api/characters/:characterId/spritesheets/:spritesheetId/select", async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const spritesheet = await mustGetCharacterSpritesheet(character.id, request.params.spritesheetId);
    const updatedCharacter = await repositories.update(
      "characters",
      character.id,
      (current) => withSelectedSpritesheetForCharacter(current, spritesheet),
      "Character",
    );

    response.json({
      characterId: updatedCharacter.id,
      selectedSpritesheetId: spritesheet.id,
      variantKey: getSpritesheetVariantKey(spritesheet),
    });
  });

  app.get("/api/characters/:characterId/export-package", async (request, response) => {
    const character = await mustGetCharacter(request.params.characterId);
    const spritesheets = await listCharacterSpritesheets(character);
    const exportPackage = await buildCharacterExportPackage({
      paths,
      character,
      spritesheets,
    });

    response.download(exportPackage.filePath, exportPackage.fileName);
  });

  app.get("/api/spritesheets/:spritesheetId", async (request, response) => {
    const spritesheet = await repositories.mustGet("spritesheets", request.params.spritesheetId, "Spritesheet");
    const character = await mustGetCharacter(spritesheet.characterId);
    const annotatedSpritesheets = await listAnnotatedCharacterSpritesheets(character);
    const annotatedSpritesheet = annotatedSpritesheets.find((item) => item.id === spritesheet.id);
    response.json(annotatedSpritesheet || spritesheet);
  });

  app.get("/api/jobs", async (request, response) => {
    let jobs = await repositories.list("jobs");
    if (request.query.characterId) {
      jobs = jobs.filter((job) => job.characterId === request.query.characterId);
    }
    if (request.query.status) {
      jobs = jobs.filter((job) => job.status === request.query.status);
    }
    response.json({ jobs });
  });

  app.get("/api/jobs/:jobId", async (request, response) => {
    const job = await repositories.mustGet("jobs", request.params.jobId, "Job");
    response.json(job);
  });

  app.use((_request, _response, next) => {
    next(new HttpError(404, "Resource not found.", "NOT_FOUND"));
  });

  app.use((error, _request, response, _next) => {
    const payload = toErrorPayload(error);
    response.status(payload.status).json(payload.body);
  });

  return {
    app,
    paths,
    repositories,
  };
}

module.exports = {
  createApp,
};
