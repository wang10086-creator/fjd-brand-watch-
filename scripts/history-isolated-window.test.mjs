import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {validateCapture,sourceIdForUrl} from '../cloud/history-window-batch.mjs';import {validateIsolatedCapture} from '../cloud/history-isolated-window.mjs';import {browserResponseHeaders} from '../cloud/window-response-headers.mjs';
const url='https://example.com/product/1',scope={historyId:'20261102-999',recordId:'recFixture999',sourceId:sourceIdForUrl(url)};
const bytes=Buffer.alloc(1200);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(1360,16);bytes.writeUInt32BE(1000,20);
const proof={method:'x11-native-window',addressReadMethod:'native-omnibox-clipboard',windowTree:'Google-chrome',scripts:'enabled-isolated',strictTargetGate:'isolated-rendered-public-v1',originalUrl:url,addressBarUrl:url,pageUrl:url,navigationError:false,width:1360,height:1000,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),at:new Date().toISOString(),documents:[{url,status:200,mainDocument:true}],isolation:{networkNamespaceDifferent:true,unprivilegedBrowser:true,directTcpAndUdpUnavailable:true,devtoolsTransport:'pipe'},renderedGate:{passed:true,title:'Public product',visibleTextLength:200,visibleTextSha256:'a'.repeat(64),framesChecked:0},recoveryScope:scope};
test('isolated proof never satisfies default gate and requires scope plus live isolation proof',()=>{
 assert.throws(()=>validateCapture(proof,bytes,url));assert.equal(validateIsolatedCapture(proof,bytes,url,scope,[scope]).scripts,'enabled-isolated');
 for(const change of [{isolation:undefined},{isolation:{...proof.isolation,networkNamespaceDifferent:false}},{recoveryScope:{...scope,recordId:'recOther'}},{renderedGate:{...proof.renderedGate,visibleTextLength:0}},{scripts:'disabled'},{addressBarUrl:'https://example.com/login'},{navigationError:true}])assert.throws(()=>validateIsolatedCapture({...proof,...change},bytes,url,scope,[scope]));
 assert.throws(()=>validateIsolatedCapture(proof,bytes,url,scope,[]));const altered=Buffer.from(bytes);altered[500]=1;assert.throws(()=>validateIsolatedCapture(proof,altered,url,scope,[scope]));
});
test('policy and CORS headers survive opt-in while cookie/auth/compression headers never do',()=>{
 const headers={'content-type':'text/html','content-security-policy':"default-src 'self'",'access-control-allow-origin':'https://example.com','cross-origin-resource-policy':'same-site','set-cookie':'private','authorization':'private','content-encoding':'gzip','content-length':'200','x-robots-tag':'noarchive'};
 assert.deepEqual(Object.keys(browserResponseHeaders(headers)).sort(),['content-type','x-robots-tag']);
 const selected=browserResponseHeaders(headers,true);for(const key of ['content-security-policy','access-control-allow-origin','cross-origin-resource-policy'])assert.equal(selected[key],headers[key]);for(const key of ['set-cookie','authorization','content-encoding','content-length'])assert.ok(!(key in selected));
});
