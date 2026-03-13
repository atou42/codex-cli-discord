import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatReasoningEffortUnsupported,
  getProviderBinEnvName,
  getProviderDefaultBin,
  getProviderDefaultSlashPrefix,
  getProviderDisplayName,
  getProviderShortName,
  isReasoningEffortSupported,
  normalizeProvider,
  parseOptionalProvider,
  parseProviderInput,
  providerBindsSessionsToWorkspace,
} from '../src/provider-metadata.js';

test('provider-metadata normalizes aliases and optional parsing consistently', () => {
  assert.equal(normalizeProvider('openai'), 'codex');
  assert.equal(normalizeProvider('anthropic'), 'claude');
  assert.equal(normalizeProvider('google'), 'gemini');
  assert.equal(parseOptionalProvider('google'), 'gemini');
  assert.equal(parseOptionalProvider(''), null);
  assert.equal(parseProviderInput('anthropic'), 'claude');
  assert.equal(parseProviderInput('unknown'), null);
});

test('provider-metadata exposes provider labels, bins, and slash prefixes', () => {
  assert.equal(getProviderDisplayName('codex'), 'Codex CLI');
  assert.equal(getProviderDisplayName('claude'), 'Claude Code');
  assert.equal(getProviderDisplayName('gemini'), 'Gemini CLI');
  assert.equal(getProviderShortName('gemini'), 'Gemini');
  assert.equal(getProviderDefaultBin('claude'), 'claude');
  assert.equal(getProviderDefaultBin('gemini'), 'gemini');
  assert.equal(getProviderBinEnvName('codex'), 'CODEX_BIN');
  assert.equal(getProviderBinEnvName('gemini'), 'GEMINI_BIN');
  assert.equal(getProviderDefaultSlashPrefix('codex'), 'cx');
  assert.equal(getProviderDefaultSlashPrefix('claude'), 'cc');
  assert.equal(getProviderDefaultSlashPrefix('gemini'), 'gm');
});

test('provider-metadata exposes workspace and reasoning capabilities', () => {
  assert.equal(providerBindsSessionsToWorkspace('codex'), true);
  assert.equal(providerBindsSessionsToWorkspace('claude'), false);
  assert.equal(providerBindsSessionsToWorkspace('gemini'), true);
  assert.equal(isReasoningEffortSupported('codex', 'xhigh'), true);
  assert.equal(isReasoningEffortSupported('claude', 'xhigh'), false);
  assert.equal(isReasoningEffortSupported('gemini', 'medium'), false);
});

test('provider-metadata formats provider-aware reasoning help', () => {
  assert.match(formatReasoningEffortUnsupported('gemini', 'en'), /Gemini CLI/);
  assert.match(formatReasoningEffortUnsupported('claude', 'zh'), /Codex CLI/);
});
