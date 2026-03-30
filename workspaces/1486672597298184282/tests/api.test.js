const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const express = require("express");
const sharp = require("sharp");
const request = require("supertest");
const { createApp } = require("../src/server/create-app");

const tempDirectories = [];
const tempServers = [];

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function binaryParser(response, callback) {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

async function makeTempApp(options = {}) {
  const { generationBackend, ...restOptions } = options;
  if (!generationBackend) {
    throw new Error("makeTempApp requires an explicit generationBackend.");
  }

  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "autosprite-phase2-"));
  tempDirectories.push(baseDir);
  const publicDir = path.join(baseDir, "public");
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, "index.html"), "<!doctype html><html><body>test</body></html>");
  const created = await createApp({ baseDir, generationBackend, ...restOptions });
  return {
    ...created,
    client: request(created.app),
    baseDir,
  };
}

async function makeLocalApp(options = {}) {
  return makeTempApp({
    generationBackend: "local",
    ...options,
  });
}

async function makeNetaApp(options = {}) {
  return makeTempApp({
    generationBackend: "neta",
    publicBaseUrl: "https://sprites.example.com",
    ...options,
  });
}

async function makeCharacterImage() {
  return sharp({
    create: {
      width: 96,
      height: 128,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg xmlns="http://www.w3.org/2000/svg" width="96" height="128">
            <rect x="36" y="18" width="24" height="34" rx="12" fill="#d85c30" />
            <rect x="28" y="52" width="40" height="50" rx="10" fill="#2f5d8c" />
            <rect x="24" y="52" width="10" height="38" rx="5" fill="#f2c9a5" />
            <rect x="62" y="52" width="10" height="38" rx="5" fill="#f2c9a5" />
            <rect x="34" y="98" width="12" height="24" rx="6" fill="#33261b" />
            <rect x="50" y="98" width="12" height="24" rx="6" fill="#33261b" />
          </svg>
        `),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function makeSolidColorImage(width, height, color) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

async function makeMockVideo(baseDir) {
  const framesDir = path.join(baseDir, "mock-video-frames");
  const videoPath = path.join(baseDir, "mock-video.mp4");
  await fs.mkdir(framesDir, { recursive: true });

  const backdrop = { r: 244, g: 247, b: 242, alpha: 1 };
  const subject = { r: 32, g: 220, b: 96, alpha: 1 };
  for (let index = 0; index < 8; index += 1) {
    const frameBuffer = await sharp({
      create: {
        width: 160,
        height: 224,
        channels: 4,
        background: backdrop,
      },
    })
      .composite([
        {
          input: Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" width="160" height="224">
              <circle cx="80" cy="60" r="26" fill="rgb(232, 182, 146)" />
              <rect x="52" y="86" width="56" height="82" rx="18" fill="rgb(${subject.r}, ${subject.g}, ${subject.b})" />
              <rect x="58" y="166" width="16" height="42" rx="8" fill="#40261b" />
              <rect x="86" y="166" width="16" height="42" rx="8" fill="#40261b" />
            </svg>
          `),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    await fs.writeFile(path.join(framesDir, `${String(index).padStart(4, "0")}.png`), frameBuffer);
  }

  await execFileAsync("ffmpeg", [
    "-y",
    "-framerate",
    "8",
    "-i",
    path.join(framesDir, "%04d.png"),
    "-pix_fmt",
    "yuv420p",
    videoPath,
  ]);

  return {
    videoPath,
    expectedCenterColor: subject,
  };
}

async function createMockNetaServer({
  characterImageBuffer,
  poseImageBuffer,
  videoPath,
  serveCharacterArtifact = true,
  servePoseArtifact = true,
  serveVideoArtifact = true,
}) {
  const app = express();
  app.use(express.json());

  const calls = {
    makeImage: [],
    editImage: [],
    makeVideo: [],
  };

  app.get("/v1/user/", (_request, response) => {
    response.json({
      uuid: "user_mock",
      nick_name: "Mock User",
      email: "mock@example.com",
    });
  });

  app.post("/v3/make_image", (request, response) => {
    calls.makeImage.push(request.body);
    response.json("task_make_image");
  });

  app.post("/v1/image_edit_v1/task", (request, response) => {
    calls.editImage.push(request.body);
    response.json("task_edit_image");
  });

  app.post("/v3/make_video", (request, response) => {
    calls.makeVideo.push(request.body);
    response.json("task_make_video");
  });

  app.get("/v1/artifact/task/:taskId", (request, response) => {
    const origin = `${request.protocol}://${request.get("host")}`;
    if (request.params.taskId === "task_make_image") {
      response.json({
        task_status: "SUCCESS",
        artifacts: [
          {
            modality: "PICTURE",
            url: `${origin}/artifacts/generated-character.png`,
          },
        ],
      });
      return;
    }

    if (request.params.taskId === "task_edit_image") {
      response.json({
        task_status: "SUCCESS",
        artifacts: [
          {
            modality: "PICTURE",
            url: `${origin}/artifacts/generated-pose.png`,
          },
        ],
      });
      return;
    }

    if (request.params.taskId === "task_make_video") {
      response.json({
        task_status: "SUCCESS",
        artifacts: [
          {
            modality: "VIDEO",
            url: `${origin}/artifacts/generated-video.mp4`,
          },
        ],
      });
      return;
    }

    response.status(404).json({
      error: {
        message: "Unknown task",
      },
    });
  });

  if (serveCharacterArtifact) {
    app.get("/artifacts/generated-character.png", (_request, response) => {
      response.type("png").send(characterImageBuffer);
    });
  }

  if (servePoseArtifact) {
    app.get("/artifacts/generated-pose.png", (_request, response) => {
      response.type("png").send(poseImageBuffer);
    });
  }

  if (serveVideoArtifact) {
    app.get("/artifacts/generated-video.mp4", (_request, response) => {
      response.type("mp4").sendFile(videoPath);
    });
  }

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  tempServers.push(server);

  const address = server.address();
  return {
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    calls,
  };
}

async function createCharacter(client, name = "Knight") {
  const image = await makeCharacterImage();
  const response = await client
    .post("/api/characters")
    .field("name", name)
    .attach("image", image, `${name.toLowerCase()}.png`)
    .expect(201);

  return response.body;
}

async function listPoses(client, characterId) {
  const response = await client.get(`/api/characters/${characterId}/poses`).expect(200);
  return response.body.poses;
}

async function readSequenceFrameBuffers(baseDir, sequence, indexes) {
  return Promise.all(indexes.map((index) => fs.readFile(path.join(baseDir, sequence.framePaths[index]))));
}

async function listZipEntries(zipPath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readZipText(zipPath, entryPath) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath]);
  return stdout;
}

