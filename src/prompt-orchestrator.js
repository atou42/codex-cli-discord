import { createPromptResultRenderer } from './prompt-result-renderer.js';

export function createPromptOrchestrator({
  showReasoning = false,
  resultChunkChars = 1900,
  safeReply,
  withDiscordNetworkRetry,
  splitForDiscord,
  getSession,
  ensureWorkspace,
  saveDb,
  clearSessionId,
  getSessionId,
  setSessionId,
  getSessionProvider,
  getSessionLanguage,
  normalizeUiLanguage,
  getProviderDisplayName,
  getProviderShortName,
  getProviderDefaultBin,
  getProviderBinEnvName,
  resolveTimeoutSetting,
  resolveCompactStrategySetting,
  resolveCompactEnabledSetting,
  resolveCompactThresholdSetting,
  formatWorkspaceBusyReport,
  formatTimeoutLabel,
  setActiveRun,
  acquireWorkspace,
  stopChildProcess,
  runTask,
  createProgressReporter = () => ({
    async start() {},
    sync() {},
    setLatestStep() {},
    onEvent() {},
    onLog() {},
    async finish() {},
  }),
  isCliNotFound,
  slashRef,
  safeError,
  truncate,
  toOptionalInt,
  extractInputTokensFromUsage,
  composeFinalAnswerText,
} = {}) {
  const { composeResultText } = createPromptResultRenderer({
    showReasoning,
    truncate,
    composeFinalAnswerText,
    getProviderShortName,
    getSessionProvider,
    getSessionId,
  });

  function shouldCompactSession(session) {
    const compactSetting = resolveCompactStrategySetting(session);
    const enabledSetting = resolveCompactEnabledSetting(session);
    const thresholdSetting = resolveCompactThresholdSetting(session);
    if (!enabledSetting.enabled) return false;
    if (compactSetting.strategy !== 'hard') return false;
    if (!getSessionId(session)) return false;
    const last = toOptionalInt(session.lastInputTokens);
    if (!Number.isFinite(last)) return false;
    return last >= thresholdSetting.tokens;
  }

  async function compactSessionContext({ session, workspaceDir, onSpawn, wasCancelled, onEvent, onLog }) {
    if (!getSessionId(session)) {
      return { ok: false, summary: '', error: 'missing session id' };
    }

    const compactPrompt = [
      '请压缩总结当前会话上下文，供新会话继续工作使用。',
      '输出要求：',
      '1) 用中文，结构化分段，控制在 1200 字以内。',
      '2) 包含：目标、已完成工作、关键代码/文件、未完成事项、风险与约束、下一步建议。',
      '3) 只输出摘要正文，不要寒暄。',
    ].join('\n');

    const result = await runTask({
      session,
      workspaceDir,
      prompt: compactPrompt,
      onSpawn,
      wasCancelled,
      onEvent,
      onLog,
    });
    if (!result.ok) {
      return {
        ok: false,
        summary: '',
        error: result.error || truncate(result.logs.join('\n'), 400),
      };
    }

    const summary = result.messages.join('\n\n').trim();
    if (!summary) {
      return { ok: false, summary: '', error: 'empty compact summary' };
    }

    return { ok: true, summary, usage: result.usage };
  }

  function buildPromptFromCompactedContext(summary, userPrompt) {
    return [
      '下面是上一轮会话的压缩摘要，请先把它作为上下文再回答新的用户请求。',
      '',
      '【压缩摘要开始】',
      summary,
      '【压缩摘要结束】',
      '',
      '请在不丢失关键上下文的前提下继续处理以下新请求：',
      userPrompt,
    ].join('\n');
  }

  async function handlePrompt(message, key, prompt, channelState) {
    if (channelState.cancelRequested) {
      return { ok: false, cancelled: true };
    }

    const session = getSession(key);
    const workspaceDir = ensureWorkspace(session, key);
    const language = normalizeUiLanguage(getSessionLanguage(session));
    const waitingForWorkspaceText = language === 'en'
      ? `Waiting for workspace lock: ${workspaceDir}`
      : `等待 workspace 锁：${workspaceDir}`;
    let workspaceLock = null;

    setActiveRun(channelState, message, prompt, null, 'workspace');
    const progress = createProgressReporter({
      message,
      channelState,
      language,
      initialLatestStep: waitingForWorkspaceText,
    });

    await message.channel.sendTyping();
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 8000);
    await progress.start();
    let progressOutcome = { ok: false, cancelled: false, timedOut: false, error: '' };

    const releaseWorkspaceLock = () => {
      if (!workspaceLock?.acquired || typeof workspaceLock.release !== 'function') return;
      try {
        workspaceLock.release();
      } catch (err) {
        console.warn(`Failed to release workspace lock: ${safeError(err)}`);
      }
      workspaceLock = null;
    };

    try {
      workspaceLock = await acquireWorkspace(
        workspaceDir,
        {
          key,
          provider: getSessionProvider(session),
          messageId: message.id,
          sessionId: getSessionId(session),
          sessionName: session.name || null,
        },
        {
          isAborted: () => Boolean(channelState.cancelRequested || channelState.activeRun?.cancelRequested),
          onWait: ({ owner }) => {
            progress.setLatestStep(
              language === 'en'
                ? `Workspace busy: ${workspaceDir}`
                : `workspace 正忙：${workspaceDir}`,
            );
            return safeReply(message, formatWorkspaceBusyReport(session, workspaceDir, owner)).catch(() => {});
          },
        },
      );

      if (workspaceLock?.aborted || channelState.cancelRequested) {
        progressOutcome = { ok: false, cancelled: true, timedOut: false, error: 'cancelled by user' };
        return { ok: false, cancelled: true };
      }

      progress.setLatestStep(
        language === 'en'
          ? `Workspace lock acquired: ${workspaceDir}`
          : `已获取 workspace 锁：${workspaceDir}`,
      );

      let promptToRun = prompt;
      const preNotes = [];
      if (shouldCompactSession(session)) {
        const previousThreadId = getSessionId(session);
        const compacted = await compactSessionContext({
          session,
          workspaceDir,
          onSpawn: (child) => {
            setActiveRun(channelState, message, 'auto-compact summary request', child, 'compact');
            progress.sync({ forceEmit: true });
            if (channelState.cancelRequested) stopChildProcess(child);
          },
          wasCancelled: () => Boolean(channelState.cancelRequested || channelState.activeRun?.cancelRequested),
          onEvent: progress.onEvent,
          onLog: progress.onLog,
        });
        if (compacted.ok && compacted.summary) {
          clearSessionId(session);
          saveDb();
          promptToRun = buildPromptFromCompactedContext(compacted.summary, prompt);
          preNotes.push(`上下文输入 token=${session.lastInputTokens}，已自动压缩并切换新会话（旧 session: ${previousThreadId}）。`);
        } else {
          clearSessionId(session);
          saveDb();
          preNotes.push(`上下文输入 token=${session.lastInputTokens}，自动压缩失败，已回退 reset（旧 session: ${previousThreadId}）。`);
          if (compacted.error) preNotes.push(`压缩失败原因：${compacted.error}`);
        }
      }

      if (channelState.cancelRequested) {
        progressOutcome = { ok: false, cancelled: true, timedOut: false, error: 'cancelled by user' };
        return { ok: false, cancelled: true };
      }

      let result = await runTask({
        session,
        workspaceDir,
        prompt: promptToRun,
        onSpawn: (child) => {
          setActiveRun(channelState, message, promptToRun, child, 'exec');
          progress.sync({ forceEmit: true });
          if (channelState.cancelRequested) stopChildProcess(child);
        },
        wasCancelled: () => Boolean(channelState.cancelRequested || channelState.activeRun?.cancelRequested),
        onEvent: progress.onEvent,
        onLog: progress.onLog,
      });
      if (preNotes.length) {
        result.notes.unshift(...preNotes);
      }

      if (!result.ok && getSessionId(session) && !result.cancelled && !result.timedOut) {
        const previous = getSessionId(session);
        clearSessionId(session);
        saveDb();
        result = await runTask({
          session,
          workspaceDir,
          prompt,
          onSpawn: (child) => {
            setActiveRun(channelState, message, prompt, child, 'retry');
            progress.sync({ forceEmit: true });
            if (channelState.cancelRequested) stopChildProcess(child);
          },
          wasCancelled: () => Boolean(channelState.cancelRequested || channelState.activeRun?.cancelRequested),
          onEvent: progress.onEvent,
          onLog: progress.onLog,
        });
        if (result.ok) {
          result.notes.push(`已自动重置旧会话：${previous}`);
        }
      }

      const inputTokens = extractInputTokensFromUsage(result.usage);
      let sessionDirty = false;
      if (result.threadId) {
        setSessionId(session, result.threadId);
        sessionDirty = true;
      }
      if (inputTokens !== null) {
        session.lastInputTokens = inputTokens;
        sessionDirty = true;
      }
      if (sessionDirty) {
        saveDb();
      }

      releaseWorkspaceLock();

      if (!result.ok) {
        if (result.cancelled) {
          progressOutcome = { ok: false, cancelled: true, timedOut: false, error: result.error || 'cancelled' };
          await safeReply(message, '🛑 当前任务已中断。');
          return { ok: false, cancelled: true };
        }

        const provider = getSessionProvider(session);
        const cliMissing = isCliNotFound(result.error);
        const timeoutSetting = resolveTimeoutSetting(session);
        const failText = [
          result.timedOut ? `❌ ${getProviderShortName(provider)} 执行超时` : `❌ ${getProviderShortName(provider)} 执行失败`,
          result.error ? `• error: ${result.error}` : null,
          result.logs.length ? `• logs: ${truncate(result.logs.join('\n'), 1200)}` : null,
          result.timedOut
            ? `• 处理: 可用 \`${slashRef('timeout')} <ms|off|status>\` 或 \`!timeout <ms|off|status>\` 调整本频道超时。当前: ${formatTimeoutLabel(timeoutSetting.timeoutMs)} (${timeoutSetting.source})`
            : null,
          cliMissing ? `• 诊断: 当前环境找不到 ${getProviderDisplayName(provider)} CLI 可执行文件。` : null,
          cliMissing ? `• 处理: 在该设备安装 ${getProviderDefaultBin(provider)}，或在 .env 配置 \`${getProviderBinEnvName(provider)}=/绝对路径/${getProviderDefaultBin(provider)}\`，然后重启 bot。` : null,
          cliMissing ? `• 自检: 用 \`${slashRef('status')}\` 或 \`!status\` 查看 CLI 状态。` : null,
          '',
          `可以先 \`${slashRef('reset')}\` 再重试，或 \`${slashRef('status')}\` 看状态。`,
        ].filter(Boolean).join('\n');
        progressOutcome = {
          ok: false,
          cancelled: false,
          timedOut: Boolean(result.timedOut),
          error: result.error || `${getSessionProvider(session)} run failed`,
        };
        await safeReply(message, failText);
        return { ok: false, cancelled: false };
      }

      const body = composeResultText(result, session);
      const parts = splitForDiscord(body, resultChunkChars);

      if (parts.length === 0) {
        await safeReply(message, '✅ 完成（无可展示文本输出）。');
        progressOutcome = { ok: true, cancelled: false, timedOut: false, error: '' };
        return { ok: true, cancelled: false };
      }

      await safeReply(message, parts[0]);
      for (let i = 1; i < parts.length; i += 1) {
        await withDiscordNetworkRetry(
          () => message.channel.send(parts[i]),
          { logger: console, label: 'channel.send (result part)' },
        );
      }

      progressOutcome = { ok: true, cancelled: false, timedOut: false, error: '' };
      return { ok: true, cancelled: false };
    } catch (err) {
      progressOutcome = { ok: false, cancelled: false, timedOut: false, error: safeError(err) };
      throw err;
    } finally {
      releaseWorkspaceLock();
      clearInterval(typingInterval);
      await progress.finish(progressOutcome);
    }
  }

  return {
    createProgressReporter,
    shouldCompactSession,
    compactSessionContext,
    buildPromptFromCompactedContext,
    composeResultText,
    handlePrompt,
  };
}
