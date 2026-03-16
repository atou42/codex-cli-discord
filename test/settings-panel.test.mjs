import test from 'node:test';
import assert from 'node:assert/strict';

import { createSettingsPanel } from '../src/settings-panel.js';

class FakeButtonBuilder {
  constructor() {
    this.data = {};
  }

  setCustomId(value) {
    this.data.customId = value;
    return this;
  }

  setLabel(value) {
    this.data.label = value;
    return this;
  }

  setStyle(value) {
    this.data.style = value;
    return this;
  }

  setDisabled(value) {
    this.data.disabled = value;
    return this;
  }
}

class FakeActionRowBuilder {
  constructor() {
    this.components = [];
  }

  addComponents(...components) {
    this.components.push(...components);
    return this;
  }
}

class FakeModalBuilder {
  constructor() {
    this.data = { components: [] };
  }

  setCustomId(value) {
    this.data.customId = value;
    return this;
  }

  setTitle(value) {
    this.data.title = value;
    return this;
  }

  addComponents(...components) {
    this.data.components.push(...components);
    return this;
  }
}

class FakeTextInputBuilder {
  constructor() {
    this.data = {};
  }

  setCustomId(value) {
    this.data.customId = value;
    return this;
  }

  setLabel(value) {
    this.data.label = value;
    return this;
  }

  setStyle(value) {
    this.data.style = value;
    return this;
  }

  setPlaceholder(value) {
    this.data.placeholder = value;
    return this;
  }

  setRequired(value) {
    this.data.required = value;
    return this;
  }

  setMaxLength(value) {
    this.data.maxLength = value;
    return this;
  }

  setValue(value) {
    this.data.value = value;
    return this;
  }
}

const ButtonStyle = {
  Primary: 'primary',
  Secondary: 'secondary',
  Success: 'success',
  Danger: 'danger',
};

const TextInputStyle = {
  Short: 'short',
};

function createPanel({ session, botProvider = null, openWorkspaceBrowser, commandActions = {} } = {}) {
  return createSettingsPanel({
    botProvider,
    defaultUiLanguage: 'zh',
    ActionRowBuilder: FakeActionRowBuilder,
    ButtonBuilder: FakeButtonBuilder,
    ButtonStyle,
    ModalBuilder: FakeModalBuilder,
    TextInputBuilder: FakeTextInputBuilder,
    TextInputStyle,
    getSession: () => session,
    getSessionLanguage: (currentSession) => currentSession?.language || 'zh',
    getSessionProvider: (currentSession) => currentSession?.provider || 'codex',
    getWorkspaceBinding: (currentSession) => ({
      workspaceDir: currentSession?.workspaceDir || '/repo/demo',
      source: currentSession?.workspaceDir ? 'thread override' : 'provider default',
    }),
    getProviderDefaults: (provider) => ({
      model: provider === 'codex' ? 'gpt-5.4' : '(provider default)',
      effort: provider === 'codex' ? 'high' : '(provider default)',
      source: provider === 'codex' ? 'config.toml' : 'provider',
    }),
    getProviderDisplayName: (provider) => ({
      codex: 'Codex CLI',
      claude: 'Claude Code',
      gemini: 'Gemini CLI',
    }[provider] || provider),
    getSupportedReasoningEffortLevels: (provider) => provider === 'gemini' ? [] : (provider === 'claude' ? ['high', 'medium', 'low'] : ['xhigh', 'high', 'medium', 'low']),
    getProviderCompactCapabilities: () => ({ strategies: ['hard', 'native', 'off'] }),
    normalizeUiLanguage: (value) => String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh',
    resolveFastModeSetting: (currentSession) => currentSession?.provider === 'codex'
      ? {
        enabled: currentSession?.fastMode ?? false,
        supported: true,
        source: currentSession?.fastMode === null || currentSession?.fastMode === undefined ? 'config.toml' : 'session override',
      }
      : { enabled: false, supported: false, source: 'provider unsupported' },
    resolveCompactStrategySetting: (currentSession) => ({
      strategy: currentSession?.compactStrategy || 'native',
      source: currentSession?.compactStrategy ? 'session override' : 'env default',
    }),
    commandActions,
    openWorkspaceBrowser,
    slashRef: (base) => `/cx_${base}`,
  });
}

