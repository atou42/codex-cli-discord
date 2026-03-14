import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listRecentSessions,
  readGeminiSessionState,
} from '../src/provider-sessions.js';

test('provider-sessions reads gemini session state from project-scoped files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-gemini-'));
  const workspaceDir = path.join(root, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const previousHome = process.env.HOME;
  process.env.HOME = root;

  try {
    const geminiRoot = path.join(root, '.gemini');
    const slug = '-tmp-workspace';
    const projectDir = path.join(geminiRoot, 'tmp', slug);
    const chatsDir = path.join(projectDir, 'chats');
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.writeFileSync(path.join(geminiRoot, 'projects.json'), JSON.stringify({
      projects: {
        [path.resolve(workspaceDir)]: slug,
      },
    }, null, 2));
    fs.writeFileSync(path.join(projectDir, '.project_root'), `${path.resolve(workspaceDir)}\n`);

    const sessionId = '03c6d6dd-8920-42a6-ab7b-883d824ab355';
    fs.writeFileSync(path.join(chatsDir, 'session-test.json'), JSON.stringify({
      sessionId,
      lastUpdated: '2026-03-13T07:54:38.393Z',
      messages: [
        { type: 'user', content: [{ text: 'hi' }] },
        {
          type: 'gemini',
          content: 'I will inspect files.',
          tokens: { input: 10, output: 2, total: 12 },
        },
        {
          type: 'gemini',
          content: 'Final answer',
          tokens: { input: 11, output: 3, total: 14 },
        },
      ],
    }, null, 2));

    const recent = listRecentSessions({ provider: 'gemini', workspaceDir, limit: 5 });
    const sessionState = readGeminiSessionState({ sessionId, workspaceDir });

    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, sessionId);
    assert.deepEqual(sessionState.messages, ['I will inspect files.']);
    assert.equal(sessionState.finalAnswer, 'Final answer');
    assert.deepEqual(sessionState.usage, { input: 11, output: 3, total: 14 });
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});
