import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  configureRuntimeProxy,
  createDiscordClient,
  normalizeSlashPrefix,
  readCodexDefaults,
  readCodexModelCatalog,
  readCodexProfileCatalog,
  renderMissingDiscordTokenHint,
  writeCodexDefaults,
} from '../src/runtime-bootstrap.js';

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agents-in-discord-runtime-bootstrap-'));
}

test('readCodexDefaults reads model reasoning effort and keeps fast mode on by default', () => {
  const rootDir = makeTempRoot();
  const homeDir = path.join(rootDir, 'home');
  const configDir = path.join(homeDir, '.codex');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.toml');
  fs.writeFileSync(
    configPath,
    ['model = "o3"', 'model_reasoning_effort = "high"', '[features]', 'fast_mode = true'].join('\n'),
  );

  assert.deepEqual(readCodexDefaults({ env: { HOME: homeDir } }), {
    model: 'o3',
    modelConfigured: true,
    effort: 'high',
    effortConfigured: true,
    fastMode: true,
    fastModeConfigured: true,
  });

  fs.writeFileSync(
    configPath,
    ['model = "o3"', 'model_reasoning_effort = "high"', '[features]'].join('\n'),
  );
  assert.deepEqual(readCodexDefaults({ env: { HOME: homeDir } }), {
    model: 'o3',
    modelConfigured: true,
    effort: 'high',
    effortConfigured: true,
    fastMode: true,
    fastModeConfigured: false,
  });

  fs.writeFileSync(
    configPath,
    ['model = "o3"', 'model_reasoning_effort = "high"', '[features]', 'fast_mode = false'].join('\n'),
  );
  assert.deepEqual(readCodexDefaults({ env: { HOME: homeDir } }), {
    model: 'o3',
    modelConfigured: true,
    effort: 'high',
    effortConfigured: true,
    fastMode: false,
    fastModeConfigured: true,
  });

  assert.deepEqual(readCodexDefaults({ env: { HOME: path.join(rootDir, 'missing') } }), {
    model: null,
    modelConfigured: false,
    effort: null,
    effortConfigured: false,
    fastMode: true,
    fastModeConfigured: false,
  });
});

test('writeCodexDefaults updates codex config defaults and can clear back to built-in/provider defaults', () => {
  const rootDir = makeTempRoot();
  const homeDir = path.join(rootDir, 'home');
  const configDir = path.join(homeDir, '.codex');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.toml');

  fs.writeFileSync(
    configPath,
    [
      'model_provider = "tabcode"',
      '[features]',
      'unified_exec = true',
      'fast_mode = false',
    ].join('\n'),
  );

  let defaults = writeCodexDefaults({
    env: { HOME: homeDir },
    model: 'gpt-5.4',
    effort: 'xhigh',
    fastMode: true,
  });

  assert.deepEqual(defaults, {
    model: 'gpt-5.4',
    modelConfigured: true,
    effort: 'xhigh',
    effortConfigured: true,
    fastMode: true,
    fastModeConfigured: true,
  });
  assert.match(fs.readFileSync(configPath, 'utf-8'), /^model = "gpt-5\.4"$/m);
  assert.match(fs.readFileSync(configPath, 'utf-8'), /^model_reasoning_effort = "xhigh"$/m);
  assert.match(fs.readFileSync(configPath, 'utf-8'), /^\[features\]$/m);
  assert.match(fs.readFileSync(configPath, 'utf-8'), /^fast_mode = true$/m);

  defaults = writeCodexDefaults({
    env: { HOME: homeDir },
    model: null,
    effort: null,
    fastMode: null,
  });

  assert.deepEqual(defaults, {
    model: null,
    modelConfigured: false,
    effort: null,
    effortConfigured: false,
    fastMode: true,
    fastModeConfigured: false,
  });
  const raw = fs.readFileSync(configPath, 'utf-8');
  assert.doesNotMatch(raw, /^model = /m);
  assert.doesNotMatch(raw, /^model_reasoning_effort = /m);
  assert.doesNotMatch(raw, /^fast_mode = /m);
  assert.match(raw, /^\[features\]$/m);
});

test('writeCodexDefaults trims string inputs and clears blank string values', () => {
  const rootDir = makeTempRoot();
  const homeDir = path.join(rootDir, 'home');
  const configDir = path.join(homeDir, '.codex');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.toml');

  const defaults = writeCodexDefaults({
    env: { HOME: homeDir },
    model: '  gpt-5.4  ',
    effort: '   ',
  });

  assert.deepEqual(defaults, {
    model: 'gpt-5.4',
    modelConfigured: true,
    effort: null,
    effortConfigured: false,
    fastMode: true,
    fastModeConfigured: false,
  });

  const raw = fs.readFileSync(configPath, 'utf-8');
  assert.match(raw, /^model = "gpt-5\.4"$/m);
  assert.doesNotMatch(raw, /^model_reasoning_effort = /m);
});

test('readCodexProfileCatalog reads named codex profiles from config.toml', () => {
  const rootDir = makeTempRoot();
  const homeDir = path.join(rootDir, 'home');
  const configDir = path.join(homeDir, '.codex');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.toml');

  fs.writeFileSync(configPath, [
    'model = "gpt-5.4"',
    '',
    '[profiles.default_work]',
    'model = "gpt-5.4"',
    '',
    '[profiles."vision qa"]',
    'model = "gpt-5.4-mini"',
    '',
    '[profiles.default_work]',
    'model = "o3"',
  ].join('\n'));

  assert.deepEqual(readCodexProfileCatalog({ env: { HOME: homeDir } }), {
    profiles: ['default_work', 'vision qa'],
    configPath,
  });
});

