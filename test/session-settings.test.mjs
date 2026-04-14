import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionSettings,
  describeCompactStrategy,
  formatLanguageLabel,
  normalizeCompactStrategy,
  normalizeSessionFastMode,
  normalizeSessionRuntimeMode,
  normalizeUiLanguage,
  parseCompactConfigAction,
  parseCompactConfigFromText,
  parseFastModeAction,
  parseRuntimeModeAction,
  parseReasoningEffortInput,
  parseWorkspaceCommandAction,
} from '../src/session-settings.js';

test('session-settings normalizes ui language labels and fallbacks', () => {
  const settings = createSessionSettings({ defaultUiLanguage: 'en' });

  assert.equal(normalizeUiLanguage('中文'), 'zh');
  assert.equal(normalizeUiLanguage('EN-us'), 'en');
  assert.equal(settings.getSessionLanguage({ language: 'zh-cn' }), 'zh');
  assert.equal(settings.getSessionLanguage({}), 'en');
  assert.equal(formatLanguageLabel('en'), 'en (English)');
  assert.equal(formatLanguageLabel('zh'), 'zh (中文)');
});

test('session-settings resolves timeout security profile and compact values with overrides', () => {
  const settings = createSessionSettings({
    defaultUiLanguage: 'zh',
    securityProfile: 'team',
    codexTimeoutMs: 60_000,
    taskMaxAttempts: 3,
    taskRetryBaseDelayMs: 1000,
    taskRetryMaxDelayMs: 8000,
    compactStrategy: 'native',
    compactOnThreshold: false,
    maxInputTokensBeforeCompact: 250_000,
    modelAutoCompactTokenLimit: 320_000,
  });

  assert.deepEqual(settings.getEffectiveSecurityProfile({ securityProfile: 'public' }), {
    profile: 'public',
    source: 'session override',
  });
  assert.deepEqual(settings.getEffectiveSecurityProfile({}), {
    profile: 'team',
    source: 'env default',
  });
  assert.deepEqual(settings.resolveTimeoutSetting({ timeoutMs: '45000' }), {
    timeoutMs: 45_000,
    source: 'session override',
  });
  assert.deepEqual(settings.resolveTimeoutSetting({}), {
    timeoutMs: 60_000,
    source: 'env default',
  });
  assert.deepEqual(settings.resolveFastModeSetting({ provider: 'codex', fastMode: 'on' }), {
    enabled: true,
    supported: true,
    source: 'session override',
  });
  assert.deepEqual(settings.resolveFastModeSetting({ provider: 'codex' }), {
    enabled: true,
    supported: true,
    source: 'config.toml',
  });
  assert.deepEqual(settings.resolveTaskRetrySetting({
    taskMaxAttempts: '4',
    taskRetryBaseDelayMs: '1500',
    taskRetryMaxDelayMs: '9000',
  }), {
    maxAttempts: 4,
    baseDelayMs: 1500,
    maxDelayMs: 9000,
    source: 'session override',
  });
  assert.deepEqual(settings.resolveTaskRetrySetting({}), {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    source: 'env default',
  });
  assert.deepEqual(settings.resolveCompactStrategySetting({ compactStrategy: 'hard' }), {
    strategy: 'hard',
    source: 'session override',
  });
  assert.deepEqual(settings.resolveCompactEnabledSetting({ compactEnabled: 'on' }), {
    enabled: true,
    source: 'session override',
  });
  assert.deepEqual(settings.resolveCompactThresholdSetting({ compactThresholdTokens: '123456' }), {
    tokens: 123_456,
    source: 'session override',
  });
  assert.deepEqual(settings.resolveNativeCompactTokenLimitSetting({ compactThresholdTokens: '200000' }), {
    tokens: 200_000,
    source: 'session threshold fallback',
  });
  assert.deepEqual(settings.resolveNativeCompactTokenLimitSetting({}), {
    tokens: 320_000,
    source: 'env default',
  });
});

