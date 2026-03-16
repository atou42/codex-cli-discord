const SETTINGS_COMPONENT_PREFIX = 'stg';
const SETTINGS_MODAL_PREFIX = 'stgm';
const MODEL_INPUT_ID = 'model_name';

const ALL_SECTIONS = Object.freeze([
  'overview',
  'provider',
  'model',
  'fast',
  'effort',
  'compact',
  'language',
  'mode',
  'workspace',
]);

function normalizeLanguage(value) {
  return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh';
}

function normalizeSection(value) {
  const section = String(value || '').trim().toLowerCase();
  return ALL_SECTIONS.includes(section) ? section : 'overview';
}

function formatSettingSourceLabel(source, language) {
  const value = String(source || '').trim().toLowerCase();
  if (language === 'en') {
    if (value === 'session override') return 'this channel';
    if (value === 'config.toml') return 'global config';
    if (value === 'env default') return 'env default';
    if (value === 'provider') return 'provider default';
    if (value === 'provider unsupported') return 'not supported';
    if (value === 'thread override') return 'this channel';
    if (value === 'provider default') return 'provider default';
    if (value === 'legacy fallback') return 'legacy fallback';
    if (value === 'unset') return 'unset';
    return value || 'unknown';
  }

  if (value === 'session override') return '当前频道';
  if (value === 'config.toml') return '全局配置';
  if (value === 'env default') return '环境默认';
  if (value === 'provider') return 'provider 默认';
  if (value === 'provider unsupported') return '当前 provider 不支持';
  if (value === 'thread override') return '当前频道';
  if (value === 'provider default') return 'provider 默认';
  if (value === 'legacy fallback') return 'legacy 回退';
  if (value === 'unset') return '未设置';
  return value || '未知';
}

function formatFastModeLabel(enabled, language) {
  return enabled
    ? (language === 'en' ? 'on' : '开启')
    : (language === 'en' ? 'off' : '关闭');
}

function formatWorkspaceLabel(binding, language) {
  const workspaceDir = String(binding?.workspaceDir || '').trim();
  const source = formatSettingSourceLabel(binding?.source, language);
  if (!workspaceDir) {
    return language === 'en'
      ? `(unset) (${source})`
      : `（未设置）（${source}）`;
  }
  return language === 'en'
    ? `\`${workspaceDir}\` (${source})`
    : `\`${workspaceDir}\`（${source}）`;
}

function formatValueLabel(value, fallback, language) {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (text.startsWith('(') && text.endsWith(')')) return text;
  return `\`${text}\``;
}

function formatSectionButtonLabel(section, language) {
  const labels = {
    overview: { en: 'overview', zh: '总览' },
    provider: { en: 'provider', zh: 'provider' },
    model: { en: 'model', zh: 'model' },
    fast: { en: 'fast', zh: 'fast' },
    effort: { en: 'effort', zh: 'effort' },
    compact: { en: 'compact', zh: 'compact' },
    language: { en: 'language', zh: '语言' },
    mode: { en: 'mode', zh: 'mode' },
    workspace: { en: 'workspace', zh: 'workspace' },
    close: { en: 'close', zh: '关闭' },
  };
  return labels[section]?.[language] || section;
}

function buildSettingsComponentId(kind, target, value, userId) {
  return `${SETTINGS_COMPONENT_PREFIX}:${kind}:${target}:${value}:${String(userId || '').trim()}`;
}

function buildSettingsModalId(target, userId) {
  return `${SETTINGS_MODAL_PREFIX}:${target}:${String(userId || '').trim()}`;
}

function parseSettingsComponentId(customId) {
  const match = /^stg:(nav|set|act):([a-z_]+):([a-z0-9_-]+):([0-9]{5,32})$/i.exec(String(customId || '').trim());
  if (!match) return null;
  return {
    kind: String(match[1] || '').trim().toLowerCase(),
    target: String(match[2] || '').trim().toLowerCase(),
    value: String(match[3] || '').trim().toLowerCase(),
    userId: String(match[4] || '').trim(),
  };
}

function parseSettingsModalId(customId) {
  const match = /^stgm:([a-z_]+):([0-9]{5,32})$/i.exec(String(customId || '').trim());
  if (!match) return null;
  return {
    target: String(match[1] || '').trim().toLowerCase(),
    userId: String(match[2] || '').trim(),
  };
}

