import { getSupportedReasoningEffortLevels } from './provider-metadata.js';

function defaultNormalizeUiLanguage(value) {
  return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'zh';
}

function defaultTruncate(value, max) {
  const text = String(value || '');
  const limit = Number(max);
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  if (limit <= 3) return text.slice(0, limit);
  return `${text.slice(0, limit - 3)}...`;
}

function joinLinesWithinLimit(lines, maxChars, truncate = defaultTruncate) {
  const normalized = Array.isArray(lines)
    ? lines
      .map((line) => String(line || '').trimEnd())
      .filter(Boolean)
    : [];
  if (!normalized.length) return '';

  const limit = Math.max(1, Number(maxChars) || 0);
  const output = [];
  let used = 0;
  let overflowed = false;

  for (const line of normalized) {
    const nextLength = line.length + (output.length ? 1 : 0);
    if (used + nextLength > limit) {
      overflowed = true;
      break;
    }
    output.push(line);
    used += nextLength;
  }

  if (!output.length) {
    return truncate(normalized[0], limit);
  }

  if (overflowed) {
    const overflowLine = '...';
    if (used + overflowLine.length + 1 <= limit) {
      output.push(overflowLine);
    }
  }

  return output.join('\n');
}

function createNoopProgressReporter({
  channelState,
  initialLatestStep = '',
  now = () => Date.now(),
}) {
  let latestStep = String(initialLatestStep || '').trim();

  const sync = () => {
    if (!channelState?.activeRun) return;
    channelState.activeRun.lastProgressText = latestStep;
    channelState.activeRun.lastProgressAt = now();
  };

  return {
    async start() {
      sync();
    },
    sync,
    setLatestStep(value) {
      const next = String(value || '').trim();
      if (!next) return;
      latestStep = next;
      sync();
    },
    onEvent() {},
    onLog() {},
    async finish() {},
  };
}

function getDefaultLatestStep(language) {
  return language === 'en'
    ? 'Task started, waiting for the first event...'
    : '任务已开始，等待首个事件...';
}

