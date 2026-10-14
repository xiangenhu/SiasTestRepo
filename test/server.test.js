const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer, generateQuestion } = require('../server');

const question = {
  question: 'Solve for x: 2x + 3 = 11',
  choices: ['2', '3', '4', '7'],
  correctIndex: 2,
  explanation: 'Subtract 3, then divide by 2 to get x = 4.',
};

async function start(t, generator) {
  const server = createServer(generator);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
function post(url, body) {
  return fetch(url + '/api/question', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('serves wizard assets and generates a question for user topics', async t => {
  let topics;
  const url = await start(t, async (...args) => { topics = args; return question; });
  for (const path of ['/', '/app.js', '/style.css']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 100);
  }
  const response = await post(url, { domain: ' Mathematics ', subdomain: ' Algebra ' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), question);
  assert.deepEqual(topics, ['Mathematics', 'Algebra']);
  assert.equal((await fetch(url + '/unknown')).status, 404);
  assert.equal((await fetch(url + '/api/question')).status, 405);
});

test('rejects invalid input before calling generation', async t => {
  let called = false;
  const url = await start(t, async () => { called = true; return question; });
  for (const body of [null, {}, { domain: ' ', subdomain: 'Algebra' }, { domain: 3, subdomain: 'Algebra' }, { domain: 'a'.repeat(121), subdomain: 'Algebra' }]) {
    assert.equal((await post(url, body)).status, 400);
  }
  assert.equal((await fetch(url + '/api/question', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await post(url, { domain: 'a'.repeat(5000), subdomain: 'Algebra' })).status, 413);
  assert.equal(called, false);
});

test('handles unavailable generation and rejects malformed questions', async t => {
  const failing = await start(t, async () => { throw new Error('Private provider detail'); });
  const response = await post(failing, { domain: 'Biology', subdomain: 'Cells' });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('Private provider detail'));
  const malformed = await start(t, async () => ({ ...question, correctIndex: 7 }));
  assert.equal((await post(malformed, { domain: 'Biology', subdomain: 'Cells' })).status, 502);
});

test('provider request uses structured output and handles refusals', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(question) }] }] }) };
  });
  assert.deepEqual(await generateQuestion('Mathematics', 'Algebra'), question);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(JSON.parse(request.input), { domain: 'Mathematics', subdomain: 'Algebra' });
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }) }));
  await assert.rejects(generateQuestion('Topic', 'Subtopic'), /refused/);
});
