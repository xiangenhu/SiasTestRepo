const $ = id => document.getElementById(id);
const screens = [$('domain-form'), $('topic-form'), $('question-step')];
let question;
let busy = false;
let startedAt = 0;
let submitted = false;

function storedId(storage, key) {
  try {
    let id = storage.getItem(key);
    if (!/^[0-9a-f-]{36}$/i.test(id || '')) { id = crypto.randomUUID(); storage.setItem(key, id); }
    return id;
  } catch { return crypto.randomUUID(); }
}
let learnerId;
let sessionId;
try { learnerId = storedId(localStorage, 'mc-learner-id'); } catch { learnerId = crypto.randomUUID(); }
try { sessionId = storedId(sessionStorage, 'mc-session-id'); } catch { sessionId = crypto.randomUUID(); }

let trackingEnabled = null;
let sending = false;
let retryTimer;
let batchSize = 20;
const pageStartedAt = performance.now();
let pending = [];
try { pending = JSON.parse(sessionStorage.getItem('mc-pending-events') || '[]'); if (!Array.isArray(pending)) pending = []; } catch { pending = []; }
function persistEvents() {
  try { sessionStorage.setItem('mc-pending-events', JSON.stringify(pending)); } catch { /* Keep the queue in memory when storage is unavailable. */ }
}
function enqueue(event) {
  if (trackingEnabled === false) return;
  pending.push(event);
  persistEvents();
  flushEvents();
}
async function flushEvents() {
  if (sending || trackingEnabled !== true || !pending.length) return;
  sending = true;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  const batch = [];
  for (const event of pending.slice(0, batchSize)) {
    if (JSON.stringify([...batch, event]).length > 48000) break;
    batch.push(event);
  }
  try {
    const response = await fetch('/api/activity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch), keepalive: true,
    });
    if (response.status === 400) {
      // Isolate invalid/expired records so they cannot block newer activity.
      if (batch.length > 1) batchSize = 1;
      else {
        pending.shift();
        persistEvents();
        $('tracking-status').textContent = 'One expired or invalid activity record could not be saved.';
      }
      return;
    }
    if (!response.ok) throw Error('Tracking failed');
    pending.splice(0, batch.length);
    batchSize = 20;
    persistEvents();
    $('tracking-status').textContent = 'Activity tracking is enabled.';
  } catch {
    $('tracking-status').textContent = 'Activity has not been saved yet. Retrying while you continue.';
    retryTimer = setTimeout(flushEvents, 5000);
  } finally {
    sending = false;
    if (!retryTimer && pending.length) flushEvents();
  }
}
function track(type, answerIndex, details) {
  const activeQuestion = question && !screens[2].hidden;
  enqueue({
    type, answerIndex, details,
    ...(activeQuestion ? { questionToken: question.questionToken } : {}),
    eventId: crypto.randomUUID(), learnerId, sessionId, timestamp: new Date().toISOString(),
    durationMs: Math.min(86400000, Math.max(0, Math.round(performance.now() - (activeQuestion ? startedAt : pageStartedAt)))),
  });
}
function uiTrack(type, details = {}) {
  track(type, undefined, { step: screens.findIndex(screen => !screen.hidden) + 1, ...details });
}
fetch('/api/tracking').then(response => {
  if (!response.ok) throw Error('Tracking configuration unavailable');
  return response.json();
}).then(data => {
  trackingEnabled = data.enabled;
  if (!trackingEnabled) { pending = []; persistEvents(); }
  else { $('tracking-status').textContent = 'Clicks and learning activity are recorded using an anonymous learner ID.'; flushEvents(); }
}).catch(() => { $('tracking-status').textContent = 'Activity tracking could not start. Reload to try again.'; });
uiTrack('page_opened');

function targetDetails(target) {
  if (!(target instanceof Element)) return {};
  const control = target.closest('button, input, a, label') || target;
  const input = control.matches('input') ? control : control.querySelector('input');
  return {
    tag: control.tagName.toLowerCase(), id: control.id || '',
    ...(control.matches('button') ? { label: control.textContent.trim().slice(0, 120) } : {}),
    ...(input?.type === 'radio' ? { choice: input.value } : {}),
  };
}
for (const [browserEvent, type] of [['click', 'click'], ['dblclick', 'double_click'], ['contextmenu', 'context_menu'], ['focusin', 'focus'], ['focusout', 'blur'], ['input', 'input'], ['change', 'change']]) {
  document.addEventListener(browserEvent, event => {
    const details = targetDetails(event.target);
    if (['domain', 'subdomain'].includes(event.target.id) && ['input', 'change'].includes(type)) details.value = event.target.value.slice(0, 120);
    uiTrack(type, details);
  }, true);
}
document.addEventListener('keydown', event => {
  // Record key activity without collecting typed text or clipboard contents.
  const key = ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace', 'Delete', ' '].includes(event.key) ? (event.key === ' ' ? 'Space' : event.key) : 'character';
  uiTrack('key', { ...targetDetails(event.target), key, repeat: event.repeat });
}, true);
document.addEventListener('invalid', event => uiTrack('validation_failed', targetDetails(event.target)), true);
let scrollTimer;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => uiTrack('scroll', { x: Math.round(window.scrollX), y: Math.round(window.scrollY) }), 250);
}, { passive: true });
document.addEventListener('visibilitychange', () => uiTrack('visibility', { state: document.visibilityState }));
window.addEventListener('online', flushEvents);
window.addEventListener('pagehide', () => {
  leaveQuestion();
  uiTrack('page_left');
  if (trackingEnabled && pending.length) {
    const batch = [];
    for (const event of pending.slice(0, 20)) {
      if (JSON.stringify([...batch, event]).length > 48000) break;
      batch.push(event);
    }
    navigator.sendBeacon('/api/activity', new Blob([JSON.stringify(batch)], { type: 'application/json' }));
  }
});

