export function parseCsvSet(value) {
  if (!value || !value.trim()) return null;
  return new Set(value.split(',').map((item) => item.trim()).filter(Boolean));
}

export function normalizeSecurityProfile(value, { logger = console } = {}) {
  const raw = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'solo', 'team', 'public'].includes(raw)) return raw;
  logger?.warn?.(`⚠️ Unknown SECURITY_PROFILE=${value}, fallback to auto`);
  return 'auto';
}

export function parseOptionalBool(value, { logger = console } = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  logger?.warn?.(`⚠️ Invalid boolean value: ${value} (ignored)`);
  return null;
}

export function normalizeQueueLimit(value, { logger = console } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    logger?.warn?.(`⚠️ Invalid MAX_QUEUE_PER_CHANNEL=${value}, using profile default`);
    return null;
  }
  if (n <= 0) return 0;
  return Math.floor(n);
}

export function parseConfigAllowlist(value) {
  const raw = String(value || '').trim();
  if (raw === '*') {
    return { allowAll: true, keys: new Set() };
  }
  return {
    allowAll: false,
    keys: new Set(
      raw.split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export function parseConfigKey(input) {
  const text = String(input || '').trim();
  const match = text.match(/^([a-zA-Z0-9_.-]+)\s*=/);
  return match?.[1]?.toLowerCase() || '';
}

export function createSecurityPolicy({
  securityProfile = 'auto',
  securityProfileDefaults = {},
  mentionOnlyOverride = null,
  mentionOnlyEnabledGuildIds = null,
  mentionOnlyDisabledGuildIds = null,
  maxQueuePerChannelOverride = null,
  enableConfigCmd = false,
  configPolicy = { allowAll: false, keys: new Set() },
  getEffectiveSecurityProfile = () => ({ profile: securityProfile, source: 'env default' }),
  permissionFlagsBits = {},
} = {}) {
  function isConfigKeyAllowed(key) {
    if (configPolicy.allowAll) return true;
    return configPolicy.keys.has(String(key || '').trim().toLowerCase());
  }

  function describeConfigPolicy() {
    if (configPolicy.allowAll) return '`*` (allow all)';
    if (!configPolicy.keys.size) return '(none)';
    return [...configPolicy.keys].map((key) => `\`${key}\``).join(', ');
  }

  function formatConfigCommandStatus() {
    if (!enableConfigCmd) return 'off';
    return `on (${describeConfigPolicy()})`;
  }

  function formatQueueLimit(limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return 'unlimited';
    return `${Math.floor(n)}`;
  }

  function resolveGuildId(channel) {
    const baseChannel = channel?.isThread?.() ? (channel.parent || null) : channel;
    const guildId = baseChannel?.guild?.id || channel?.guild?.id || '';
    const normalized = String(guildId || '').trim();
    return normalized || null;
  }

  function resolveMentionOnly(defaults, channel) {
    const guildId = resolveGuildId(channel);
    if (guildId && mentionOnlyEnabledGuildIds?.has(guildId)) return true;
    if (guildId && mentionOnlyDisabledGuildIds?.has(guildId)) return false;
    return mentionOnlyOverride === null ? defaults.mentionOnly : mentionOnlyOverride;
  }

  function resolveSecurityContext(channel, session = null) {
    const configured = getEffectiveSecurityProfile(session);
    const resolved = resolveSecurityProfileForChannel(channel, configured.profile, configured.source);
    const defaults = securityProfileDefaults[resolved.profile] || securityProfileDefaults.team || {
      mentionOnly: false,
      maxQueuePerChannel: 20,
    };
    return {
      configuredProfile: configured.profile,
      configuredSource: configured.source,
      profile: resolved.profile,
      source: resolved.source,
      reason: resolved.reason,
      mentionOnly: resolveMentionOnly(defaults, channel),
      maxQueuePerChannel: maxQueuePerChannelOverride === null ? defaults.maxQueuePerChannel : maxQueuePerChannelOverride,
    };
  }

  function resolveSecurityProfileForChannel(
    channel,
    configuredProfile = securityProfile,
    configuredSource = 'env default',
  ) {
    if (configuredProfile !== 'auto') {
      return {
        profile: configuredProfile,
        source: configuredSource === 'session override' ? 'session' : 'manual',
        reason: `${configuredSource}: ${configuredProfile}`,
      };
    }
    if (!channel) {
      return { profile: 'team', source: 'auto', reason: 'channel unavailable (fallback team)' };
    }
    if (channel.isDMBased?.()) {
      return { profile: 'solo', source: 'auto', reason: 'dm channel' };
    }

    const visibility = resolveGuildChannelVisibility(channel);
    if (visibility.visibility === 'public') {
      return { profile: 'public', source: 'auto', reason: visibility.reason };
    }
    if (visibility.visibility === 'team') {
      return { profile: 'team', source: 'auto', reason: visibility.reason };
    }
    return { profile: 'team', source: 'auto', reason: `${visibility.reason} (fallback team)` };
  }

  function resolveGuildChannelVisibility(channel) {
    const baseChannel = channel.isThread?.() ? (channel.parent || null) : channel;
    const target = baseChannel || channel;
    const guild = target?.guild || channel?.guild || null;
    if (!guild) return { visibility: 'unknown', reason: 'missing guild context' };

    const everyoneRole = guild.roles?.everyone;
    if (!everyoneRole) return { visibility: 'unknown', reason: 'missing @everyone role' };

    const perms = target?.permissionsFor?.(everyoneRole);
    if (!perms) return { visibility: 'unknown', reason: 'permissions unavailable' };

    const canView = perms.has(permissionFlagsBits.ViewChannel, true);
    return canView
      ? { visibility: 'public', reason: '@everyone can view channel' }
      : { visibility: 'team', reason: '@everyone cannot view channel' };
  }

  function formatSecurityProfileDisplay(security, language = 'en') {
    if (!security) return language === 'en' ? '(unknown)' : '（未知）';
    if (security.source === 'session') {
      return language === 'en'
        ? `${security.profile} (session override)`
        : `${security.profile}（频道覆盖）`;
    }
    if (security.source === 'manual') {
      return language === 'en'
        ? `${security.profile} (manual)`
        : `${security.profile}（手动设置）`;
    }
    return language === 'en'
      ? `${security.profile} (auto: ${security.reason})`
      : `${security.profile}（自动：${security.reason}）`;
  }

  return {
    isConfigKeyAllowed,
    describeConfigPolicy,
    formatConfigCommandStatus,
    formatQueueLimit,
    resolveSecurityContext,
    resolveSecurityProfileForChannel,
    resolveGuildChannelVisibility,
    formatSecurityProfileDisplay,
  };
}