async function waitForJob(client, jobId, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await client.get(`/api/jobs/${jobId}`);
    if (response.status !== 200) {
      if (response.status === 403 || response.status === 404) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        continue;
      }
      throw new Error(`Unexpected status while waiting for ${jobId}: ${response.status}`);
    }
    if (response.body.status === "succeeded" || response.body.status === "failed") {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out waiting for ${jobId}`);
}

async function waitForStatuses(client, jobIds, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const jobs = [];
    let shouldRetry = false;
    for (const jobId of jobIds) {
      const response = await client.get(`/api/jobs/${jobId}`);
      if (response.status !== 200) {
        if (response.status === 403 || response.status === 404) {
          shouldRetry = true;
          break;
        }
        throw new Error(`Unexpected status while waiting for ${jobId}: ${response.status}`);
      }
      jobs.push(response.body);
    }
    if (shouldRetry) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      continue;
    }
    if (predicate(jobs)) {
      return jobs;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  throw new Error(`Timed out waiting for statuses of ${jobIds.join(", ")}`);
}

async function removeDirectoryWithRetry(directory, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (
        error &&
        (error.code === "ENOTEMPTY" || error.code === "EBUSY" || error.code === "EPERM") &&
        attempt < attempts - 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      throw error;
    }
  }
}

afterEach(async () => {
  while (tempServers.length) {
    const server = tempServers.pop();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  while (tempDirectories.length) {
    const directory = tempDirectories.pop();
    await removeDirectoryWithRetry(directory);
  }
});

describe("AutoSprite Phase 2 API", () => {
  it("creates and lists a character from upload", async () => {
    const { client } = await makeLocalApp();
    const image = await makeCharacterImage();

    const createResponse = await client
      .post("/api/characters")
      .field("name", "Knight")
      .attach("image", image, "knight.png")
      .expect(201);

    expect(createResponse.body.name).toBe("Knight");
    expect(createResponse.body.baseImageUrl).toMatch(/^\/files\/uploads\//);
    expect(createResponse.body.sourceType).toBe("upload");
    expect(createResponse.body.generationBackend).toBe("upload");
    expect(createResponse.body).not.toHaveProperty("credits");

    const listResponse = await client.get("/api/characters").expect(200);
    expect(listResponse.body.characters).toHaveLength(1);
    expect(listResponse.body.characters[0].id).toBe(createResponse.body.id);
  });

  it("includes workspace summaries in character list responses", async () => {
    const { client, repositories } = await makeLocalApp();
    const image = await makeCharacterImage();

    const failedCharacter = await client
      .post("/api/characters")
      .field("name", "Failed Card")
      .attach("image", image, "failed-card.png")
      .expect(201);

    const readyCharacter = await client
      .post("/api/characters")
      .field("name", "Ready Card")
      .attach("image", image, "ready-card.png")
      .expect(201);

    await repositories.save("jobs", {
      id: "job_failed_card",
      jobId: "job_failed_card",
      type: "animation_generation",
      status: "failed",
      progress: 100,
      error: "Could not read video duration.",
      characterId: failedCharacter.body.id,
      outputId: "ss_missing",
      redoOfSpritesheetId: null,
      request: {
        action: "walk",
        requestKind: "standard",
      },
      steps: [],
      resultIds: [],
      createdAt: "2026-03-30T10:00:00.000Z",
      completedAt: "2026-03-30T10:01:00.000Z",
    });

    await repositories.save("spritesheets", {
      id: "ss_ready_card",
      characterId: readyCharacter.body.id,
      kind: "walk",
      name: "Walk",
      requestKind: "standard",
      customAnimationId: null,
      prompt: null,
      mode: null,
      loop: true,
      frameCount: 8,
      frameWidth: 96,
      frameHeight: 128,
      columns: 4,
      rows: 2,
      sheetUrl: "/files/sheets/ss_ready_card.png",
      atlasUrl: "/files/atlases/ss_ready_card.json",
      status: "succeeded",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:00:00.000Z",
    });

    const listResponse = await client.get("/api/characters").expect(200);
    const listedFailedCharacter = listResponse.body.characters.find((character) => character.id === failedCharacter.body.id);
    const listedReadyCharacter = listResponse.body.characters.find((character) => character.id === readyCharacter.body.id);

    expect(listedFailedCharacter.workspaceSummary).toMatchObject({
      completedSpritesheetCount: 0,
      failedJobCount: 1,
      activeJobCount: 0,
      latestJobStatus: "failed",
      latestFailureMessage: "Could not read video duration.",
      hasPreview: false,
    });
    expect(listedReadyCharacter.workspaceSummary).toMatchObject({
      completedSpritesheetCount: 1,
      failedJobCount: 0,
      hasPreview: true,
      hasExports: true,
    });
  });

  it("does not serve deleted character records from cache", async () => {
    const { client, baseDir } = await makeLocalApp();
    const image = await makeCharacterImage();

    const created = await client
      .post("/api/characters")
      .field("name", "Cache Bust")
      .attach("image", image, "cache-bust.png")
      .expect(201);

    await client.get(`/api/characters/${created.body.id}`).expect(200);

    const characterJsonPath = path.join(baseDir, "runtime", "data", "characters", `${created.body.id}.json`);
    await fs.rm(characterJsonPath);

    await client.get(`/api/characters/${created.body.id}`).expect(404);
    const listResponse = await client.get("/api/characters").expect(200);
    expect(listResponse.body.characters.some((character) => character.id === created.body.id)).toBe(false);
  });

  it("rejects invalid character creation without an image or prompt", async () => {
    const { client } = await makeLocalApp();

    const response = await client.post("/api/characters").field("name", "Broken").expect(400);
    expect(response.body.error.code).toBe("MISSING_CHARACTER_INPUT");
  });

  it("rejects prompt-only character creation on the local stub backend", async () => {
    const { client } = await makeLocalApp();

    const response = await client
      .post("/api/characters")
      .field("name", "PromptOnly")
      .field("prompt", "green-haired ranger, full body, white background")
      .expect(400);

    expect(response.body.error.code).toBe("PROMPT_CHARACTER_BACKEND_UNAVAILABLE");
  });

  it("rejects invalid frame settings before creating any job", async () => {
    const { client } = await makeLocalApp();
    const image = await makeCharacterImage();

    const created = await client
      .post("/api/characters")
      .field("name", "Validator")
      .attach("image", image, "validator.png")
      .expect(201);

    const response = await client
      .post(`/api/characters/${created.body.id}/spritesheets`)
      .send({ actions: ["walk"], frameCount: -1, frameSize: 9999 })
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_FRAME_COUNT");

    const jobs = await client.get(`/api/jobs?characterId=${created.body.id}`).expect(200);
    expect(jobs.body.jobs).toHaveLength(0);
  });

  it("generates a spritesheet job and exposes downloadable artifacts", async () => {
    const { client } = await makeLocalApp();
    const image = await makeCharacterImage();

    const created = await client
      .post("/api/characters")
      .field("name", "Runner")
      .attach("image", image, "runner.png")
      .expect(201);

    const generation = await client
      .post(`/api/characters/${created.body.id}/spritesheets`)
      .send({ actions: ["walk"] })
      .expect(202);

    expect(generation.body.workflows).toHaveLength(1);

    const job = await waitForJob(client, generation.body.workflows[0].jobId);
    expect(job.status).toBe("succeeded");
    expect(job.steps[0].status).toBe("succeeded");
    expect(job.steps[1].status).toBe("succeeded");

    const sheetId = job.resultIds[0];
    const sheetDetail = await client.get(`/api/spritesheets/${sheetId}`).expect(200);
    expect(sheetDetail.body.kind).toBe("walk");
    expect(sheetDetail.body.frameCount).toBe(48);
    expect(sheetDetail.body.columns).toBe(8);
    expect(sheetDetail.body.rows).toBe(6);
    expect(sheetDetail.body.frameWidth).toBe(544);
    expect(sheetDetail.body.renderStyle).toBe("pixel");
    expect(sheetDetail.body).not.toHaveProperty("creditsUsed");

    const atlas = await client.get(sheetDetail.body.atlasUrl).expect(200);
    expect(atlas.body.meta.action).toBe("walk");
    expect(atlas.body.meta.frameCount).toBe(48);
    expect(atlas.body.meta.columns).toBe(8);
    expect(atlas.body.meta.rows).toBe(6);
    expect(atlas.body.meta.renderStyle).toBe("pixel");
    expect(atlas.body.frames.length).toBe(sheetDetail.body.frameCount);

    await client.get(sheetDetail.body.sheetUrl).expect(200);
  }, 15000);

  it("uses a portrait 8-column spritesheet layout for an 8-frame action", async () => {
    const { client } = await makeLocalApp();
    const image = await makeCharacterImage();

    const created = await client
      .post("/api/characters")
      .field("name", "PortraitLayout")
      .attach("image", image, "portrait-layout.png")
      .expect(201);

    const generation = await client
      .post(`/api/characters/${created.body.id}/spritesheets`)
      .send({ actions: ["walk"], frameCount: 8 })
      .expect(202);

    const job = await waitForJob(client, generation.body.workflows[0].jobId);
    expect(job.status).toBe("succeeded");

    const sheetDetail = await client.get(`/api/spritesheets/${job.resultIds[0]}`).expect(200);
    expect(sheetDetail.body.frameHeight).toBeGreaterThan(sheetDetail.body.frameWidth);
    expect(sheetDetail.body.columns).toBe(8);
    expect(sheetDetail.body.rows).toBe(1);

    const atlas = await client.get(sheetDetail.body.atlasUrl).expect(200);
    expect(atlas.body.meta.columns).toBe(8);
    expect(atlas.body.meta.rows).toBe(1);
    expect(atlas.body.meta.frameHeight).toBeGreaterThan(atlas.body.meta.frameWidth);
  });

  it("supports multiple standard actions in parallel", async () => {
    const { client } = await makeLocalApp();
    const image = await makeCharacterImage();

    const created = await client
      .post("/api/characters")
      .field("name", "Brawler")
      .attach("image", image, "brawler.png")
      .expect(201);

    const generation = await client
      .post(`/api/characters/${created.body.id}/spritesheets`)
      .send({ actions: ["idle", "attack"] })
      .expect(202);

    expect(generation.body.workflows).toHaveLength(2);

    const jobs = await Promise.all(generation.body.workflows.map((workflow) => waitForJob(client, workflow.jobId)));
    expect(jobs.every((job) => job.status === "succeeded")).toBe(true);

    const list = await client.get(`/api/characters/${created.body.id}/spritesheets`).expect(200);
    expect(list.body.spritesheets).toHaveLength(2);
  }, 15000);

  it("exposes the extended side-scroller action set through the supported actions API", async () => {
    const { client } = await makeLocalApp();

    const response = await client.get("/api/supported-actions").expect(200);
    const actionsById = Object.fromEntries(response.body.actions.map((action) => [action.id, action]));

    expect(actionsById).toMatchObject({
      crouch: {
        id: "crouch",
        label: "Crouch",
        defaultFrameCount: 16,
        loop: true,
      },
      dash: {
        id: "dash",
        label: "Dash",
        defaultFrameCount: 14,
        loop: false,
      },
      fall: {
        id: "fall",
        label: "Fall",
        defaultFrameCount: 14,
        loop: false,
      },
      slide: {
        id: "slide",
        label: "Slide",
        defaultFrameCount: 14,
        loop: false,
      },
      hurt: {
        id: "hurt",
        label: "Hurt",
        defaultFrameCount: 12,
        loop: false,
      },
    });
  });

  it("renders extended side-scroller actions as real motion instead of static placeholder frames", async () => {
    const { client, repositories, baseDir } = await makeLocalApp();
    const character = await createCharacter(client, "Mover");
    const frameCount = 8;
    const expectations = {
      crouch: { frameCount, loop: true, repeatStartAtEnd: true },
      dash: { frameCount, loop: false, repeatStartAtEnd: false },
      fall: { frameCount, loop: false, repeatStartAtEnd: false },
      slide: { frameCount, loop: false, repeatStartAtEnd: false },
      hurt: { frameCount, loop: false, repeatStartAtEnd: false },
    };

    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({ actions: Object.keys(expectations), frameCount })
      .expect(202);

    const jobs = await Promise.all(generation.body.workflows.map((workflow) => waitForJob(client, workflow.jobId)));
    expect(jobs.every((job) => job.status === "succeeded")).toBe(true);

    for (const workflow of generation.body.workflows) {
      const expected = expectations[workflow.kind];
      const detail = await client.get(`/api/spritesheets/${jobs.find((job) => job.id === workflow.jobId).resultIds[0]}`).expect(200);
      const atlas = await client.get(detail.body.atlasUrl).expect(200);
      const sequence = await repositories.mustGet("sequences", detail.body.sourceVideoId, "Sequence");
      const middleIndex = Math.floor(sequence.framePaths.length / 2);
      const [firstFrame, middleFrame, lastFrame] = await readSequenceFrameBuffers(baseDir, sequence, [
        0,
        middleIndex,
        sequence.framePaths.length - 1,
      ]);

      expect(detail.body.kind).toBe(workflow.kind);
      expect(detail.body.frameCount).toBe(expected.frameCount);
      expect(detail.body.loop).toBe(expected.loop);
      expect(atlas.body.meta.action).toBe(workflow.kind);
      expect(atlas.body.meta.frameCount).toBe(expected.frameCount);
      expect(atlas.body.meta.loop).toBe(expected.loop);
      expect(firstFrame.equals(middleFrame)).toBe(false);
      expect(middleFrame.equals(lastFrame)).toBe(false);
      expect(firstFrame.equals(lastFrame)).toBe(expected.repeatStartAtEnd);
    }
  }, 15000);

  it("rejects export package requests before any spritesheets exist", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "Exporter");

    const response = await client.get(`/api/characters/${character.id}/export-package`).expect(409);
    expect(response.body.error.code).toBe("EXPORT_NOT_READY");
  });

  it("downloads a character export package with manifest, base art, sheets, and atlases", async () => {
    const { client, baseDir } = await makeLocalApp();
    const character = await createCharacter(client, "Bundle Hero");

    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({ actions: ["walk", "dash"], frameCount: 8 })
      .expect(202);

    await Promise.all(generation.body.workflows.map((workflow) => waitForJob(client, workflow.jobId)));

    const exportResponse = await client
      .get(`/api/characters/${character.id}/export-package`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(exportResponse.headers["content-type"]).toContain("application/zip");
    expect(exportResponse.headers["content-disposition"]).toContain(".zip");

    const zipPath = path.join(baseDir, "bundle-hero-export.zip");
    await fs.writeFile(zipPath, exportResponse.body);

    const entries = await listZipEntries(zipPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        "bundle-hero/manifest.json",
        "bundle-hero/character/base.png",
        "bundle-hero/sheets/walk.png",
        "bundle-hero/sheets/dash.png",
        "bundle-hero/atlases/walk.json",
        "bundle-hero/atlases/dash.json",
      ]),
    );

    const manifest = JSON.parse(await readZipText(zipPath, "bundle-hero/manifest.json"));
    expect(manifest.character).toMatchObject({
      id: character.id,
      name: "Bundle Hero",
    });
    expect(manifest.assets.spritesheets.map((sheet) => sheet.kind)).toEqual(["dash", "walk"]);
    expect(manifest.assets.spritesheets[0]).toMatchObject({
      bundleSheetPath: "sheets/dash.png",
      bundleAtlasPath: "atlases/dash.json",
      frameCount: 8,
    });

    const walkAtlas = JSON.parse(await readZipText(zipPath, "bundle-hero/atlases/walk.json"));
    expect(walkAtlas.meta.action).toBe("walk");
    expect(walkAtlas.meta.frameCount).toBe(8);
  }, 15000);

  it("redos a spritesheet into a new version and auto-selects the latest version for that action", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "Redo Hero");

    const firstGeneration = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({ actions: ["walk"], frameCount: 8 })
      .expect(202);
    const firstJob = await waitForJob(client, firstGeneration.body.workflows[0].jobId);
    const firstSheetId = firstJob.resultIds[0];

    const redoResponse = await client.post(`/api/characters/${character.id}/spritesheets/${firstSheetId}/redo`).expect(202);
    expect(redoResponse.body.workflow).toMatchObject({
      kind: "walk",
      name: "Walk",
      redoOfSpritesheetId: firstSheetId,
    });

    const redoJob = await waitForJob(client, redoResponse.body.workflow.jobId);
    const secondSheetId = redoJob.resultIds[0];

    const list = await client.get(`/api/characters/${character.id}/spritesheets`).expect(200);
    const walkSheets = list.body.spritesheets.filter((sheet) => sheet.kind === "walk");

    expect(walkSheets).toHaveLength(2);
    expect(walkSheets.map((sheet) => sheet.id)).toEqual([secondSheetId, firstSheetId]);
    expect(walkSheets.map((sheet) => sheet.versionNumber)).toEqual([2, 1]);
    expect(walkSheets.map((sheet) => sheet.variantKey)).toEqual(["standard:walk", "standard:walk"]);
    expect(walkSheets.map((sheet) => sheet.isSelectedVersion)).toEqual([true, false]);
    expect(walkSheets[0].redoOfSpritesheetId).toBe(firstSheetId);
  }, 15000);

  it("lets the user select an older version and exports that selected version instead of the newest one", async () => {
    const { client, baseDir } = await makeLocalApp();
    const character = await createCharacter(client, "Version Switcher");

    const firstGeneration = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({ actions: ["walk"], frameCount: 8 })
      .expect(202);
    const firstJob = await waitForJob(client, firstGeneration.body.workflows[0].jobId);
    const firstSheetId = firstJob.resultIds[0];

    const redoResponse = await client.post(`/api/characters/${character.id}/spritesheets/${firstSheetId}/redo`).expect(202);
    const redoJob = await waitForJob(client, redoResponse.body.workflow.jobId);
    const secondSheetId = redoJob.resultIds[0];

    await client.post(`/api/characters/${character.id}/spritesheets/${firstSheetId}/select`).expect(200);

    const list = await client.get(`/api/characters/${character.id}/spritesheets`).expect(200);
    const walkSheets = list.body.spritesheets.filter((sheet) => sheet.kind === "walk");

    expect(walkSheets.map((sheet) => ({ id: sheet.id, selected: sheet.isSelectedVersion }))).toEqual([
      { id: secondSheetId, selected: false },
      { id: firstSheetId, selected: true },
    ]);

    const exportResponse = await client
      .get(`/api/characters/${character.id}/export-package`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    const zipPath = path.join(baseDir, "version-switcher-export.zip");
    await fs.writeFile(zipPath, exportResponse.body);

    const manifest = JSON.parse(await readZipText(zipPath, "version-switcher/manifest.json"));
    const exportedWalk = manifest.assets.spritesheets.find((sheet) => sheet.kind === "walk");

    expect(exportedWalk).toMatchObject({
      id: firstSheetId,
      bundleSheetPath: "sheets/walk.png",
      bundleAtlasPath: "atlases/walk.json",
    });
  }, 15000);

  it("queues jobs when the concurrency limit is reached", async () => {
    const { client } = await makeLocalApp({
      maxConcurrentJobs: 1,
      jobStepDelayMs: 180,
    });
    const character = await createCharacter(client, "QueueTester");

    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({ actions: ["idle", "walk"], frameCount: 8 })
      .expect(202);

    const [firstJobId, secondJobId] = generation.body.workflows.map((workflow) => workflow.jobId);
    const [firstJob, secondJob] = await waitForStatuses(
      client,
      [firstJobId, secondJobId],
      ([left, right]) => left.status === "running" && right.status === "queued",
      2000,
    );

    expect(firstJob.steps[0].status).toBe("running");
    expect(secondJob.steps[0].status).toBe("queued");

    const completedJobs = await Promise.all([waitForJob(client, firstJobId), waitForJob(client, secondJobId)]);
    expect(completedJobs.map((job) => job.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("rejects generation requests with missing animations", async () => {
    const { client } = await makeLocalApp();
    const image = await makeCharacterImage();

    const created = await client
      .post("/api/characters")
      .field("name", "Mage")
      .attach("image", image, "mage.png")
      .expect(201);

    const response = await client.post(`/api/characters/${created.body.id}/spritesheets`).send({}).expect(400);
    expect(response.body.error.code).toBe("MISSING_ANIMATIONS");
    expect(response.body.error.code).not.toBe("PLAN_REQUIRED");
  });

  it("requires a Neta token for prompt pose generation in neta mode", async () => {
    const { client } = await makeNetaApp();
    const character = await createCharacter(client, "NetaPose");

    const response = await client
      .post(`/api/characters/${character.id}/poses`)
      .field("name", "Signal")
      .field("prompt", "raise one hand")
      .expect(401);

    expect(response.body.error.code).toBe("MISSING_NETA_TOKEN");
  });

  it("requires a Neta token for spritesheet generation in neta mode", async () => {
    const { client } = await makeNetaApp();
    const character = await createCharacter(client, "NetaSheet");

    const response = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({ actions: ["walk"] })
      .expect(401);

    expect(response.body.error.code).toBe("MISSING_NETA_TOKEN");
  });

  it("creates a character from prompt through Neta image generation instead of local fallback", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "autosprite-phase2-neta-char-"));
    tempDirectories.push(baseDir);
    const characterImageBuffer = await makeSolidColorImage(160, 224, { r: 12, g: 190, b: 220, alpha: 1 });
    const poseImageBuffer = await makeSolidColorImage(160, 224, { r: 180, g: 80, b: 220, alpha: 1 });
    const { videoPath } = await makeMockVideo(baseDir);
    const mockNeta = await createMockNetaServer({
      characterImageBuffer,
      poseImageBuffer,
      videoPath,
    });

    const { client } = await makeNetaApp({
      netaApiBaseUrl: mockNeta.apiBaseUrl,
    });

    const response = await client
      .post("/api/characters")
      .set("x-neta-token", "test-token")
      .field("name", "Prompt Knight")
      .field("prompt", "teal armored knight, full body, white background")
      .field("characterDescription", "Generated from prompt")
      .expect(201);

    expect(mockNeta.calls.makeImage).toHaveLength(1);
    expect(mockNeta.calls.makeImage[0].context_model_series).toBe("8_image_edit");
    expect(mockNeta.calls.makeImage[0].rawPrompt).toHaveLength(1);
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].type).toBe("freetext");
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].weight).toBe(1);
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].value).toContain("teal armored knight, full body, white background");
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].value).toContain("retro 2D RPG sprite");
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].value).toContain("side-view character");
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].value).toContain("facing right");
    expect(mockNeta.calls.makeImage[0].rawPrompt[0].value).toContain("chroma-key green background");
    expect(response.body.sourceType).toBe("generate");
    expect(response.body.prompt).toBe("teal armored knight, full body, white background");
    expect(response.body.renderStyle).toBe("pixel");
    expect(response.body.generationBackend).toBe("neta");
    expect(response.body.upstreamTaskId).toBe("task_make_image");
    expect(response.body.upstreamArtifactUrl).toContain("/artifacts/generated-character.png");

    const createdImage = await client.get(response.body.baseImageUrl).expect(200);
    expect(Buffer.from(createdImage.body).equals(characterImageBuffer)).toBe(true);

    const poses = await listPoses(client, response.body.id);
    expect(poses).toHaveLength(1);
    expect(poses[0].sourceType).toBe("original");
    expect(poses[0].renderStyle).toBe("pixel");
    expect(poses[0].generationBackend).toBe("neta");
    expect(poses[0].upstreamTaskId).toBe("task_make_image");
  });

  it("uses Neta video frames for spritesheet generation instead of the local geometric stub", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "autosprite-phase2-neta-video-"));
    tempDirectories.push(baseDir);
    const characterImageBuffer = await makeCharacterImage();
    const poseImageBuffer = await makeSolidColorImage(160, 224, { r: 180, g: 80, b: 220, alpha: 1 });
    const { videoPath, expectedCenterColor } = await makeMockVideo(baseDir);
    const mockNeta = await createMockNetaServer({
      characterImageBuffer,
      poseImageBuffer,
      videoPath,
    });

    const { client, repositories, baseDir: appBaseDir } = await makeNetaApp({
      netaApiBaseUrl: mockNeta.apiBaseUrl,
    });

    const character = await createCharacter(client, "RemoteRunner");
    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .set("x-neta-token", "test-token")
      .send({ actions: ["walk"], frameCount: 8 })
      .expect(202);

    const job = await waitForJob(client, generation.body.workflows[0].jobId);
    expect(job.status).toBe("succeeded");
    expect(mockNeta.calls.makeVideo).toHaveLength(1);
    expect(mockNeta.calls.makeVideo[0].work_flow_text).toContain("retro 2D RPG sprite");
    expect(mockNeta.calls.makeVideo[0].work_flow_text).toContain("side-scroller camera");
    expect(mockNeta.calls.makeVideo[0].work_flow_text).toContain("facing right");
    expect(mockNeta.calls.makeVideo[0].work_flow_text).toContain("camera locked");
    expect(mockNeta.calls.makeVideo[0].work_flow_text).toContain("chroma-key green background");

    const detail = await client.get(`/api/spritesheets/${job.resultIds[0]}`).expect(200);
    expect(detail.body.generationBackend).toBe("neta");
    expect(detail.body.renderStyle).toBe("pixel");
    expect(detail.body.sourceVideoTaskId).toBe("task_make_video");
    expect(detail.body.sourceVideoUrl).toContain("/artifacts/generated-video.mp4");

    const sequence = await repositories.mustGet("sequences", detail.body.sourceVideoId, "Sequence");
    expect(sequence.renderStyle).toBe("pixel");
    expect(sequence.sourceVideoTaskId).toBe("task_make_video");
    const middleFramePath = path.join(appBaseDir, sequence.framePaths[Math.floor(sequence.framePaths.length / 2)]);
    const { data: frameData, info } = await sharp(middleFramePath)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const pixelIndex = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * channels;
    const [red, green, blue] = frameData.slice(pixelIndex, pixelIndex + 3);

    expect(green).toBeGreaterThan(150);
    expect(red).toBeLessThan(80);
    expect(blue).toBeLessThan(140);
    expect(green).toBeGreaterThan(red);
    expect(green).toBeGreaterThan(blue);
    expect(expectedCenterColor.g).toBeGreaterThan(expectedCenterColor.r);
  });

  it("fails the job when the Neta video artifact cannot be downloaded instead of falling back locally", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "autosprite-phase2-neta-video-fail-"));
    tempDirectories.push(baseDir);
    const characterImageBuffer = await makeCharacterImage();
    const poseImageBuffer = await makeSolidColorImage(160, 224, { r: 180, g: 80, b: 220, alpha: 1 });
    const { videoPath } = await makeMockVideo(baseDir);
    const mockNeta = await createMockNetaServer({
      characterImageBuffer,
      poseImageBuffer,
      videoPath,
      serveVideoArtifact: false,
    });

    const { client } = await makeNetaApp({
      netaApiBaseUrl: mockNeta.apiBaseUrl,
    });

    const character = await createCharacter(client, "BrokenRemoteRunner");
    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .set("x-neta-token", "test-token")
      .send({ actions: ["walk"] })
      .expect(202);

    const job = await waitForJob(client, generation.body.workflows[0].jobId);
    expect(job.status).toBe("failed");
    expect(job.error).toContain("Failed to download remote media: 404.");

    const list = await client.get(`/api/characters/${character.id}/spritesheets`).expect(200);
    expect(list.body.spritesheets).toHaveLength(0);
  });

  it("creates an original pose together with each character", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "PoseSeed");

    const poses = await listPoses(client, character.id);
    expect(poses).toHaveLength(1);
    expect(poses[0]).toMatchObject({
      characterId: character.id,
      name: "Original",
      sourceType: "original",
      generationBackend: "upload",
      imagePath: character.imagePath,
      imageUrl: character.baseImageUrl,
    });
  });

  it("creates generated and uploaded poses for a character", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "PoseMaker");

    const generatedPose = await client
      .post(`/api/characters/${character.id}/poses`)
      .field("name", "Victory")
      .field("prompt", "victory cheer pose")
      .expect(201);

    expect(generatedPose.body).toMatchObject({
      characterId: character.id,
      name: "Victory",
      sourceType: "generate",
      generationBackend: "local",
      prompt: "victory cheer pose",
    });

    const uploadedImage = await makeCharacterImage();
    const uploadedPose = await client
      .post(`/api/characters/${character.id}/poses`)
      .field("name", "Landing")
      .attach("image", uploadedImage, "landing.png")
      .expect(201);

    expect(uploadedPose.body).toMatchObject({
      characterId: character.id,
      name: "Landing",
      sourceType: "upload",
      generationBackend: "upload",
    });

    const poses = await listPoses(client, character.id);
    expect(poses.map((pose) => pose.name)).toEqual(["Landing", "Victory", "Original"]);

    await client.get(generatedPose.body.imageUrl).expect(200);
    await client.get(uploadedPose.body.imageUrl).expect(200);
  });

  it("rejects reserved or incomplete custom animation definitions", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "Animator");
    const [originalPose] = await listPoses(client, character.id);

    const reservedName = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Walk",
        prompt: "dramatic walk cycle",
        mode: "auto",
      })
      .expect(400);

    expect(reservedName.body.error.code).toBe("RESERVED_ANIMATION_NAME");

    const missingFirstPose = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Guard Stance",
        prompt: "hold a guarded stance",
        mode: "first_frame_only",
      })
      .expect(400);

    expect(missingFirstPose.body.error.code).toBe("MISSING_FIRST_FRAME_POSE");

    const missingLastPose = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Heavy Land",
        prompt: "land from a jump",
        mode: "first_and_last_frame",
        poseId: originalPose.id,
        loop: false,
      })
      .expect(400);

    expect(missingLastPose.body.error.code).toBe("MISSING_LAST_FRAME_POSE");
  });

  it("stores custom animation definitions with pose constraints", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "Planner");
    const [originalPose] = await listPoses(client, character.id);

    const firstFrameOnly = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Signal",
        prompt: "raise one hand to signal",
        mode: "first_frame_only",
        poseId: originalPose.id,
      })
      .expect(201);

    expect(firstFrameOnly.body).toMatchObject({
      characterId: character.id,
      name: "Signal",
      mode: "first_frame_only",
      poseId: originalPose.id,
      lastFramePoseId: null,
      loop: false,
    });

    const looped = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Spin Loop",
        prompt: "spin in place",
        mode: "first_and_last_frame",
        poseId: originalPose.id,
        loop: true,
      })
      .expect(201);

    expect(looped.body).toMatchObject({
      characterId: character.id,
      name: "Spin Loop",
      mode: "first_and_last_frame",
      poseId: originalPose.id,
      lastFramePoseId: null,
      loop: true,
    });

    const list = await client.get(`/api/characters/${character.id}/custom-animations`).expect(200);
    expect(list.body.customAnimations.map((item) => item.name)).toEqual(["Spin Loop", "Signal"]);
  });

  it("generates a custom animation spritesheet and preserves custom metadata", async () => {
    const { client } = await makeLocalApp();
    const character = await createCharacter(client, "Caster");
    const [originalPose] = await listPoses(client, character.id);

    const lastPoseImage = await makeCharacterImage();
    const lastPose = await client
      .post(`/api/characters/${character.id}/poses`)
      .field("name", "Landing")
      .attach("image", lastPoseImage, "landing.png")
      .expect(201);

    const customAnimation = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Arc Burst",
        prompt: "cast a bright energy arc",
        mode: "first_and_last_frame",
        poseId: originalPose.id,
        lastFramePoseId: lastPose.body.id,
        loop: false,
      })
      .expect(201);

    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({
        animations: [{ kind: "custom", customAnimationId: customAnimation.body.id }],
        frameCount: 12,
      })
      .expect(202);

    const job = await waitForJob(client, generation.body.workflows[0].jobId);
    expect(job.status).toBe("succeeded");

    const sheetId = job.resultIds[0];
    const sheetDetail = await client.get(`/api/spritesheets/${sheetId}`).expect(200);
    expect(sheetDetail.body).toMatchObject({
      characterId: character.id,
      kind: "custom",
      name: "Arc Burst",
      frameCount: 12,
      customAnimationId: customAnimation.body.id,
      poseId: originalPose.id,
      lastFramePoseId: lastPose.body.id,
      loop: false,
    });

    const atlas = await client.get(sheetDetail.body.atlasUrl).expect(200);
    expect(atlas.body.meta).toMatchObject({
      action: "custom",
      label: "Arc Burst",
      customAnimationId: customAnimation.body.id,
      mode: "first_and_last_frame",
      poseId: originalPose.id,
      lastFramePoseId: lastPose.body.id,
      loop: false,
      prompt: "cast a bright energy arc",
    });
  });

  it("reuses the first pose as the last frame for looped custom animations", async () => {
    const { client, repositories, baseDir } = await makeLocalApp();
    const character = await createCharacter(client, "Looper");
    const [originalPose] = (await repositories.list("poses")).filter((pose) => pose.characterId === character.id);

    const customAnimation = await client
      .post(`/api/characters/${character.id}/custom-animations`)
      .send({
        name: "Loop Spin",
        prompt: "spin in place",
        mode: "first_and_last_frame",
        poseId: originalPose.id,
        loop: true,
      })
      .expect(201);

    const generation = await client
      .post(`/api/characters/${character.id}/spritesheets`)
      .send({
        animations: [{ kind: "custom", customAnimationId: customAnimation.body.id }],
        frameCount: 10,
      })
      .expect(202);

    const job = await waitForJob(client, generation.body.workflows[0].jobId);
    expect(job.status).toBe("succeeded");

    const sheetDetail = await client.get(`/api/spritesheets/${job.resultIds[0]}`).expect(200);
    const sequence = await repositories.mustGet("sequences", sheetDetail.body.sourceVideoId, "Sequence");
    const firstFrame = await fs.readFile(path.join(baseDir, sequence.framePaths[0]));
    const lastFrame = await fs.readFile(path.join(baseDir, sequence.framePaths[sequence.framePaths.length - 1]));
    expect(firstFrame.equals(lastFrame)).toBe(true);
  });
});
