import test from 'node:test';
import assert from 'node:assert/strict';
import {imageMatchBadges,imageMatchEvidence} from '../image-match-view.js';
import {enrichPictures} from '../cloud/visual-enrichment.mjs';
import {dualImageRows} from './fixtures/dual-images.mjs';
test('list pending and failed categories are distinct from confirmed evidence',()=>{
 assert.match(imageMatchBadges({}),/尚无图片核验记录/);
 assert.match(imageMatchBadges(dualImageRows()[6]),/图片核验受限/);
 for(const [i,t,p] of [[0,1,0],[1,0,1],[2,1,1]]){const html=imageMatchBadges(dualImageRows()[i]);assert.equal(+html.includes('>商标图匹配<'),t);assert.equal(+html.includes('>产品图匹配<'),p)}
});
test('detail resolves matching catalog identifiers and retains exact official page',()=>{
 const row=dualImageRows()[2],m=row.trademarkImageMatch.matches[0],product=row.productImageMatch.matches[0];
 const html=imageMatchEvidence(row,{catalog:{entries:[{id:m.brandIds[0],canonicalName:'Catalog trademark name'}]}});
 assert.ok(html.includes('Catalog trademark name'));assert.ok(html.includes('href="'+product.sourcePage+'"'));assert.match(html,/官网原始页面/);assert.match(html,/无需逐条操作/);
});
test('historical batch rotates past a repeatedly failing recent row',async()=>{
 const state={rows:[{url:'https://a.example/new',lastSeen:'2026-10-21'},{url:'https://a.example/old',lastSeen:'2026-10-01'}]},seen=[];
 const collector=async rows=>{seen.push(rows.map(r=>r.url));return rows.map(r=>({url:r.url,trademarkImageMatch:{status:'unavailable',matches:[]},productImageMatch:{status:'unavailable',matches:[]},imageEvidence:{complete:false,systemFailure:true,images:[],pageError:'HTTP 403'}}))};
 await enrichPictures(state,{limit:1,now:Date.parse('2026-10-21T01:00Z'),collector});
 await enrichPictures(state,{limit:1,now:Date.parse('2026-10-21T04:00Z'),collector});
 assert.deepEqual(seen,[['https://a.example/new'],['https://a.example/old']]);assert.equal(state.rows[0].imageEvidence.complete,false);
});
