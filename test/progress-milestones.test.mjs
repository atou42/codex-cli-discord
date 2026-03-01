import test from 'node:test';
import assert from 'node:assert/strict';

import {
  areNearDuplicateProgressSteps,
  formatCompletedMilestonesSummary,
  isCodingNoiseCompletedStep,
  normalizeProgressSemanticKey,
  pickReadableCompletedMilestones,
} from '../src/progress-milestones.js';

test('normalizeProgressSemanticKey removes phase prefixes for equivalent latest/completed text', () => {
  const latest = normalizeProgressSemanticKey('web search completed: search: task info richness bug');
  const completed = normalizeProgressSemanticKey('web search: search: task info richness bug');
  assert.equal(latest, completed);
});

test('areNearDuplicateProgressSteps matches semantically same latest/completed wording', () => {
  const a = 'latest activity: web search completed: open page: docs.example.com/progress';
  const b = 'web search: open page: docs.example.com/progress';
  assert.equal(areNearDuplicateProgressSteps(a, b), true);
});

test('isCodingNoiseCompletedStep flags coding-action style milestones', () => {
  assert.equal(isCodingNoiseCompletedStep('Inspect src/index.js and patch progress render'), true);
  assert.equal(isCodingNoiseCompletedStep('command: rg -n "progress" src/index.js'), true);
  assert.equal(isCodingNoiseCompletedStep('明确问题根因并给出用户可读修复结论'), false);
});

test('pickReadableCompletedMilestones keeps user-facing milestones and drops coding noise + latest duplicates', () => {
  const picked = pickReadableCompletedMilestones(
    [
      'command: rg -n "completed steps" src/index.js',
      'web search: search: task info richness issue',
      '已定位根因：completed milestones 与 latest activity 去重规则不完整',
      '已完成修复：里程碑改为任务结果导向并增强去重',
    ],
    {
      latestStep: 'latest activity: 已完成修复：里程碑改为任务结果导向并增强去重',
      maxSteps: 3,
    },
  );

  assert.deepEqual(picked, ['已定位根因：completed milestones 与 latest activity 去重规则不完整']);
});

test('formatCompletedMilestonesSummary returns empty when only coding noise remains', () => {
  const summary = formatCompletedMilestonesSummary(
    [
      'command: npm run test:progress',
      'web search completed: search: how to dedupe latest step',
      'Inspect src/progress-utils.js',
    ],
    {
      latestStep: 'latest activity: command completed: npm run test:progress',
      maxSteps: 3,
    },
  );

  assert.equal(summary, '');
});
