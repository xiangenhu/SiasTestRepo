const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const context = new AsyncLocalStorage();

function failure(code) { return Object.assign(new Error(code), { auditCode: code }); }

async function requestStructured(operation, request, parse) {
  const audit = context.getStore();
  let providerStarted;
  const interactionId = randomUUID();
  let response;
  let data;
  let success = false;
  let errorCode;
  const record = async phase => {
    if (!audit?.record) return;
    try {
      await audit.record({
        interactionId, phase, operation, timestamp: new Date().toISOString(),
        durationMs: providerStarted === undefined ? 0 : Date.now() - providerStarted, request,
        ...(response?.status ? { httpStatus: response.status } : {}),
        ...(data ? {
          model: data.model || request.model, responseId: data.id,
          providerStatus: data.status, usage: data.usage,
          output: data.output || [], incompleteDetails: data.incomplete_details,
        } : { model: request.model }),
        success, ...(errorCode ? { errorCode } : {}),
      });
    } catch {
      audit.failed = true;
      console.error('xAPI: LLM interaction could not be delivered to the LRS.');
    }
  };
  await record('started');
  try {
    providerStarted = Date.now();
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45000), body: JSON.stringify(request),
    });
    try { data = await response.json(); } catch { throw failure('invalid_provider_json'); }
    if (!response.ok) throw failure('provider_http_error');
    if (data.status !== 'completed') throw failure('incomplete_response');
    const output = (data.output || []).flatMap(item => item.content || []);
    if (output.some(item => item.type === 'refusal')) throw failure('refusal');
    let parsed;
    try { parsed = JSON.parse(output.filter(item => item.type === 'output_text').map(item => item.text).join('')); }
    catch { throw failure('invalid_output_json'); }
    const result = parse(parsed);
    success = true;
    return result;
  } catch (error) {
    errorCode = error.auditCode || (error.name === 'TimeoutError' ? 'timeout' : error.name === 'TypeError' ? 'network_error' : 'invalid_output');
    throw error;
  } finally {
    await record(success ? 'completed' : 'failed');
  }
}

module.exports = { context, requestStructured };
