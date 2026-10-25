// One-image consent, not a general screenshot publishing switch. No environment override.
import {hash} from './store.mjs';
export const approvedScreenshot=Object.freeze({
 sha256:'d6f8dd6a230e2e00d8e8f68e6b8c360ebfe123785888ae6b7649e74821b2a3c3',bytes:176760,
 capturedAt:'2026-10-24T05:15:00.704666+00:00',
 sourceId:'lead-3165324fb08d966d1fc9a655bf65aa80589940c2833ab0eec4a3781927ac3370',
 originalUrl:'https://item.rakuten.co.jp/iwasa472000/c/0000000491?l2-id=item_sp_medama_category_3'
});
const denied=()=>Object.assign(Error('单图分享未授权或已撤销'),{status:404});
const conflict=()=>Object.assign(Error('分享已撤销或原授权版本不一致；不能自动重新授权'),{status:409});
export function screenshotShare(store,{spec=approvedScreenshot,now=Date.now}={}){
 const current=()=>store.read().screenshotShares?.[spec.sha256];
 const bound=r=>r?.sha256===spec.sha256&&r.bytes===spec.bytes&&r.capturedAt===spec.capturedAt&&r.sourceId===spec.sourceId;
 function check(bytes,manifest){
  // Compare full precision capture time, not Date.parse (which discards microseconds).
  if(hash(bytes)!==spec.sha256||bytes.length!==spec.bytes||manifest?.sha256!==spec.sha256||
    manifest.bytes!==spec.bytes||manifest.at!==spec.capturedAt||manifest.originalUrl!==spec.originalUrl)throw denied();
 }
 function assert(sha,token){
  if(sha!==spec.sha256)return; // Preserve unrelated existing evidence; grants below cannot authorize it.
  const r=current();if(!bound(r)||r.status!=='active'||r.tokenHash!==hash(token))throw denied();
 }
 return {
  spec,check,assert,
  // A manual-upload route must never become a bypass for this automatic capture.
  assertManual(sha){if(sha===spec.sha256)throw denied()},
  status(){const r=current();return {sha256:spec.sha256,bytes:spec.bytes,capturedAt:spec.capturedAt,sourceId:spec.sourceId,status:bound(r)?r.status:'unapproved',...(r?.revokedAt?{revokedAt:r.revokedAt}:{})}},
  async authorize(bytes,manifest,token,actor){
   check(bytes,manifest);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw denied();
   await store.mutate(s=>{s.screenshotShares||={};const old=s.screenshotShares[spec.sha256];
    if(old&&(!bound(old)||old.status!=='active'||old.tokenHash!==hash(token)))throw conflict();
    if(!old)s.screenshotShares[spec.sha256]={...spec,status:'active',tokenHash:hash(token),authorizedBy:actor,authorizedAt:new Date(now()).toISOString()};
   });
   assert(spec.sha256,token);return this.status();
  },
  async revoke(actor){await store.mutate(s=>{s.screenshotShares||={};const old=s.screenshotShares[spec.sha256];
   // Durable tombstone even when no grant exists yet. Never delete the encrypted PNG.
   if(old?.status!=='revoked')s.screenshotShares[spec.sha256]={...old,...spec,status:'revoked',revokedBy:actor,revokedAt:new Date(now()).toISOString()};
  });return this.status()}
 };
}
