import test from 'node:test';
import assert from 'node:assert/strict';

import { createPromptOrchestrator } from '../src/prompt-orchestrator.js';

function createHarness(overrides = {}) {
  const session = {
    provider: 'codex',
    runnerSessionId: 'sess-1',
    codexThreadId: 'sess-1',
    language: 'zh',
    lastInputTokens: 0,
    name: 'demo',
  };

  const replyLog = [];
  const orchestrator = createPromptOrchestrator({
    safeReply: async (_message, payload) => {
      replyLog.push(payload);
      return { id: `reply-${replyLog.length}`, edit: async () => {} };
    },
    safeChannelSend: async () => {},
    withDiscordNetworkRetry: async (fn) => fn(),
    splitForDiscord: (text) => [text],
    getSession: () => session,
    ensureWorkspace: () => '/repo/demo',
    saveDb: () => {},
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
    getProviderDisplayName: () => 'Codex CLI',
    getProviderShortName: () => 'Codex',
    formatProviderSessionTerm: () => 'rollout session',
    getProviderDefaultBin: () => 'codex',
    getProviderBinEnvName: () => 'CODEX_BIN',
    resolveTimeoutSetting: () => ({ timeoutMs: 60_000, source: 'session override' }),
    resolveTaskRetrySetting: () => ({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0, source: 'test' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard', source: 'env default' }),
    resolveCompactEnabledSetting: () => ({ enabled: false, source: 'env default' }),
    resolveCompactThresholdSetting: () => ({ tokens: 200_000, source: 'env default' }),
    resolveReplyDeliverySetting: () => ({ mode: 'card_only', source: 'env default' }),
    formatWorkspaceBusyReport: () => 'busy',
    formatTimeoutLabel: (timeoutMs) => `${timeoutMs}ms`,
    setActiveRun: (channelState, message, prompt, child = null, phase = 'exec') => {
      channelState.activeRun = {
        messageId: message?.id || null,
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
    createProgressReporter: () => ({
      async start() {},
      sync() {},
      setLatestStep() {},
      onEvent() {},
      onLog() {},
      async finish() {},
    }),
    runTask: async (options) => {
      options.onSpawn?.({ pid: 321 });
      return {
        ok: true,
        cancelled: false,
        timedOut: false,
        error: '',
        logs: [],
        notes: [],
        reasonings: [],
        messages: ['done'],
        finalAnswerMessages: ['final answer'],
        threadId: 'sess-1',
        usage: { input_tokens: 111 },
      };
    },
    isCliNotFound: () => false,
    slashRef: (name) => `/bot-${name}`,
    safeError: (err) => err?.message || String(err),
    truncate: (text) => String(text || ''),
    toOptionalInt: (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.floor(n) : null;
    },
    extractInputTokensFromUsage: (usage) => usage?.input_tokens ?? null,
    composeFinalAnswerText: ({ finalAnswerMessages }) => finalAnswerMessages.join('\n\n'),
    sleep: async () => {},
    ...overrides,
  });

  return { orchestrator, replyLog, session };
}

test('createPromptOrchestrator passes native image inputs through runTask and cleans them up', async () => {
  const cleanupCalls = [];
  const runTaskCalls = [];
  const { orchestrator } = createHarness({
    prepareNativeInputs: async () => ({
      inputImages: ['/tmp/native-a.jpg', '/tmp/native-b.png'],
      promptNote: '说明：图片附件已作为原生图片输入附带。',
      notes: [],
      cleanup: async () => {
        cleanupCalls.push('cleanup');
      },
    }),
    runTask: async (options) => {
      runTaskCalls.push(options);
      options.onSpawn?.({ pid: 654 });
      return {
        ok: true,
        cancelled: false,
        timedOut: false,
        error: '',
        logs: [],
        notes: [],
        reasonings: [],
        messages: ['done'],
        finalAnswerMessages: ['final answer'],
        threadId: 'sess-1',
        usage: { input_tokens: 111 },
      };
    },
  });

  const message = {
    id: 'msg-image',
    attachments: new Map([
      ['1', { name: 'img.jpg', contentType: 'image/jpeg', url: 'https://example.com/img.jpg' }],
    ]),
    channel: {
      async sendTyping() {},
      async send() {},
    },
  };
  const channelState = { queue: [], cancelRequested: false, activeRun: null };

  const outcome = await orchestrator.handlePrompt(message, 'thread-1', 'describe image', channelState);

  assert.deepEqual(outcome, { ok: true, cancelled: false });
  assert.equal(runTaskCalls.length, 1);
  assert.deepEqual(runTaskCalls[0].inputImages, ['/tmp/native-a.jpg', '/tmp/native-b.png']);
  assert.match(runTaskCalls[0].prompt, /原生图片输入/);
  assert.deepEqual(cleanupCalls, ['cleanup']);
});
