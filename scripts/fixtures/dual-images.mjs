import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
export const trademarks=JSON.parse(fs.readFileSync(new URL('assets/trademark-image-references.json',root)));
export const products=JSON.parse(fs.readFileSync(new URL('assets/official-product-images.json',root)));
export const trademark=trademarks.references.find(r=>r.referenceFile==='image10.jpeg'),product=products.references[0];
export function exactMatch(category,ref,url,at='2026-10-20T02:00:00.000Z'){
 return {category,pixelEncoding:'rgba-exif-v1',algorithmVersion:'dual-images-2.1',at,method:'sha256',exact:true,similarity:100,referenceId:ref.id,referenceFile:ref.file,referencePreviewFile:ref.previewFile||'',referenceUrl:ref.imageUrl||'',sourcePage:ref.sourcePage||'',brand:ref.brand,brandIds:ref.brandIds||[],productName:ref.productName||'',candidateUrl:url,candidateSha256:ref.sha256,referenceSha256:ref.sha256,candidatePixelSha256:ref.pixelSha256,referencePixelSha256:ref.pixelSha256,candidateWidth:ref.width,candidateHeight:ref.height,referenceWidth:ref.width,referenceHeight:ref.height};
}
export function result(...matches){return {version:2,algorithmVersion:'dual-images-2.1',at:'2026-10-20T02:00:00.000Z',status:'confirmed',checkedImages:matches.length,referenceCount:1,matches};}
export function dualImageRows(){
 const a=exactMatch('trademark',trademark,'https://dual-image-check.example/logo.jpg'),b=exactMatch('product',product,'https://dual-image-check.example/product.png'),base={platform:'dealer',country:'GB',status:'pending',note:'旧处理备注保留',imageMatch:'different',firstSeen:'2026-10-19T02:00:00Z',lastSeen:'2026-10-20T02:00:00Z',title:'FJDynamics image evidence'};
 const thumb=(ref,url)=>({url,sha256:ref.sha256,width:ref.width,height:ref.height,capturedAt:a.at,thumbnail:'data:image/'+(ref.previewFile?'jpeg':'jpeg')+';base64,'+fs.readFileSync(new URL(ref.previewFile||ref.file,root)).toString('base64')});
 return [
  {...base,id:'logo-only',url:'https://image-fixture.example/logo',title:'FJDynamics · only trademark',trademarkImageMatch:result(a)},
  {...base,id:'product-only',url:'https://image-fixture.example/product',title:'FJDynamics · only official material',productImageMatch:result(b)},
  {...base,id:'both-images',url:'https://image-fixture.example/both',title:'FJDynamics · two actual images',trademarkImageMatch:result(a),productImageMatch:result(b),imageEvidence:{version:2,at:a.at,images:[thumb(trademark,a.candidateUrl),thumb(product,b.candidateUrl)]}},
  {...base,id:'same-image',url:'https://image-fixture.example/same',title:'FJDynamics · both independent references',trademarkImageMatch:result(exactMatch('trademark',{...product,id:'fixture-custom-product-logo'},b.candidateUrl)),productImageMatch:result(b)},
  {...base,id:'legacy-shape',url:'https://image-fixture.example/legacy',title:'FJDynamics · contour is not confirmation',imageAnalysis:{method:'background-normalized-shape-32',status:'matched',match:{score:100,referenceFile:'image10.jpeg'}}},
  {...base,id:'suspected-only',url:'https://image-fixture.example/suspected',title:'FJDynamics · perceptual hash is not exact',productImageMatch:result({...b,method:'phash-candidate-only',exact:false,suspected:true,similarity:100})},
  {...base,id:'pending-image',url:'https://image-fixture.example/pending',title:'FJDynamics · images pending',productImageMatch:{status:'pending',at:a.at,matches:[]},trademarkImageMatch:{status:'unavailable',error:'HTTP 403',at:a.at,matches:[]}}
 ];
}
