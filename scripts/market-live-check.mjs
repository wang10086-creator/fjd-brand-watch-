// Explicit, read-only acceptance. Never imports the business runner or a data store.
import {marketBatch,MARKET_BUDGET} from '../cloud/market-discovery.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const samples=[
 {platform:'jd-cn',domain:'jd.com',url:'https://item.jd.com/10230443820762.html'},
 {platform:'rakuten',domain:'rakuten.co.jp',url:'https://item.rakuten.co.jp/iwasa472000/c/0000000491?l2-id=item_sp_medama_category_3'},
 {platform:'mercado',domain:'mercadolibre.com.ar',url:'https://www.mercadolibre.com.ar/robot-corta-cesped-fjd-fv2000-rtk/up/MLAU3658676349'}
];
const limits={requests:12,durationMs:30000,details:3},batch=marketBatch({limits}),results=[];
for(const sample of samples){const {results:rows,discovery}=await batch.expand([{url:sample.url}],{...sample,aliases:['FJDynamics','FJD Trion','FJD','丰疆']});results.push({entry:sample.url,platform:sample.platform,requests:discovery.requests,observations:discovery.observations,pending:discovery.pending,details:rows.map(r=>({url:r.url,title:r.title,evidence:r.marketEvidence})),complete:discovery.complete})}
const report={version:1,codeSha:process.env.GITHUB_SHA||null,scanSha256:createHash('sha256').update(await readFile(new URL('../cloud/scan.mjs',import.meta.url))).digest('hex'),checkedAt:new Date().toISOString(),productionWrites:0,railwayRequests:0,limits:{...MARKET_BUDGET,...limits},requests:12-batch.budget.remaining,results};
await writeFile('market-live-result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
