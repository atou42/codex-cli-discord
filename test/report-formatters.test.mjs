import test from 'node:test';
import assert from 'node:assert/strict';

import { createReportFormatters } from '../src/report-formatters.js';

function createFormatters(overrides = {}) {
  const base = {
    botProvider: null,
    allowedChannelIds: new Set(['channel-1', 'channel-2']),
    allowedUserIds: new Set(['user-1']),
    progressProcessLines: 3,
    progressPlanMaxLines: 3,
    progressDoneStepsMax: 3,
    slashRef: (name) => `/bot-${name}`,
    getSessionLanguage: (session) => session?.language || 'zh',
    normalizeUiLanguage: (value) => (String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh'),
    getSessionProvider: (session) => session?.provider || 'codex',
    getProviderDisplayName: (provider) => {
      if (provider === 'gemini') return 'Gemini CLI';
      if (provider === 'claude') return 'Claude Code';
      return 'Codex CLI';
    },
    getProviderShortName: (provider) => {
      if (provider === 'gemini') return 'Gemini';
      if (provider === 'claude') return 'Claude';
      return 'Codex';
    },
    getProviderDefaults: () => ({ model: 'gpt-5-codex', effort: 'high', source: 'config.toml' }),
    getCliHealth: (provider) => ({ ok: true, version: '1.2.3', bin: `/usr/local/bin/${provider}` }),
    getRuntimeSnapshot: () => ({
      running: false,
      queued: 2,
      progressPlan: null,
      completedSteps: [],
      recentActivities: [],
      progressText: 'building',
      progressAgoMs: 1_234,
      messageId: 'msg-1',
      progressMessageId: 'progress-1',
      progressEvents: 4,
      activeSinceMs: 3_000,
      pid: 1234,
      phase: 'exec',
    }),
    resolveSecurityContext: () => ({ mentionOnly: false, maxQueuePerChannel: 20, profile: 'team' }),
    resolveTimeoutSetting: () => ({ timeoutMs: 60_000, source: 'session override' }),
    getEffectiveSecurityProfile: () => ({ profile: 'public', source: 'session override' }),
    resolveCompactStrategySetting: () => ({ strategy: 'native', source: 'session override' }),
    resolveCompactEnabledSetting: () => ({ enabled: true, source: 'env default' }),
    resolveCompactThresholdSetting: () => ({ tokens: 272_000, source: 'session override' }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 320_000, source: 'session threshold fallback' }),
    getWorkspaceBinding: (session, key) => ({
      workspaceDir: session?.workspaceDir || `/repo/${key}`,
      source: session?.workspaceDir ? 'thread override' : 'provider default',
      defaultWorkspaceDir: '/repo/default',
      defaultSource: 'provider-scoped env',
      defaultEnvKey: 'CODEX__DEFAULT_WORKSPACE_DIR',
    }),
    readWorkspaceLock: () => ({ owner: { key: 'thread-9' } }),
    formatCliHealth: (health) => `ok ${health.version}`,
    formatPermissionsLabel: (_session, language) => (language === 'en' ? 'sandboxed' : '沙盒模式'),
    formatLanguageLabel: (language) => (language === 'en' ? 'en (English)' : 'zh (中文)'),
    formatSecurityProfileDisplay: (security) => `${security.profile || 'team'} profile`,
    formatSecurityProfileLabel: (profile) => String(profile || 'team'),
    formatQueueLimit: (limit) => String(limit),
    formatRuntimeLabel: (runtime, language = 'en') => {
      if (!runtime.running) return language === 'en' ? 'idle' : '空闲';
      return language === 'en' ? 'running' : '运行中';
    },
    formatTimeoutLabel: (timeoutMs) => `${timeoutMs}ms`,
    describeCompactStrategy: (strategy, language = 'en') => (
      language === 'en' ? `strategy:${strategy}` : `策略:${strategy}`
    ),
    humanAge: (ms) => `${Math.round(ms / 1000)}s`,
    formatTokenValue: (value) => (value === null || value === undefined ? '-' : String(value)),
    formatConfigCommandStatus: () => 'enabled',
    describeConfigPolicy: () => 'personality,model_reasoning_effort',
    formatSessionStatusLabel: (session) => (session?.name ? `**${session.name}** (\`sess-1\`)` : '`sess-1`'),
    formatProgressPlanSummary: () => '1/3 completed',
    formatCompletedStepsSummary: () => 'bootstrap',
    renderProcessContentLines: () => ['• process content:', '  · compiling'],
    localizeProgressLines: (lines, language = 'en') => (
      language === 'en' ? lines : lines.map((line) => line.replace(/^• plan:/, '• 计划：'))
    ),
    renderProgressPlanLines: () => ['• plan: 1/3 completed'],
    renderCompletedStepsLines: () => ['• completed steps: bootstrap'],
  };

  return createReportFormatters({ ...base, ...overrides });
}