test('session-settings lets thread fast mode inherit the parent channel provider-scoped override', () => {
  const parentSession = {
    provider: 'claude',
    providers: {
      claude: {
        runnerSessionId: null,
        codexThreadId: null,
        lastInputTokens: null,
        model: null,
        effort: null,
        fastMode: null,
        compactStrategy: null,
        compactEnabled: null,
        compactThresholdTokens: null,
        nativeCompactTokenLimit: null,
        configOverrides: [],
      },
      codex: {
        runnerSessionId: null,
        codexThreadId: null,
        lastInputTokens: null,
        model: 'gpt-5.4-turbo',
        effort: 'medium',
        fastMode: true,
        compactStrategy: 'native',
        compactEnabled: null,
        compactThresholdTokens: null,
        nativeCompactTokenLimit: null,
        configOverrides: [],
      },
    },
  };
  const settings = createSessionSettings({
    getParentSession: () => parentSession,
    readCodexDefaults: () => ({ model: 'gpt-5.4', effort: 'high', fastMode: false }),
    normalizeProvider: (provider) => String(provider || '').trim().toLowerCase() || 'codex',
  });

  assert.deepEqual(settings.resolveFastModeSetting({
    provider: 'codex',
    parentChannelId: 'channel-1',
    fastMode: null,
  }), {
    enabled: true,
    supported: true,
    source: 'parent channel',
  });
  assert.deepEqual(settings.resolveModelSetting({
    provider: 'codex',
    parentChannelId: 'channel-1',
    model: null,
  }), {
    value: 'gpt-5.4-turbo',
    source: 'parent channel',
  });
  assert.deepEqual(settings.resolveReasoningEffortSetting({
    provider: 'codex',
    parentChannelId: 'channel-1',
    effort: null,
  }), {
    value: 'medium',
    source: 'parent channel',
  });
  assert.deepEqual(settings.resolveCompactStrategySetting({
    provider: 'codex',
    parentChannelId: 'channel-1',
    compactStrategy: null,
  }), {
    strategy: 'native',
    source: 'parent channel',
  });
});

test('session-settings resolves Claude runtime mode from session, parent, and env default', () => {
  const parentSession = {
    provider: 'claude',
    providers: {
      claude: {
        runnerSessionId: null,
        codexThreadId: null,
        lastInputTokens: null,
        model: null,
        effort: null,
        fastMode: null,
        runtimeMode: 'long',
        compactStrategy: null,
        compactEnabled: null,
        compactThresholdTokens: null,
        nativeCompactTokenLimit: null,
        configOverrides: [],
      },
    },
  };
  const settings = createSessionSettings({
    claudeRuntimeMode: 'normal',
    getParentSession: () => parentSession,
    normalizeProvider: (provider) => String(provider || '').trim().toLowerCase() || 'codex',
  });

  assert.deepEqual(settings.resolveRuntimeModeSetting({ provider: 'claude', runtimeMode: 'normal' }), {
    mode: 'normal',
    supported: true,
    source: 'session override',
  });
  assert.deepEqual(settings.resolveRuntimeModeSetting({ provider: 'claude', runtimeMode: null, parentChannelId: 'channel-1' }), {
    mode: 'long',
    supported: true,
    source: 'parent channel',
  });
  assert.deepEqual(settings.resolveRuntimeModeSetting({ provider: 'claude', runtimeMode: null }), {
    mode: 'long',
    supported: true,
    source: 'parent channel',
  });
  assert.deepEqual(createSessionSettings({ claudeRuntimeMode: 'hot' }).resolveRuntimeModeSetting({ provider: 'claude' }), {
    mode: 'long',
    supported: true,
    source: 'env default',
  });
  assert.deepEqual(settings.resolveRuntimeModeSetting({ provider: 'codex', runtimeMode: 'long' }), {
    mode: 'normal',
    supported: false,
    source: 'provider unsupported',
  });
});