function isSettingsPanelComponentId(customId) {
  return Boolean(parseSettingsComponentId(customId));
}

function isSettingsPanelModalId(customId) {
  return Boolean(parseSettingsModalId(customId));
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function createSettingsPanel({
  botProvider = null,
  defaultUiLanguage = 'zh',
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  getSession = () => null,
  getSessionLanguage = () => defaultUiLanguage,
  getSessionProvider = () => 'codex',
  getWorkspaceBinding = () => ({ workspaceDir: null, source: 'unset' }),
  getProviderDefaults = () => ({ model: '(provider default)', effort: '(provider default)', source: 'provider' }),
  getProviderDisplayName = (provider) => String(provider || ''),
  getSupportedReasoningEffortLevels = () => [],
  getProviderCompactCapabilities = () => ({ strategies: ['hard', 'native', 'off'] }),
  normalizeUiLanguage = normalizeLanguage,
  resolveFastModeSetting = () => ({ enabled: false, supported: false, source: 'provider unsupported' }),
  resolveCompactStrategySetting = () => ({ strategy: 'native', source: 'env default' }),
  commandActions = {},
  openWorkspaceBrowser,
  slashRef = (name) => `/${name}`,
} = {}) {
  function getAvailableSections(session) {
    const provider = getSessionProvider(session);
    const sections = ['overview'];
    if (!botProvider) sections.push('provider');
    sections.push('model');
    if (provider === 'codex') sections.push('fast');
    if (getSupportedReasoningEffortLevels(provider).length) sections.push('effort');
    sections.push('compact', 'language', 'mode', 'workspace');
    return sections;
  }

  function resolveActiveSection(session, requested) {
    const normalized = normalizeSection(requested);
    return getAvailableSections(session).includes(normalized) ? normalized : 'overview';
  }

  function buildSnapshot(key, session) {
    const language = normalizeUiLanguage(getSessionLanguage(session) || defaultUiLanguage);
    const provider = getSessionProvider(session);
    const defaults = getProviderDefaults(provider);
    const fastMode = resolveFastModeSetting(session);
    const compact = resolveCompactStrategySetting(session);
    const workspace = getWorkspaceBinding(session, key) || { workspaceDir: null, source: 'unset' };
    const effortLevels = getSupportedReasoningEffortLevels(provider);

    return {
      language,
      provider,
      providerLabel: getProviderDisplayName(provider),
      defaults,
      fastMode,
      compact,
      workspace,
      effortLevels,
      modelValue: session?.model || defaults.model,
      modelSource: session?.model ? 'session override' : defaults.source,
      effortValue: effortLevels.length ? (session?.effort || defaults.effort) : null,
      effortSource: session?.effort ? 'session override' : defaults.source,
    };
  }

  function buildSectionButtons(session, userId, activeSection) {
    const language = normalizeUiLanguage(getSessionLanguage(session) || defaultUiLanguage);
    const available = getAvailableSections(session);
    const primaryRow = [];
    const secondaryRow = [];

    for (const section of ['provider', 'model', 'fast', 'effort', 'compact']) {
      if (!available.includes(section)) continue;
      primaryRow.push(
        new ButtonBuilder()
          .setCustomId(buildSettingsComponentId('nav', section, '_', userId))
          .setLabel(formatSectionButtonLabel(section, language))
          .setStyle(activeSection === section ? ButtonStyle.Primary : ButtonStyle.Secondary),
      );
    }

    for (const section of ['overview', 'language', 'mode', 'workspace']) {
      if (!available.includes(section)) continue;
      secondaryRow.push(
        new ButtonBuilder()
          .setCustomId(buildSettingsComponentId('nav', section, '_', userId))
          .setLabel(formatSectionButtonLabel(section, language))
          .setStyle(activeSection === section ? ButtonStyle.Primary : ButtonStyle.Secondary),
      );
    }

    secondaryRow.push(
      new ButtonBuilder()
        .setCustomId(buildSettingsComponentId('act', 'panel', 'close', userId))
        .setLabel(formatSectionButtonLabel('close', language))
        .setStyle(ButtonStyle.Danger),
    );

    return [
      primaryRow.length ? new ActionRowBuilder().addComponents(...primaryRow) : null,
      secondaryRow.length ? new ActionRowBuilder().addComponents(...secondaryRow) : null,
    ].filter(Boolean);
  }

  function buildSectionControls(key, session, userId, activeSection, snapshot) {
    switch (activeSection) {
      case 'provider': {
        if (botProvider) return [];
        return [
          new ActionRowBuilder().addComponents(
            ...['codex', 'claude', 'gemini'].map((provider) => new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'provider', provider, userId))
              .setLabel(provider)
              .setStyle(snapshot.provider === provider ? ButtonStyle.Primary : ButtonStyle.Secondary)),
          ),
        ];
      }

      case 'language':
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'language', 'zh', userId))
              .setLabel('中文')
              .setStyle(snapshot.language === 'zh' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'language', 'en', userId))
              .setLabel('English')
              .setStyle(snapshot.language === 'en' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
        ];

      case 'mode':
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'mode', 'safe', userId))
              .setLabel('safe')
              .setStyle(session?.mode === 'safe' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'mode', 'dangerous', userId))
              .setLabel('dangerous')
              .setStyle(session?.mode === 'dangerous' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
        ];

      case 'fast': {
        const selected = snapshot.fastMode.source === 'session override'
          ? (snapshot.fastMode.enabled ? 'on' : 'off')
          : 'follow';
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'fast', 'follow', userId))
              .setLabel(snapshot.language === 'en' ? 'Follow global' : '跟随全局')
              .setStyle(selected === 'follow' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'fast', 'on', userId))
              .setLabel(snapshot.language === 'en' ? 'On' : '开启')
              .setStyle(selected === 'on' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'fast', 'off', userId))
              .setLabel(snapshot.language === 'en' ? 'Off' : '关闭')
              .setStyle(selected === 'off' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
        ];
      }

      case 'effort': {
        const values = [...snapshot.effortLevels, 'default'];
        return chunk(values, 5).map((rowValues) => new ActionRowBuilder().addComponents(
          ...rowValues.map((value) => {
            const selected = value === 'default'
              ? !session?.effort
              : session?.effort === value;
            return new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('set', 'effort', value, userId))
              .setLabel(value)
              .setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary);
          }),
        ));
      }

      case 'compact': {
        const compactCapabilities = getProviderCompactCapabilities(snapshot.provider);
        const values = ['follow', ...compactCapabilities.strategies];
        return [
          new ActionRowBuilder().addComponents(
            ...values.map((value) => {
              const selected = value === 'follow'
                ? !session?.compactStrategy
                : session?.compactStrategy === value;
              const label = value === 'follow'
                ? (snapshot.language === 'en' ? 'Follow default' : '跟随默认')
                : value;
              return new ButtonBuilder()
                .setCustomId(buildSettingsComponentId('set', 'compact', value, userId))
                .setLabel(label)
                .setStyle(selected ? ButtonStyle.Primary : ButtonStyle.Secondary);
            }),
          ),
        ];
      }

      case 'model':
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('act', 'model', 'custom', userId))
              .setLabel(snapshot.language === 'en' ? 'Set custom model' : '设置自定义模型')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('act', 'model', 'default', userId))
              .setLabel(snapshot.language === 'en' ? 'Use provider default' : '使用 provider 默认')
              .setStyle(!session?.model ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
        ];

      case 'workspace':
        return [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('act', 'workspace', 'browse', userId))
              .setLabel(snapshot.language === 'en' ? 'Browse workspace' : '浏览 workspace')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(buildSettingsComponentId('act', 'workspace', 'clear', userId))
              .setLabel(snapshot.language === 'en' ? 'Follow provider default' : '跟随 provider 默认')
              .setStyle(!session?.workspaceDir ? ButtonStyle.Primary : ButtonStyle.Secondary)
              .setDisabled(!session?.workspaceDir),
          ),
        ];

      default:
        return [];
    }
  }

  function formatOverviewSection(snapshot) {
    if (snapshot.language === 'en') {
      return [
        'Choose a setting section below.',
        !botProvider ? 'Switching provider restores the saved per-provider channel settings.' : null,
      ].filter(Boolean).join('\n');
    }
    return [
      '请选择下方的设置项。',
      !botProvider ? '切换 provider 会恢复这个频道里该 provider 自己保存的那组设置。' : null,
    ].filter(Boolean).join('\n');
  }

  function formatActiveSection(activeSection, snapshot) {
    const compactSurface = `${slashRef('compact')} key:<...> value:<...>`;
    switch (activeSection) {
      case 'provider':
        return snapshot.language === 'en'
          ? 'Provider switches the active runtime for this channel. Each provider keeps its own saved session/model/runtime overrides.'
          : 'provider 决定这个频道当前使用哪套 CLI 运行时。每个 provider 会保留自己独立的 session、model 和运行时覆盖。';
      case 'model':
        return snapshot.language === 'en'
          ? 'Set a custom model string with the modal, or clear the channel override and fall back to the provider default.'
          : '可以通过弹窗输入自定义模型名，也可以清掉当前频道覆盖，回退到 provider 默认模型。';
      case 'fast':
        return snapshot.language === 'en'
          ? 'Fast mode only exists on Codex. "Follow global" means this channel stops overriding and inherits `~/.codex/config.toml`.'
          : 'Fast mode 仅对 Codex 生效。选择“跟随全局”表示当前频道不再覆盖，改为继承 `~/.codex/config.toml`。';
      case 'effort':
        return snapshot.language === 'en'
          ? 'Reasoning effort options are provider-specific. "default" clears this channel override.'
          : 'reasoning effort 的可选值由 provider 决定。选择 `default` 会清掉当前频道覆盖。';
      case 'compact':
        return snapshot.language === 'en'
          ? `This panel currently controls compact strategy only. For token limits or enabled/status details, keep using \`${compactSurface}\`.`
          : `这个面板当前只管理 compact strategy。若要设置 token limit 或查看更多细项，继续使用 \`${compactSurface}\`。`;
      case 'language':
        return snapshot.language === 'en'
          ? 'This only changes the bot hint language for the current channel.'
          : '这里只会切换当前频道的 bot 提示语言。';
      case 'mode':
        return snapshot.language === 'en'
          ? 'Execution mode is channel-scoped. `dangerous` removes sandbox/approval safeguards.'
          : '执行模式按频道生效。`dangerous` 会去掉 sandbox 与审批保护。';
      case 'workspace':
        return snapshot.language === 'en'
          ? 'Browsing opens the existing workspace picker in a separate ephemeral panel. "Follow provider default" clears the thread override only.'
          : '“浏览 workspace” 会在单独的 ephemeral 面板里打开现有路径选择器。“跟随 provider 默认”只会清掉当前 thread 的 workspace 覆盖。';
      default:
        return formatOverviewSection(snapshot);
    }
  }

  function formatSettingsContent(key, session, activeSection, notice = '') {
    const snapshot = buildSnapshot(key, session);
    const lines = [
      snapshot.language === 'en' ? '⚙️ **Channel Settings**' : '⚙️ **频道设置**',
      notice || null,
      snapshot.language === 'en'
        ? `• provider: \`${snapshot.provider}\` (${snapshot.providerLabel})`
        : `• provider：\`${snapshot.provider}\`（${snapshot.providerLabel}）`,
      snapshot.language === 'en'
        ? `• model: ${formatValueLabel(snapshot.modelValue, '(provider default)', snapshot.language)} (${formatSettingSourceLabel(snapshot.modelSource, snapshot.language)})`
        : `• model：${formatValueLabel(snapshot.modelValue, '（provider 默认）', snapshot.language)}（${formatSettingSourceLabel(snapshot.modelSource, snapshot.language)}）`,
      snapshot.fastMode.supported
        ? (snapshot.language === 'en'
          ? `• fast mode: ${formatFastModeLabel(snapshot.fastMode.enabled, snapshot.language)} (${formatSettingSourceLabel(snapshot.fastMode.source, snapshot.language)})`
          : `• fast mode：${formatFastModeLabel(snapshot.fastMode.enabled, snapshot.language)}（${formatSettingSourceLabel(snapshot.fastMode.source, snapshot.language)}）`)
        : (snapshot.language === 'en'
          ? '• fast mode: n/a (Codex only)'
          : '• fast mode：不适用（仅 Codex）'),
      snapshot.effortLevels.length
        ? (snapshot.language === 'en'
          ? `• effort: ${formatValueLabel(snapshot.effortValue, '(provider default)', snapshot.language)} (${formatSettingSourceLabel(snapshot.effortSource, snapshot.language)})`
          : `• effort：${formatValueLabel(snapshot.effortValue, '（provider 默认）', snapshot.language)}（${formatSettingSourceLabel(snapshot.effortSource, snapshot.language)}）`)
        : (snapshot.language === 'en'
          ? `• effort: not exposed on ${snapshot.providerLabel}`
          : `• effort：${snapshot.providerLabel} 当前未暴露`),
      snapshot.language === 'en'
        ? `• compact: \`${snapshot.compact.strategy}\` (${formatSettingSourceLabel(snapshot.compact.source, snapshot.language)})`
        : `• compact：\`${snapshot.compact.strategy}\`（${formatSettingSourceLabel(snapshot.compact.source, snapshot.language)}）`,
      snapshot.language === 'en'
        ? `• mode: \`${session?.mode || 'safe'}\``
        : `• mode：\`${session?.mode || 'safe'}\``,
      snapshot.language === 'en'
        ? `• language: ${snapshot.language === 'en' ? 'English' : '中文'}`
        : `• language：${snapshot.language === 'en' ? 'English' : '中文'}`,
      snapshot.language === 'en'
        ? `• workspace: ${formatWorkspaceLabel(snapshot.workspace, snapshot.language)}`
        : `• workspace：${formatWorkspaceLabel(snapshot.workspace, snapshot.language)}`,
      '',
      snapshot.language === 'en'
        ? `**Active: ${activeSection}**`
        : `**当前项：${activeSection}**`,
      formatActiveSection(activeSection, snapshot),
    ];
    return lines.filter(Boolean).join('\n');
  }

  function buildSettingsPayload({ key, session, userId, flags = undefined, activeSection = 'overview', notice = '' } = {}) {
    const section = resolveActiveSection(session, activeSection);
    const snapshot = buildSnapshot(key, session);
    const components = [
      ...buildSectionButtons(session, userId, section),
      ...buildSectionControls(key, session, userId, section, snapshot),
    ];
    const payload = {
      content: formatSettingsContent(key, session, section, notice),
      components,
    };
    if (flags !== undefined) payload.flags = flags;
    return payload;
  }

  function buildModelModal(session, userId) {
    const language = normalizeUiLanguage(getSessionLanguage(session) || defaultUiLanguage);
    const input = new TextInputBuilder()
      .setCustomId(MODEL_INPUT_ID)
      .setLabel(language === 'en' ? 'Model name or default' : '模型名或 default')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(language === 'en' ? 'e.g. o3, gpt-5.4, default' : '例如 o3、gpt-5.4、default')
      .setRequired(true)
      .setMaxLength(120);
    if (session?.model) input.setValue(session.model);

    return new ModalBuilder()
      .setCustomId(buildSettingsModalId('model', userId))
      .setTitle(language === 'en' ? 'Set custom model' : '设置自定义模型')
      .addComponents(
        new ActionRowBuilder().addComponents(input),
      );
  }

  async function handleSettingsPanelInteraction(interaction) {
    const parsed = parseSettingsComponentId(interaction.customId);
    if (!parsed) return false;

    const key = String(interaction.channelId || '').trim();
    const session = key ? getSession(key) : null;
    const language = normalizeUiLanguage(getSessionLanguage(session) || defaultUiLanguage);

    if (!key || !session) {
      await interaction.reply({
        content: language === 'en' ? '❌ Unable to load channel settings.' : '❌ 无法读取当前频道设置。',
        flags: 64,
      });
      return true;
    }

    if (parsed.userId !== interaction.user.id) {
      await interaction.reply({
        content: language === 'en' ? '⛔ This settings panel belongs to another user.' : '⛔ 这个设置面板属于其他用户。',
        flags: 64,
      });
      return true;
    }

    if (parsed.kind === 'nav') {
      await interaction.update(buildSettingsPayload({
        key,
        session,
        userId: interaction.user.id,
        activeSection: parsed.target,
      }));
      return true;
    }

    if (parsed.kind === 'act') {
      if (parsed.target === 'panel' && parsed.value === 'close') {
        await interaction.update({
          content: language === 'en' ? '⚙️ Settings panel closed.' : '⚙️ 设置面板已关闭。',
          components: [],
        });
        return true;
      }

      if (parsed.target === 'model' && parsed.value === 'custom') {
        await interaction.showModal(buildModelModal(session, interaction.user.id));
        return true;
      }

      if (parsed.target === 'model' && parsed.value === 'default') {
        commandActions.setModel?.(session, 'default');
        await interaction.update(buildSettingsPayload({
          key,
          session,
          userId: interaction.user.id,
          activeSection: 'model',
          notice: language === 'en' ? '✅ Model now follows the provider default.' : '✅ 当前 model 已改为跟随 provider 默认。',
        }));
        return true;
      }

      if (parsed.target === 'workspace' && parsed.value === 'browse') {
        if (typeof openWorkspaceBrowser !== 'function') {
          await interaction.reply({
            content: language === 'en' ? '❌ Workspace browser is unavailable here.' : '❌ 当前环境没有可用的 workspace 浏览器。',
            flags: 64,
          });
          return true;
        }
        await interaction.reply(openWorkspaceBrowser({
          key,
          session,
          userId: interaction.user.id,
          mode: 'thread',
          flags: 64,
        }));
        return true;
      }

      if (parsed.target === 'workspace' && parsed.value === 'clear') {
        const result = commandActions.clearWorkspaceDir?.(session, key);
        await interaction.update(buildSettingsPayload({
          key,
          session,
          userId: interaction.user.id,
          activeSection: 'workspace',
          notice: result
            ? (language === 'en' ? '✅ This channel now follows the provider default workspace.' : '✅ 当前频道已改为跟随 provider 默认 workspace。')
            : '',
        }));
        return true;
      }
    }

    if (parsed.kind === 'set') {
      if (parsed.target === 'provider' && !botProvider) {
        commandActions.setProvider?.(session, parsed.value);
      } else if (parsed.target === 'language') {
        commandActions.setLanguage?.(session, parsed.value);
      } else if (parsed.target === 'mode') {
        commandActions.setMode?.(session, parsed.value);
      } else if (parsed.target === 'fast') {
        const next = parsed.value === 'follow' ? null : parsed.value === 'on';
        commandActions.setFastMode?.(session, next);
      } else if (parsed.target === 'effort') {
        commandActions.setReasoningEffort?.(session, parsed.value);
      } else if (parsed.target === 'compact') {
        commandActions.setCompactStrategy?.(session, parsed.value === 'follow' ? null : parsed.value);
      }

      await interaction.update(buildSettingsPayload({
        key,
        session,
        userId: interaction.user.id,
        activeSection: parsed.target,
      }));
      return true;
    }

    await interaction.reply({
      content: language === 'en' ? '❌ Unsupported settings action.' : '❌ 不支持这个设置操作。',
      flags: 64,
    });
    return true;
  }

  async function handleSettingsPanelModalSubmit(interaction) {
    const parsed = parseSettingsModalId(interaction.customId);
    if (!parsed) return false;

    const key = String(interaction.channelId || '').trim();
    const session = key ? getSession(key) : null;
    const language = normalizeUiLanguage(getSessionLanguage(session) || defaultUiLanguage);

    if (!key || !session) {
      await interaction.reply({
        content: language === 'en' ? '❌ Unable to load channel settings.' : '❌ 无法读取当前频道设置。',
        flags: 64,
      });
      return true;
    }

    if (parsed.userId !== interaction.user.id) {
      await interaction.reply({
        content: language === 'en' ? '⛔ This settings panel belongs to another user.' : '⛔ 这个设置面板属于其他用户。',
        flags: 64,
      });
      return true;
    }

    if (parsed.target === 'model') {
      const rawValue = String(interaction.fields.getTextInputValue(MODEL_INPUT_ID) || '').trim();
      commandActions.setModel?.(session, rawValue);
      await interaction.reply(buildSettingsPayload({
        key,
        session,
        userId: interaction.user.id,
        activeSection: 'model',
        flags: 64,
        notice: language === 'en' ? '✅ Model updated. This is the latest settings panel.' : '✅ model 已更新。这是最新的设置面板。',
      }));
      return true;
    }

    await interaction.reply({
      content: language === 'en' ? '❌ Unsupported settings modal.' : '❌ 不支持这个设置弹窗。',
      flags: 64,
    });
    return true;
  }

  return {
    openSettingsPanel: (options = {}) => buildSettingsPayload(options),
    handleSettingsPanelInteraction,
    handleSettingsPanelModalSubmit,
    isSettingsPanelComponentId,
    isSettingsPanelModalId,
  };
}
