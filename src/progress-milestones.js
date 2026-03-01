const DEFAULT_DONE_STEPS_MAX = 4;

const LOW_SIGNAL_PREFIX_RE = /^(command|web search|tool(?:\s+[a-z0-9_.-]+)?|item|stderr)(\s+(completed|started|updated|finished|done))?\s*[:：]/;
const CODING_SIGNAL_RES = [
  /\b(update_plan|function_call|local_shell|exec_command|rg|ripgrep|grep|sed|awk|npm|pnpm|yarn|git)\b/,
  /\b(read|open|inspect|search|find|scan|debug|trace|patch|refactor|edit|lint|compile|build|command)\b/,
  /\b(src\/|test\/|package\.json|readme\.md|\/users\/|\.js\b|\.ts\b|\.tsx\b|\.py\b|\.sh\b)\b/,
  /(代码|文件|命令|脚本|测试|日志|补丁|函数|模块|路径|仓库)/,
];

export function normalizeProgressSemanticKey(text) {
  let normalized = String(text || '')
    .toLowerCase()
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';

  const prefixPatterns = [
    /^(latest (step|progress|activity|milestone)|completed (step|steps|milestone|milestones)|latest milestone)\s*[:：]\s*/,
    /^(最新(步骤|进度|活动|里程碑)|已完成(步骤|里程碑)|完成里程碑)\s*[:：]\s*/,
    /^(web search|command|agent message|item|stderr|tool(?:\s+[a-z0-9_.-]+)?)\s+(completed|started|updated|finished|done)\s*[:：]\s*/,
    /^(web search|command|agent message|item|stderr|tool(?:\s+[a-z0-9_.-]+)?)\s*[:：]\s*/,
    /^(completed|done|finished|started|updated)\s*[:：]\s*/,
  ];

  for (let i = 0; i < 4; i += 1) {
    const before = normalized;
    for (const pattern of prefixPatterns) {
      normalized = normalized.replace(pattern, '');
    }
    normalized = normalized.trim();
    if (normalized === before) break;
  }

  return normalized
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLowSignalCompletedStep(stepText) {
  const text = String(stepText || '').trim().toLowerCase();
  if (!text) return true;
  return LOW_SIGNAL_PREFIX_RE.test(text)
    || text === 'command completed'
    || text === 'turn completed';
}

export function isCodingNoiseCompletedStep(stepText) {
  const text = String(stepText || '').trim().toLowerCase();
  if (!text) return true;
  if (isLowSignalCompletedStep(text)) return true;
  return CODING_SIGNAL_RES.some((pattern) => pattern.test(text));
}

export function areNearDuplicateProgressSteps(a, b) {
  const ak = normalizeProgressSemanticKey(a);
  const bk = normalizeProgressSemanticKey(b);
  if (!ak || !bk) return false;
  if (ak === bk) return true;

  const minLen = Math.min(ak.length, bk.length);
  if (minLen >= 12 && (ak.includes(bk) || bk.includes(ak))) return true;

  const at = ak.split(' ').filter(Boolean);
  const bt = bk.split(' ').filter(Boolean);
  if (!at.length || !bt.length) return false;

  const aset = new Set(at);
  const bset = new Set(bt);
  let common = 0;
  for (const token of aset) {
    if (bset.has(token)) common += 1;
  }
  const overlap = common / Math.max(1, Math.min(aset.size, bset.size));
  return overlap >= 0.8;
}

export function pickReadableCompletedMilestones(steps, {
  planState = null,
  latestStep = '',
  maxSteps = DEFAULT_DONE_STEPS_MAX,
} = {}) {
  const limit = Math.max(1, Number(maxSteps || DEFAULT_DONE_STEPS_MAX));
  const planCompleted = Array.isArray(planState?.steps)
    ? planState.steps
      .filter((item) => item?.status === 'completed')
      .map((item) => String(item.step || '').trim())
      .filter(Boolean)
    : [];
  const fallbackSteps = Array.isArray(steps) ? steps : [];

  const out = [];
  const seen = new Set();

  const push = (rawStep, { allowLowSignal = false, allowCodingNoise = false } = {}) => {
    const text = String(rawStep || '').trim();
    if (!text) return;
    const key = normalizeProgressSemanticKey(text);
    if (!key || seen.has(key)) return;
    if (latestStep && areNearDuplicateProgressSteps(text, latestStep)) return;
    if (out.some((existing) => areNearDuplicateProgressSteps(existing, text))) return;
    if (!allowLowSignal && isLowSignalCompletedStep(text)) return;
    if (!allowCodingNoise && isCodingNoiseCompletedStep(text)) return;
    seen.add(key);
    out.push(text);
  };

  for (const step of planCompleted) {
    push(step);
  }
  for (const step of fallbackSteps) {
    push(step);
  }
  if (!out.length) {
    for (const step of planCompleted) {
      push(step, { allowLowSignal: true });
    }
  }
  if (!out.length) {
    for (const step of fallbackSteps) {
      push(step, { allowLowSignal: true });
    }
  }

  return out.slice(-limit);
}

export function formatCompletedMilestonesSummary(steps, options = {}) {
  const selected = pickReadableCompletedMilestones(steps, options);
  if (!selected.length) return '';
  return selected.join(' | ');
}

export function renderCompletedMilestonesLines(steps, options = {}) {
  const summary = formatCompletedMilestonesSummary(steps, options);
  if (!summary) return [];
  return [`• completed milestones: ${summary}`];
}
