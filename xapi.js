const { createHmac, timingSafeEqual, randomUUID } = require('node:crypto');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const verbs = { viewed: 'experienced', selected: 'interacted', answered: 'answered', abandoned: 'terminated' };
const uiEvents = new Set(['page_opened', 'page_left', 'click', 'double_click', 'context_menu', 'input', 'change', 'focus', 'blur', 'key', 'scroll', 'visibility', 'navigation', 'generation_started', 'generation_succeeded', 'generation_failed', 'validation_failed', 'suggestions_requested', 'suggestions_succeeded', 'suggestions_failed', 'suggestion_selected']);

function config(env = process.env) {
  if (env.XAPI_ENABLED !== 'true') return null;
  const endpoint = new URL(env.XAPI_LRS_URL);
  const base = new URL(env.XAPI_ACTIVITY_BASE_URL);
  if (!['https:', 'http:'].includes(endpoint.protocol) || !['https:', 'http:'].includes(base.protocol)) throw Error('Invalid xAPI URL');
  if (!env.XAPI_AUTH_TOKEN && !(env.XAPI_USERNAME && env.XAPI_PASSWORD)) throw Error('Missing LRS credentials');
  if (!env.XAPI_SIGNING_SECRET || env.XAPI_SIGNING_SECRET.length < 32) throw Error('Use an xAPI signing secret of at least 32 characters');
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '');
  if (!endpoint.pathname.endsWith('/statements')) endpoint.pathname += '/statements';
  base.pathname = base.pathname.replace(/\/$/, '') + '/';
  return {
    endpoint: endpoint.href, base: base.href, secret: env.XAPI_SIGNING_SECRET,
    version: '1.0.3',
    authorization: env.XAPI_AUTH_TOKEN ? `Bearer ${env.XAPI_AUTH_TOKEN}` : 'Basic ' + Buffer.from(`${env.XAPI_USERNAME}:${env.XAPI_PASSWORD}`).toString('base64'),
  };
}

function signQuestion(question, domain, subdomain, cfg) {
  const payload = Buffer.from(JSON.stringify({ ...question, domain, subdomain, id: randomUUID(), expires: Date.now() + 86400000 })).toString('base64url');
  return payload + '.' + createHmac('sha256', cfg.secret).update(payload).digest('base64url');
}

function verifyQuestion(token, cfg) {
  if (typeof token !== 'string' || token.length > 24000) throw Error('Invalid question token');
  const parts = token.split('.');
  if (parts.length !== 2) throw Error('Invalid question token');
  const signature = Buffer.from(parts[1], 'base64url');
  const expected = createHmac('sha256', cfg.secret).update(parts[0]).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw Error('Invalid question token');
  const question = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (question.expires < Date.now()) throw Error('Expired question token');
  return question;
}

function buildStatement(event, cfg) {
  if (!event || !uuid.test(event.eventId) || !uuid.test(event.learnerId) || !uuid.test(event.sessionId) || (!Object.hasOwn(verbs, event.type) && !uiEvents.has(event.type))) throw Error('Invalid activity event');
  if (!Number.isFinite(event.durationMs) || event.durationMs < 0 || event.durationMs > 86400000) throw Error('Invalid duration');
  if (['selected', 'answered'].includes(event.type) && (!Number.isInteger(event.answerIndex) || event.answerIndex < 0 || event.answerIndex > 3)) throw Error('Invalid answer');
  const isUI = uiEvents.has(event.type);
  const q = event.questionToken ? verifyQuestion(event.questionToken, cfg) : null;
  if (!isUI && !q) throw Error('Missing question token');
  if (event.details !== undefined && (!event.details || typeof event.details !== 'object' || Array.isArray(event.details) || JSON.stringify(event.details).length > 2048)) throw Error('Invalid event details');
  if (event.timestamp !== undefined && (typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp)))) throw Error('Invalid event timestamp');
  const iri = path => new URL(path, cfg.base).href;
  const verb = verbs[event.type] || (event.type === 'page_opened' ? 'initialized' : event.type === 'page_left' ? 'terminated' : 'interacted');
  const statement = {
    id: event.eventId,
    actor: { objectType: 'Agent', account: { homePage: cfg.base, name: event.learnerId } },
    verb: { id: 'http://adlnet.gov/expapi/verbs/' + verb, display: { 'en-US': verb } },
    object: q ? {
      objectType: 'Activity', id: iri('questions/' + q.id),
      definition: {
        name: { 'en-US': q.question }, type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
        interactionType: 'choice', correctResponsesPattern: [String(q.correctIndex)],
        choices: q.choices.map((choice, index) => ({ id: String(index), description: { 'en-US': choice } })),
      },
    } : { objectType: 'Activity', id: iri('wizard'), definition: { name: { 'en-US': 'Question Wizard' } } },
    context: {
      registration: event.sessionId,
      extensions: {
        ...(q ? { [iri('extensions/domain')]: q.domain, [iri('extensions/subdomain')]: q.subdomain } : {}),
        [iri('extensions/event')]: event.type,
        ...(event.details ? { [iri('extensions/details')]: event.details } : {}),
      },
    },
    result: { duration: 'PT' + (event.durationMs / 1000).toFixed(3) + 'S' },
    timestamp: event.timestamp || new Date().toISOString(),
  };
  if (['selected', 'answered'].includes(event.type)) statement.result.response = String(event.answerIndex);
  if (event.type === 'answered') {
    const success = event.answerIndex === q.correctIndex;
    Object.assign(statement.result, { success, completion: true, score: { scaled: success ? 1 : 0, raw: success ? 1 : 0, min: 0, max: 1 } });
  }
  return statement;
}

