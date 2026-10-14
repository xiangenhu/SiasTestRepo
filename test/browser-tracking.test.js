const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function harness(enabled = true) {
  const documentEvents = {};
  const windowEvents = {};
  const requests = [];
  const records = [];
  const timers = [];
  const storage = new Map();
  let failing = false;
  class Element {
    constructor(id = '', tag = 'INPUT') { this.id = id; this.tagName = tag; this.hidden = false; this.value = ''; this.textContent = ''; this.handlers = {}; }
    addEventListener(type, fn) { const previous = this.handlers[type]; this.handlers[type] = previous ? (...args) => { previous(...args); fn(...args); } : fn; }
    replaceChildren() {}
    append() {}
    closest() { return this; }
    matches(selector) { return selector.toUpperCase() === this.tagName; }
    querySelector() { return null; }
    focus() {}
    setAttribute() {}
    removeAttribute() {}
  }
  const nodes = {};
  for (const id of ['domain-form', 'topic-form', 'question-step', 'domain', 'subdomain', 'tracking-status', 'back', 'restart', 'topic-summary', 'domain-summary', 'generate', 'status', 'question', 'choices', 'feedback', 'answer-form', 'another', 'suggest-domains', 'suggest-subdomains', 'domain-suggestions', 'subdomain-suggestions', 'domain-suggestion-status', 'subdomain-suggestion-status']) nodes[id] = new Element(id);
  nodes['topic-form'].hidden = nodes['question-step'].hidden = true;
  const store = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const context = {
    Element, crypto: { randomUUID }, performance: { now: () => 100 },
    localStorage: store, sessionStorage: store, Blob,
    document: { getElementById: id => nodes[id], querySelectorAll: () => [], addEventListener: (type, fn) => { documentEvents[type] = fn; }, visibilityState: 'hidden' },
    window: { addEventListener: (type, fn) => { windowEvents[type] = fn; }, scrollX: 0, scrollY: 100 },
    navigator: { sendBeacon: () => true },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    fetch: async (url, options) => {
      requests.push(url);
      if (url === '/api/topics') return { ok: false, json: async () => ({ error: 'Test suggestions unavailable' }) };
      if (url === '/api/tracking') return { ok: true, json: async () => ({ enabled }) };
      const batch = JSON.parse(options.body);
      if (!failing) records.push(...batch);
      return { ok: !failing, status: failing ? 502 : 200 };
    },
  };
  vm.runInNewContext(fs.readFileSync('public/app.js', 'utf8'), context);
  return { nodes, documentEvents, windowEvents, records, requests, timers, storage, fail: value => { failing = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('captures clicks before generation, topic edits, navigation and keyboard activity', async () => {
  const app = harness();
  await settle();
  const button = app.nodes.back;
  button.tagName = 'BUTTON'; button.textContent = 'Back';
  app.documentEvents.click({ target: button });
  app.nodes.domain.value = 'Mathematics';
  app.documentEvents.input({ target: app.nodes.domain });
  app.documentEvents.keydown({ target: app.nodes.domain, key: 's', repeat: false });
  app.nodes['domain-form'].handlers.submit({ preventDefault() {} });
  await settle();
  assert.ok(app.records.some(record => record.type === 'page_opened'));
  assert.ok(app.records.some(record => record.type === 'click' && record.details.id === 'back'));
  assert.ok(app.records.some(record => record.type === 'input' && record.details.value === 'Mathematics'));
  assert.ok(app.records.some(record => record.type === 'navigation' && record.details.to === 2));
  assert.equal(app.records.find(record => record.type === 'key').details.key, 'character');
  assert.ok(app.records.every(record => record.eventId && record.timestamp && !record.questionToken));
});

test('queues failed events and sends them on reconnection with original IDs', async () => {
  const app = harness();
  await settle();
  app.fail(true);
  app.documentEvents.click({ target: app.nodes.back });
  await settle();
  const queue = JSON.parse(app.storage.get('mc-pending-events'));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].type, 'click');
  app.fail(false);
  app.windowEvents.online();
  await settle();
  assert.ok(app.records.some(record => record.eventId === queue[0].eventId));
  assert.deepEqual(JSON.parse(app.storage.get('mc-pending-events')), []);
});

test('does not send activity when tracking is disabled', async () => {
  const app = harness(false);
  await settle();
  app.documentEvents.click({ target: app.nodes.back });
  await settle();
  assert.equal(app.requests.filter(url => url === '/api/activity').length, 0);
});
