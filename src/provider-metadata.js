const PROVIDER_METADATA = Object.freeze({
  codex: Object.freeze({
    aliases: Object.freeze(['codex', 'openai']),
    displayName: 'Codex CLI',
    shortName: 'Codex',
    defaultBin: 'codex',
    binEnvName: 'CODEX_BIN',
    defaultSlashPrefix: 'cx',
    supportsConfigOverrides: true,
    supportsNativeCompact: true,
    bindsSessionsToWorkspace: true,
  }),
  claude: Object.freeze({
    aliases: Object.freeze(['claude', 'anthropic']),
    displayName: 'Claude Code',
    shortName: 'Claude',
    defaultBin: 'claude',
    binEnvName: 'CLAUDE_BIN',
    defaultSlashPrefix: 'cc',
    supportsConfigOverrides: false,
    supportsNativeCompact: false,
    bindsSessionsToWorkspace: false,
  }),
  gemini: Object.freeze({
    aliases: Object.freeze(['gemini', 'google']),
    displayName: 'Gemini CLI',
    shortName: 'Gemini',
    defaultBin: 'gemini',
    binEnvName: 'GEMINI_BIN',
    defaultSlashPrefix: 'gm',
    supportsConfigOverrides: false,
    supportsNativeCompact: false,
    bindsSessionsToWorkspace: true,
  }),
});

function findProviderByAlias(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  for (const [provider, metadata] of Object.entries(PROVIDER_METADATA)) {
    if (metadata.aliases.includes(raw)) return provider;
  }

  return null;
}

export function normalizeProvider(value, fallback = 'codex') {
  return findProviderByAlias(value) || fallback;
}

export function parseOptionalProvider(value) {
  return findProviderByAlias(value);
}

export function parseProviderInput(value) {
  return parseOptionalProvider(value);
}

export function getProviderMetadata(provider) {
  const normalized = normalizeProvider(provider);
  return PROVIDER_METADATA[normalized] || PROVIDER_METADATA.codex;
}

export function getProviderDisplayName(provider) {
  return getProviderMetadata(provider).displayName;
}

export function getProviderShortName(provider) {
  return getProviderMetadata(provider).shortName;
}

export function getProviderDefaultBin(provider) {
  return getProviderMetadata(provider).defaultBin;
}

export function getProviderBinEnvName(provider) {
  return getProviderMetadata(provider).binEnvName;
}

export function getProviderDefaultSlashPrefix(provider = null) {
  const normalized = parseOptionalProvider(provider) || 'codex';
  return getProviderMetadata(normalized).defaultSlashPrefix;
}

export function providerSupportsConfigOverrides(provider) {
  return getProviderMetadata(provider).supportsConfigOverrides;
}

export function providerSupportsNativeCompact(provider) {
  return getProviderMetadata(provider).supportsNativeCompact;
}

export function providerBindsSessionsToWorkspace(provider) {
  return getProviderMetadata(provider).bindsSessionsToWorkspace;
}

export function isReasoningEffortSupported(provider, effort) {
  if (!effort) return true;
  const normalizedProvider = normalizeProvider(provider);
  if (normalizedProvider === 'codex') return true;
  if (normalizedProvider === 'claude') return effort !== 'xhigh';
  return false;
}

export function formatReasoningEffortUnsupported(provider, language = 'en') {
  const displayName = getProviderDisplayName(provider);
  if (normalizeProvider(provider) === 'gemini') {
    if (language === 'en') {
      return `⚠️ Reasoning effort is not currently supported for Gemini CLI. Current provider: ${displayName}.`;
    }
    return `⚠️ Gemini CLI 当前不支持 reasoning effort。当前 provider：${displayName}。`;
  }
  if (language === 'en') {
    return `⚠️ \`xhigh\` is currently only supported for Codex CLI. Current provider: ${displayName}.`;
  }
  return `⚠️ \`xhigh\` 目前仅支持 Codex CLI。当前 provider：${displayName}。`;
}