test('readCodexModelCatalog reads Codex CLI model catalog', () => {
  const catalog = readCodexModelCatalog({
    codexBin: 'codex-test',
    now: () => 1000,
    execFileSyncFn(bin, args) {
      assert.equal(bin, 'codex-test');
      assert.deepEqual(args, ['debug', 'models']);
      return JSON.stringify({
        models: [{
          slug: 'gpt-5.4',
          display_name: 'gpt-5.4',
          description: 'Strong model',
          default_reasoning_level: 'medium',
          supported_reasoning_levels: [
            { effort: 'low' },
            { effort: 'medium' },
            { effort: 'high' },
          ],
          visibility: 'list',
        }],
      });
    },
  });

  assert.deepEqual(catalog, {
    models: [{
      slug: 'gpt-5.4',
      displayName: 'gpt-5.4',
      description: 'Strong model',
      defaultReasoningLevel: 'medium',
      supportedReasoningLevels: ['low', 'medium', 'high'],
      visibility: 'list',
    }],
    error: null,
  });
});

test('readCodexModelCatalog reports CLI catalog errors', () => {
  const catalog = readCodexModelCatalog({
    codexBin: 'codex-fail',
    now: () => 2000,
    execFileSyncFn() {
      throw new Error('codex debug models failed');
    },
  });

  assert.deepEqual(catalog, {
    models: [],
    error: 'codex debug models failed',
  });
});

test('normalizeSlashPrefix trims strips and truncates invalid input', () => {
  assert.equal(normalizeSlashPrefix('  Codex-Bot__Alpha!!  '), 'codexbot__al');
  assert.equal(normalizeSlashPrefix('___'), '');
  assert.equal(normalizeSlashPrefix(''), '');
});

test('renderMissingDiscordTokenHint explains provider-scoped and shared token states', () => {
  assert.equal(
    renderMissingDiscordTokenHint({ botProvider: 'gemini', env: {} }),
    'Missing Discord token in environment (DISCORD_TOKEN_GEMINI or DISCORD_TOKEN)',
  );
  assert.match(
    renderMissingDiscordTokenHint({
      env: {
        CODEX__DISCORD_TOKEN: 'a',
        GEMINI__DISCORD_TOKEN: 'b',
      },
    }),
    /Found provider-scoped tokens for: codex, gemini/,
  );
  assert.equal(
    renderMissingDiscordTokenHint({ env: {} }),
    'Missing DISCORD_TOKEN in environment',
  );
});

test('configureRuntimeProxy wires repaired proxy settings into agents and logs', () => {
  const env = {
    HTTP_PROXY: 'http://127.0.0.1:7890',
    SOCKS_PROXY: 'socks5h://127.0.0.1:7891',
    INSECURE_TLS: '1',
  };
  const globalTarget = {};
  const dispatcherCalls = [];
  const repairs = [];

  const result = configureRuntimeProxy({
    env,
    envFilePath: '/tmp/.env',
    autoRepairProxyEnvFn: (envFilePath, options) => {
      repairs.push({ envFilePath, options });
      return { logs: ['proxy repaired'] };
    },
    createHttpProxyAgent: (uri) => ({ kind: 'http', uri }),
    createSocksProxyAgent: (uri) => ({ kind: 'socks', uri }),
    setGlobalDispatcherFn: (agent) => dispatcherCalls.push(agent),
    globalTarget,
  });

  assert.equal(repairs[0].envFilePath, '/tmp/.env');
  assert.equal(repairs[0].options.env, env);
  assert.deepEqual(result.restProxyAgent, { kind: 'http', uri: 'http://127.0.0.1:7890' });
  assert.deepEqual(result.wsProxyAgent, { kind: 'socks', uri: 'socks5h://127.0.0.1:7891' });
  assert.deepEqual(dispatcherCalls, [{ kind: 'http', uri: 'http://127.0.0.1:7890' }]);
  assert.equal(globalTarget.__discordWsAgent, result.wsProxyAgent);
  assert.equal(env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  assert.deepEqual(result.logs, [
    'proxy repaired',
    '🌐 Proxy: REST=http://127.0.0.1:7890 | WS=socks5h://127.0.0.1:7891 | INSECURE_TLS=true',
  ]);
});

test('createDiscordClient applies Discord intents and optional REST proxy agent', () => {
  class FakeClient {
    constructor(options) {
      this.options = options;
      this.rest = {
        setAgent: (agent) => {
          this.agent = agent;
        },
      };
    }
  }

  const restProxyAgent = { kind: 'proxy' };
  const client = createDiscordClient({
    Client: FakeClient,
    GatewayIntentBits: {
      Guilds: 'guilds',
      GuildMessages: 'messages',
      MessageContent: 'content',
    },
    Partials: {
      Channel: 'channel',
      Message: 'message',
    },
    restProxyAgent,
  });

  assert.deepEqual(client.options.intents, ['guilds', 'messages', 'content']);
  assert.deepEqual(client.options.partials, ['channel', 'message']);
  assert.equal(client.agent, restProxyAgent);
});
