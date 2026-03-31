import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const execFileAsync = promisify(execFile);

const baseUrl = process.env.AUTOSPRITE_BASE_URL || "http://127.0.0.1:3123";
const token = process.env.NETA_TOKEN_CN || process.env.NETA_TOKEN || "";
const prompt =
  process.env.AUTOSPRITE_SMOKE_PROMPT ||
  "retro pixel RPG heroine, full body, side view facing right, standing idle pose, short silver hair, short teal jacket, visible arms, visible legs, brown boots";
const frameCount = Number(process.env.AUTOSPRITE_SMOKE_FRAME_COUNT || "48");

if (!token) {
  throw new Error("Set NETA_TOKEN_CN or NETA_TOKEN before running the Neta smoke test.");
}

if (!Number.isInteger(frameCount) || frameCount < 8 || frameCount > 48) {
  throw new Error("AUTOSPRITE_SMOKE_FRAME_COUNT must be an integer between 8 and 48.");
}

function sanitizeFileExtension(fileUrl, fallback = ".png") {
  try {
    const parsed = new URL(fileUrl);
    return path.extname(parsed.pathname) || fallback;
  } catch (_error) {
    return fallback;
  }
}

async function api(method, pathname, { json, form } = {}) {
  const headers = new Headers({
    "x-neta-token": token,
  });
  const init = {
    method,
    headers,
  };

  if (json) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(json);
  }

  if (form) {
    init.body = form;
  }

  const response = await fetch(new URL(pathname, `${baseUrl}/`), init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_error) {
    body = text;
  }

  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function waitForJob(jobId, timeoutMs = 8 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await api("GET", `/api/jobs/${jobId}`);
    console.log(
      JSON.stringify({
        stage: "job",
        jobId,
        status: job.status,
        progress: job.progress,
        error: job.error,
      }),
    );
    if (job.status === "succeeded" || job.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for ${jobId}.`);
}

async function fetchBinary(pathname) {
  const response = await fetch(new URL(pathname, `${baseUrl}/`));
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed with ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchBinaryWithMeta(pathname) {
  const response = await fetch(new URL(pathname, `${baseUrl}/`), {
    headers: {
      "x-neta-token": token,
    },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed with ${response.status}.`);
  }
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "",
    contentDisposition: response.headers.get("content-disposition") || "",
  };
}

