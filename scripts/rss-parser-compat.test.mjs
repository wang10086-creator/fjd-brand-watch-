import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRss} from '../cloud/search.mjs';
import {inTarget} from '../search-links.js';
const feed=items=>'<rss version="2.0"><channel><title>Search</title>'+items+'</channel></rss>';
const item=(attrs='',url='https://shop.example/p')=>'<item'+attrs+'><title>FJDynamics &amp; Co</title><link>'+url+'</link><description>Product</description></item>';
test('attributed RSS items retain their results, including quoted angle brackets',()=>{
 for(const attrs of [' xml:lang="en"'," data-kind='search'",' xml:lang="en" data-note="a > b"','\n xml:lang = "en"']){
  const results=parseRss(feed(item(attrs)));assert.equal(results.length,1);assert.equal(results[0].url,'https://shop.example/p');assert.equal(results[0].title,'FJDynamics & Co');
 }
});
test('multiple ordinary and attributed items are not silently omitted',()=>{assert.equal(parseRss(feed(item()+item(' xml:lang="en"','https://shop.example/q'))).length,2)});
test('genuine empty feeds remain empty and comment/CDATA item text is not parsed',()=>{
 for(const body of ['', '<!-- <item><link>https://outside.example</link></item> -->','<description><![CDATA[Example <item> markup]]></description>'])assert.deepEqual(parseRss('<?xml version="1.0"?>'+feed(body)),[]);
});
test('truncated, mismatched and malformed item structures never become zero',()=>{
 for(const xml of [
  '<rss><channel>',feed('<item'),feed('<item><link>https://shop.example/p</link>'),
  feed('<item bogus><link>https://shop.example/p</link></item>'),
  feed('<item xml:lang="en><link>https://shop.example/p</link></item>'),
  feed('<item><title>x</link></item>'),feed('<item><item></item></item>'),
  feed('<x:item xmlns:x="urn:unknown"><link>https://shop.example/p</link></x:item>'),
  feed('<wrapper>'+item()+'</wrapper>'),feed(item()).replace('</channel>',''),
  feed('')+feed(''),'<rss><item><link>https://shop.example/p</link></item></rss>',
  '<rss><channel/><channel/></rss>',feed('<![CDATA[unfinished'),
  '<!DOCTYPE rss [<!ENTITY external SYSTEM "https://outside.example">]>'+feed('')
 ])assert.throws(()=>parseRss(xml),/RSS/);
});
test('unusable item links remain scope-unverified rather than an empty success',()=>{
 for(const body of ['<item/>','<item xml:lang="en"/>','<item><title>no link</title></item>',item('','javascript:alert(1)'),item('','https://user:pass@shop.example/p')])assert.throws(()=>parseRss(feed(body)),e=>e.code==='scope-unverified');
});
test('documented wrappers and CDATA links retain strict target validation',()=>{
 const wrap=url=>'https://www.bing.com/ck/a?u=a1'+Buffer.from(url).toString('base64url');
 const results=parseRss(feed(item(' xml:lang="en"',wrap('https://shop.example/p'))));assert.equal(inTarget(results[0].url,'shop.example'),true);
 assert.equal(parseRss(feed(item('','<![CDATA[https://shop.example/p?a=1&b=2]]>')))[0].url,'https://shop.example/p?a=1&b=2');
 for(const url of [wrap(wrap('https://shop.example/p')),'https://www.bing.com/unknown?u=https://shop.example'])assert.throws(()=>parseRss(feed(item(' xml:lang="en"',url))),e=>e.code==='scope-unverified');
 const outside=parseRss(feed(item(' xml:lang="en"','https://shop.example.evil.test/p')));assert.equal(inTarget(outside[0].url,'shop.example'),false);
});
test('malformed remainder cannot hide behind one otherwise valid result',()=>{assert.throws(()=>parseRss(feed(item()+'<item broken>')),/RSS/)});
test('fake links in comments, nested elements and description CDATA never become target results',()=>{
 const fake='<link>https://shop.example/fake</link>';
 for(const disguise of ['<!--'+fake+'-->','<description><![CDATA['+fake+']]></description>','<extension>'+fake+'</extension>','<description>'+fake+'</description>','<![CDATA['+fake+']]>']){
  assert.throws(()=>parseRss(feed('<item>'+disguise+'</item>')),e=>e.code==='scope-unverified');
  const results=parseRss(feed('<item>'+disguise+'<link>https://outside.example/real</link></item>'));
  assert.equal(results[0].url,'https://outside.example/real');assert.equal(inTarget(results[0].url,'shop.example'),false);
 }
});
test('real direct link CDATA works without entity double-decoding or comment contamination',()=>{
 const results=parseRss(feed('<item><!--<link>https://outside.example/fake</link>--><link><![CDATA[https://shop.example/real?a=1&amp;b=2]]></link><title><![CDATA[FJD &amp; literal]]></title></item>'));
 assert.equal(results[0].url,'https://shop.example/real?a=1&amp;b=2');assert.equal(results[0].title,'FJD &amp; literal');
 assert.equal(parseRss(feed('<item><link>https://shop.example/<!-- ignored -->real?a=1&amp;b=2</link></item>'))[0].url,'https://shop.example/real?a=1&b=2');
});
test('duplicate direct links and nested markup inside a real link fail closed',()=>{
 for(const body of ['<link>https://shop.example/a</link><link>https://outside.example/b</link>','<link><extension>https://shop.example/a</extension></link>'])assert.throws(()=>parseRss(feed('<item>'+body+'</item>')),/RSS/);
});
