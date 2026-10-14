const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const backend = require('../backend');
function env(t,key,value){const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
async function start(t, overrides = {}) {
 const server = createServer({ ...backend, ...overrides });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(() => new Promise(resolve => server.close(resolve)));
 return 'http://127.0.0.1:' + server.address().port;
}
const post = (url, data) => fetch(url+'/api/analyze', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
test('serves replacement dashboard and sample content without revealing secrets', async t => {
 const url = await start(t);
 for(const path of ['/','/app.js','/style.css']) assert.equal((await fetch(url+path)).status,200);
 assert.match(await (await fetch(url)).text(), /SafetySignal/);
 const config=await(await fetch(url+'/api/config')).json();
 assert.ok(!JSON.stringify(config).includes('OPENAI_API_KEY'));
 const samples=await(await fetch(url+'/api/samples')).json();
 assert.equal(samples.updates.length,6);
 assert.ok(samples.updates.some(u=>u.analysis===null));
 assert.ok(samples.updates.some(u=>u.analysis?.confidence==='low'));
 assert.equal((await fetch(url+'/api/question')).status,404);
});
test('analysis rejects unauthenticated and unverified users before spending quota', async t=>{
 let called=false;
 const url=await start(t,{authenticate:async()=>{throw backend.failure(401,'Please sign in.');},reserveQuota:async()=>{called=true;}});
 assert.equal((await post(url,{id:'heat-proposal'})).status,401);
 assert.equal(called,false);
});
test('validates update IDs and source size before spending quota',async t=>{
 env(t,'OPENAI_API_KEY','test');let called=false;
 const url=await start(t,{authenticate:async()=>({uid:'user'}),firebase:()=>({db:{doc:()=>({get:async()=>({exists:true,data:()=>({text:'a'.repeat(12001)})})})}}),reserveQuota:async()=>{called=true;}});
 for(const id of ['../../private','',null])assert.equal((await post(url,{id})).status,400);
 assert.equal((await post(url,{id:'valid'})).status,400);assert.equal(called,false);
});
test('quota rejection prevents provider calls; provider failure is sanitized',async t=>{
 env(t,'OPENAI_API_KEY','test');let called=false;
 const deps={authenticate:async()=>({uid:'user'}),firebase:()=>({db:{doc:()=>({get:async()=>({exists:true,data:()=>({text:'source text'})})})}}),reserveQuota:async()=>{throw backend.failure(429,'Daily AI limit reached.');},analyze:async()=>{called=true;throw Error('secret detail');}};
 let url=await start(t,deps);assert.equal((await post(url,{id:'valid'})).status,429);assert.equal(called,false);
 url=await start(t,{...deps,reserveQuota:async()=>({used:1,limit:10})});const response=await post(url,{id:'valid'});assert.equal(response.status,502);assert.ok(!(await response.text()).includes('secret detail'));
});
test('atomic quota reservation enforces user and global caps and counts attempts',async t=>{
 env(t,'AI_DAILY_USER_LIMIT','2');env(t,'AI_DAILY_GLOBAL_LIMIT','3');
 const data=new Map();let queue=Promise.resolve();
 const db={doc:path=>path,runTransaction:fn=>{const result=queue.then(()=>fn({get:async ref=>({data:()=>data.get(ref)}),set:(ref,value)=>data.set(ref,value)}));queue=result.catch(()=>{});return result;}};
 const results=await Promise.allSettled(Array.from({length:5},()=>backend.reserveQuota(db,'alice','2026-10-14')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 await backend.reserveQuota(db,'bob','2026-10-14');
 await assert.rejects(backend.reserveQuota(db,'carol','2026-10-14'),e=>e.status===429);
 assert.equal(data.get('usage/2026-10-14').count,3);
});
test('AI output is structured and uncertain sample text is explicitly identified',async t=>{
 const analysis={summary:'Review source',actions:['Check applicability'],confidence:'low',uncertainty:'Sample text'};let request;
 t.mock.method(globalThis,'fetch',async(url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(analysis)}]}]})};});
 assert.deepEqual(await backend.analyze(backend.samples[0]),analysis);
 assert.equal(request.max_output_tokens,900);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.match(request.instructions,/Never approve/);
});
test('ingestion is protected with a server-only secret',async t=>{
 env(t,'CRON_SECRET','test-secret');let called=false;const url=await start(t,{ingest:async()=>{called=true;return{imported:6};}});
 assert.equal((await fetch(url+'/api/ingest')).status,401);assert.equal(called,false);
 const response=await fetch(url+'/api/ingest',{headers:{Authorization:'Bearer test-secret'}});assert.equal(response.status,200);assert.equal(called,true);
});
test('successful analysis atomically saves a private result and invalidates prior review',async t=>{
 env(t,'OPENAI_API_KEY','test');const writes=[];let committed=false;let analyzed;
 const db={doc:path=>path==='updates/update'?{get:async()=>({exists:true,data:()=>({text:'trusted source',title:'Update'})})}:path,batch:()=>({set:(ref,data)=>writes.push(['set',ref,data]),delete:ref=>writes.push(['delete',ref]),commit:async()=>{committed=true;}})};
 const url=await start(t,{authenticate:async()=>({uid:'alice'}),firebase:()=>({db}),reserveQuota:async()=>({used:1,limit:10}),analyze:async source=>{analyzed=source;return{summary:'Review',confidence:'low',actions:[],uncertainty:'Verify'};}});
 const response=await post(url,{id:'update',uid:'bob',text:'injected prompt'});
 assert.equal(response.status,200);assert.equal(analyzed.text,'trusted source');assert.equal(committed,true);
 assert.equal(writes[0][1],'users/alice/analyses/update');assert.ok(writes[0][2].revision);assert.equal(writes[1][1],'users/alice/reviews/update');
});
