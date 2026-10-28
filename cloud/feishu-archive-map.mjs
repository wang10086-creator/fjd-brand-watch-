// Authenticated archive-executor receipts only. Never reads Feishu credentials.
export const MAP_PATH='assets/feishu-daily-archives.json';
export const SOURCE_TABLE='tblUcSezDdVSfWsa';
const keys=['archive_status','document_url','report_day'];
function row(value){
 if(!value||Object.keys(value).sort().join()!==keys.join())throw Error('Unexpected public mapping fields');
 const {report_day,document_url,archive_status}=value;
 if(typeof report_day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(report_day)||!Number.isFinite(Date.parse(report_day+'T00:00:00Z'))||new Date(report_day+'T00:00:00Z').toISOString().slice(0,10)!==report_day)throw Error('Invalid report day');
 if(archive_status!=='archived'||typeof document_url!=='string'||!/^https:\/\/fjdynamics\.feishu\.cn\/docx\/[A-Za-z0-9]+$/.test(document_url))throw Error('Not a successful Feishu archive');
 return {report_day,document_url,archive_status};
}
export function mergeArchiveReceipt(existing,receipt){
 if(!receipt||Object.keys(receipt).sort().join()!==['record','report_day','source_record_id','source_table_id'].join()||receipt.source_table_id!==SOURCE_TABLE||!/^rec[A-Za-z0-9]+$/.test(receipt.source_record_id||''))throw Error('Invalid archive receipt source');
 const next=row(receipt.record);
 if(next.report_day!==receipt.report_day)throw Error('Receipt/report date mismatch');
 if(!Array.isArray(existing))throw Error('Invalid existing map');
 const days=new Map();
 for(const item of existing){const r=row(item);if(days.has(r.report_day))throw Error('Duplicate existing date');days.set(r.report_day,r);}
 const previous=days.get(next.report_day);
 if(previous&&previous.document_url!==next.document_url)throw Error('Conflicting archived document; preserve existing mapping');
 if(previous)return {changed:false,rows:existing};
 days.set(next.report_day,next);
 return {changed:true,rows:[...days.values()].sort((a,b)=>a.report_day.localeCompare(b.report_day))};
}
export async function publishArchiveReceipt({github,owner,repo,receipt}){
 const target={owner,repo,path:MAP_PATH};
 const {data:current}=await github.rest.repos.getContent({...target,ref:'main'});
 if(current.type!=='file'||current.encoding!=='base64')throw Error('Existing mapping unavailable');
 const result=mergeArchiveReceipt(JSON.parse(Buffer.from(current.content,'base64').toString('utf8')),receipt);
 if(!result.changed)return {status:'unchanged',report_day:receipt.report_day};
 const bytes=Buffer.from(JSON.stringify(result.rows,null,2)+'\n');
 // Contents SHA is a compare-and-swap: conflicts stop, never force or blind retry.
 const {data:saved}=await github.rest.repos.createOrUpdateFileContents({...target,branch:'main',sha:current.sha,message:'Publish confirmed Feishu archive link '+receipt.report_day,content:bytes.toString('base64')});
 const {data:readback}=await github.rest.repos.getContent({...target,ref:saved.commit.sha});
 if(readback.encoding!=='base64'||!Buffer.from(readback.content,'base64').equals(bytes))throw Error('Committed map readback unconfirmed');
 return {status:'committed',report_day:receipt.report_day,commit:saved.commit.sha};
}
