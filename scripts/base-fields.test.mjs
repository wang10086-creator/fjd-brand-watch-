import test from 'node:test';
import assert from 'node:assert/strict';
import {baseFields} from '../cloud/base-fields.mjs';
const base={url:'https://example.com/item',platform:'amazon',title:'Listing',country:'SG'};
test('unknown facts remain explicit and do not inherit the search market or invent removal',()=>{
 const p=baseFields({...base,pageState:'unknown',verification:'page-fetched'});
 assert.equal(p.country_region,'待核实');assert.match(p.operator_name,/待核实/);assert.match(p.product_model,/待核实/);
 assert.equal(Object.hasOwn(p,'page_status'),false);assert.equal(p.processing_status,'待核查');assert.equal(p.remarks,'');assert.equal(p.display_image_url,'');
 assert.equal(baseFields({...base,pageState:'blocked'}).page_status,'无法访问');
 assert.equal(baseFields({...base,pageState:'removed'}).page_status,'已下架');
});
test('common platform names and social search classification reflect the source page',()=>{
 const p=baseFields({...base,url:'https://www.douyin.com/search/brand',platform:'douyin-cn'});
 assert.equal(p.source_platform,'抖音');assert.equal(p.monitor_category,'社交媒体');assert.match(p.country_region,/中国/);
 assert.equal(baseFields({...base,url:'https://www.douyin.com/product/123',platform:'douyin-cn'}).monitor_category,'电商平台');
});
test('source evidence enriches fields without treating a brand as the operator',()=>{
 const p=baseFields({...base,url:'https://www.mercadolibre.com.ar/robot/up/MLAU123',platform:'mercado',title:'Robot Corta Césped Fjd Fv2000 Rtk'});
 assert.equal(p.country_region,'阿根廷');assert.equal(p.product_model,'FJD FV2000 RTK');assert.match(p.operator_name,/待核实/);
 assert.match(baseFields({...base,title:'Bäuerlein Landtechnik GmbH in Buch am Wald - technikboerse.com'}).operator_name,/Bäuerlein Landtechnik GmbH/);
 assert.equal(baseFields({...base,url:'https://example.co.uk/item'}).country_region,'英国');
 assert.equal(baseFields({...base,url:'https://example.io/item'}).country_region,'待核实');
});
test('monitoring priority uses the effective manual priority and reclassifies legacy pending without a fourth current tier',()=>{
 assert.equal(baseFields({...base,priorityV2:{auto:{level:'high'},manual:{level:'low'}}}).monitor_level,'低');
 assert.equal(baseFields({...base,priorityV2:{auto:{level:'pending'}}}).monitor_level,'低');
});
test('display candidates exclude navigation logos and unsafe URLs; deep link uses canonical source identity',()=>{
 const p=baseFields({...base,imageEvidence:{images:[{url:'https://cdn.test/frontend-assets/ui-navigation/logo.png'},{url:'https://cdn.test/product.jpg'}]}});
 assert.equal(p.display_image_url,'https://cdn.test/product.jpg');assert.match(p.platform_lead_url,/#inbox\?lead=https%3A%2F%2Fexample.com%2Fitem/);
 assert.equal(baseFields({...base,imageUrl:'https://user:secret@cdn.test/product.jpg'}).display_image_url,'');
 assert.throws(()=>baseFields({...base,url:'https://user:secret@example.com/item'}),/网址无效/);
});
