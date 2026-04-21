import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunnerArgsBuilder, uniqueDirs } from '../src/runner-args.js';

test('uniqueDirs removes blanks and duplicates while keeping order', () => {
  assert.deepEqual(
    uniqueDirs([' /repo/a ', '', null, '/repo/b', '/repo/a', '  ', '/repo/b']),
    ['/repo/a', '/repo/b'],
  );
});

test('createRunnerArgsBuilder builds gemini args instead of codex args', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: null,
    normalizeProvider: (value) => value,
    getSessionId: (session) => session.runnerSessionId,
    resolveModelSetting: (session) => ({ value: session.model || null, source: session.model ? 'session override' : 'provider' }),
    resolveFastModeSetting: () => ({ enabled: false, source: 'provider unsupported' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard' }),
    resolveCompactEnabledSetting: () => ({ enabled: false }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 0 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'gemini',
    session: {
      provider: 'gemini',
      mode: 'dangerous',
      model: 'gemini-2.5-pro',
      runnerSessionId: 'sess-gm-1',
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'summarize the repo',
  });

  assert.deepEqual(args, [
    '--output-format',
    'stream-json',
    '--yolo',
    '--model',
    'gemini-2.5-pro',
    '--resume',
    'sess-gm-1',
    '--prompt',
    'summarize the repo',
  ]);
});

test('createRunnerArgsBuilder adds native compact config for fresh codex sessions when enabled', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: 'gpt-5-codex',
    normalizeProvider: (value) => value,
    getSessionId: () => null,
    resolveFastModeSetting: () => ({ enabled: true, source: 'session override' }),
    resolveCompactStrategySetting: () => ({ strategy: 'native' }),
    resolveCompactEnabledSetting: () => ({ enabled: true }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 123456 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'codex',
    session: {
      mode: 'safe',
      configOverrides: ['foo="bar"'],
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'inspect',
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-C',
    '/tmp/workspace',
    '-m',
    'gpt-5-codex',
    '-c',
    'features.fast_mode=true',
    '-c',
    'model_auto_compact_token_limit=123456',
    '-c',
    'foo="bar"',
    'inspect',
  ]);
});

test('createRunnerArgsBuilder keeps native compact config for resumed codex sessions', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: 'gpt-5-codex',
    normalizeProvider: (value) => value,
    getSessionId: () => 'sess-1',
    resolveFastModeSetting: () => ({ enabled: true, source: 'session override' }),
    resolveCompactStrategySetting: () => ({ strategy: 'native' }),
    resolveCompactEnabledSetting: () => ({ enabled: true }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 123456 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'codex',
    session: {
      mode: 'safe',
      configOverrides: ['foo="bar"'],
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'inspect',
  });

  assert.deepEqual(args, [
    'exec',
    'resume',
    '--json',
    '--full-auto',
    '-m',
    'gpt-5-codex',
    '-c',
    'features.fast_mode=true',
    '-c',
    'model_auto_compact_token_limit=123456',
    '-c',
    'foo="bar"',
    'sess-1',
    'inspect',
  ]);
});

test('createRunnerArgsBuilder passes native image inputs to codex exec', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: 'gpt-5-codex',
    normalizeProvider: (value) => value,
    getSessionId: () => null,
    resolveFastModeSetting: () => ({ enabled: false, source: 'config.toml' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard' }),
    resolveCompactEnabledSetting: () => ({ enabled: false }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 0 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'codex',
    session: {
      mode: 'safe',
      configOverrides: [],
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'inspect',
    inputImages: ['/tmp/image-a.jpg', '/tmp/image-b.png'],
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-C',
    '/tmp/workspace',
    '-m',
    'gpt-5-codex',
    '-c',
    'features.fast_mode=false',
    '--image',
    '/tmp/image-a.jpg',
    '--image',
    '/tmp/image-b.png',
    'inspect',
  ]);
});

test('createRunnerArgsBuilder passes fast mode through when inherited from the parent channel', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: 'gpt-5-codex',
    normalizeProvider: (value) => value,
    getSessionId: () => null,
    resolveFastModeSetting: () => ({ enabled: false, source: 'parent channel' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard' }),
    resolveCompactEnabledSetting: () => ({ enabled: false }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 0 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'codex',
    session: {
      mode: 'safe',
      configOverrides: [],
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'inspect',
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-C',
    '/tmp/workspace',
    '-m',
    'gpt-5-codex',
    '-c',
    'features.fast_mode=false',
    'inspect',
  ]);
});

test('createRunnerArgsBuilder uses inherited model and effort settings', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: 'gpt-5-codex',
    normalizeProvider: (value) => value,
    getSessionId: () => null,
    resolveModelSetting: () => ({ value: 'gpt-5.4', source: 'parent channel' }),
    resolveReasoningEffortSetting: () => ({ value: 'high', source: 'parent channel' }),
    resolveFastModeSetting: () => ({ enabled: false, source: 'config.toml' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard' }),
    resolveCompactEnabledSetting: () => ({ enabled: false }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 0 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'codex',
    session: {
      mode: 'safe',
      configOverrides: [],
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'inspect',
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-C',
    '/tmp/workspace',
    '-m',
    'gpt-5.4',
    '-c',
    'model_reasoning_effort="high"',
    '-c',
    'features.fast_mode=false',
    'inspect',
  ]);
});

test('createRunnerArgsBuilder explicitly disables fast mode when config.toml resolves to off', () => {
  const { buildSessionRunnerArgs } = createRunnerArgsBuilder({
    defaultModel: 'gpt-5-codex',
    normalizeProvider: (value) => value,
    getSessionId: () => null,
    resolveFastModeSetting: () => ({ enabled: false, source: 'config.toml' }),
    resolveCompactStrategySetting: () => ({ strategy: 'hard' }),
    resolveCompactEnabledSetting: () => ({ enabled: false }),
    resolveNativeCompactTokenLimitSetting: () => ({ tokens: 0 }),
  });

  const args = buildSessionRunnerArgs({
    provider: 'codex',
    session: {
      mode: 'safe',
      configOverrides: [],
    },
    workspaceDir: '/tmp/workspace',
    prompt: 'inspect',
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--full-auto',
    '-C',
    '/tmp/workspace',
    '-m',
    'gpt-5-codex',
    '-c',
    'features.fast_mode=false',
    'inspect',
  ]);
});
