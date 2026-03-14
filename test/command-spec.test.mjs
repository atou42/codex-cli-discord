import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSlashCommandEntries,
  getActionButtonCommandNames,
  normalizeCommandName,
} from '../src/command-spec.js';

test('normalizeCommandName maps text and slash aliases to canonical names', () => {
  assert.equal(normalizeCommandName('!abort', { allowBangPrefix: true }), 'cancel');
  assert.equal(normalizeCommandName('guide'), 'onboarding');
  assert.equal(normalizeCommandName('lang'), 'language');
  assert.equal(normalizeCommandName('cd'), 'setdir');
  assert.equal(normalizeCommandName('defaultdir'), 'setdefaultdir');
});

test('getActionButtonCommandNames exposes canonical button-safe commands', () => {
  assert.deepEqual(getActionButtonCommandNames(), ['status', 'sessions', 'queue', 'progress', 'new', 'cancel', 'retry']);
});

test('buildSlashCommandEntries includes aliases and provider toggle only in shared mode', () => {
  const sharedEntries = buildSlashCommandEntries({ botProvider: null });
  const lockedEntries = buildSlashCommandEntries({ botProvider: 'gemini' });

  const newEntry = sharedEntries.find((entry) => entry.name === 'new');
  const cancelEntry = sharedEntries.find((entry) => entry.name === 'cancel');

  assert.equal(Array.isArray(newEntry.aliases), false);
  assert.deepEqual(cancelEntry.aliases, ['abort']);
  assert.ok(sharedEntries.some((entry) => entry.name === 'provider'));
  assert.ok(!lockedEntries.some((entry) => entry.name === 'provider'));
});
