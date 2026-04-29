const UUID_LIKE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeForkSessionId(value) {
  const text = String(value || '').trim();
  return text || null;
}

function shortenId(value) {
  const text = normalizeForkSessionId(value);
  if (!text) return 'new';
  return text.length <= 12 ? text : text.slice(0, 8);
}

export function parseForkTextInput(input) {
  const text = String(input || '').trim();
  if (!text) return { sessionId: null, prompt: '' };
  const [first, ...rest] = text.split(/\s+/);
  if (UUID_LIKE_PATTERN.test(first)) {
    return {
      sessionId: first,
      prompt: rest.join(' ').trim(),
    };
  }
  return {
    sessionId: null,
    prompt: text,
  };
}

export function formatForkThreadName({ forkedSessionId, parentSessionId } = {}) {
  const forkShort = shortenId(forkedSessionId);
  const parentShort = shortenId(parentSessionId);
  return `codex fork ${forkShort} from ${parentShort}`.slice(0, 100);
}

function resolveThreadCreateChannel(channel) {
  if (channel?.threads && typeof channel.threads.create === 'function') return channel;
  if (typeof channel?.isThread === 'function' && channel.isThread() && channel.parent?.threads && typeof channel.parent.threads.create === 'function') {
    return channel.parent;
  }
  if (channel?.parent?.threads && typeof channel.parent.threads.create === 'function') return channel.parent;
  return null;
}

export function canCreateDiscordForkThread(source) {
  return Boolean(resolveThreadCreateChannel(source?.channel));
}

async function createDiscordForkThread(source, { parentSessionId, forkedSessionId } = {}) {
  const targetChannel = resolveThreadCreateChannel(source?.channel);
  if (!targetChannel) {
    throw new Error('当前频道不支持创建 Discord thread，无法放置 fork。');
  }
  const thread = await targetChannel.threads.create({
    name: formatForkThreadName({ forkedSessionId, parentSessionId }),
    autoArchiveDuration: 1440,
    reason: `Codex fork from ${parentSessionId}`,
  });
  try {
    await thread.join?.();
  } catch {
  }
  return thread;
}

export function createSyntheticForkMessage(source, childThread) {
  const author = source?.user || source?.author || {};
  const client = source?.client || source?.channel?.client || childThread?.client || null;
  const reactions = {
    cache: {
      get: () => ({ users: { remove: async () => {} } }),
    },
  };
  return {
    id: String(source?.id || `fork-${Date.now()}`),
    channelId: childThread?.id,
    channel: childThread,
    author,
    client,
    system: false,
    content: '',
    attachments: { size: 0 },
    reactions,
    react: async () => {},
    reply: async (payload) => childThread.send(payload),
  };
}