test('createSettingsPanel opens an overview payload with key channel settings', () => {
  const session = {
    provider: 'codex',
    language: 'zh',
    mode: 'safe',
    fastMode: null,
    model: null,
  };
  const panel = createPanel({ session });

  const payload = panel.openSettingsPanel({
    key: 'thread-1',
    session,
    userId: '12345',
    activeSection: 'overview',
    flags: 64,
  });

  assert.equal(payload.flags, 64);
  assert.match(payload.content, /频道设置/);
  assert.match(payload.content, /provider：`codex`/);
  assert.match(payload.content, /model：`gpt-5.4`/);
  assert.equal(payload.components.length, 2);
  assert.equal(payload.components[0].components[0].data.label, 'provider');
  assert.equal(payload.components[1].components.at(-1).data.label, '关闭');
});

test('createSettingsPanel updates fast mode through button interaction', async () => {
  const session = {
    provider: 'codex',
    language: 'zh',
    mode: 'safe',
    fastMode: null,
  };
  const updates = [];
  const panel = createPanel({
    session,
    commandActions: {
      setFastMode(currentSession, enabled) {
        currentSession.fastMode = enabled;
        return { fastModeSetting: { enabled, supported: true, source: 'session override' } };
      },
    },
  });

  await panel.handleSettingsPanelInteraction({
    customId: 'stg:set:fast:on:12345',
    channelId: 'thread-1',
    user: { id: '12345' },
    async update(payload) {
      updates.push(payload);
    },
    async reply() {
      throw new Error('should not reply');
    },
    async showModal() {
      throw new Error('should not show modal');
    },
  });

  assert.equal(session.fastMode, true);
  assert.equal(updates.length, 1);
  assert.match(updates[0].content, /当前项：fast/);
  assert.match(updates[0].content, /fast mode：开启（当前频道）/);
});

test('createSettingsPanel opens a model modal from the model section', async () => {
  const session = {
    provider: 'codex',
    language: 'zh',
    mode: 'safe',
    model: 'gpt-5.4',
  };
  const modals = [];
  const panel = createPanel({ session });

  await panel.handleSettingsPanelInteraction({
    customId: 'stg:act:model:custom:12345',
    channelId: 'thread-1',
    user: { id: '12345' },
    async update() {
      throw new Error('should not update');
    },
    async reply() {
      throw new Error('should not reply');
    },
    async showModal(modal) {
      modals.push(modal);
    },
  });

  assert.equal(modals.length, 1);
  assert.equal(modals[0].data.customId, 'stgm:model:12345');
  assert.equal(modals[0].data.components[0].components[0].data.customId, 'model_name');
  assert.equal(modals[0].data.components[0].components[0].data.value, 'gpt-5.4');
});

test('createSettingsPanel applies model modal submit and replies with a refreshed panel', async () => {
  const session = {
    provider: 'codex',
    language: 'en',
    mode: 'safe',
    model: null,
  };
  const replies = [];
  const panel = createPanel({
    session,
    commandActions: {
      setModel(currentSession, value) {
        currentSession.model = String(value || '').trim().toLowerCase() === 'default' ? null : value;
        return { model: currentSession.model };
      },
    },
  });

  await panel.handleSettingsPanelModalSubmit({
    customId: 'stgm:model:12345',
    channelId: 'thread-1',
    user: { id: '12345' },
    fields: {
      getTextInputValue() {
        return 'o3';
      },
    },
    async reply(payload) {
      replies.push(payload);
    },
  });

  assert.equal(session.model, 'o3');
  assert.equal(replies.length, 1);
  assert.equal(replies[0].flags, 64);
  assert.match(replies[0].content, /Model updated/);
  assert.match(replies[0].content, /model: `o3` \(this channel\)/);
});

test('createSettingsPanel opens the existing workspace browser in a separate reply', async () => {
  const session = {
    provider: 'codex',
    language: 'zh',
    mode: 'safe',
    workspaceDir: '/repo/current',
  };
  const replies = [];
  const panel = createPanel({
    session,
    openWorkspaceBrowser: ({ mode, key, userId, flags }) => ({
      content: `browse:${mode}:${key}:${userId}`,
      components: [],
      flags,
    }),
  });

  await panel.handleSettingsPanelInteraction({
    customId: 'stg:act:workspace:browse:12345',
    channelId: 'thread-1',
    user: { id: '12345' },
    async update() {
      throw new Error('should not update');
    },
    async reply(payload) {
      replies.push(payload);
    },
    async showModal() {
      throw new Error('should not show modal');
    },
  });

  assert.deepEqual(replies, [{
    content: 'browse:thread:thread-1:12345',
    components: [],
    flags: 64,
  }]);
});
