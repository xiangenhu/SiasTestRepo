const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
try { process.loadEnvFile(join(__dirname, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const backend = require('./backend');
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function handler(deps = backend) {
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const path = req.url.split('?')[0];
    try {
      if (req.method === 'GET' && path === '/api/config') return json(res, 200, { firebase: deps.clientConfig(), quota: deps.limits().user });
      if (req.method === 'GET' && path === '/api/samples') return json(res, 200, { updates: deps.samples });
      if (path === '/api/ingest') {
        if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Use GET or POST.' });
        if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return json(res, 401, { error: 'Unauthorized ingestion.' });
        return json(res, 200, await deps.ingest());
      }
      if (path === '/api/analyze') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
        const user = await deps.authenticate(req);
        if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'AI analysis is not configured.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2048) return json(res, 413, { error: 'Request too large.' }); }
        let data;
        try { data = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }
        if (typeof data?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id)) return json(res, 400, { error: 'Invalid update ID.' });
        const { db } = deps.firebase();
        const doc = await db.doc(`updates/${data.id}`).get();
        if (!doc.exists) return json(res, 404, { error: 'Update not found.' });
        const update = doc.data();
        if (typeof update.text !== 'string' || !update.text.trim() || update.text.length > 12000) return json(res, 400, { error: 'Update text must be between 1 and 12,000 characters.' });
        const quota = await deps.reserveQuota(db, user.uid);
        let analysis;
        try { analysis = await deps.analyze(update); } catch { return json(res, 502, { error: 'Analysis unavailable. This attempt counts toward your daily limit. Review the source or retry later.' }); }
        analysis.revision = require('node:crypto').randomUUID();
        const batch = db.batch();
        batch.set(db.doc(`users/${user.uid}/analyses/${data.id}`), { ...analysis, updatedAt: new Date().toISOString() });
        // Save the new interpretation and invalidate the previous review atomically.
        batch.delete(db.doc(`users/${user.uid}/reviews/${data.id}`));
        await batch.commit();
        return json(res, 200, { analysis, quota });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' });
        return res.end(readFileSync(join(__dirname, 'public', file)));
      }
      return json(res, 404, { error: 'Not found.' });
    } catch (e) { return json(res, e.status || 503, { error: e.status ? e.message : 'Service unavailable. Check your Firebase configuration and try again.' }); }
  };
}
function createServer(deps) { return http.createServer(handler(deps)); }
if (require.main === module) createServer().listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('SafetySignal running on port ' + (process.env.PORT || 3000)));
module.exports = { handler, createServer };
