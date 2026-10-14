const {test,before,after}=require('node:test');
const {readFileSync}=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,serverTimestamp}=require('firebase/firestore');
let env;
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-safetysignal',firestore:{rules:readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8081}});
 await env.withSecurityRulesDisabled(async ctx=>{const db=ctx.firestore();await setDoc(doc(db,'updates/ready'),{analysis:{summary:'Test'},revision:'v1'});await setDoc(doc(db,'updates/pending'),{analysis:null,revision:'v1'});await setDoc(doc(db,'users/alice/usage/day'),{count:1});});
});
after(async()=>{if(env)await env.cleanup();});
const record=(status='accepted',extras={})=>({status,confirmed:true,note:'Checked source',updatedAt:serverTimestamp(),interpretationVersion:'v1',...extras});
test('isolates user documents and blocks client quota or analysis writes',async()=>{
 const alice=env.authenticatedContext('alice').firestore(),bob=env.authenticatedContext('bob').firestore();
 await assertSucceeds(setDoc(doc(alice,'users/alice'),{filters:{type:'Heat safety',jurisdiction:'Federal'},saved:['ready']}));
 await assertSucceeds(getDoc(doc(alice,'users/alice/usage/day')));
 await assertFails(getDoc(doc(bob,'users/alice')));
 await assertFails(getDoc(doc(bob,'users/alice/usage/day')));
 await assertFails(setDoc(doc(bob,'users/alice/reviews/ready'),record()));
 await assertFails(setDoc(doc(alice,'users/alice/usage/day'),{count:0}));
 await assertFails(setDoc(doc(alice,'users/alice/analyses/ready'),{summary:'fake'}));
 await assertFails(setDoc(doc(alice,'updates/ready'),{text:'fake'}));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'updates/ready')));
});
test('requires confirmation and available analysis to accept but permits explicit flagging',async()=>{
 const db=env.authenticatedContext('alice').firestore();
 await assertFails(setDoc(doc(db,'users/alice/reviews/ready'),record('accepted',{confirmed:false})));
 await assertFails(setDoc(doc(db,'users/alice/reviews/pending'),record()));
 await assertSucceeds(setDoc(doc(db,'users/alice/reviews/pending'),record('flagged')));
 await assertSucceeds(setDoc(doc(db,'users/alice/reviews/ready'),record()));
});
test('rejects acceptance of a stale interpretation version',async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users/alice/analyses/ready'),{revision:'v2',summary:'New interpretation'}));
 const db=env.authenticatedContext('alice').firestore();
 await assertFails(setDoc(doc(db,'users/alice/reviews/ready'),record()));
 await assertSucceeds(setDoc(doc(db,'users/alice/reviews/ready'),record('accepted',{interpretationVersion:'v2'})));
});
