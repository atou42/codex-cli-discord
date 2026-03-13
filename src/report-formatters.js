export function createReportFormatters({
  botProvider = null,
  allowedChannelIds = null,
  allowedUserIds = null,
  progressProcessLines = 3,
  progressPlanMaxLines = 3,
  progressDoneStepsMax = 3,
  slashRef = (name) => `/${name}`,
  getSessionLanguage = () => 'zh',
  normalizeUiLanguage = (value) => (String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh'),
  getSessionProvider = () => 'codex',
  getProviderDisplayName = (provider) => String(provider || ''),
  getProviderShortName = (provider) => String(provider || ''),
  getProviderDefaults = () => ({ model: '(unknown)', effort: '(unknown)', source: 'provider' }),
  getCliHealth = () => ({ ok: false, error: 'unavailable' }),
  getRuntimeSnapshot = () => ({ running: false, queued: 0 }),
  resolveSecurityContext = () => ({ mentionOnly: false, maxQueuePerChannel: 0 }),
  resolveTimeoutSetting = () => ({ timeoutMs: 0, source: 'env default' }),
  getEffectiveSecurityProfile = () => ({ profile: 'team', source: 'env default' }),
  resolveCompactStrategySetting = () => ({ strategy: 'hard', source: 'env default' }),
  resolveCompactEnabledSetting = () => ({ enabled: true, source: 'env default' }),
  resolveCompactThresholdSetting = () => ({ tokens: 0, source: 'env default' }),
  resolveNativeCompactTokenLimitSetting = () => ({ tokens: 0, source: 'env default' }),
  getWorkspaceBinding = () => ({
    workspaceDir: null,
    source: 'unset',
    defaultWorkspaceDir: null,
    defaultSource: 'unset',
    defaultEnvKey: 'DEFAULT_WORKSPACE_DIR',
  }),
  readWorkspaceLock = () => ({ owner: null }),
  formatCliHealth = (health) => String(health?.error || 'unknown'),
  formatPermissionsLabel = () => '',
  formatLanguageLabel = (language) => String(language || ''),
  formatSecurityProfileDisplay = () => '',
  formatSecurityProfileLabel = (profile) => String(profile || ''),
  formatQueueLimit = (limit) => String(limit ?? ''),
  formatRuntimeLabel = () => 'idle',
  formatTimeoutLabel = () => 'off (no hard timeout)',
  describeCompactStrategy = (strategy) => String(strategy || ''),
  humanAge = (ms) => `${ms}ms`,
  formatTokenValue = (value) => String(value ?? '-'),
  formatConfigCommandStatus = () => 'disabled',
  describeConfigPolicy = () => '(none)',
  formatSessionStatusLabel = () => '`(auto)`',
  formatProgressPlanSummary = () => '',
  formatCompletedStepsSummary = () => '',
  renderProcessContentLines = () => [],
  localizeProgressLines = (lines) => (Array.isArray(lines) ? lines : []),
  renderProgressPlanLines = () => [],
  renderCompletedStepsLines = () => [],
} = {}) {
  function formatProviderDefaultLabel(value, language = 'en') {
    const source = value?.source || 'provider';
    const model = value?.value || '(unknown)';
    if (source === 'config.toml') {
      return `${model} _(config.toml)_`;
    }
    if (language === 'en') {
      return `${model} _(provider default)_`;
    }
    return `${model} _(provider 默认)_`;
  }

  function formatSettingSourceLabel(source, language = 'en') {
    if (source === 'session override') {
      return language === 'en' ? 'session override' : '频道覆盖';
    }
    if (source === 'session threshold fallback') {
      return language === 'en' ? 'threshold fallback' : '阈值回退';
    }
    if (source === 'env default') {
      return language === 'en' ? 'env default' : '环境默认';
    }
    return source || (language === 'en' ? 'unknown' : '未知');
  }

  function formatWorkspaceSourceLabel(source, language = 'zh') {
    const value = String(source || '').trim().toLowerCase();
    if (language === 'en') {
      if (value === 'thread override') return 'thread override';
      if (value === 'provider default') return 'provider default';
      if (value === 'legacy fallback') return 'legacy fallback';
      return value || 'unknown';
    }
    if (value === 'thread override') return 'thread 覆盖';
    if (value === 'provider default') return 'provider 默认';
    if (value === 'legacy fallback') return 'legacy 回退';
    return value || '未知';
  }

  function formatDefaultWorkspaceSourceLabel(source, envKey = null, language = 'zh') {
    const suffix = envKey ? `, ${envKey}` : '';
    const value = String(source || '').trim().toLowerCase();
    if (language === 'en') {
      if (value === 'provider-scoped env') return `provider-scoped env${suffix}`;
      if (value === 'shared env') return `shared env${suffix}`;
      if (value === 'unset') return `unset${suffix}`;
      return `${value || 'unknown'}${suffix}`;
    }
    if (value === 'provider-scoped env') return `provider 专属 env${suffix}`;
    if (value === 'shared env') return `共享 env${suffix}`;
    if (value === 'unset') return `未设置${suffix}`;
    return `${value || '未知'}${suffix}`;
  }

  function formatWorkspaceDefaultDisplay(binding, language = 'zh') {
    if (binding.defaultWorkspaceDir) {
      return `\`${binding.defaultWorkspaceDir}\` (${formatDefaultWorkspaceSourceLabel(binding.defaultSource, binding.defaultEnvKey, language)})`;
    }
    if (language === 'en') {
      return `(unset; ${binding.defaultEnvKey || 'DEFAULT_WORKSPACE_DIR'})`;
    }
    return `（未设置；${binding.defaultEnvKey || 'DEFAULT_WORKSPACE_DIR'}）`;
  }

  function getWorkspaceStatusLines(key, session, language = 'zh') {
    const binding = getWorkspaceBinding(session, key);
    if (language === 'en') {
      return [
        `• workspace: \`${binding.workspaceDir}\` (${formatWorkspaceSourceLabel(binding.source, language)})`,
        `• provider default workspace: ${formatWorkspaceDefaultDisplay(binding, language)}`,
      ];
    }
    return [
      `• workspace: \`${binding.workspaceDir}\`（${formatWorkspaceSourceLabel(binding.source, language)}）`,
      `• provider 默认 workspace: ${formatWorkspaceDefaultDisplay(binding, language)}`,
    ];
  }

  function formatBotModeLabel() {
    if (!botProvider) {
      return 'shared (provider can switch per channel)';
    }
    return `locked to \`${botProvider}\` (${getProviderDisplayName(botProvider)})`;
  }

  function formatStatusReport(key, session, channel = null) {
    const language = getSessionLanguage(session);
    const lang = normalizeUiLanguage(language);
    const provider = getSessionProvider(session);
    const defaults = getProviderDefaults(provider);
    const cliHealth = getCliHealth(provider);
    const security = resolveSecurityContext(channel, session);
    const compactSetting = resolveCompactStrategySetting(session);
    const compactEnabled = resolveCompactEnabledSetting(session);
    const compactThreshold = resolveCompactThresholdSetting(session);
    const nativeLimit = resolveNativeCompactTokenLimitSetting(session);
    const modeDesc = session?.mode === 'dangerous'
      ? (lang === 'en' ? 'dangerous (no sandbox, full access)' : 'dangerous（无沙盒，全权限）')
      : (lang === 'en' ? 'safe (sandboxed, no network)' : 'safe（沙盒隔离，无网络）');
    const workspaceLines = getWorkspaceStatusLines(key, session, lang);
    const defaultModel = formatProviderDefaultLabel({ value: defaults.model, source: defaults.source }, lang);
    const defaultEffort = formatProviderDefaultLabel({ value: defaults.effort, source: defaults.source }, lang);

    if (lang === 'en') {
      return [
        '🧭 **Current Status**',
        `• provider: \`${provider}\` (${getProviderDisplayName(provider)})`,
        `• model: ${session.model || defaultModel}`,
        `• mode: ${modeDesc}`,
        `• effort: ${session.effort || defaultEffort}`,
        ...workspaceLines,
        `• compact strategy: ${describeCompactStrategy(compactSetting.strategy, lang)} (${formatSettingSourceLabel(compactSetting.source, lang)})`,
        `• compact enabled: ${compactEnabled.enabled ? 'on' : 'off'} (${formatSettingSourceLabel(compactEnabled.source, lang)})`,
        `• compact token limit: ${compactThreshold.tokens} (${formatSettingSourceLabel(compactThreshold.source, lang)})`,
        `• native compact limit: ${nativeLimit.tokens} (${formatSettingSourceLabel(nativeLimit.source, lang)})`,
        `• ui language: ${formatLanguageLabel(language)}`,
        `• permissions: ${formatPermissionsLabel(session, lang)}`,
        `• cli: ${formatCliHealth(cliHealth, lang)}`,
        `• session: ${formatSessionStatusLabel(session)}`,
        `• last input tokens: ${formatTokenValue(session?.lastInputTokens)}`,
        `• security profile: ${formatSecurityProfileDisplay(security, lang)}`,
      ].filter(Boolean).join('\n');
    }

    return [
      '🧭 **当前状态**',
      `• provider: \`${provider}\` (${getProviderDisplayName(provider)})`,
      `• model: ${session.model || defaultModel}`,
      `• mode: ${modeDesc}`,
      `• effort: ${session.effort || defaultEffort}`,
      ...workspaceLines,
      `• compact strategy: ${describeCompactStrategy(compactSetting.strategy, lang)}（${formatSettingSourceLabel(compactSetting.source, lang)}）`,
      `• compact enabled: ${compactEnabled.enabled ? 'on' : 'off'}（${formatSettingSourceLabel(compactEnabled.source, lang)}）`,
      `• compact token limit: ${compactThreshold.tokens}（${formatSettingSourceLabel(compactThreshold.source, lang)}）`,
      `• native compact limit: ${nativeLimit.tokens}（${formatSettingSourceLabel(nativeLimit.source, lang)}）`,
      `• 界面语言: ${formatLanguageLabel(language)}`,
      `• 权限: ${formatPermissionsLabel(session, lang)}`,
      `• CLI: ${formatCliHealth(cliHealth, lang)}`,
      `• session: ${formatSessionStatusLabel(session)}`,
      `• 最近输入 tokens: ${formatTokenValue(session?.lastInputTokens)}`,
      `• security profile: ${formatSecurityProfileDisplay(security, lang)}`,
    ].filter(Boolean).join('\n');
  }

  function formatQueueReport(key, session = null, channel = null) {
    const runtime = getRuntimeSnapshot(key);
    const security = resolveSecurityContext(channel, session);
    const planSummary = formatProgressPlanSummary(runtime.progressPlan);
    const completedSummary = formatCompletedStepsSummary(runtime.completedSteps, {
      planState: runtime.progressPlan,
      latestStep: runtime.progressText,
      maxSteps: 3,
    });
    const processLines = renderProcessContentLines(runtime.recentActivities, 'en', progressProcessLines);
    return [
      '📮 **任务队列状态**',
      `• runtime: ${formatRuntimeLabel(runtime)}`,
      `• queued prompts: ${runtime.queued}`,
      `• queue limit: ${formatQueueLimit(security.maxQueuePerChannel)}`,
      runtime.progressText ? `• latest activity: ${runtime.progressText}` : null,
      ...processLines,
      planSummary ? `• plan: ${planSummary}` : null,
      completedSummary ? `• completed milestones: ${completedSummary}` : null,
      runtime.progressAgoMs !== null ? `• progress updated: ${humanAge(runtime.progressAgoMs)} ago` : null,
      runtime.messageId ? `• active message id: \`${runtime.messageId}\`` : null,
      runtime.progressMessageId ? `• progress message id: \`${runtime.progressMessageId}\`` : null,
    ].filter(Boolean).join('\n');
  }

  function formatProgressReport(key, session = null, channel = null) {
    const runtime = getRuntimeSnapshot(key);
    const security = resolveSecurityContext(channel, session);
    const language = getSessionLanguage(session);
    const lang = normalizeUiLanguage(language);
    if (!runtime.running) {
      if (lang === 'en') {
        return [
          'ℹ️ No running task in this channel.',
          `• queued prompts: ${runtime.queued}`,
          `• queue limit: ${formatQueueLimit(security.maxQueuePerChannel)}`,
          `• hint: After sending a task, use \`!progress\` / \`${slashRef('progress')}\` for live updates.`,
        ].join('\n');
      }
      return [
        'ℹ️ 当前没有运行中的任务。',
        `• 排队任务: ${runtime.queued}`,
        `• 队列上限: ${formatQueueLimit(security.maxQueuePerChannel)}`,
        `• 提示: 发送新任务后可用 \`!progress\` / \`${slashRef('progress')}\` 查看实时进度。`,
      ].join('\n');
    }
    const processLines = renderProcessContentLines(runtime.recentActivities, lang, progressProcessLines);
    const planLines = localizeProgressLines(renderProgressPlanLines(runtime.progressPlan, progressPlanMaxLines), lang);
    const completedLines = localizeProgressLines(renderCompletedStepsLines(runtime.completedSteps, {
      planState: runtime.progressPlan,
      latestStep: runtime.progressText,
      maxSteps: progressDoneStepsMax,
    }), lang);
    if (lang === 'en') {
      return [
        '🧵 **Task Progress**',
        `• runtime: ${formatRuntimeLabel(runtime, lang)}`,
        `• event count: ${runtime.progressEvents}`,
        runtime.progressText ? `• latest activity: ${runtime.progressText}` : null,
        ...processLines,
        ...planLines,
        ...completedLines,
        runtime.progressAgoMs !== null ? `• last update: ${humanAge(runtime.progressAgoMs)} ago` : null,
        runtime.messageId ? `• active message id: \`${runtime.messageId}\`` : null,
        runtime.progressMessageId ? `• progress message id: \`${runtime.progressMessageId}\`` : null,
        `• queued prompts: ${runtime.queued}`,
        `• queue limit: ${formatQueueLimit(security.maxQueuePerChannel)}`,
        `• hint: Use \`!abort\` / \`${slashRef('cancel')}\` to interrupt current task and clear queue.`,
      ].filter(Boolean).join('\n');
    }
    return [
      '🧵 **任务进度**',
      `• 运行状态: ${formatRuntimeLabel(runtime, lang)}`,
      `• 事件数: ${runtime.progressEvents}`,
      runtime.progressText ? `• 最新活动: ${runtime.progressText}` : null,
      ...processLines,
      ...planLines,
      ...completedLines,
      runtime.progressAgoMs !== null ? `• 上次更新: ${humanAge(runtime.progressAgoMs)}前` : null,
      runtime.messageId ? `• 运行消息 ID: \`${runtime.messageId}\`` : null,
      runtime.progressMessageId ? `• 进度消息 ID: \`${runtime.progressMessageId}\`` : null,
      `• 排队任务: ${runtime.queued}`,
      `• 队列上限: ${formatQueueLimit(security.maxQueuePerChannel)}`,
      `• 提示: 可用 \`!abort\` / \`${slashRef('cancel')}\` 中断当前任务并清空队列。`,
    ].filter(Boolean).join('\n');
  }

  function formatCancelReport(outcome) {
    if (!outcome.cancelledRunning && outcome.clearedQueued === 0) {
      return 'ℹ️ 当前没有运行中或排队任务。';
    }
    return [
      '🛑 已处理取消请求',
      `• running task interrupted: ${outcome.cancelledRunning ? 'yes' : 'no'}`,
      outcome.pid ? `• pid: ${outcome.pid}` : null,
      `• cleared queued prompts: ${outcome.clearedQueued}`,
    ].filter(Boolean).join('\n');
  }

  function formatDoctorReport(key, session = null, channel = null) {
    const runtime = getRuntimeSnapshot(key);
    const provider = getSessionProvider(session);
    const cliHealth = getCliHealth(provider);
    const security = resolveSecurityContext(channel, session);
    const timeoutSetting = resolveTimeoutSetting(session);
    const securitySetting = getEffectiveSecurityProfile(session);
    const compactSetting = resolveCompactStrategySetting(session);
    const compactEnabled = resolveCompactEnabledSetting(session);
    const compactThreshold = resolveCompactThresholdSetting(session);
    const nativeLimit = resolveNativeCompactTokenLimitSetting(session);
    const workspaceBinding = getWorkspaceBinding(session, key);
    const workspaceLock = workspaceBinding.workspaceDir ? readWorkspaceLock(workspaceBinding.workspaceDir) : { owner: null };
    return [
      '🩺 **Bot Doctor**',
      `• bot mode: ${formatBotModeLabel()}`,
      `• provider: \`${provider}\` (${getProviderDisplayName(provider)})`,
      `• cli: ${formatCliHealth(cliHealth)}`,
      `• workspace: \`${workspaceBinding.workspaceDir}\` (${workspaceBinding.source})`,
      `• workspace serialization: ${workspaceLock.owner ? 'busy' : 'idle'}`,
      `• runtime: ${formatRuntimeLabel(runtime)}`,
      `• queued prompts: ${runtime.queued}`,
      `• security profile: ${formatSecurityProfileDisplay(security)}`,
      `• profile setting: ${formatSecurityProfileLabel(securitySetting.profile)} (${securitySetting.source})`,
      `• mention only: ${security.mentionOnly ? 'on' : 'off'}`,
      `• queue limit: ${formatQueueLimit(security.maxQueuePerChannel)}`,
      `• !config: ${formatConfigCommandStatus()}`,
      `• config allowlist: ${describeConfigPolicy()}`,
      `• ALLOWED_CHANNEL_IDS: ${allowedChannelIds ? `${allowedChannelIds.size} configured` : '(all channels)'}`,
      `• ALLOWED_USER_IDS: ${allowedUserIds ? `${allowedUserIds.size} configured` : '(all users)'}`,
      `• runner timeout: ${formatTimeoutLabel(timeoutSetting.timeoutMs)} (${timeoutSetting.source})`,
      `• compact strategy: ${describeCompactStrategy(compactSetting.strategy)} (${compactSetting.source})`,
      `• compact enabled: ${compactEnabled.enabled ? 'on' : 'off'} (${compactEnabled.source})`,
      `• compact token limit: ${compactThreshold.tokens} (${compactThreshold.source})`,
      `• native compact limit: ${nativeLimit.tokens} (${nativeLimit.source})`,
    ].join('\n');
  }

  function formatCompactStrategyConfigHelp(language) {
    if (language === 'en') {
      return [
        'Usage: `!compact <status|strategy|token_limit|native_limit|enabled|reset> [value]`',
        `Slash: \`${slashRef('compact')} key:<...> value:<...>\``,
        'Examples: `!compact strategy native`, `!compact token_limit 272000`, `!compact enabled on`',
        'Note: compact settings only affect Codex CLI.',
      ].join('\n');
    }
    return [
      '用法：`!compact <status|strategy|token_limit|native_limit|enabled|reset> [value]`',
      `Slash：\`${slashRef('compact')} key:<...> value:<...>\``,
      '示例：`!compact strategy native`、`!compact token_limit 272000`、`!compact enabled on`',
      '说明：compact 配置仅对 Codex CLI 生效。',
    ].join('\n');
  }

  function formatCompactConfigReport(language, session, changed = false) {
    const strategy = resolveCompactStrategySetting(session);
    const enabled = resolveCompactEnabledSetting(session);
    const threshold = resolveCompactThresholdSetting(session);
    const nativeLimit = resolveNativeCompactTokenLimitSetting(session);

    if (language === 'en') {
      return [
        changed ? '✅ Compact config updated' : 'ℹ️ Compact config',
        `• strategy: ${describeCompactStrategy(strategy.strategy, language)} (${formatSettingSourceLabel(strategy.source, language)})`,
        `• enabled: ${enabled.enabled ? 'on' : 'off'} (${formatSettingSourceLabel(enabled.source, language)})`,
        `• token limit: ${threshold.tokens} (${formatSettingSourceLabel(threshold.source, language)})`,
        `• native limit: ${nativeLimit.tokens} (${formatSettingSourceLabel(nativeLimit.source, language)})`,
        '• note: native compaction is handled inside Codex CLI; the bot does not currently emit a guaranteed per-compact notification.',
      ].join('\n');
    }
    return [
      changed ? '✅ compact 配置已更新' : 'ℹ️ 当前 compact 配置',
      `• strategy: ${describeCompactStrategy(strategy.strategy, language)}（${formatSettingSourceLabel(strategy.source, language)}）`,
      `• enabled: ${enabled.enabled ? 'on' : 'off'}（${formatSettingSourceLabel(enabled.source, language)}）`,
      `• token limit: ${threshold.tokens}（${formatSettingSourceLabel(threshold.source, language)}）`,
      `• native limit: ${nativeLimit.tokens}（${formatSettingSourceLabel(nativeLimit.source, language)}）`,
      '• 说明：native 压缩发生在 Codex CLI 内部，bot 目前拿不到稳定的“本次刚压缩完成”通知。',
    ].join('\n');
  }

  function formatReasoningEffortHelp(language) {
    return language === 'en'
      ? 'Usage: `!effort <xhigh|high|medium|low|default>`'
      : '用法：`!effort <xhigh|high|medium|low|default>`';
  }

  function formatLanguageConfigHelp(language) {
    if (language === 'en') {
      return [
        'Usage: `!lang <zh|en>`',
        `Current: ${formatLanguageLabel(language)}`,
        'Examples: `!lang en`, `!lang zh`',
      ].join('\n');
    }
    return [
      '用法：`!lang <zh|en>`',
      `当前：${formatLanguageLabel(language)}`,
      '示例：`!lang en`、`!lang zh`',
    ].join('\n');
  }

  function formatLanguageConfigReport(language, changed) {
    if (language === 'en') {
      return changed
        ? `✅ Message language set to ${formatLanguageLabel(language)}`
        : `ℹ️ Message language is ${formatLanguageLabel(language)}`;
    }
    return changed
      ? `✅ 消息提示语言已设置为 ${formatLanguageLabel(language)}`
      : `ℹ️ 当前消息提示语言为 ${formatLanguageLabel(language)}`;
  }

  function formatProfileConfigHelp(language) {
    if (language === 'en') {
      return [
        'Usage: `!profile <auto|solo|team|public|status>`',
        `Slash: \`${slashRef('profile')} <auto|solo|team|public|status>\``,
      ].join('\n');
    }
    return [
      '用法：`!profile <auto|solo|team|public|status>`',
      `Slash：\`${slashRef('profile')} <auto|solo|team|public|status>\``,
    ].join('\n');
  }

  function formatProfileConfigReport(language, profile, changed) {
    const label = formatSecurityProfileLabel(profile);
    if (language === 'en') {
      return changed
        ? `✅ Security profile set to ${label}`
        : `ℹ️ Security profile is ${label}`;
    }
    return changed
      ? `✅ 安全策略 profile 已设置为 ${label}`
      : `ℹ️ 当前安全策略 profile 为 ${label}`;
  }

  function formatTimeoutConfigHelp(language) {
    if (language === 'en') {
      return [
        'Usage: `!timeout <ms|off|status>`',
        `Slash: \`${slashRef('timeout')} <ms|off|status>\``,
        'Examples: `!timeout 60000`, `!timeout off`, `!timeout status`',
      ].join('\n');
    }
    return [
      '用法：`!timeout <毫秒|off|status>`',
      `Slash：\`${slashRef('timeout')} <毫秒|off|status>\``,
      '示例：`!timeout 60000`、`!timeout off`、`!timeout status`',
    ].join('\n');
  }

  function formatTimeoutConfigReport(language, timeoutSetting, changed) {
    const label = `${formatTimeoutLabel(timeoutSetting.timeoutMs)} (${timeoutSetting.source})`;
    if (language === 'en') {
      return changed
        ? `✅ Runner timeout set to ${label}`
        : `ℹ️ Runner timeout is ${label}`;
    }
    return changed
      ? `✅ Runner 超时已设置为 ${label}`
      : `ℹ️ 当前 Runner 超时为 ${label}`;
  }

  function formatHelpReport(session) {
    const language = getSessionLanguage(session);
    if (language === 'en') {
      return [
        '**📋 Commands**',
        '',
        botProvider
          ? `Bot mode: locked to ${getProviderDisplayName(botProvider)}`
          : 'Bot mode: shared (use `!provider` / `/provider` to switch per channel)',
        '',
        '**Session**',
        '• `!status` — current config snapshot',
        '• `!queue` — queue status in current channel',
        '• `!doctor` — runtime + security diagnostics',
        `• \`${slashRef('onboarding')}\` — interactive onboarding`,
        '• `!onboarding` — onboarding text checklist',
        `• \`${slashRef('onboarding_config')} <on|off|status>\` / \`!onboarding <on|off|status>\` — onboarding switch`,
        `• \`${slashRef('language')} <中文|English>\` / \`!lang <zh|en>\` — message language`,
        `• \`${slashRef('profile')} <auto|solo|team|public|status>\` / \`!profile <...|status>\` — channel security profile`,
        `• \`${slashRef('timeout')} <ms|off|status>\` / \`!timeout <...>\` — runner timeout`,
        `• \`${slashRef('progress')}\` / \`!progress\` — current run progress`,
        `• \`${slashRef('cancel')}\` / \`${slashRef('abort')}\` / \`!abort\` / \`!cancel\` / \`!stop\` — stop running task and clear queue`,
        `• \`${slashRef('new')}\` / \`!new\` — switch to a fresh session but keep channel settings`,
        `• \`${slashRef('reset')}\` / \`!reset\` — clear session context and extra config overrides`,
        '• `!resume <session_id>` — bind existing provider session',
        '• `!sessions` — list recent provider sessions',
        !botProvider ? '• `!provider <codex|claude|gemini|status>` — switch provider for current channel' : null,
        '',
        '**Workspace**',
        '• `!setdir <path|browse|default|status>` — set or clear current thread workspace',
        '• `!cd <...>` — alias of `!setdir`',
        '• `!setdefaultdir <path|browse|clear|status>` — set provider default workspace',
        `• \`${slashRef('setdir')} path:<...>\` / \`${slashRef('setdefaultdir')} path:<...>\` — workspace controls`,
        '',
        '**Model & Runtime**',
        '• `!model <name|default>` — set model override',
        '• `!effort <xhigh|high|medium|low|default>` — reasoning effort',
        `• \`${slashRef('compact')} key:<...> value:<...>\` / \`!compact <...>\` — compact config (Codex only)`,
        '• `!mode <safe|dangerous>` — execution mode',
        '• `!config <key=value>` — append provider config override (Codex only; when enabled + allowlisted)',
        '',
        'Normal messages are forwarded to the current provider.',
      ].filter(Boolean).join('\n');
    }
    return [
      '**📋 命令列表**',
      '',
      botProvider
        ? `Bot 模式：已锁定到 ${getProviderDisplayName(botProvider)}`
        : 'Bot 模式：共享实例（可用 `!provider` / `/provider` 按频道切换）',
      '',
      '**会话管理**',
      '• `!status` — 当前配置一览',
      '• `!queue` — 查看当前频道队列（运行中/排队数）',
      '• `!doctor` — 查看 bot 健康状态与当前安全策略',
      `• \`${slashRef('onboarding')}\` — 交互式引导（按钮分步）`,
      '• `!onboarding` — 文本版引导流程与检查清单',
      `• \`${slashRef('onboarding_config')} <on|off|status>\` / \`!onboarding <on|off|status>\` — onboarding 开关`,
      `• \`${slashRef('language')} <中文|English>\` / \`!lang <zh|en>\` — 消息提示语言`,
      `• \`${slashRef('profile')} <auto|solo|team|public|status>\` / \`!profile <...|status>\` — 当前频道 security profile`,
      `• \`${slashRef('timeout')} <毫秒|off|status>\` / \`!timeout <...>\` — runner 超时`,
      `• \`${slashRef('progress')}\` / \`!progress\` — 查看当前任务的最新进度`,
      `• \`${slashRef('cancel')}\` / \`${slashRef('abort')}\` / \`!abort\` / \`!cancel\` / \`!stop\` — 中断当前任务并清空队列`,
      `• \`${slashRef('new')}\` / \`!new\` — 切到新会话，但保留当前频道配置`,
      `• \`${slashRef('reset')}\` / \`!reset\` — 清空会话与额外配置，下条消息新开上下文`,
      '• `!resume <session_id>` — 继承一个已有的 provider session',
      '• `!sessions` — 列出最近的 provider sessions',
      !botProvider ? '• `!provider <codex|claude|gemini|status>` — 切换当前频道 provider' : null,
      '',
      '**工作目录**',
      '• `!setdir <path|browse|default|status>` — 设置或清除当前 thread 的 workspace',
      '• `!cd <...>` — 同 `!setdir` 的别名',
      '• `!setdefaultdir <path|browse|clear|status>` — 设置当前 provider 的默认 workspace',
      `• \`${slashRef('setdir')} path:<...>\` / \`${slashRef('setdefaultdir')} path:<...>\` — workspace 控制`,
      '',
      '**模型 & 执行**',
      '• `!model <name|default>` — 切换模型（如 gpt-5.3-codex, o3）',
      '• `!effort <xhigh|high|medium|low|default>` — reasoning effort',
      `• \`${slashRef('compact')} key:<...> value:<...>\` / \`!compact <...>\` — compact 配置（仅 Codex）`,
      '• `!mode <safe|dangerous>` — 执行模式',
      '• `!config <key=value>` — 添加 provider 配置覆盖（当前仅 Codex 支持；需 ENABLE_CONFIG_CMD=true 且 key 在白名单）',
      '',
      '普通消息直接转给当前 provider。',
    ].filter(Boolean).join('\n');
  }

  function formatWorkspaceReport(key, session) {
    const language = normalizeUiLanguage(getSessionLanguage(session));
    const lines = getWorkspaceStatusLines(key, session, language);
    if (language === 'en') {
      return [
        '📁 **Workspace**',
        ...lines,
        '• session rule: Codex and Gemini clear session on workspace change; Claude keeps session when possible.',
      ].join('\n');
    }
    return [
      '📁 **工作目录**',
      ...lines,
      '• session 规则：Codex / Gemini 在 workspace 变化时会清空 session；Claude 尽量保留当前 session。',
    ].join('\n');
  }

  function formatWorkspaceSetHelp(language = 'zh') {
    if (language === 'en') {
      return [
        'Usage: `!setdir <path|browse|default|status>`',
        `Slash: \`${slashRef('setdir')} path:<path|browse|default|status>\``,
        'Examples: `!setdir ~/GitHub/my-repo`, `!setdir browse`, `!setdir default`, `!setdir status`',
      ].join('\n');
    }
    return [
      '用法：`!setdir <path|browse|default|status>`',
      `Slash：\`${slashRef('setdir')} path:<path|browse|default|status>\``,
      '示例：`!setdir ~/GitHub/my-repo`、`!setdir browse`、`!setdir default`、`!setdir status`',
    ].join('\n');
  }

  function formatDefaultWorkspaceSetHelp(language = 'zh') {
    if (language === 'en') {
      return [
        'Usage: `!setdefaultdir <path|browse|clear|status>`',
        `Slash: \`${slashRef('setdefaultdir')} path:<path|browse|clear|status>\``,
        'Examples: `!setdefaultdir ~/GitHub`, `!setdefaultdir browse`, `!setdefaultdir clear`, `!setdefaultdir status`',
      ].join('\n');
    }
    return [
      '用法：`!setdefaultdir <path|browse|clear|status>`',
      `Slash：\`${slashRef('setdefaultdir')} path:<path|browse|clear|status>\``,
      '示例：`!setdefaultdir ~/GitHub`、`!setdefaultdir browse`、`!setdefaultdir clear`、`!setdefaultdir status`',
    ].join('\n');
  }

  function formatWorkspaceUpdateReport(key, session, result) {
    const language = normalizeUiLanguage(getSessionLanguage(session));
    const lines = getWorkspaceStatusLines(key, session, language);
    const providerShortName = getProviderShortName(getSessionProvider(session));
    if (language === 'en') {
      return [
        result.clearedOverride ? '✅ Cleared thread workspace override' : '✅ Workspace updated',
        ...lines,
        result.sessionReset
          ? `• session: reset because ${providerShortName} cannot resume into a different workspace`
          : '• session: kept',
      ].join('\n');
    }
    return [
      result.clearedOverride ? '✅ 已清除当前 thread 的 workspace 覆盖' : '✅ workspace 已更新',
      ...lines,
      result.sessionReset
        ? `• session: 已重置（${providerShortName} 不能在不同 workspace 中继续同一个 session）`
        : '• session: 已保留',
    ].join('\n');
  }

  function formatDefaultWorkspaceUpdateReport(key, session, result) {
    const language = normalizeUiLanguage(getSessionLanguage(session));
    const lines = getWorkspaceStatusLines(key, session, language);
    if (language === 'en') {
      return [
        result.defaultWorkspaceDir ? '✅ Provider default workspace updated' : '✅ Provider default workspace cleared',
        ...lines,
        `• affected threads: ${result.affectedThreads}`,
        `• reset sessions: ${result.resetSessions}`,
      ].join('\n');
    }
    return [
      result.defaultWorkspaceDir ? '✅ provider 默认 workspace 已更新' : '✅ provider 默认 workspace 已清除',
      ...lines,
      `• 受影响 threads: ${result.affectedThreads}`,
      `• 重置 sessions: ${result.resetSessions}`,
    ].join('\n');
  }

  function formatWorkspaceBusyReport(session, workspaceDir, owner = null) {
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

  return {
    formatStatusReport,
    formatQueueReport,
    formatProgressReport,
    formatCancelReport,
    formatDoctorReport,
    formatCompactStrategyConfigHelp,
    formatCompactConfigReport,
    formatReasoningEffortHelp,
    formatLanguageConfigHelp,
    formatLanguageConfigReport,
    formatProfileConfigHelp,
    formatProfileConfigReport,
    formatTimeoutConfigHelp,
    formatTimeoutConfigReport,
    formatHelpReport,
    formatWorkspaceReport,
    formatWorkspaceSetHelp,
    formatDefaultWorkspaceSetHelp,
    formatWorkspaceUpdateReport,
    formatDefaultWorkspaceUpdateReport,
    formatWorkspaceBusyReport,
  };
}
