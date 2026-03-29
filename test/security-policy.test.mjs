import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSecurityPolicy,
  normalizeQueueLimit,
  normalizeSecurityProfile,
  parseConfigAllowlist,
  parseConfigKey,
  parseCsvSet,
  parseOptionalBool,
} from '../src/security-policy.js';

function createGuildChannel({ canView = false } = {}) {
  const everyone = { id: 'everyone' };
  return {
    guild: {
      roles: { everyone },
    },
    permissionsFor(role) {
      assert.equal(role, everyone);
      return {
        has(flag) {
          assert.equal(flag, 'VIEW');
          return canView;
        },
      };
    },
  };
}

test('security-policy parses csv booleans queue limit and security profile with warnings', () => {
  const warnings = [];
  const logger = { warn: (line) => warnings.push(line) };

  assert.deepEqual([...parseCsvSet('a, b, c')], ['a', 'b', 'c']);
  assert.equal(parseOptionalBool('on'), true);
  assert.equal(parseOptionalBool('off'), false);
  assert.equal(parseOptionalBool('bad', { logger }), null);
  assert.equal(normalizeQueueLimit('12'), 12);
  assert.equal(normalizeQueueLimit('0'), 0);
  assert.equal(normalizeQueueLimit('oops', { logger }), null);
  assert.equal(normalizeSecurityProfile('TEAM'), 'team');
  assert.equal(normalizeSecurityProfile('mystery', { logger }), 'auto');
  assert.equal(warnings.length, 3);
});

test('security-policy tracks config allowlist helpers', () => {
  const policy = createSecurityPolicy({
    enableConfigCmd: true,
    configPolicy: parseConfigAllowlist('personality,model_reasoning_effort'),
  });

  assert.equal(parseConfigKey('model_reasoning_effort = "high"'), 'model_reasoning_effort');
  assert.equal(policy.isConfigKeyAllowed('personality'), true);
  assert.equal(policy.isConfigKeyAllowed('temperature'), false);
  assert.equal(policy.describeConfigPolicy(), '`personality`, `model_reasoning_effort`');
  assert.equal(policy.formatConfigCommandStatus(), 'on (`personality`, `model_reasoning_effort`)');
  assert.equal(policy.formatQueueLimit(0), 'unlimited');
  assert.equal(policy.formatQueueLimit(7), '7');
});

test('security-policy resolves auto and manual channel security contexts', () => {
  const policy = createSecurityPolicy({
    securityProfile: 'auto',
    securityProfileDefaults: {
      solo: { mentionOnly: false, maxQueuePerChannel: 0 },
      team: { mentionOnly: false, maxQueuePerChannel: 20 },
      public: { mentionOnly: true, maxQueuePerChannel: 20 },
    },
    mentionOnlyOverride: null,
    maxQueuePerChannelOverride: null,
    getEffectiveSecurityProfile: (session) => {
      if (session?.securityProfile) {
        return { profile: session.securityProfile, source: 'session override' };
      }
      return { profile: 'auto', source: 'env default' };
    },
    permissionFlagsBits: { ViewChannel: 'VIEW' },
  });

  const dmSecurity = policy.resolveSecurityContext({ isDMBased: () => true }, {});
  const publicSecurity = policy.resolveSecurityContext(createGuildChannel({ canView: true }), {});
  const teamSecurity = policy.resolveSecurityContext(createGuildChannel({ canView: false }), {});
  const manualSecurity = policy.resolveSecurityContext(createGuildChannel({ canView: true }), { securityProfile: 'public' });

  assert.deepEqual({ profile: dmSecurity.profile, mentionOnly: dmSecurity.mentionOnly, maxQueuePerChannel: dmSecurity.maxQueuePerChannel }, {
    profile: 'solo',
    mentionOnly: false,
    maxQueuePerChannel: 0,
  });
  assert.deepEqual({ profile: publicSecurity.profile, mentionOnly: publicSecurity.mentionOnly }, {
    profile: 'public',
    mentionOnly: true,
  });
  assert.deepEqual({ profile: teamSecurity.profile, mentionOnly: teamSecurity.mentionOnly }, {
    profile: 'team',
    mentionOnly: false,
  });
  assert.equal(manualSecurity.source, 'session');
  assert.equal(manualSecurity.reason, 'session override: public');
});

test('security-policy supports per-guild mention-only overrides', () => {
  const policy = createSecurityPolicy({
    securityProfile: 'auto',
    securityProfileDefaults: {
      solo: { mentionOnly: false, maxQueuePerChannel: 0 },
      team: { mentionOnly: false, maxQueuePerChannel: 20 },
      public: { mentionOnly: true, maxQueuePerChannel: 20 },
    },
    mentionOnlyOverride: false,
    mentionOnlyEnabledGuildIds: parseCsvSet('guild-force-mention'),
    mentionOnlyDisabledGuildIds: parseCsvSet('guild-no-mention'),
    maxQueuePerChannelOverride: null,
    getEffectiveSecurityProfile: () => ({ profile: 'auto', source: 'env default' }),
    permissionFlagsBits: { ViewChannel: 'VIEW' },
  });

  const forcedMention = policy.resolveSecurityContext({
    ...createGuildChannel({ canView: false }),
    guild: {
      roles: { everyone: { id: 'everyone' } },
      id: 'guild-force-mention',
    },
    permissionsFor(role) {
      assert.equal(role.id, 'everyone');
      return { has: () => false };
    },
  }, {});
  const disabledMention = policy.resolveSecurityContext({
    ...createGuildChannel({ canView: true }),
    guild: {
      roles: { everyone: { id: 'everyone' } },
      id: 'guild-no-mention',
    },
    permissionsFor(role) {
      assert.equal(role.id, 'everyone');
      return { has: () => true };
    },
  }, {});
  const fallbackMention = policy.resolveSecurityContext(createGuildChannel({ canView: true }), {});

  assert.equal(forcedMention.mentionOnly, true);
  assert.equal(disabledMention.mentionOnly, false);
  assert.equal(fallbackMention.mentionOnly, false);
});

test('security-policy formats security profile display for localized output', () => {
  const policy = createSecurityPolicy();

  assert.equal(policy.formatSecurityProfileDisplay(null, 'zh'), '（未知）');
  assert.equal(
    policy.formatSecurityProfileDisplay({ profile: 'team', source: 'auto', reason: '@everyone cannot view channel' }, 'en'),
    'team (auto: @everyone cannot view channel)',
  );
  assert.equal(
    policy.formatSecurityProfileDisplay({ profile: 'public', source: 'manual', reason: 'env default: public' }, 'zh'),
    'public（手动设置）',
  );
  assert.equal(
    policy.formatSecurityProfileDisplay({ profile: 'solo', source: 'session', reason: 'session override: solo' }, 'zh'),
    'solo（频道覆盖）',
  );
});
