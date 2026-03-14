import test from 'node:test';
import assert from 'node:assert/strict';

import { createPromptOrchestrator } from '../src/prompt-orchestrator.js';

function createOrchestrator(overrides = {}) {
  const replyLog = [];
  const progressCalls = [];
  let saveCount = 0;
  const session = {
    provider: 'codex',
    runnerSessionId: 'sess-1',
    codexThreadId: 'sess-1',
    language: 'zh',
    lastInputTokens: 0,
    name: 'demo',
  };

  const deps = {
    showReasoning: true,
    resultChunkChars: 1900,
    createProgressReporter: ({ initialLatestStep }) => ({
      async start() {
        progressCalls.push({ type: 'start', initialLatestStep });
      },
      sync(options = {}) {
        progressCalls.push({ type: 'sync', options });
      },
      setLatestStep(text) {
        progressCalls.push({ type: 'setLatestStep', text });
      },
      onEvent(event) {
        progressCalls.push({ type: 'onEvent', event });
      },
      onLog(line, source) {
        progressCalls.push({ type: 'onLog', line, source });
      },
      async finish(outcome) {
        progressCalls.push({ type: 'finish', outcome });
      },
    }),
    safeReply: async (_message, payload) => {
      replyLog.push(payload);
      return { id: `reply-${replyLog.length}`, edit: async () => {} };
    },
    withDiscordNetworkRetry: async (fn) => fn(),
    splitForDiscord: (text) => [text],
    getSession: () => session,
    ensureWorkspace: () => '/repo/demo',
    saveDb: () => {
      saveCount += 1;
    },
    clearSessionId: (currentSession) => {
      currentSession.runnerSessionId = null;
      currentSession.codexThreadId = null;
    },
    getSessionId: (currentSession) => currentSession.runnerSessionId || currentSession.codexThreadId || null,
    setSessionId: (currentSession, value) => {
      currentSession.runnerSessionId = value;
      currentSession.codexThreadId = value;
    },
    getSessionProvider: (currentSession) => currentSession.provider || 'codex',
    getSessionLanguage: (currentSession) => currentSession.language || 'zh',
    normalizeUiLanguage: (value) => (String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh'),
    getProviderDisplayName: (provider) => provider === 'codex' ? 'Codex CLI' : provider,
    getProviderShortName: (provider) => provider === 'codex' ? 'Codex' : provider,
    getProviderDefaultBin: () => 'codex',
    getProviderBinEnvName: () => 'CODEX_BIN',
    resolveTimeoutSetting: () => ({ timeoutMs: 60_000, source: 'session override' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard', source: 'env default' }),
    resolveCompactEnabledSetting: () => ({ enabled: true, source: 'env default' }),
    resolveCompactThresholdSetting: () => ({ tokens: 200_000, source: 'env default' }),
    formatWorkspaceBusyReport: () => 'busy',
    formatTimeoutLabel: (timeoutMs) => `${timeoutMs}ms`,
    setActiveRun: (channelState, message, prompt, child = null, phase = 'exec') => {
      channelState.activeRun = {
        messageId: message.id,
        prompt,
        child,
        phase,
        queue: channelState.queue,
        completedSteps: [],
        recentActivities: [],
        progressPlan: null,
      };
    },
    acquireWorkspace: async () => ({ acquired: true, aborted: false, release() {} }),
    stopChildProcess: () => {},
    runTask: async (options) => {
      options.onSpawn?.({ pid: 123 });
      return {
        ok: true,
        cancelled: false,
        timedOut: false,
        error: '',
        logs: [],
        notes: [],
        reasonings: ['thinking'],
        messages: ['done'],
        finalAnswerMessages: ['final answer'],
        threadId: 'sess-2',
        usage: { input_tokens: 321 },
      };
    },
    isCliNotFound: () => false,
    slashRef: (name) => `/bot-${name}`,
    safeError: (err) => err?.message || String(err),
    truncate: (text, max) => (String(text || '').length <= max ? String(text || '') : `${String(text).slice(0, max - 3)}...`),
    toOptionalInt: (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.floor(n) : null;
    },
    extractInputTokensFromUsage: (usage) => usage?.input_tokens ?? null,
    composeFinalAnswerText: ({ finalAnswerMessages }) => finalAnswerMessages.join('\n\n'),
  };

  return {
    session,
    replyLog,
    progressCalls,
    get saveCount() {
      return saveCount;
    },
    orchestrator: createPromptOrchestrator({ ...deps, ...overrides }),
  };
}

test('createPromptOrchestrator.shouldCompactSession respects strategy threshold and session binding', () => {
  const { session, orchestrator } = createOrchestrator();
  session.lastInputTokens = 250_000;

  assert.equal(orchestrator.shouldCompactSession(session), true);

  session.runnerSessionId = null;
  session.codexThreadId = null;
  assert.equal(orchestrator.shouldCompactSession(session), false);
});

test('createPromptOrchestrator.composeResultText renders reasoning answer notes and session label', () => {
  const { session, orchestrator } = createOrchestrator();

  const text = orchestrator.composeResultText({
    reasonings: ['step one', 'step two'],
    messages: ['fallback'],
    finalAnswerMessages: ['final answer'],
    notes: ['auto reset'],
    threadId: 'sess-9',
  }, session);

  assert.match(text, /🧠 Reasoning/);
  assert.match(text, /final answer/);
  assert.match(text, /• auto reset/);
  assert.match(text, /• session: \*\*demo\*\* \(`sess-9`\)/);
});

test('createPromptOrchestrator.handlePrompt runs task updates session and replies with result', async () => {
  const harness = createOrchestrator();
  const { session, replyLog, progressCalls, orchestrator } = harness;
  const message = {
    id: 'msg-1',
    channel: {
      async sendTyping() {},
      async send(payload) {
        replyLog.push(payload);
      },
    },
  };
  const channelState = { queue: [], cancelRequested: false, activeRun: null };

  const outcome = await orchestrator.handlePrompt(message, 'thread-1', 'do work', channelState);

  assert.deepEqual(outcome, { ok: true, cancelled: false });
  assert.equal(session.runnerSessionId, 'sess-2');
  assert.equal(session.codexThreadId, 'sess-2');
  assert.equal(session.lastInputTokens, 321);
  assert.equal(harness.saveCount > 0, true);
  assert.equal(replyLog.length, 1);
  assert.match(replyLog[0], /final answer/);
  assert.match(replyLog[0], /• session: \*\*demo\*\* \(`sess-2`\)/);
  assert.deepEqual(progressCalls[0], {
    type: 'start',
    initialLatestStep: '等待 workspace 锁：/repo/demo',
  });
  assert.deepEqual(progressCalls[1], {
    type: 'setLatestStep',
    text: '已获取 workspace 锁：/repo/demo',
  });
  assert.deepEqual(progressCalls[2], {
    type: 'sync',
    options: { forceEmit: true },
  });
  assert.deepEqual(progressCalls[3], {
    type: 'finish',
    outcome: { ok: true, cancelled: false, timedOut: false, error: '' },
  });
});
