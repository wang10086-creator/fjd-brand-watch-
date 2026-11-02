import test from 'node:test';import assert from 'node:assert/strict';
import {sourceIdForUrl} from '../cloud/history-window-batch.mjs';import {verifiedTarget} from '../cloud/history-verified-redirects.mjs';
const source='https://example.com/old-item',target='https://example.com/ua/old-item',candidate={historyId:'20261102-999',recordId:'recFixture999',sourceId:sourceIdForUrl(source)};
const rule={...candidate,targetSourceId:sourceIdForUrl(target),kind:'http'};
test('only the reviewed ID tuple and actual HTTP chain can map a source',()=>{
 const diagnostic={documents:[{url:source,status:301,location:target},{url:target,status:200}],final:{url:target,status:200,challenge:false}};
 assert.equal(verifiedTarget(candidate,source,diagnostic,[rule]).target,target);
 assert.throws(()=>verifiedTarget({...candidate,recordId:'recOther'},source,diagnostic,[rule]));
 assert.throws(()=>verifiedTarget(candidate,source,{...diagnostic,final:{...diagnostic.final,url:'https://example.com/new-listing-id'}},[rule]));
 assert.throws(()=>verifiedTarget(candidate,source,{...diagnostic,documents:[{url:source,status:200}]},[rule]));
 assert.throws(()=>verifiedTarget(candidate,source,{...diagnostic,final:{...diagnostic.final,url:source}},[rule]));
 assert.throws(()=>verifiedTarget(candidate,source,{...diagnostic,final:{...diagnostic.final,challenge:true}},[rule]));
});
test('a meta refresh requires a public source and exact reviewed zero-delay target',()=>{
 const d={gate:'public-document-v1-passed',documents:[{url:source,status:200}],final:{url:source,status:200,metaRefresh:'<meta http-equiv="refresh" content="0; url='+target+'">'}};
 assert.equal(verifiedTarget(candidate,source,d,[{...rule,kind:'meta-refresh'}]).target,target);
 assert.throws(()=>verifiedTarget(candidate,source,{...d,gate:'login-required'},[{...rule,kind:'meta-refresh'}]));
 assert.throws(()=>verifiedTarget(candidate,source,{...d,final:{...d.final,metaRefresh:d.final.metaRefresh.replace('0;','30;')}},[{...rule,kind:'meta-refresh'}]));
});
