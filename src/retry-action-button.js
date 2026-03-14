import { buildCommandActionButtonId } from './slash-command-router.js';

const ACTION_ROW_COMPONENT_TYPE = 1;
const BUTTON_COMPONENT_TYPE = 2;
const PRIMARY_BUTTON_STYLE = 1;

function normalizePayload(payload) {
  return typeof payload === 'string' ? { content: payload } : payload;
}

export function withRetryAction(payload, userId, { label = 'Retry' } = {}) {
  const body = normalizePayload(payload);
  if (!body || !userId) return body;

  const components = Array.isArray(body.components) ? [...body.components] : [];
  components.push({
    type: ACTION_ROW_COMPONENT_TYPE,
    components: [
      {
        type: BUTTON_COMPONENT_TYPE,
        style: PRIMARY_BUTTON_STYLE,
        label,
        custom_id: buildCommandActionButtonId('retry', userId),
      },
    ],
  });

  return {
    ...body,
    components,
  };
}