export async function createCodexForkThread({
  key,
  session,
  source,
  parentSessionId,
  prompt = '',
  provider = 'codex',
  getRuntimeSnapshot = () => ({ running: false, queued: 0 }),
  getSession,
  commandActions = {},
  forkCodexThread,
  enqueuePrompt,
  resolveSecurityContext,
  createThread = createDiscordForkThread,
} = {}) {
  const normalizedParentSessionId = normalizeForkSessionId(parentSessionId);
  if (!normalizedParentSessionId) {
    return { ok: false, reason: 'missing_parent_session' };
  }
  const runtime = getRuntimeSnapshot(key) || {};
  if (runtime.running) {
    return { ok: false, reason: 'parent_running' };
  }
  if (!canCreateDiscordForkThread(source)) {
    return { ok: false, reason: 'thread_unavailable' };
  }
  if (typeof forkCodexThread !== 'function') {
    return { ok: false, reason: 'fork_unavailable' };
  }
  if (typeof getSession !== 'function') {
    throw new Error('getSession is required for Codex fork');
  }
  if (typeof commandActions.bindForkedSession !== 'function') {
    throw new Error('bindForkedSession is required for Codex fork');
  }

  const childThread = await createThread(source, {
    parentSessionId: normalizedParentSessionId,
    forkedSessionId: null,
  });
  if (!childThread?.id) {
    throw new Error('Discord thread creation did not return a thread id');
  }

  let forkResult = null;
  try {
    forkResult = await forkCodexThread({
      threadId: normalizedParentSessionId,
    });
  } catch (err) {
    try {
      await childThread.delete?.('Codex fork failed before session binding');
    } catch {
    }
    throw err;
  }
  const forkedSessionId = normalizeForkSessionId(forkResult?.threadId || forkResult?.thread?.id);
  if (!forkedSessionId) {
    try {
      await childThread.delete?.('Codex fork did not return a session id');
    } catch {
    }
    throw new Error('Codex fork did not return a session id');
  }
  if (typeof childThread.setName === 'function') {
    try {
      await childThread.setName(
        formatForkThreadName({ parentSessionId: normalizedParentSessionId, forkedSessionId }),
        'Codex fork session assigned',
      );
    } catch {
    }
  }

  const childSession = getSession(childThread.id, {
    channel: childThread,
    parentChannelId: key,
  });
  const binding = commandActions.bindForkedSession(childSession, {
    sessionId: forkedSessionId,
    parentSessionId: normalizedParentSessionId,
    parentChannelId: key,
    provider,
  });

  const normalizedPrompt = String(prompt || '').trim();
  let promptQueue = null;
  if (normalizedPrompt) {
    if (typeof enqueuePrompt !== 'function') {
      promptQueue = { ok: false, enqueued: false, error: 'enqueuePrompt is unavailable' };
    } else {
      try {
        const syntheticMessage = createSyntheticForkMessage(source, childThread);
        const securityContext = typeof resolveSecurityContext === 'function'
          ? resolveSecurityContext(childThread, childSession)
          : null;
        promptQueue = await enqueuePrompt(syntheticMessage, childThread.id, normalizedPrompt, securityContext);
      } catch (err) {
        promptQueue = {
          ok: false,
          enqueued: false,
          error: String(err?.message || err || 'unknown error'),
        };
      }
    }
  }

  return {
    ok: true,
    parentSessionId: normalizedParentSessionId,
    forkedSessionId,
    forkedFromId: normalizeForkSessionId(forkResult?.forkedFromId) || normalizedParentSessionId,
    childThread,
    childSession,
    binding,
    promptQueue,
  };
}

export function formatCodexForkResult(result, language = 'zh') {
  if (!result?.ok) {
    if (result?.reason === 'missing_parent_session') {
      return language === 'en'
        ? '❌ No Codex session is bound here yet. Run one task first or pass `session_id`.'
        : '❌ 当前频道还没有绑定 Codex session。先跑一轮，或传入 `session_id`。';
    }
    if (result?.reason === 'parent_running') {
      return language === 'en'
        ? '⏳ The parent channel is running. Fork after the current task finishes.'
        : '⏳ 父频道正在运行任务，等这轮结束后再 fork。';
    }
    if (result?.reason === 'fork_unavailable') {
      return language === 'en'
        ? '❌ Codex native fork is unavailable in this runtime.'
        : '❌ 当前运行环境没有接入 Codex 原生 fork。';
    }
    if (result?.reason === 'thread_unavailable') {
      return language === 'en'
        ? '❌ This Discord channel cannot create a fork thread.'
        : '❌ 当前 Discord 频道不能创建 fork thread。';
    }
    return language === 'en' ? '❌ Codex fork failed.' : '❌ Codex fork 失败。';
  }

  const channelLabel = result.childThread?.id ? `<#${result.childThread.id}>` : result.childThread?.name || '(new thread)';
  const promptQueued = result.promptQueue?.enqueued;
  const queuedAhead = Number(result.promptQueue?.queuedAhead || 0);
  const promptError = String(result.promptQueue?.error || '').trim();
  if (language === 'en') {
    return [
      promptError
        ? `⚠️ Created Codex fork in ${channelLabel}, but the prompt was not queued`
        : `✅ Created Codex fork in ${channelLabel}`,
      `• fork session: \`${result.forkedSessionId}\``,
      `• parent session: \`${result.parentSessionId}\``,
      promptQueued ? `• prompt queued in fork${queuedAhead > 0 ? ` (${queuedAhead} ahead)` : ''}` : null,
      promptError ? `• error: ${promptError}` : null,
    ].filter(Boolean).join('\n');
  }
  return [
    promptError
      ? `⚠️ 已创建 Codex fork：${channelLabel}，但 prompt 没有入队`
      : `✅ 已创建 Codex fork：${channelLabel}`,
    `• fork session: \`${result.forkedSessionId}\``,
    `• parent session: \`${result.parentSessionId}\``,
    promptQueued ? `• prompt 已进入 fork 队列${queuedAhead > 0 ? `，前面还有 ${queuedAhead} 条` : ''}` : null,
    promptError ? `• 错误：${promptError}` : null,
  ].filter(Boolean).join('\n');
}
