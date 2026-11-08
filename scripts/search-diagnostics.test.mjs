import test from 'node:test';import assert from 'node:assert/strict';
import {searchDiagnostics} from '../cloud/search-diagnostics.mjs';
test('summarizes source calls and skips separately without changing inputs',()=>{
 const items=[{sourceTrace:[{source:'primary',called:false,outcome:'cooldown-skip'},{source:'rss',called:true,outcome:'scope-unverified'},{source:'web',called:true,outcome:'access-challenge'}]},{sourceTrace:[{source:'primary',called:true,outcome:'hit'},{source:'rss',called:false,outcome:'prior-source-completed'}]}];
 const before=JSON.stringify(items),s=searchDiagnostics(items);
 assert.equal(s.primary.called,1);assert.equal(s.primary.outcomes.hit,1);assert.equal(s.primary.outcomes['cooldown-skip'],1);assert.equal(s.rss.called,1);assert.equal(s.rss.outcomes['scope-unverified'],1);assert.equal(s.web.outcomes['access-challenge'],1);assert.equal(JSON.stringify(items),before);
});
test('only emits fixed names and numeric counters even with hostile strings',()=>{
 const secret='PRIVATE_SENTINEL https://private.example/?token=abc\nFORGED LOG';
 const s=searchDiagnostics([{query:secret,sourceTrace:[{source:'rss',called:true,outcome:secret,code:secret,message:secret,url:secret,at:secret},{source:secret,called:true,outcome:'hit'},{source:'__proto__',called:true,outcome:'hit'},{source:'web',called:secret,outcome:'constructor'}]}]);
 assert.equal(JSON.stringify(s).includes('PRIVATE_SENTINEL'),false);assert.equal(s.rss.outcomes.other,1);assert.equal(s.web.outcomes.other,1);assert.equal(s.web.called,0);assert.deepEqual(Object.keys(s),['primary','rss','web']);
 for(const slot of Object.values(s)){assert.equal(typeof slot.called,'number');for(const count of Object.values(slot.outcomes))assert.equal(typeof count,'number');}
});
test('tolerates legacy missing and malformed traces and empty scans',()=>{
 for(const input of [undefined,null,{},[],[null,{}, {sourceTrace:null},{sourceTrace:{}},{sourceTrace:[null,{},'private']}]] )assert.equal(Object.values(searchDiagnostics(input)).reduce((n,s)=>n+s.called,0),0);
});
test('reads dynamic trace fields once before allowlist validation',()=>{
 let sourceReads=0,outcomeReads=0;const trace={get source(){return ++sourceReads===1?'rss':'PRIVATE_SENTINEL'},get outcome(){return ++outcomeReads===1?'hit':'PRIVATE_SENTINEL'},called:true};
 const s=searchDiagnostics([{sourceTrace:[trace]}]);assert.equal(sourceReads,1);assert.equal(outcomeReads,1);assert.equal(s.rss.outcomes.hit,1);assert.equal(JSON.stringify(s).includes('PRIVATE_SENTINEL'),false);
});
