import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectSources,urls,day,diagnose} from '../cloud/source-key-diagnostic.mjs';
import {snapshotPayload} from '../cloud/formal-reports.mjs';
function fixture(){const formal={day,report:{cohort:urls.map(url=>({kind:'new',snapshot:{url}}))}};formal.checksum=createHash('sha256').update(JSON.stringify(snapshotPayload(formal))).digest('hex');return {state:{rows:urls.map(url=>({url,secret:'DO_NOT_OUTPUT'})),monitor:{formalReports:{[day]:formal}}}};}
test('fixed private matches produce only whitelist without mutation',()=>{const v=fixture(),before=JSON.stringify(v),out=selectSources(v);assert.equal(JSON.stringify(v),before);assert.equal(out.length,2);assert.ok(out.every(r=>r.source_basis==='private-row-production-fallback'&&/^lead-[a-f0-9]{64}$/.test(r.source_id)));assert.ok(!JSON.stringify(out).includes('DO_NOT_OUTPUT'));assert.deepEqual(Object.keys(out[0]),['url','source_id','report_day','source_basis','event_id']);});
test('stored identity preserved and conflicts fail closed',()=>{const v=fixture();v.state.rows[0].source_id='lead-'+'a'.repeat(64);assert.equal(selectSources(v)[0].source_id,v.state.rows[0].source_id);v.historyV3={items:{x:{payload:{url:urls[0],source_id:'lead-'+'b'.repeat(64)}}}};assert.throws(()=>selectSources(v));});
test('duplicates and invalid formal proof fail',()=>{const v=fixture();v.state.rows.push(v.state.rows[0]);assert.throws(()=>selectSources(v));const w=fixture();w.state.monitor.formalReports[day].checksum='bad';assert.throws(()=>selectSources(w));});
test('transport uses only GET and never follows failure with writes',async()=>{const calls=[];await assert.rejects(diagnose({token:'test',password:'test',fetcher:async(url,o)=>{calls.push(o.method);throw Error('stop')}}));assert.deepEqual(calls,['GET']);});
