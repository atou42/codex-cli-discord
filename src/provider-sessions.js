import fs from 'node:fs';
import path from 'node:path';

import { normalizeProvider } from './provider-metadata.js';

export function listRecentSessions({ provider = 'codex', workspaceDir = '', limit = 10 } = {}) {
  switch (normalizeProvider(provider)) {
    case 'claude':
      return listRecentClaudeSessions(limit, workspaceDir);
    case 'gemini':
      return listRecentGeminiSessions(limit, workspaceDir);
    default:
      return listRecentCodexSessions(limit);
  }
}

function listRecentCodexSessions(limit = 10) {
  const sessionsDir = getCodexSessionsDir();
  if (!sessionsDir || !fs.existsSync(sessionsDir)) return [];

  const files = findCodexRolloutFiles(sessionsDir);
  const latestById = new Map();

  for (const file of files) {
    const id = parseSessionIdFromRolloutFile(path.basename(file));
    if (!id) continue;

    let mtime = 0;
    try {
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }

    const previous = latestById.get(id);
    if (!previous || mtime > previous.mtime) {
      latestById.set(id, { id, mtime });
    }
  }

  return [...latestById.values()]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

function listRecentClaudeSessions(limit = 10, workspaceDir = '') {
  const preferredRoot = getClaudeProjectDir(workspaceDir);
  const searchRoot = preferredRoot && fs.existsSync(preferredRoot) ? preferredRoot : getClaudeProjectsDir();
  if (!searchRoot || !fs.existsSync(searchRoot)) return [];

  return findClaudeSessionFiles(searchRoot)
    .map((file) => {
      const id = parseClaudeSessionIdFromFile(path.basename(file));
      if (!id) return null;
      try {
        const stat = fs.statSync(file);
        return stat.isFile() ? { id, mtime: stat.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

function listRecentGeminiSessions(limit = 10, workspaceDir = '') {
  const roots = getGeminiSearchRoots(workspaceDir);
  if (!roots.length) return [];

  const latestById = new Map();
  for (const root of roots) {
    for (const file of findGeminiSessionFiles(root)) {
      const snapshot = readGeminiSessionFile(file);
      const id = String(snapshot?.sessionId || '').trim();
      if (!id) continue;

      let mtime = Date.parse(String(snapshot?.lastUpdated || snapshot?.startTime || ''));
      if (!Number.isFinite(mtime)) {
        try {
          mtime = fs.statSync(file).mtimeMs;
        } catch {
          mtime = 0;
        }
      }

      const previous = latestById.get(id);
      if (!previous || mtime > previous.mtime) {
        latestById.set(id, { id, mtime });
      }
    }
  }

  return [...latestById.values()]
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
}

export function findLatestRolloutFileBySessionId(sessionId, notOlderThanMs = 0) {
  const targetId = String(sessionId || '').trim().toLowerCase();
  if (!targetId) return null;

  const sessionsDir = getCodexSessionsDir();
  if (!sessionsDir || !fs.existsSync(sessionsDir)) return null;

  const files = findCodexRolloutFiles(sessionsDir);
  let latest = null;

  for (const file of files) {
    const id = parseSessionIdFromRolloutFile(path.basename(file));
    if (!id || String(id).toLowerCase() !== targetId) continue;

    let stat = null;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat?.isFile()) continue;
    if (notOlderThanMs > 0 && stat.mtimeMs < notOlderThanMs) continue;

    if (!latest || stat.mtimeMs > latest.mtimeMs) {
      latest = {
        file,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
      };
    }
  }

  return latest;
}

export function findLatestClaudeSessionFileBySessionId(sessionId, workspaceDir = '', notOlderThanMs = 0) {
  const targetId = String(sessionId || '').trim().toLowerCase();
  if (!targetId) return null;

  const roots = [];
  const preferredRoot = getClaudeProjectDir(workspaceDir);
  if (preferredRoot) roots.push(preferredRoot);
  const projectsRoot = getClaudeProjectsDir();
  if (projectsRoot && !roots.includes(projectsRoot)) roots.push(projectsRoot);

  let latest = null;
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    for (const file of findClaudeSessionFiles(root)) {
      const id = parseClaudeSessionIdFromFile(path.basename(file));
      if (!id || String(id).toLowerCase() !== targetId) continue;

      let stat = null;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat?.isFile()) continue;
      if (notOlderThanMs > 0 && stat.mtimeMs < notOlderThanMs) continue;

      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = { file, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
      }
    }
    if (latest) return latest;
  }

  return latest;
}

function findLatestGeminiSessionFileBySessionId(sessionId, workspaceDir = '', notOlderThanMs = 0) {
  const targetId = String(sessionId || '').trim().toLowerCase();
  if (!targetId) return null;

  let latest = null;
  for (const root of getGeminiSearchRoots(workspaceDir)) {
    for (const file of findGeminiSessionFiles(root)) {
      const snapshot = readGeminiSessionFile(file);
      const id = String(snapshot?.sessionId || '').trim().toLowerCase();
      if (!id || id !== targetId) continue;

      let stat = null;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (!stat?.isFile()) continue;
      if (notOlderThanMs > 0 && stat.mtimeMs < notOlderThanMs) continue;

      if (!latest || stat.mtimeMs > latest.mtimeMs) {
        latest = { file, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
      }
    }
    if (latest) return latest;
  }

  return latest;
}

function getCodexSessionsDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return '';
  return path.join(home, '.codex', 'sessions');
}

function getGeminiRootDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return '';
  return path.join(home, '.gemini');
}

function getGeminiTmpDir() {
  const root = getGeminiRootDir();
  if (!root) return '';
  return path.join(root, 'tmp');
}

function getClaudeProjectsDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return '';
  return path.join(home, '.claude', 'projects');
}

function getClaudeProjectDir(workspaceDir = '') {
  const projectsRoot = getClaudeProjectsDir();
  const slug = encodeClaudeProjectPath(workspaceDir);
  if (!projectsRoot || !slug) return '';
  return path.join(projectsRoot, slug);
}

function encodeClaudeProjectPath(workspaceDir = '') {
  const raw = String(workspaceDir || '').trim();
  if (!raw) return '';
  return path.resolve(raw).replace(/[\\/]/g, '-');
}

function getGeminiProjectDir(workspaceDir = '') {
  const tmpRoot = getGeminiTmpDir();
  const slug = resolveGeminiProjectSlug(workspaceDir);
  if (!tmpRoot || !slug) return '';
  return path.join(tmpRoot, slug);
}

function resolveGeminiProjectSlug(workspaceDir = '') {
  const raw = String(workspaceDir || '').trim();
  if (!raw) return '';
  const normalizedWorkspace = path.resolve(raw);

  const projects = readGeminiProjectsMap();
  const direct = projects.get(normalizedWorkspace);
  if (direct) return direct;

  const tmpRoot = getGeminiTmpDir();
  if (!tmpRoot || !fs.existsSync(tmpRoot)) return '';
  try {
    const entries = fs.readdirSync(tmpRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(tmpRoot, entry.name);
      const projectRootFile = path.join(fullPath, '.project_root');
      const projectRoot = safeReadText(projectRootFile);
      if (projectRoot && path.resolve(projectRoot) === normalizedWorkspace) {
        return entry.name;
      }
    }
  } catch {
  }

  return '';
}

function readGeminiProjectsMap() {
  const file = path.join(getGeminiRootDir(), 'projects.json');
  const parsed = readJsonFile(file);
  const projects = parsed?.projects && typeof parsed.projects === 'object' ? parsed.projects : {};
  const out = new Map();
  for (const [workspacePath, slug] of Object.entries(projects)) {
    const normalizedWorkspace = String(workspacePath || '').trim();
    const normalizedSlug = String(slug || '').trim();
    if (!normalizedWorkspace || !normalizedSlug) continue;
    out.set(path.resolve(normalizedWorkspace), normalizedSlug);
  }
  return out;
}

function getGeminiSearchRoots(workspaceDir = '') {
  const roots = [];
  const preferredRoot = getGeminiProjectDir(workspaceDir);
  if (preferredRoot && fs.existsSync(preferredRoot)) roots.push(preferredRoot);

  const tmpRoot = getGeminiTmpDir();
  if (!tmpRoot || !fs.existsSync(tmpRoot)) return roots;

  try {
    const entries = fs.readdirSync(tmpRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(tmpRoot, entry.name);
      if (!fs.existsSync(path.join(fullPath, '.project_root'))) continue;
      if (!roots.includes(fullPath)) roots.push(fullPath);
    }
  } catch {
  }

  return roots;
}

function findFilesRecursive(root, predicate) {
  const out = [];
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && predicate(entry.name, fullPath)) {
        out.push(fullPath);
      }
    }
  }

  return out;
}

