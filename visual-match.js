// Background/colour-normalized shape evidence. This is not legal or semantic recognition.
export function shapeSignature({data,width,height}){
 if(!data||width<3||height<3)return null;
 const channel=(i,c)=>data[i+c]*(data[i+3]/255)+255*(1-data[i+3]/255);
 const corners=[[0,0],[width-1,0],[0,height-1],[width-1,height-1]],bg=[0,1,2].map(c=>corners.map(([x,y])=>channel((y*width+x)*4,c)).sort((a,b)=>a-b).slice(1,3).reduce((a,b)=>a+b,0)/2),mask=new Uint8Array(width*height);
 let contrast=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>=40)contrast=Math.max(contrast,...bg.map((v,c)=>Math.abs(channel(i,c)-v)));const threshold=Math.max(8,Math.min(48,contrast*.35));
 let x0=width,y0=height,x1=0,y1=0,count=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i+3]<40)continue;const delta=Math.max(...bg.map((v,c)=>Math.abs(channel(i,c)-v)));if(delta>threshold){mask[y*width+x]=1;count++;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}}
 if(count<8||count/(width*height)>.94)return null;
 const w=x1-x0+1,h=y1-y0+1,scale=28/Math.max(w,h),ox=(32-w*scale)/2,oy=(32-h*scale)/2;let bits='',ink=0;
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const sx=Math.floor((x-ox)/scale)+x0,sy=Math.floor((y-oy)/scale)+y0,on=x>=ox&&y>=oy&&sx>=x0&&sy>=y0&&sx<=x1&&sy<=y1&&mask[sy*width+sx]===1;bits+=on?'1':'0';if(on)ink++;}
 return ink<8?null:{bits,aspect:w/h,ink};
}
export function shapeSimilarity(a,b){if(!a||!b||a.bits.length!==1024||b.bits.length!==1024)return 0;if(Math.min(a.aspect,b.aspect)/Math.max(a.aspect,b.aspect)<.6)return 0;let best=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){let union=0,intersection=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++){const av=a.bits[y*32+x]==='1',xx=x+dx,yy=y+dy,bv=xx>=0&&xx<32&&yy>=0&&yy<32&&b.bits[yy*32+xx]==='1';if(av||bv)union++;if(av&&bv)intersection++;}best=Math.max(best,union?intersection/union:0)}return Math.round(best*1000)/10;}
export function comparePictures(pictures,references){let best=null,compared=0;for(const p of pictures){const signature=p.signature||shapeSignature(p);if(!signature)continue;compared++;for(const ref of references){const score=shapeSimilarity(signature,ref.signature);if(!best||score>best.score)best={score,referenceFile:ref.file,brandIds:ref.brandIds||[],candidateUrl:p.url};}}return {compared,best:best&&best.score>=86?best:null};}
export const visualLabels={matched:'发现图形相似候选',compared:'已比对，未发现高相似候选',unavailable:'原页面或图片访问受限',no_images:'未取得可比对图片',pending:'待云端图形核查',no_reference:'未选择可用图样'};
