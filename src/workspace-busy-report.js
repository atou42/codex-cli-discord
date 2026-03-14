import { humanAge as defaultHumanAge } from './runtime-utils.js';

export function formatWorkspaceBusyReport(
  session,
  workspaceDir,
  owner = null,
  {
    getSessionLanguage = () => 'zh',
    normalizeUiLanguage = (value) => (String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh'),
    humanAge = defaultHumanAge,
  } = {},
) {
  const language = normalizeUiLanguage(getSessionLanguage(session));
  const ownerProvider = owner?.provider ? `\`${owner.provider}\`` : null;
  const ownerKey = owner?.key ? `\`${owner.key}\`` : null;
  const acquiredAtMs = owner?.acquiredAt ? Date.parse(owner.acquiredAt) : NaN;
  const age = Number.isFinite(acquiredAtMs) ? humanAge(Math.max(0, Date.now() - acquiredAtMs)) : null;

  if (language === 'en') {
    return [
      '⏳ Workspace is busy; waiting for exclusive access.',
      `• workspace: \`${workspaceDir}\``,
      ownerProvider ? `• owner provider: ${ownerProvider}` : null,
      ownerKey ? `• owner channel: ${ownerKey}` : null,
      age ? `• lock age: ${age}` : null,
    ].filter(Boolean).join('\n');
  }

  return [
    '⏳ workspace 正忙，正在等待独占执行。',
    `• workspace: \`${workspaceDir}\``,
    ownerProvider ? `• 当前持有 provider: ${ownerProvider}` : null,
    ownerKey ? `• 当前持有频道: ${ownerKey}` : null,
    age ? `• 锁已持有: ${age}` : null,
  ].filter(Boolean).join('\n');
}