function normalizeActivityKey(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizeProgressEventType(value) {
  return String(value || '').trim().toLowerCase().replace(/[./-]/g, '_');
}

function normalizeProgressText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseProgressJsonMaybe(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeClaudeToolInput(input, truncateText, previewChars) {
  if (!input || typeof input !== 'object') return '';

  const command = normalizeProgressText(input.command || input.cmd || '');
  if (command) return `run: ${truncateText(command, previewChars)}`;

  const query = normalizeProgressText(input.query || input.q || '');
  if (query) return `search: ${truncateText(query, previewChars)}`;

  const filePath = normalizeProgressText(input.file_path || input.path || '');
  if (filePath) return `file_path: ${truncateText(filePath, previewChars)}`;

  const url = normalizeProgressText(input.url || '');
  if (url) return `url: ${truncateText(url, previewChars)}`;

  const pattern = normalizeProgressText(input.pattern || '');
  if (pattern) return `find: ${truncateText(pattern, previewChars)}`;

  const description = normalizeProgressText(input.description || '');
  if (description) return truncateText(description, previewChars);

  return '';
}

function formatClaudeToolUseLabel(block, truncateText, previewChars) {
  const toolName = normalizeProgressText(block?.name || 'tool') || 'tool';
  const detail = summarizeClaudeToolInput(block?.input, truncateText, previewChars);
  return detail ? `${toolName}: ${detail}` : `tool ${toolName}`;
}

function createClaudeProgressTracker({ truncateText, previewChars }) {
  const activeBlocks = new Map();
  const finalizedBlocks = [];
  const toolUseLabelsById = new Map();

  function resetMessage() {
    activeBlocks.clear();
    finalizedBlocks.length = 0;
  }

  function finalizeBlock(index) {
    if (!activeBlocks.has(index)) return;
    const block = activeBlocks.get(index);
    activeBlocks.delete(index);
    if (!block) return;

    if (block.kind === 'text') {
      const text = normalizeProgressText(block.text);
      if (text) finalizedBlocks.push({ kind: 'text', text });
      return;
    }

    if (block.kind === 'tool_use') {
      let mergedInput = block.input && typeof block.input === 'object' ? { ...block.input } : {};
      const parsed = parseProgressJsonMaybe(block.partialInput);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        mergedInput = { ...mergedInput, ...parsed };
      }
      const next = {
        kind: 'tool_use',
        id: normalizeProgressText(block.id),
        name: normalizeProgressText(block.name || 'tool') || 'tool',
        input: mergedInput,
      };
      finalizedBlocks.push(next);
      if (next.id) {
        toolUseLabelsById.set(next.id, formatClaudeToolUseLabel(next, truncateText, previewChars));
      }
    }
  }

  function consumeMessageBoundary(stopReason) {
    const normalizedStopReason = normalizeProgressEventType(stopReason);
    const summaryCandidates = [];
    const rawActivities = [];

    for (const block of finalizedBlocks.splice(0)) {
      if (block.kind === 'tool_use') {
        const label = formatClaudeToolUseLabel(block, truncateText, previewChars);
        summaryCandidates.push(label);
        rawActivities.push(label);
        continue;
      }

      if (block.kind === 'text' && normalizedStopReason !== 'end_turn') {
        const text = truncateText(block.text, previewChars);
        if (text) {
          summaryCandidates.push(`agent message: ${text}`);
          rawActivities.push(text);
        }
      }
    }

    return {
      summaryStep: summaryCandidates[summaryCandidates.length - 1] || '',
      rawActivities,
      completedSteps: [],
    };
  }

  function consumeToolResult(event) {
    if (!event || typeof event !== 'object') return null;
    const parts = Array.isArray(event?.message?.content) ? event.message.content : [];
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      if (normalizeProgressEventType(part.type || '') !== 'tool_result') continue;
      const toolUseId = normalizeProgressText(part.tool_use_id || '');
      if (!toolUseId) continue;
      const label = toolUseLabelsById.get(toolUseId);
      if (!label) continue;
      return {
        summaryStep: `${label} completed`,
        rawActivities: [],
        completedSteps: [label],
      };
    }
    return null;
  }

  function capture(event) {
    const type = normalizeProgressEventType(event?.type || '');
    if (!type) return null;

    if (type === 'stream_event' && event.event && typeof event.event === 'object') {
      const nestedType = normalizeProgressEventType(event.event.type || '');
      if (nestedType === 'message_start') {
        resetMessage();
        return null;
      }

      if (nestedType === 'content_block_start') {
        const index = Number(event.event.index);
        if (!Number.isFinite(index)) return null;
        const block = event.event.content_block && typeof event.event.content_block === 'object'
          ? event.event.content_block
          : {};
        const blockType = normalizeProgressEventType(block.type || '');
        if (blockType === 'text') {
          activeBlocks.set(index, {
            kind: 'text',
            text: String(block.text || ''),
          });
        } else if (blockType === 'tool_use') {
          activeBlocks.set(index, {
            kind: 'tool_use',
            id: block.id,
            name: block.name || block.tool_name || 'tool',
            input: block.input && typeof block.input === 'object' ? block.input : {},
            partialInput: '',
          });
        }
        return null;
      }

      if (nestedType === 'content_block_delta') {
        const index = Number(event.event.index);
        if (!Number.isFinite(index) || !activeBlocks.has(index)) return null;
        const block = activeBlocks.get(index);
        const delta = event.event.delta && typeof event.event.delta === 'object' ? event.event.delta : {};
        const deltaType = normalizeProgressEventType(delta.type || '');
        if (block.kind === 'text' && deltaType === 'text_delta' && typeof delta.text === 'string') {
          block.text = `${block.text || ''}${delta.text}`;
        } else if (block.kind === 'tool_use' && deltaType === 'input_json_delta' && typeof delta.partial_json === 'string') {
          block.partialInput = `${block.partialInput || ''}${delta.partial_json}`;
        }
        return null;
      }

      if (nestedType === 'content_block_stop') {
        finalizeBlock(Number(event.event.index));
        return null;
      }

      if (nestedType === 'message_delta') {
        return consumeMessageBoundary(
          event.event.delta?.stop_reason
          || event.event.delta?.stopReason
          || '',
        );
      }

      if (nestedType === 'message_stop') {
        resetMessage();
      }

      return null;
    }

    if (type === 'user') {
      return consumeToolResult(event);
    }

    return null;
  }

  return {
    capture,
  };
}

