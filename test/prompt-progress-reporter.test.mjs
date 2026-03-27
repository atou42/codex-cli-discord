import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProgressEventDedupeKey,
  createProgressEventDeduper,
} from '../src/codex-event-utils.js';
import { createPromptProgressReporterFactory } from '../src/prompt-progress-reporter.js';

function clonePlan(plan) {
  return plan ? JSON.parse(JSON.stringify(plan)) : null;
}

function appendUnique(list, value) {
  const text = String(value || '').trim();
  if (!text || list.includes(text)) return;
  list.push(text);
}

function createHarness(overrides = {}) {
  let currentNow = 10_000;
  const sent = [];
  const edits = [];
  const intervals = [];
  const cleared = [];
  const channelState = {
    queue: ['queued-1'],
    activeRun: {
      phase: 'workspace',
      progressPlan: null,
      completedSteps: [],
      recentActivities: [],
    },
  };
  const message = { id: 'msg-1', author: { id: '12345' } };

  const createProgressReporter = createPromptProgressReporterFactory({
    defaultUiLanguage: 'zh',
    progressUpdatesEnabled: true,
    progressProcessLines: 2,
    progressUpdateIntervalMs: 5000,
    progressEventFlushMs: 0,
    progressEventDedupeWindowMs: 2500,
    progressIncludeStdout: true,
    progressIncludeStderr: false,
    progressTextPreviewChars: 120,
    progressProcessPushIntervalMs: 1000,
    progressMessageMaxChars: 1800,
    progressPlanMaxLines: 4,
    progressDoneStepsMax: 4,
    safeReply: async (_message, body) => {
      sent.push(body);
      return {
        id: 'progress-1',
        async edit(nextBody) {
          edits.push(nextBody);
        },
      };
    },
    normalizeUiLanguage: (value) => (String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh'),
    slashRef: (name) => `/bot-${name}`,
    resolveReasoningEffortSetting: (session) => ({
      value: session?.effort || 'high',
      source: session?.effort ? 'session override' : 'config.toml',
    }),
    resolveFastModeSetting: (session) => ({
      enabled: Boolean(session?.fastMode),
      supported: session?.provider === 'codex',
      source: session?.fastMode ? 'session override' : 'config.toml',
    }),
    truncate: (text, max) => {
      const value = String(text || '');
      return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
    },
    humanElapsed: (ms) => `${ms}ms`,
    createProgressEventDeduper,
    buildProgressEventDedupeKey,
    presentation: {
      summarizeCodexEvent: (event) => event.summaryStep || '',
      extractRawProgressTextFromEvent: (event) => event.rawActivity || '',
      cloneProgressPlan: clonePlan,
      extractPlanStateFromEvent: (event) => clonePlan(event.planState),
      extractCompletedStepFromEvent: (event) => event.completedStep || '',
      appendCompletedStep: appendUnique,
      appendRecentActivity: appendUnique,
      formatProgressPlanSummary: (planState) => JSON.stringify(planState?.steps || []),
      renderProcessContentLines: (activities, _language, count) => (
        activities.slice(-count).map((line) => `process: ${line}`)
      ),
      localizeProgressLines: (lines) => lines,
      renderProgressPlanLines: (planState) => (
        Array.isArray(planState?.steps) && planState.steps.length
          ? [`plan: ${planState.steps.length}`]
          : []
      ),
      renderCompletedStepsLines: (steps) => steps.map((step) => `done: ${step}`),
      formatRuntimePhaseLabel: (phase) => String(phase || ''),
    },
    now: () => currentNow,
    setIntervalFn: (fn, ms) => {
      const handle = { fn, ms, unref() {} };
      intervals.push(handle);
      return handle;
    },
    clearIntervalFn: (handle) => {
      cleared.push(handle);
    },
    ...overrides.factoryOptions,
  });

  return {
    sent,
    edits,
    intervals,
    cleared,
    channelState,
    message,
    reporter: createProgressReporter({
      message,
      channelState,
      session: overrides.session || { provider: 'codex', fastMode: true },
      language: overrides.language || 'en',
      initialLatestStep: overrides.initialLatestStep || 'Waiting for workspace lock: /repo/demo',
    }),
    advance(ms) {
      currentNow += ms;
    },
  };
}

test('createPromptProgressReporterFactory seeds initial step and updates final progress card', async () => {
  const harness = createHarness();

  await harness.reporter.start();
  assert.match(harness.sent[0].content, /Waiting for workspace lock: \/repo\/demo/);
  assert.deepEqual(harness.sent[0].components, []);
  assert.match(harness.sent[0].content, /effort: high/);
  assert.match(harness.sent[0].content, /fast mode: on \(this channel\)/);
  assert.match(harness.sent[0].content, /!c/);
  assert.doesNotMatch(harness.sent[0].content, /\/bot-status/);
  assert.doesNotMatch(harness.sent[0].content, /!cancel/);
  assert.equal(harness.channelState.activeRun.lastProgressText, 'Waiting for workspace lock: /repo/demo');
  assert.equal(harness.channelState.activeRun.progressMessageId, 'progress-1');

  harness.channelState.activeRun.phase = 'exec';
  harness.advance(50);
  harness.reporter.setLatestStep('Workspace lock acquired: /repo/demo');
  assert.match(harness.edits[0].content, /Workspace lock acquired: \/repo\/demo/);
  assert.deepEqual(harness.edits[0].components, []);

  await harness.reporter.finish({ ok: true });
  assert.match(harness.edits[harness.edits.length - 1].content, /✅ \*\*Task Completed\*\*/);
  assert.match(harness.edits[harness.edits.length - 1].content, /• phase: done/);
  assert.match(harness.edits[harness.edits.length - 1].content, /• latest activity: Final response sent/);
  assert.deepEqual(harness.edits[harness.edits.length - 1].components, []);
  assert.equal(harness.channelState.activeRun.phase, 'done');
  assert.equal(harness.cleared.length, 2);
});

test('createPromptProgressReporterFactory dedupes repeated events and drains buffered activity on finish', async () => {
  const harness = createHarness();

  await harness.reporter.start();
  harness.channelState.activeRun.phase = 'exec';

  const planState = {
    steps: [
      { step: 'Inspect code', status: 'completed' },
      { step: 'Edit code', status: 'in_progress' },
    ],
  };

  harness.reporter.onEvent({
    summaryStep: 'Searching files',
    rawActivity: 'rg src',
    planState,
  });
  harness.reporter.onEvent({
    summaryStep: 'Searching files',
    rawActivity: 'rg src',
    planState,
  });
  harness.reporter.onEvent({
    summaryStep: 'Updating tests',
    rawActivity: 'rg test',
    completedStep: 'Patch orchestrator',
  });

  assert.equal(harness.channelState.activeRun.progressEvents, 2);
  assert.deepEqual(harness.channelState.activeRun.completedSteps, ['Inspect code', 'Patch orchestrator']);
  assert.deepEqual(harness.channelState.activeRun.recentActivities, ['rg src']);

  await harness.reporter.finish({ ok: true });

  const finalCard = harness.edits[harness.edits.length - 1].content;
  assert.match(finalCard, /process: rg src/);
  assert.match(finalCard, /process: rg test/);
  assert.match(finalCard, /done: Inspect code/);
  assert.match(finalCard, /done: Patch orchestrator/);
});

test('createPromptProgressReporterFactory ignores stderr when disabled and keeps stdout progress', async () => {
  const harness = createHarness();

  await harness.reporter.start();
  harness.channelState.activeRun.phase = 'exec';

  harness.reporter.onLog('warning', 'stderr');
  assert.equal(harness.channelState.activeRun.progressEvents, 0);

  harness.reporter.onLog('stdout line', 'stdout');
  assert.equal(harness.channelState.activeRun.progressEvents, 1);
  assert.equal(harness.channelState.activeRun.lastProgressText, 'stdout: stdout line');
  assert.match(harness.edits[harness.edits.length - 1].content, /stdout: stdout line/);
});

test('createPromptProgressReporterFactory truncates overflowing cards on line boundaries', async () => {
  const harness = createHarness({
    factoryOptions: {
      progressMessageMaxChars: 120,
    },
  });

  await harness.reporter.start();
  harness.channelState.activeRun.phase = 'exec';

  harness.reporter.onEvent({ summaryStep: 'Locate regression', rawActivity: 'inspect dispatcher' });
  harness.reporter.onEvent({ summaryStep: 'Inspect renderer', rawActivity: 'inspect renderer' });
  harness.reporter.onEvent({ summaryStep: 'Inspect bridge', rawActivity: 'inspect bridge' });
  harness.reporter.onEvent({ summaryStep: 'Patch tests', rawActivity: 'patch tests' });

  const runningCard = harness.edits[harness.edits.length - 1].content;
  assert.match(runningCard, /\n\.\.\.$/);

  await harness.reporter.finish({ ok: true });
  const finalCard = harness.edits[harness.edits.length - 1].content;
  assert.match(finalCard, /\n\.\.\.$/);
});

test('createPromptProgressReporterFactory derives Claude commentary and tool progress from stream events', async () => {
  const harness = createHarness({
    session: { provider: 'claude' },
  });

  await harness.reporter.start();
  harness.channelState.activeRun.phase = 'exec';

  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'message_start',
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'text',
        text: '',
      },
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: '我来查看',
      },
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: '当前目录。',
      },
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_stop',
      index: 0,
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'call_pwd',
        name: 'Bash',
        input: {},
      },
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'input_json_delta',
        partial_json: '{"command":"pwd","description":"Show current working directory"}',
      },
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'content_block_stop',
      index: 1,
    },
  });
  harness.reporter.onEvent({
    type: 'stream_event',
    event: {
      type: 'message_delta',
      delta: {
        stop_reason: 'tool_use',
      },
    },
  });
  harness.reporter.onEvent({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_pwd',
          content: '/tmp/demo',
        },
      ],
    },
  });

  await harness.reporter.finish({ ok: true });

  const finalCard = harness.edits[harness.edits.length - 1].content;
  assert.match(finalCard, /process: 我来查看当前目录。/);
  assert.match(finalCard, /process: Bash: run: pwd/);
  assert.match(finalCard, /done: Bash: run: pwd/);
});
