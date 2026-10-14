const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
test('replacement does not load legacy learner tracking',()=>{
 const html=readFileSync('public/index.html','utf8');
 assert.match(html,/SafetySignal/);
 assert.doesNotMatch(html,/Question Wizard|tracking-status/);
});