test('session-settings parses compact, reasoning and workspace command inputs', () => {
  assert.deepEqual(parseCompactConfigAction('strategy', 'native'), {
    type: 'set_strategy',
    strategy: 'native',
  });
  assert.deepEqual(parseCompactConfigAction('enabled', 'off'), {
    type: 'set_enabled',
    enabled: false,
  });
  assert.deepEqual(parseCompactConfigFromText('token_limit 99999'), {
    type: 'set_threshold',
    tokens: 99_999,
  });
  assert.deepEqual(parseCompactConfigFromText('continue'), { type: 'invalid' });
  assert.deepEqual(parseCompactConfigFromText('reset'), { type: 'reset' });
  assert.deepEqual(parseFastModeAction('on'), { type: 'set', enabled: true });
  assert.deepEqual(parseFastModeAction('default'), { type: 'set', enabled: null });
  assert.deepEqual(parseFastModeAction('status'), { type: 'status' });
  assert.equal(normalizeSessionFastMode('off'), false);
  assert.deepEqual(parseRuntimeModeAction('long'), { type: 'set', mode: 'long' });
  assert.deepEqual(parseRuntimeModeAction('default'), { type: 'set', mode: null });
  assert.deepEqual(parseRuntimeModeAction('status'), { type: 'status' });
  assert.equal(normalizeSessionRuntimeMode('hot'), 'long');
  assert.deepEqual(parseWorkspaceCommandAction('browse'), { type: 'browse' });
  assert.deepEqual(parseWorkspaceCommandAction('~/repo'), { type: 'set', value: '~/repo' });
  assert.equal(parseReasoningEffortInput('HIGH'), 'high');
  assert.equal(parseReasoningEffortInput('default', { allowDefault: true }), 'default');
  assert.equal(parseReasoningEffortInput('invalid'), null);
});

test('session-settings provides compact descriptions and provider defaults', () => {
  const warnings = [];
  const settings = createSessionSettings({
    readCodexDefaults: () => ({ model: 'gpt-5-codex', effort: 'high', fastMode: true }),
    normalizeProvider: (provider) => String(provider || '').trim().toLowerCase() || 'codex',
    getSupportedCompactStrategies: () => ['hard', 'native', 'off'],
  });

  assert.equal(normalizeCompactStrategy('native'), 'native');
  assert.equal(normalizeCompactStrategy('weird', { logger: { warn: (line) => warnings.push(line) } }), 'hard');
  assert.match(warnings[0], /Unknown COMPACT_STRATEGY=weird/);
  assert.equal(describeCompactStrategy('native', 'zh'), 'native（由 provider CLI 原生压缩并继续当前 session）');
  assert.deepEqual(settings.resolveCompactStrategySetting({ provider: 'gemini' }), {
    strategy: 'native',
    source: 'env default',
  });
  assert.deepEqual(settings.getProviderDefaults('codex'), {
    model: 'gpt-5-codex',
    effort: 'high',
    fastMode: true,
    source: 'config.toml',
  });
  assert.deepEqual(settings.getProviderDefaults('gemini'), {
    model: null,
    effort: null,
    fastMode: false,
    source: 'provider',
  });
});

test('session-settings uses DEFAULT_MODEL as the resolved provider model fallback', () => {
  const settings = createSessionSettings({
    defaultModel: 'gpt-5.4',
    readCodexDefaults: () => ({
      model: null,
      modelConfigured: false,
      effort: null,
      effortConfigured: false,
      fastMode: true,
    }),
    normalizeProvider: (provider) => String(provider || '').trim().toLowerCase() || 'codex',
  });

  assert.deepEqual(settings.resolveModelSetting({ provider: 'codex', model: null }), {
    value: 'gpt-5.4',
    source: 'env default',
  });
  assert.deepEqual(settings.resolveModelSetting({ provider: 'gemini', model: null }), {
    value: 'gpt-5.4',
    source: 'env default',
  });
  assert.deepEqual(settings.getProviderDefaults('gemini'), {
    model: 'gpt-5.4',
    effort: null,
    fastMode: false,
    source: 'env default',
  });
});