async function sendStatement(statement, cfg, fetcher = fetch) {
  const url = new URL(cfg.endpoint);
  url.searchParams.set('statementId', statement.id);
  // Reuse the statement UUID and body for idempotent retries.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(url.href, {
        method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { Authorization: cfg.authorization, 'X-Experience-API-Version': cfg.version, 'Content-Type': 'application/json' },
        body: JSON.stringify(statement),
      });
      if (response.ok) return;
      if (response.status !== 429 && response.status < 500) throw Object.assign(Error('LRS rejected statement'), { permanent: true });
      throw Error('LRS temporarily unavailable');
    } catch (error) {
      if (error.permanent || attempt === 2) throw error;
    }
  }
}

function llmIdentity(data) {
  if (data.learnerId !== undefined && !uuid.test(data.learnerId)) throw Error('Invalid learner ID');
  if (data.sessionId !== undefined && !uuid.test(data.sessionId)) throw Error('Invalid session ID');
  return { learnerId: data.learnerId || 'server-client-' + randomUUID(), sessionId: data.sessionId || randomUUID() };
}

function buildLLMStatement(record, identity, cfg) {
  const iri = path => new URL(path, cfg.base).href;
  const usage = record.usage;
  const token = value => Number.isInteger(value) && value >= 0 ? value : undefined;
  const tokens = {
    prompt_tokens: token(usage?.input_tokens), completion_tokens: token(usage?.output_tokens),
    total_tokens: token(usage?.total_tokens), cached_tokens: token(usage?.input_tokens_details?.cached_tokens),
    cache_write_tokens: token(usage?.input_tokens_details?.cache_write_tokens), reasoning_tokens: token(usage?.output_tokens_details?.reasoning_tokens),
  };
  const metadata = {
    interaction_id: record.interactionId, operation: record.operation, phase: record.phase,
    provider: 'openai', model: record.model, response_id: record.responseId,
    http_status: record.httpStatus, provider_status: record.providerStatus,
    latency_ms: record.durationMs, error_code: record.errorCode,
    prompt: { instructions: record.request.instructions, input: record.request.input },
    request_parameters: record.request, output: record.output,
    incomplete_details: record.incompleteDetails, usage_available: Boolean(usage), usage,
    ...tokens,
  };
  // Remove absent properties while preserving actual zero token counts.
  for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key];
  const verb = record.phase === 'started' ? 'initialized' : record.success ? 'completed' : 'failed';
  return {
    id: randomUUID(), timestamp: record.timestamp,
    actor: { objectType: 'Agent', account: { homePage: cfg.base, name: identity.learnerId } },
    verb: { id: 'http://adlnet.gov/expapi/verbs/' + verb, display: { 'en-US': verb } },
    object: { objectType: 'Activity', id: iri('llm/interactions/' + record.interactionId), definition: { name: { 'en-US': record.operation } } },
    context: {
      registration: identity.sessionId,
      contextActivities: { parent: [{ objectType: 'Activity', id: iri('wizard') }] },
      extensions: { [iri('extensions/event')]: 'llm_' + record.phase, [iri('extensions/llm')]: metadata },
    },
    result: {
      duration: 'PT' + (record.durationMs / 1000).toFixed(3) + 'S',
      ...(record.phase !== 'started' ? { completion: true, success: record.success } : {}),
    },
  };
}

module.exports = { config, signQuestion, buildStatement, sendStatement, llmIdentity, buildLLMStatement };
