import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCodexForkThread,
  formatCodexForkResult,
} from '../src/codex-fork-flow.js';

function createForkSource() {
  return {
    id: 'source-1',
    user: { id: 'user-1' },
    channel: {
      id: 'parent-channel',
      threads: {
        async create() {
          throw new Error('default create should not run in this test');
        },
      },
    },
  };
}

test('createCodexForkThread creates Discord thread before native fork and deletes it on native failure', async () => {
  const events = [];
  const childThread = {
    id: 'child-channel',
    async delete(reason) {
      events.push(`delete:${reason}`);
    },
  };

  await assert.rejects(
    () => createCodexForkThread({
      key: 'parent-channel',
      source: createForkSource(),
      parentSessionId: 'parent-session',
      getSession: () => ({}),
      commandActions: {
        bindForkedSession() {},
      },
      createThread: async () => {
        events.push('createThread');
        return childThread;
      },
      async forkCodexThread() {
        events.push('forkCodexThread');
        throw new Error('native fork failed');
      },
    }),
    /native fork failed/,
  );

  assert.deepEqual(events, [
    'createThread',
    'forkCodexThread',
    'delete:Codex fork failed before session binding',
  ]);
});

test('formatCodexForkResult makes prompt enqueue failure explicit', async () => {
  const childSession = {};
  const result = await createCodexForkThread({
    key: 'parent-channel',
    source: createForkSource(),
    parentSessionId: 'parent-session',
    getSession: () => childSession,
    commandActions: {
      bindForkedSession(currentSession, binding) {
        currentSession.runnerSessionId = binding.sessionId;
        return binding;
      },
    },
    createThread: async () => ({
      id: 'child-channel',
      async setName() {},
      async send() {},
    }),
    async forkCodexThread() {
      return { threadId: 'fork-session' };
    },
    async enqueuePrompt() {
      throw new Error('queue unavailable');
    },
    prompt: 'continue',
  });

  assert.equal(result.ok, true);
  assert.equal(result.promptQueue.enqueued, false);
  assert.equal(result.promptQueue.error, 'queue unavailable');
  const report = formatCodexForkResult(result, 'zh');
  assert.match(report, /^⚠️ 已创建 Codex fork/);
  assert.match(report, /prompt 没有入队/);
  assert.doesNotMatch(report, /^✅/);
});
