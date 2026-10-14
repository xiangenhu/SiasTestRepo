const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { context, requestStructured } = require('../llm');
const { config, buildLLMStatement } = require('../xapi');
const { createServer, generateQuestion } = require('../server');
const cfg = config({ XAPI_ENABLED: 'true', XAPI_LRS_URL: 'https://lrs.example.com/xapi/', XAPI_USERNAME: 'key', XAPI_PASSWORD: 'secret', XAPI_ACTIVITY_BASE_URL: 'https://quiz.example.com/', XAPI_SIGNING_SECRET: 'test-secret-with-at-least-32-characters' });
const request = { model: 'test-model', instructions: 'Create a question.', input: 'Math', max_output_tokens: 600 };
const usage = { input_tokens: 101, output_tokens: 34, total_tokens: 135, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 12 } };
const question = { question: '2 + 2?', choices: ['1', '2', '3', '4'], correctIndex: 3, explanation: '2 + 2 = 4.' };
function response(result = question, extra = {}) {
  return { status: 'completed', id: 'resp_test', model: 'model-snapshot', usage, output: [{ content: [{ type: 'output_text', text: JSON.stringify(result) }] }], ...extra };
}

test('captures full prompt, output, real usage and model for successful requests', async t => {
  const records = [];
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => response() }));
  const result = await context.run({ record: async record => records.push(record) }, () => requestStructured('generate_question', request, x => x));
  assert.deepEqual(result, question);
  assert.deepEqual(records.map(record => record.phase), ['started', 'completed']);
  assert.equal(records[0].interactionId, records[1].interactionId);
  assert.equal(records[1].request.instructions, request.instructions);
  assert.equal(records[1].responseId, 'resp_test');
  const statement = buildLLMStatement(records[1], { learnerId: 'learner', sessionId: randomUUID() }, cfg);
  const metadata = statement.context.extensions['https://quiz.example.com/extensions/llm'];
  assert.equal(metadata.prompt_tokens, 101);
  assert.equal(metadata.completion_tokens, 34);
  assert.equal(metadata.total_tokens, 135);
  assert.equal(metadata.cached_tokens, 0);
  assert.equal(metadata.reasoning_tokens, 12);
  assert.equal(metadata.model, 'model-snapshot');
  assert.deepEqual(metadata.prompt, { instructions: request.instructions, input: request.input });
  assert.equal(metadata.output[0].content[0].text, JSON.stringify(question));
  assert.equal(statement.result.success, true);
  assert.ok(!JSON.stringify(statement).includes('Authorization'));
});

test('records refusals, incomplete output, malformed output, HTTP errors and network failures', async t => {
  const cases = [
    { data: response(null, { output: [{ content: [{ type: 'refusal' }] }] }), code: 'refusal' },
    { data: response(null, { status: 'incomplete' }), code: 'incomplete_response' },
    { data: response(null, { output: [{ content: [{ type: 'output_text', text: '{' }] }] }), code: 'invalid_output_json' },
    { data: { error: { message: 'private detail' } }, ok: false, code: 'provider_http_error' },
    { network: true, code: 'network_error' },
  ];
  for (const item of cases) {
    const records = [];
    t.mock.method(globalThis, 'fetch', async () => {
      if (item.network) throw new TypeError('private detail');
      return { ok: item.ok !== false, status: item.ok === false ? 429 : 200, json: async () => item.data };
    });
    await assert.rejects(context.run({ record: async record => records.push(record) }, () => requestStructured('generate_question', request, x => x)));
    assert.equal(records.length, 2);
    assert.equal(records[1].phase, 'failed');
    assert.equal(records[1].errorCode, item.code);
    if (item.data?.usage) assert.deepEqual(records[1].usage, usage);
    const metadata = buildLLMStatement(records[1], { learnerId: 'learner', sessionId: randomUUID() }, cfg).context.extensions['https://quiz.example.com/extensions/llm'];
    assert.equal(metadata.usage_available, Boolean(item.data?.usage));
    if (!item.data?.usage) assert.equal(metadata.prompt_tokens, undefined);
    assert.ok(!JSON.stringify(metadata).includes('private detail'));
    t.mock.restoreAll();
  }
});

test('LRS failure preserves generation result and marks audit delivery failure', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => response() }));
  const audit = { record: async () => { throw Error('LRS unavailable'); } };
  const result = await context.run(audit, () => requestStructured('generate_question', request, x => x));
  assert.deepEqual(result, question);
  assert.equal(audit.failed, true);
});