function getFinalLatestStep({
  ok = false,
  cancelled = false,
  timedOut = false,
  latestStep = '',
  language = 'en',
} = {}) {
  if (cancelled) {
    return language === 'en' ? 'Task cancelled' : '任务已中断';
  }
  if (timedOut) {
    return language === 'en' ? 'Task timed out' : '任务已超时';
  }
  if (ok) {
    return language === 'en' ? 'Final response sent' : '最终结果已发送';
  }
  return String(latestStep || '').trim() || (language === 'en' ? 'Task failed' : '任务失败');
}

function formatFastModeSource(source, language = 'en') {
  const value = String(source || '').trim().toLowerCase();
  if (language === 'en') {
    if (value === 'session override') return 'this channel';
    if (value === 'parent channel') return 'parent channel';
    if (value === 'config.toml') return 'global config';
    return value || 'unknown';
  }
  if (value === 'session override') return '当前频道';
  if (value === 'parent channel') return '父频道默认';
  if (value === 'config.toml') return '全局配置';
  return value || '未知';
}

function formatFastModeValue(setting, language = 'en') {
  if (!setting?.supported) return null;
  const enabled = setting.enabled
    ? (language === 'en' ? 'on' : '开启')
    : (language === 'en' ? 'off' : '关闭');
  return language === 'en'
    ? `${enabled} (${formatFastModeSource(setting.source, language)})`
    : `${enabled}（${formatFastModeSource(setting.source, language)}）`;
}

function formatEffortValue(setting, provider, language = 'en') {
  if (!getSupportedReasoningEffortLevels(provider).length) return null;

  const value = String(setting?.value || '').trim();
  const source = String(setting?.source || '').trim().toLowerCase();
  if (!value) return null;
  if (source === 'provider') {
    return language === 'en' ? 'provider default' : 'provider 默认';
  }
  return value;
}

