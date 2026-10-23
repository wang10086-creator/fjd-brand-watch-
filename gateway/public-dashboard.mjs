// Wrap the already-public feed for the browser without exposing the private vault.
import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createGunzip,createGzip} from 'node:zlib';
import {validateDashboardCompressed} from './dashboard-stream.mjs';
export async function publicDashboardBytes(feed,status={}){
 const {revision}=await validateDashboardCompressed(feed,{publicFeed:true});
 const meta={revision,updatedAt:status.updatedAt||null,runtime:status.runtime||{},automation:status.automation||{},...(status.automation?.archive?{notionConfigured:!!status.automation.archive.configured,notionCheckedAt:status.automation.archive.checkedAt||null}:{}),botConfigured:!!status.automation?.bot?.configured};
 async function* document(){yield '{"ready":true,"publicOnly":true,"state":';const inflate=createGunzip();inflate.end(feed);for await(const chunk of inflate)yield chunk;yield ','+JSON.stringify(meta).slice(1)}
 const gzip=createGzip(),done=pipeline(Readable.from(document()),gzip);done.catch(()=>{});const chunks=[];try{for await(const chunk of gzip)chunks.push(chunk);await done;return Buffer.concat(chunks)}catch(error){await done.catch(()=>{});throw error}
}