test('createReportFormatters.formatStatusReport uses provider defaults for model and effort', () => {
  const formatters = createFormatters();
  const session = {
    provider: 'codex',
    language: 'en',
    mode: 'safe',
    lastInputTokens: 321,
    name: 'alpha',
  };

  const report = formatters.formatStatusReport('thread-1', session, { id: 'channel-1' });

  assert.match(report, /model: gpt-5-codex _\(config\.toml\)_/);
  assert.match(report, /effort: high _\(config\.toml\)_/);
  assert.match(report, /workspace: `\/repo\/thread-1` \(provider default\)/);
  assert.doesNotMatch(report, /\(unknown\)/);
});

test('createReportFormatters.formatProgressReport returns localized idle hint', () => {
  const formatters = createFormatters({
    resolveSecurityContext: () => ({ mentionOnly: true, maxQueuePerChannel: 5, profile: 'public' }),
  });

  const report = formatters.formatProgressReport('thread-1', { language: 'zh' }, { id: 'channel-1' });

  assert.match(report, /当前没有运行中的任务/);
  assert.match(report, /队列上限: 5/);
  assert.match(report, /`\/bot-progress`/);
});

test('createReportFormatters.formatDoctorReport includes allowlist and workspace lock diagnostics', () => {
  const formatters = createFormatters({ botProvider: 'gemini' });
  const session = { provider: 'gemini', language: 'en', workspaceDir: '/repo/live' };

  const report = formatters.formatDoctorReport('thread-1', session, { id: 'channel-1' });

  assert.match(report, /bot mode: locked to `gemini` \(Gemini CLI\)/);
  assert.match(report, /workspace serialization: busy/);
  assert.match(report, /ALLOWED_CHANNEL_IDS: 2 configured/);
  assert.match(report, /ALLOWED_USER_IDS: 1 configured/);
});

test('createReportFormatters.formatHelpReport documents browse actions and provider switching', () => {
  const sharedFormatters = createFormatters();
  const lockedFormatters = createFormatters({ botProvider: 'codex' });

  const sharedHelp = sharedFormatters.formatHelpReport({ language: 'en' });
  const lockedHelp = lockedFormatters.formatHelpReport({ language: 'en' });

  assert.match(sharedHelp, /!provider <codex\|claude\|gemini\|status>/);
  assert.match(sharedHelp, /!setdir <path\|browse\|default\|status>/);
  assert.match(sharedHelp, /!setdefaultdir <path\|browse\|clear\|status>/);
  assert.doesNotMatch(lockedHelp, /!provider <codex\|claude\|gemini\|status>/);
});

test('createReportFormatters.workspace reports explain session reset and lock owner', () => {
  const formatters = createFormatters();

  const updateReport = formatters.formatWorkspaceUpdateReport(
    'thread-1',
    { provider: 'gemini', language: 'en', workspaceDir: '/repo/next' },
    { sessionReset: true, clearedOverride: false },
  );
  const busyReport = formatters.formatWorkspaceBusyReport(
    { language: 'zh' },
    '/repo/next',
    { provider: 'gemini', key: 'thread-9', acquiredAt: '2026-03-13T08:00:00.000Z' },
  );

  assert.match(updateReport, /reset because Gemini cannot resume into a different workspace/);
  assert.match(busyReport, /workspace 正忙/);
  assert.match(busyReport, /当前持有 provider: `gemini`/);
  assert.match(busyReport, /当前持有频道: `thread-9`/);
});

test('createReportFormatters config helpers and reports remain available from one factory', () => {
  const formatters = createFormatters();

  const compactHelp = formatters.formatCompactStrategyConfigHelp('en');
  const compactReport = formatters.formatCompactConfigReport('zh', {}, true);
  const timeoutHelp = formatters.formatTimeoutConfigHelp('en');
  const languageReport = formatters.formatLanguageConfigReport('en', true);
  const profileReport = formatters.formatProfileConfigReport('zh', 'team', false);
  const effortHelp = formatters.formatReasoningEffortHelp('zh');

  assert.match(compactHelp, /\/bot-compact key:<\.\.\.> value:<\.\.\.>/);
  assert.match(compactReport, /compact 配置已更新/);
  assert.match(compactReport, /策略:native（频道覆盖）/);
  assert.match(timeoutHelp, /\/bot-timeout <ms\|off\|status>/);
  assert.equal(languageReport, '✅ Message language set to en (English)');
  assert.equal(profileReport, 'ℹ️ 当前安全策略 profile 为 team');
  assert.equal(effortHelp, '用法：`!effort <xhigh|high|medium|low|default>`');
});