export function createPromptProgressReporterFactory({
  defaultUiLanguage = 'zh',
  progressUpdatesEnabled = true,
  progressProcessLines = 2,
  progressUpdateIntervalMs = 15000,
  progressEventFlushMs = 5000,
  progressEventDedupeWindowMs = 2500,
  progressIncludeStdout = true,
  progressIncludeStderr = false,
  progressTextPreviewChars = 140,
  progressProcessPushIntervalMs = 1100,
  progressMessageMaxChars = 1800,
  progressPlanMaxLines = 4,
  progressDoneStepsMax = 4,
  safeReply = async () => null,
  normalizeUiLanguage = defaultNormalizeUiLanguage,
  slashRef = (name) => `/${name}`,
  resolveReasoningEffortSetting = () => ({ value: '', source: 'provider' }),
  resolveFastModeSetting = () => ({ enabled: false, supported: false, source: 'provider unsupported' }),
  truncate = defaultTruncate,
  humanElapsed = (ms) => `${ms}ms`,
  createProgressEventDeduper = () => () => false,
  buildProgressEventDedupeKey = () => '',
  presentation = {},
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const {
    summarizeCodexEvent = () => '',
    extractRawProgressTextFromEvent = () => '',
    cloneProgressPlan = (plan) => plan,
    extractPlanStateFromEvent = () => null,
    extractCompletedStepFromEvent = () => null,
    appendCompletedStep = () => {},
    appendRecentActivity = () => {},
    formatProgressPlanSummary = () => '',
    renderProcessContentLines = () => [],
    localizeProgressLines = (lines) => lines,
    renderProgressPlanLines = () => [],
    renderCompletedStepsLines = () => [],
    formatRuntimePhaseLabel = (phase) => String(phase || ''),
  } = presentation;

  return function createProgressReporter({
    message,
    channelState,
    session = null,
    language = defaultUiLanguage,
    processLines = progressProcessLines,
    initialLatestStep = '',
  } = {}) {
    const lang = normalizeUiLanguage(language);
    const processLineLimit = Math.max(1, Math.min(5, Number(processLines || progressProcessLines)));
    const seededLatestStep = String(initialLatestStep || '').trim() || getDefaultLatestStep(lang);

    if (!progressUpdatesEnabled) {
      return createNoopProgressReporter({
        channelState,
        initialLatestStep: seededLatestStep,
        now,
      });
    }

    const startedAt = now();
    let progressMessage = null;
    let timer = null;
    let activityTimer = null;
    let stopped = false;
    let lastEmitAt = 0;
    let lastRendered = '';
    let events = 0;
    let latestStep = seededLatestStep;
    let planState = cloneProgressPlan(channelState?.activeRun?.progressPlan);
    const completedSteps = Array.isArray(channelState?.activeRun?.completedSteps)
      ? [...channelState.activeRun.completedSteps]
      : [];
    const recentActivities = Array.isArray(channelState?.activeRun?.recentActivities)
      ? [...channelState.activeRun.recentActivities]
      : [];
    const pendingActivities = [];
    let lastActivityPushAt = 0;
    let isEmitting = false;
    let rerunEmit = false;
    const isDuplicateProgressEvent = createProgressEventDeduper({
      ttlMs: progressEventDedupeWindowMs,
      maxKeys: 700,
    });
    const claudeProgressTracker = createClaudeProgressTracker({
      truncateText: truncate,
      previewChars: progressTextPreviewChars,
    });

    const syncActiveRun = () => {
      if (!channelState?.activeRun) return;
      channelState.activeRun.progressEvents = events;
      channelState.activeRun.lastProgressText = latestStep;
      channelState.activeRun.lastProgressAt = now();
      channelState.activeRun.progressPlan = cloneProgressPlan(planState);
      channelState.activeRun.completedSteps = [...completedSteps];
      channelState.activeRun.recentActivities = [...recentActivities];
      if (progressMessage?.id) {
        channelState.activeRun.progressMessageId = progressMessage.id;
      }
    };

    const render = (status = 'running') => {
      const elapsed = humanElapsed(Math.max(0, now() - startedAt));
      const phase = formatRuntimePhaseLabel(channelState?.activeRun?.phase || 'starting', lang);
      const effort = formatEffortValue(resolveReasoningEffortSetting(session), session?.provider, lang);
      const fastMode = formatFastModeValue(resolveFastModeSetting(session), lang);
      const hint = status === 'running'
        ? (lang === 'en'
          ? 'Use `!c` to interrupt.'
          : '可用 `!c` 中断。')
        : (lang === 'en'
          ? 'Send the next message when ready.'
          : '准备好后直接发送下一条消息。');
      const statusLine = status === 'running'
        ? (lang === 'en' ? '⏳ **Task Running**' : '⏳ **任务进行中**')
        : status;
      const lines = [
        statusLine,
        `${lang === 'en' ? '• elapsed' : '• 耗时'}: ${elapsed}`,
        `${lang === 'en' ? '• phase' : '• 阶段'}: ${phase}`,
        effort ? `${lang === 'en' ? '• effort' : '• effort'}: ${effort}` : null,
        fastMode ? `${lang === 'en' ? '• fast mode' : '• fast mode'}: ${fastMode}` : null,
        `${lang === 'en' ? '• event count' : '• 事件数'}: ${events}`,
        `${lang === 'en' ? '• latest activity' : '• 最新活动'}: ${latestStep}`,
        ...renderProcessContentLines(recentActivities, lang, processLineLimit),
        ...localizeProgressLines(renderProgressPlanLines(planState, progressPlanMaxLines), lang),
        ...localizeProgressLines(renderCompletedStepsLines(completedSteps, {
          planState,
          latestStep,
          maxSteps: progressDoneStepsMax,
        }), lang),
        `${lang === 'en' ? '• queued prompts' : '• 排队任务'}: ${channelState?.queue?.length || 0}`,
        `${lang === 'en' ? '• hint' : '• 提示'}: ${hint}`,
      ].filter(Boolean);
      return joinLinesWithinLimit(lines, progressMessageMaxChars, truncate);
    };

    const buildPayload = (body) => {
      return {
        content: body,
        components: [],
      };
    };

    const emit = async (force = false) => {
      if (!progressMessage || stopped) return;
      if (isEmitting) {
        rerunEmit = true;
        return;
      }

      const currentTime = now();
      if (!force && currentTime - lastEmitAt < progressEventFlushMs) return;
      const body = render('running');
      const payload = buildPayload(body);
      if (!force && body === lastRendered) return;

      isEmitting = true;
      try {
        await progressMessage.edit(payload);
        lastEmitAt = now();
        lastRendered = body;
        syncActiveRun();
      } catch {
        // ignore edit failures
      } finally {
        isEmitting = false;
        if (rerunEmit && !stopped) {
          rerunEmit = false;
          void emit(false);
        }
      }
    };

    const enqueueActivity = (activityText) => {
      const text = String(activityText || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const key = normalizeActivityKey(text);
      if (!key) return;

      const latestVisible = normalizeActivityKey(recentActivities[recentActivities.length - 1]);
      if (latestVisible && latestVisible === key) return;
      const latestQueued = normalizeActivityKey(pendingActivities[pendingActivities.length - 1]);
      if (latestQueued && latestQueued === key) return;

      pendingActivities.push(text);
      if (pendingActivities.length > 80) {
        pendingActivities.splice(0, pendingActivities.length - 80);
      }
    };

    const pushOneActivity = ({ force = false } = {}) => {
      if (!pendingActivities.length) return false;
      const currentTime = now();
      if (!force && currentTime - lastActivityPushAt < progressProcessPushIntervalMs) return false;
      const next = pendingActivities.shift();
      if (!next) return false;
      appendRecentActivity(recentActivities, next);
      lastActivityPushAt = currentTime;
      return true;
    };

    const setLatestStep = (value, { forceEmit = true } = {}) => {
      const next = String(value || '').trim();
      if (!next) return;
      latestStep = next;
      syncActiveRun();
      if (!stopped) {
        void emit(forceEmit);
      }
    };

    const sync = ({ forceEmit = false } = {}) => {
      syncActiveRun();
      if (!stopped) {
        void emit(forceEmit);
      }
    };

    const start = async () => {
      syncActiveRun();
      try {
        const body = render('running');
        progressMessage = await safeReply(message, buildPayload(body));
        lastEmitAt = now();
        lastRendered = body;
        syncActiveRun();
        timer = setIntervalFn(() => {
          void emit(true);
        }, progressUpdateIntervalMs);
        timer?.unref?.();
        activityTimer = setIntervalFn(() => {
          if (stopped) return;
          if (!pushOneActivity()) return;
          syncActiveRun();
          void emit(false);
        }, progressProcessPushIntervalMs);
        activityTimer?.unref?.();
      } catch {
        progressMessage = null;
      }
    };

    const onEvent = (event) => {
      if (stopped) return;
      const providerProgress = session?.provider === 'claude'
        ? (claudeProgressTracker.capture(event) || null)
        : null;
      const summaryStep = providerProgress?.summaryStep || summarizeCodexEvent(event);
      const rawActivities = providerProgress?.rawActivities?.length
        ? providerProgress.rawActivities
        : (() => {
          const raw = extractRawProgressTextFromEvent(event);
          return raw ? [raw] : [];
        })();
      const nextPlan = extractPlanStateFromEvent(event);
      const completedStepsFromEvent = providerProgress?.completedSteps?.length
        ? providerProgress.completedSteps
        : (() => {
          const step = extractCompletedStepFromEvent(event);
          return step ? [step] : [];
        })();
      const dedupeKey = buildProgressEventDedupeKey({
        summaryStep,
        rawActivity: rawActivities.join(' || '),
        completedStep: completedStepsFromEvent.join(' || '),
        planSummary: formatProgressPlanSummary(nextPlan),
      });
      if (isDuplicateProgressEvent(dedupeKey)) return;

      events += 1;
      if (summaryStep && !summaryStep.startsWith('agent message')) {
        latestStep = summaryStep;
      } else if (!latestStep) {
        latestStep = summaryStep;
      }
      for (const rawActivity of rawActivities) {
        if (!rawActivity) continue;
        enqueueActivity(rawActivity);
        if (recentActivities.length === 0) {
          pushOneActivity({ force: true });
        } else {
          pushOneActivity();
        }
      }
      if (nextPlan) {
        planState = nextPlan;
        for (const item of nextPlan.steps) {
          if (item.status === 'completed') {
            appendCompletedStep(completedSteps, item.step);
          }
        }
      }
      for (const completedStep of completedStepsFromEvent) {
        if (completedStep) appendCompletedStep(completedSteps, completedStep);
      }
      syncActiveRun();
      void emit(false);
    };

    const onLog = (line, source) => {
      if (stopped) return;
      if (source === 'stderr' && !progressIncludeStderr) return;
      if (source === 'stdout' && !progressIncludeStdout) return;

      events += 1;
      const sourceLabel = lang === 'en'
        ? source
        : (source === 'stderr' ? '标准错误' : '标准输出');
      latestStep = `${sourceLabel}: ${truncate(String(line || '').replace(/\s+/g, ' ').trim(), progressTextPreviewChars)}`;
      syncActiveRun();
      void emit(false);
    };

    const finish = async ({ ok = false, cancelled = false, timedOut = false, error = '' } = {}) => {
      if (stopped) return;
      stopped = true;
      if (timer) clearIntervalFn(timer);
      if (activityTimer) clearIntervalFn(activityTimer);
      while (pushOneActivity({ force: true })) {
        // Drain buffered activity lines into the final card.
      }
      latestStep = getFinalLatestStep({
        ok,
        cancelled,
        timedOut,
        latestStep,
        language: lang,
      });
      if (channelState?.activeRun) {
        channelState.activeRun.phase = 'done';
      }
      syncActiveRun();
      if (!progressMessage) return;

      const elapsed = humanElapsed(Math.max(0, now() - startedAt));
      const status = cancelled
        ? (lang === 'en' ? '🛑 **Task Cancelled**' : '🛑 **任务已中断**')
        : ok
          ? (lang === 'en' ? '✅ **Task Completed**' : '✅ **任务已完成**')
          : timedOut
            ? (lang === 'en' ? '⏱️ **Task Timed Out**' : '⏱️ **任务超时**')
            : (lang === 'en' ? '❌ **Task Failed**' : '❌ **任务失败**');
      const lines = [
        status,
        `${lang === 'en' ? '• elapsed' : '• 耗时'}: ${elapsed}`,
        `${lang === 'en' ? '• phase' : '• 阶段'}: ${formatRuntimePhaseLabel(channelState?.activeRun?.phase || 'done', lang)}`,
        `${lang === 'en' ? '• event count' : '• 事件数'}: ${events}`,
        `${lang === 'en' ? '• latest activity' : '• 最新活动'}: ${latestStep}`,
        ...renderProcessContentLines(recentActivities, lang, processLineLimit),
        ...localizeProgressLines(renderProgressPlanLines(planState, progressPlanMaxLines), lang),
        ...localizeProgressLines(renderCompletedStepsLines(completedSteps, {
          planState,
          latestStep,
          maxSteps: progressDoneStepsMax,
        }), lang),
        !ok && !cancelled && error ? `${lang === 'en' ? '• error' : '• 错误'}: ${truncate(String(error), 260)}` : null,
      ].filter(Boolean);
      const safeBody = joinLinesWithinLimit(lines, progressMessageMaxChars, truncate);

      try {
        await progressMessage.edit(buildPayload(safeBody));
      } catch {
        // ignore
      }
    };

    return {
      start,
      sync,
      setLatestStep,
      onEvent,
      onLog,
      finish,
    };
  };
}