function leaveQuestion() {
  if (question && !submitted && !screens[2].hidden) track('abandoned');
}

function showStep(index) {
  const previousStep = screens.findIndex(screen => !screen.hidden) + 1;
  screens.forEach((screen, i) => { screen.hidden = i !== index; });
  uiTrack('navigation', { from: previousStep, to: index + 1 });
  document.querySelectorAll('.steps li').forEach((step, i) => {
    if (i === index) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  $('status').textContent = '';
  const target = index === 0 ? $('domain') : index === 1 ? $('subdomain') : $('question');
  if (index === 2) target.tabIndex = -1;
  target.focus();
}

$('domain-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('domain').value.trim()) return $('domain').focus();
  $('domain-summary').textContent = 'Domain: ' + $('domain').value.trim();
  showStep(1);
});
$('back').addEventListener('click', () => showStep(0));
$('restart').addEventListener('click', () => { leaveQuestion(); showStep(0); });


async function generate() {
  if (busy) return;
  if (!$('subdomain').value.trim()) return $('subdomain').focus();
  busy = true;
  uiTrack('generation_started', { domain: $('domain').value.trim(), subdomain: $('subdomain').value.trim() });
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  $('status').textContent = 'Creating your question…';
  try {
    const response = await fetch('/api/question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: $('domain').value.trim(), subdomain: $('subdomain').value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not generate a question. Please try again.');
    leaveQuestion();
    question = data;
    startedAt = performance.now();
    submitted = false;
    $('tracking-status').textContent = data.trackingEnabled ? 'Clicks and learning activity are recorded using an anonymous learner ID.' : '';
    $('question').textContent = data.question;
    $('topic-summary').textContent = $('domain').value.trim() + ' / ' + $('subdomain').value.trim();
    $('choices').replaceChildren();
    data.choices.forEach((choice, index) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'answer'; input.value = index; input.required = true;
      label.append(input, document.createTextNode(' ' + String.fromCharCode(65 + index) + '. ' + choice));
      $('choices').append(label);
    });
    $('feedback').textContent = '';
    showStep(2);
    track('viewed');
    uiTrack('generation_succeeded');
  } catch (error) {
    $('status').textContent = error.message;
    uiTrack('generation_failed');
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
$('topic-form').addEventListener('submit', event => { event.preventDefault(); generate(); });
$('another').addEventListener('click', generate);
$('answer-form').addEventListener('submit', event => {
  event.preventDefault();
  const answer = Number(new FormData($('answer-form')).get('answer'));
  submitted = true;
  track('answered', answer);
  $('feedback').textContent = (answer === question.correctIndex ? 'Correct! ' : 'The correct answer is ' + String.fromCharCode(65 + question.correctIndex) + '. ' + question.choices[question.correctIndex] + '. ') + question.explanation;
});
$('answer-form').addEventListener('change', () => {
  $('feedback').textContent = '';
  track('selected', Number(new FormData($('answer-form')).get('answer')));
});

const suggestionRequests = { domain: 0, subdomain: 0 };
let suggestedForDomain = '';
async function suggestTopics(field) {
  const domain = $('domain').value.trim();
  if (field === 'subdomain' && !domain) return $('domain').focus();
  const requestId = ++suggestionRequests[field];
  const button = $(field === 'domain' ? 'suggest-domains' : 'suggest-subdomains');
  const container = $(field + '-suggestions');
  const status = $(field + '-suggestion-status');
  button.disabled = true;
  container.replaceChildren();
  status.textContent = 'Finding topic suggestions…';
  uiTrack('suggestions_requested', { field, ...(field === 'subdomain' ? { domain } : {}) });
  try {
    const response = await fetch('/api/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(field === 'subdomain' ? { domain } : {}),
    });
    const data = await response.json();
    if (requestId !== suggestionRequests[field] || (field === 'subdomain' && domain !== $('domain').value.trim())) return;
    if (!response.ok) throw Error(data.error || 'Could not suggest topics. You can type your own.');
    data.suggestions.forEach(topic => {
      const choice = document.createElement('button');
      choice.type = 'button'; choice.textContent = topic;
      choice.addEventListener('click', () => {
        $(field).value = topic;
        $(field).dispatchEvent(new Event('input', { bubbles: true }));
        $(field).focus();
        uiTrack('suggestion_selected', { field, topic });
      });
      container.append(choice);
    });
    status.textContent = 'Choose a suggestion or type your own topic.';
    if (field === 'subdomain') suggestedForDomain = domain;
    uiTrack('suggestions_succeeded', { field });
  } catch (error) {
    if (requestId === suggestionRequests[field]) status.textContent = error.message;
    uiTrack('suggestions_failed', { field });
  } finally {
    if (requestId === suggestionRequests[field]) button.disabled = false;
  }
}
$('suggest-domains').addEventListener('click', () => suggestTopics('domain'));
$('suggest-subdomains').addEventListener('click', () => suggestTopics('subdomain'));
$('domain').addEventListener('input', () => {
  suggestionRequests.subdomain++;
  $('subdomain-suggestions').replaceChildren();
  $('subdomain-suggestion-status').textContent = '';
  $('suggest-subdomains').disabled = false;
  if (suggestedForDomain && suggestedForDomain !== $('domain').value.trim()) $('subdomain').value = '';
});
$('domain-form').addEventListener('submit', () => {
  if ($('domain').value.trim() && suggestedForDomain !== $('domain').value.trim()) suggestTopics('subdomain');
});
