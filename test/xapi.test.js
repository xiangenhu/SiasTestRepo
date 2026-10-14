const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { config, signQuestion, buildStatement, sendStatement } = require('../xapi');
const { createServer } = require('../server');
const cfg = config({
  XAPI_ENABLED: 'true', XAPI_LRS_URL: 'https://lrs.example.com/xapi/',
  XAPI_USERNAME: 'test-user', XAPI_PASSWORD: 'test-password',
  XAPI_ACTIVITY_BASE_URL: 'https://quiz.example.com/', XAPI_SIGNING_SECRET: 'test-secret-with-at-least-32-characters',
});
const question = { question: '2 + 2?', choices: ['1', '2', '3', '4'], correctIndex: 3, explanation: '2 + 2 = 4.' };
const token = signQuestion(question, 'Math', 'Addition', cfg);
function event(type = 'answered', answerIndex = 3) {
  return { type, answerIndex, eventId: randomUUID(), learnerId: randomUUID(), sessionId: randomUUID(), durationMs: 12500, questionToken: token };
}
async function listen(t, server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}

test('normalizes endpoint and supports Basic or bearer authentication', () => {
  assert.equal(config({}), null);
  assert.equal(cfg.endpoint, 'https://lrs.example.com/xapi/statements');
  assert.equal(cfg.authorization, 'Basic ' + Buffer.from('test-user:test-password').toString('base64'));
  const bearer = config({ XAPI_ENABLED: 'true', XAPI_LRS_URL: cfg.endpoint, XAPI_ACTIVITY_BASE_URL: cfg.base, XAPI_AUTH_TOKEN: 'token', XAPI_SIGNING_SECRET: cfg.secret });
  assert.equal(bearer.authorization, 'Bearer token');
  assert.equal(bearer.endpoint, cfg.endpoint);
  assert.throws(() => config({ XAPI_ENABLED: 'true' }));
});

test('statements record anonymous identity, choice, correctness, session, topic and duration', () => {
  const input = event();
  const statement = buildStatement(input, cfg);
  assert.equal(statement.actor.account.name, input.learnerId);
  assert.equal(statement.context.registration, input.sessionId);
  assert.equal(statement.verb.id, 'http://adlnet.gov/expapi/verbs/answered');
  assert.equal(statement.object.definition.interactionType, 'choice');
  assert.deepEqual(statement.object.definition.correctResponsesPattern, ['3']);
  assert.equal(statement.object.definition.choices[3].description['en-US'], '4');
  assert.equal(statement.result.response, '3');
  assert.equal(statement.result.success, true);
  assert.equal(statement.result.score.scaled, 1);
  assert.equal(statement.result.duration, 'PT12.500S');
  assert.equal(statement.context.extensions['https://quiz.example.com/extensions/domain'], 'Math');
  assert.equal(buildStatement(event('answered', 1), cfg).result.success, false);
  for (const type of ['viewed', 'selected', 'abandoned']) {
    assert.equal(buildStatement(event(type), cfg).result.success, undefined);
  }
});

test('rejects forged, expired and invalid events', () => {
  assert.throws(() => buildStatement({ ...event(), questionToken: token + 'x' }, cfg));
  assert.throws(() => buildStatement({ ...event(), answerIndex: 9 }, cfg));
  assert.throws(() => buildStatement({ ...event(), learnerId: 'bad' }, cfg));
  assert.throws(() => buildStatement({ ...event(), type: 'unknown' }, cfg));
  assert.throws(() => buildStatement({ ...event(), durationMs: -1 }, cfg));
  const { createHmac } = require('node:crypto');
  const payload = Buffer.from(JSON.stringify({ ...question, expires: Date.now() - 1000 })).toString('base64url');
  const expired = payload + '.' + createHmac('sha256', cfg.secret).update(payload).digest('base64url');
  assert.throws(() => buildStatement({ ...event(), questionToken: expired }, cfg), /Expired/);
});

test('sends to an LRS over HTTP and retries using the same statement ID and body', async t => {
  const received = [];
  const url = await listen(t, http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ url: req.url, method: req.method, headers: req.headers, body });
    res.writeHead(received.length === 1 ? 503 : 204);
    res.end();
  }));
  const statement = buildStatement(event(), cfg);
  await sendStatement(statement, { ...cfg, endpoint: url + '/xapi/statements' });
  assert.equal(received.length, 2);
  assert.equal(received[0].method, 'PUT');
  assert.equal(received[0].headers['x-experience-api-version'], '1.0.3');
  assert.equal(received[0].headers.authorization, cfg.authorization);
  assert.equal(received[0].url, '/xapi/statements?statementId=' + statement.id);
  assert.equal(received[0].body, received[1].body);
});

test('records clicks and wizard activity before a question exists', () => {
  for (const type of ['click', 'double_click', 'context_menu', 'input', 'change', 'focus', 'blur', 'key', 'scroll', 'visibility', 'navigation', 'generation_started', 'generation_succeeded', 'generation_failed', 'page_opened', 'page_left', 'validation_failed']) {
    const input = { ...event(type), questionToken: undefined, timestamp: '2026-10-14T12:00:00.000Z', details: { step: 1, id: 'domain', tag: 'input' } };
    const statement = buildStatement(input, cfg);
    assert.equal(statement.object.id, 'https://quiz.example.com/wizard');
    assert.equal(statement.context.extensions['https://quiz.example.com/extensions/event'], type);
    assert.equal(statement.context.extensions['https://quiz.example.com/extensions/details'].id, 'domain');
    assert.equal(statement.timestamp, input.timestamp);
    assert.equal(statement.result.success, undefined);
  }
  assert.throws(() => buildStatement({ ...event('click'), details: { huge: 'x'.repeat(2050) } }, cfg));
});