function findCodexRolloutFiles(root) {
  return findFilesRecursive(root, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'));
}

function findClaudeSessionFiles(root) {
  return findFilesRecursive(root, (name) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jsonl$/i.test(name));
}

function findGeminiSessionFiles(root) {
  const chatsDir = path.join(root, 'chats');
  if (!fs.existsSync(chatsDir)) return [];
  return findFilesRecursive(chatsDir, (name) => /^session-.*\.json$/i.test(name));
}

function parseSessionIdFromRolloutFile(filename) {
  const match = filename.match(/^rollout-.*-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] || null;
}

function parseClaudeSessionIdFromFile(filename) {
  const match = String(filename || '').match(/^([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] || null;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function readGeminiSessionFile(filePath) {
  return readJsonFile(filePath);
}

export function readGeminiSessionState({ sessionId, workspaceDir = '' } = {}) {
  const match = findLatestGeminiSessionFileBySessionId(sessionId, workspaceDir);
  if (!match?.file) return null;

  const snapshot = readGeminiSessionFile(match.file);
  if (!snapshot || typeof snapshot !== 'object') return null;

  const assistantMessages = Array.isArray(snapshot.messages)
    ? snapshot.messages
      .filter((item) => item && typeof item === 'object' && String(item.type || '').trim().toLowerCase() === 'gemini')
      .map((item) => String(item.content || '').trim())
      .filter(Boolean)
    : [];

  const finalAnswer = assistantMessages.at(-1) || '';
  const messages = finalAnswer ? assistantMessages.slice(0, -1) : assistantMessages;
  const lastAssistant = Array.isArray(snapshot.messages)
    ? [...snapshot.messages].reverse().find((item) => item && typeof item === 'object' && String(item.type || '').trim().toLowerCase() === 'gemini')
    : null;

  return {
    messages,
    finalAnswer,
    usage: lastAssistant?.tokens && typeof lastAssistant.tokens === 'object' ? lastAssistant.tokens : null,
    file: match.file,
  };
}
