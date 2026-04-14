import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import {
  buildSpawnEnv,
  formatCliHealth,
  getCodexAccountRateLimits,
  getProviderBin,
  isCliNotFound,
} from '../src/provider-runtime.js';
import {
  getLaunchctlGuardBinDir,
} from '../src/launchctl-guard.js';

test('buildSpawnEnv prepends the launchctl guard and appends common executable locations', () => {
  const env = buildSpawnEnv({
    HOME: '/tmp/home',
    PATH: '/usr/bin',
  });

  const parts = env.PATH.split(':');
  assert.equal(parts[0], getLaunchctlGuardBinDir());
  assert.ok(parts.includes('/usr/bin'));
  assert.ok(parts.includes('/tmp/home/.local/bin'));
  assert.ok(parts.includes('/opt/homebrew/bin'));
});

test('getProviderBin respects configured provider bins', () => {
  assert.equal(getProviderBin('codex', { codexBin: '/bin/codex-custom' }), '/bin/codex-custom');
  assert.equal(getProviderBin('claude', { claudeBin: '/bin/claude-custom' }), '/bin/claude-custom');
  assert.equal(getProviderBin('gemini', { geminiBin: '/bin/gemini-custom' }), '/bin/gemini-custom');
});

test('formatCliHealth renders not-found and success states', () => {
  assert.equal(isCliNotFound('spawn gemini ENOENT'), true);
  assert.match(formatCliHealth({ ok: false, bin: 'gemini', envKey: 'GEMINI_BIN', error: 'spawn gemini ENOENT' }, 'en'), /GEMINI_BIN/);
  assert.equal(formatCliHealth({ ok: true, bin: 'gemini', version: '0.33.1' }, 'zh'), '✅ `gemini` (0.33.1)');
});

test('getCodexAccountRateLimits reads official app-server rate limit response', async () => {
  const spawnCalls = [];
  const spawnImpl = (bin, args) => {
    spawnCalls.push({ bin, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = (signal) => {
      child.killed = true;
      child.emit('exit', null, signal);
    };
    child.stdin = {
      write(line) {
        const message = JSON.parse(line);
        if (message.id === 1) {
          setImmediate(() => {
            child.stdout.write(`${JSON.stringify({ id: 1, result: { userAgent: 'test' } })}\n`);
          });
        }
        if (message.id === 2) {
          setImmediate(() => {
            child.stdout.write(`${JSON.stringify({
              id: 2,
              result: {
                rateLimits: {
                  limitId: 'codex',
                  primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1776169989 },
                  secondary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1776756789 },
                  credits: null,
                  planType: 'pro',
                },
                rateLimitsByLimitId: null,
              },
            })}\n`);
          });
        }
      },
    };
    return child;
  };

  const result = await getCodexAccountRateLimits('codex', {
    codexBin: '/bin/codex',
    spawnImpl,
    timeoutMs: 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.rateLimits.primary.usedPercent, 12);
  assert.equal(result.rateLimits.secondary.windowDurationMins, 10080);
  assert.deepEqual(spawnCalls, [
    { bin: '/bin/codex', args: ['app-server', '--listen', 'stdio://'] },
  ]);
});