async function listZipEntries(zipPath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readZipText(zipPath, entryPath) {
  const { stdout } = await execFileAsync("unzip", ["-p", zipPath, entryPath], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function sanitizeFileStem(value, fallback = "export") {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

async function assertVideoFile(videoPath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size",
    "-show_entries",
    "stream=codec_name,width,height,avg_frame_rate",
    "-of",
    "json",
    videoPath,
  ]);
  const probe = JSON.parse(stdout);
  const stream = probe.streams?.[0];
  const duration = Number(probe.format?.duration || 0);
  if (!stream?.codec_name || !stream.width || !stream.height || !(duration > 0)) {
    throw new Error("The downloaded source video is invalid.");
  }
  return {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    frameRate: stream.avg_frame_rate,
    duration,
    size: Number(probe.format?.size || 0),
  };
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "runtime", "smoke", timestamp);
await fs.mkdir(outputDir, { recursive: true });

const health = await api("GET", "/api/health");
if (health.generationBackend !== "neta") {
  throw new Error(`Expected the local server to use the neta backend, got "${health.generationBackend}".`);
}

const me = await api("GET", "/api/neta/me");
if (!me.connected || !me.user?.nickName) {
  throw new Error("The provided Neta token did not authenticate successfully.");
}

console.log(
  JSON.stringify({
    stage: "health",
    backend: health.generationBackend,
    user: me.user.nickName,
  }),
);

const form = new FormData();
form.set("name", `Smoke ${Date.now()}`);
form.set("prompt", prompt);
form.set("characterDescription", "real Neta smoke test");
form.set("isHumanoid", "true");
form.set("renderStyle", "pixel");
const character = await api("POST", "/api/characters", { form });

if (
  character.sourceType !== "generate" ||
  character.generationBackend !== "neta" ||
  character.renderStyle !== "pixel" ||
  !character.upstreamTaskId
) {
  throw new Error("Character generation did not come back from Neta as expected.");
}

const characterBuffer = await fetchBinary(character.baseImageUrl);
const characterExtension = sanitizeFileExtension(character.baseImageUrl, ".webp");
const characterPath = path.join(outputDir, `character${characterExtension}`);
await fs.writeFile(characterPath, characterBuffer);

console.log(
  JSON.stringify({
    stage: "character",
    characterId: character.id,
    upstreamTaskId: character.upstreamTaskId,
    path: path.relative(process.cwd(), characterPath),
  }),
);

const generation = await api("POST", `/api/characters/${character.id}/spritesheets`, {
  json: {
    actions: ["walk"],
    frameCount,
  },
});
const workflow = generation.workflows?.[0];
if (!workflow?.jobId) {
  throw new Error("Spritesheet generation did not return a job id.");
}

console.log(
  JSON.stringify({
    stage: "queued",
    jobId: workflow.jobId,
    action: workflow.kind,
  }),
);

const job = await waitForJob(workflow.jobId);
if (job.status !== "succeeded") {
  throw new Error(`Spritesheet job failed: ${JSON.stringify(job)}`);
}

const sheetId = job.resultIds?.[0];
if (!sheetId) {
  throw new Error("Spritesheet job finished without a result id.");
}

const sheet = await api("GET", `/api/spritesheets/${sheetId}`);
const atlas = await api("GET", sheet.atlasUrl);
if (sheet.generationBackend !== "neta" || sheet.kind !== "walk" || !sheet.sourceVideoTaskId) {
  throw new Error("Spritesheet metadata is missing the expected Neta provenance.");
}
if (sheet.renderStyle !== "pixel") {
  throw new Error("Spritesheet metadata is missing the expected pixel render style.");
}
if (sheet.frameCount !== frameCount || sheet.columns !== 8 || sheet.rows !== Math.ceil(frameCount / 8)) {
  throw new Error("Spritesheet metadata does not match the expected long walk layout.");
}
if (!Array.isArray(atlas.frames) || atlas.frames.length !== sheet.frameCount) {
  throw new Error("Atlas frame count does not match the generated spritesheet.");
}

const sheetBuffer = await fetchBinary(sheet.sheetUrl);
const sheetPath = path.join(outputDir, "walk-sheet.png");
await fs.writeFile(sheetPath, sheetBuffer);
const sheetMeta = await sharp(sheetPath).metadata();
if (!sheetMeta.width || !sheetMeta.height) {
  throw new Error("The saved spritesheet PNG is invalid.");
}

const atlasPath = path.join(outputDir, "walk-atlas.json");
await fs.writeFile(atlasPath, `${JSON.stringify(atlas, null, 2)}\n`, "utf8");

const sequencePath = path.join(process.cwd(), "runtime", "data", "sequences", `${sheet.sourceVideoId}.json`);
const sequence = JSON.parse(await fs.readFile(sequencePath, "utf8"));
if (!sequence.sourceVideoPath) {
  throw new Error("Sequence record is missing the local source video path.");
}

const localVideoPath = path.join(process.cwd(), sequence.sourceVideoPath);
await fs.access(localVideoPath);
const videoProbe = await assertVideoFile(localVideoPath);
const copiedVideoPath = path.join(outputDir, "source-video.mp4");
await fs.copyFile(localVideoPath, copiedVideoPath);

const exportBundle = await fetchBinaryWithMeta(`/api/characters/${character.id}/export-package`);
if (!exportBundle.contentType.includes("application/zip")) {
  throw new Error(`Export package content type is invalid: ${exportBundle.contentType}`);
}
if (!exportBundle.contentDisposition.includes(".zip")) {
  throw new Error("Export package filename is missing a .zip download name.");
}

const exportZipPath = path.join(outputDir, "character-pack.zip");
await fs.writeFile(exportZipPath, exportBundle.buffer);
const zipEntries = await listZipEntries(exportZipPath);
const bundleSlug = sanitizeFileStem(character.name, character.id);
const baseImageExtension = path.extname(character.imagePath || ".png") || ".png";
const requiredEntries = [
  `${bundleSlug}/manifest.json`,
  `${bundleSlug}/character/base${baseImageExtension}`,
  `${bundleSlug}/sheets/walk.png`,
  `${bundleSlug}/atlases/walk.json`,
];
for (const entry of requiredEntries) {
  if (!zipEntries.includes(entry)) {
    throw new Error(`Export package is missing ${entry}.`);
  }
}

const manifest = JSON.parse(await readZipText(exportZipPath, `${bundleSlug}/manifest.json`));
if (manifest.character?.id !== character.id || manifest.character?.name !== character.name) {
  throw new Error("Export manifest character metadata does not match the generated character.");
}
if (manifest.character?.baseImagePath !== `character/base${baseImageExtension}`) {
  throw new Error("Export manifest base image path does not match the bundled base art.");
}

if (!Array.isArray(manifest.assets?.spritesheets) || manifest.assets.spritesheets.length !== 1) {
  throw new Error("Export manifest does not contain exactly one selected spritesheet.");
}

const exportedSheet = manifest.assets.spritesheets[0];
if (
  exportedSheet.id !== sheetId ||
  exportedSheet.kind !== "walk" ||
  exportedSheet.bundleSheetPath !== "sheets/walk.png" ||
  exportedSheet.bundleAtlasPath !== "atlases/walk.json"
) {
  throw new Error("Export manifest spritesheet entry does not match the generated walk sheet.");
}

const exportedAtlas = JSON.parse(await readZipText(exportZipPath, `${bundleSlug}/atlases/walk.json`));
if (exportedAtlas.meta?.action !== "walk" || exportedAtlas.meta?.frameCount !== frameCount) {
  throw new Error("Exported atlas metadata does not match the generated walk action.");
}
if (!Array.isArray(exportedAtlas.frames) || exportedAtlas.frames.length !== frameCount) {
  throw new Error("Exported atlas frame count does not match the generated sheet.");
}

const summary = {
  baseUrl,
  user: me.user.nickName,
  characterId: character.id,
  characterTaskId: character.upstreamTaskId,
  jobId: workflow.jobId,
  sheetId,
  sourceVideoId: sheet.sourceVideoId,
  sourceVideoTaskId: sheet.sourceVideoTaskId,
  sourceVideoUrl: sheet.sourceVideoUrl,
  frameCount: sheet.frameCount,
  atlasFrames: atlas.frames.length,
  sheetSize: {
    width: sheetMeta.width,
    height: sheetMeta.height,
  },
  video: videoProbe,
  exportPackage: {
    path: path.relative(process.cwd(), exportZipPath),
    entries: requiredEntries,
  },
  outputDir: path.relative(process.cwd(), outputDir),
};

await fs.writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ stage: "done", ...summary }));
