import {canonical} from '../model.js';

const ACTIVE_WORKFLOW_STAGES=new Set(['initial_review','ip_review','investigating','reopened','pending']);
const IRRELEVANT_DEDUP_FIELDS=[
 'id','url','platform','country','language','query','searchUrl','source','verification',
 'firstSeen','lastSeen','checkedAt','status','reviewOutcome','reviewedAt','decision',
 'confirmedIssue','needsRecheck','pageKind','pageState','publicOnly'
];

// Classify a lead as irrelevant ONLY from explicit human/workflow exclusion decisions.
// Never infer irrelevance or trademark ownership from language, country, or source failures.
export function isIrrelevantLead(row){
 if(!row||typeof row!=='object')return false;
 if(row.confirmedIssue===true||row.watch===true)return false;
 const stage=row.reviewWorkflow?.currentStage;
 if(stage&&ACTIVE_WORKFLOW_STAGES.has(stage))return false;
 if(row.reviewOutcome==='irrelevant')return true;
 if(stage==='excluded'&&row.reviewWorkflow?.exclusion?.reason==='irrelevant')return true;
 return false;
}

function compactWorkflow(workflow){
 if(!workflow||typeof workflow!=='object')return undefined;
 const out={};
 for(const key of ['version','currentStage','stageUpdatedAt','round','exclusion','closure','history']){
  if(workflow[key]===undefined)continue;
  if(key==='history'&&Array.isArray(workflow[key])){
   out.history=workflow[key].map(entry=>{
    if(!entry||typeof entry!=='object')return entry;
    const slim={};
    for(const k of ['id','round','from','to','stage','at','reason','outcome','decision','source'])if(entry[k]!==undefined)slim[k]=structuredClone(entry[k]);
    return slim;
   });
  }else out[key]=structuredClone(workflow[key]);
 }
 return out;
}

function compactUrlStatus(urlCheck){
 if(!urlCheck?.current)return undefined;
 const cur={};
 for(const k of ['status','at','httpStatus','source','targetPresent'])if(urlCheck.current[k]!==undefined)cur[k]=urlCheck.current[k];
 return Object.keys(cur).length?{current:cur}:undefined;
}

// Relevant leads retain complete evidence. Irrelevant leads retain only stable key,
// dedup, review traceability, and minimal status fields.
export function compactLeadForStorage(row){
 if(!row||typeof row!=='object')return row;
 if(!isIrrelevantLead(row))return structuredClone(row);
 const out={};
 for(const key of IRRELEVANT_DEDUP_FIELDS)if(row[key]!==undefined)out[key]=structuredClone(row[key]);
 if(typeof row.title==='string')out.title=row.title.slice(0,240);
 if(typeof row.url==='string')out.canonicalKey=canonical(row.url);
 const wf=compactWorkflow(row.reviewWorkflow);
 if(wf)out.reviewWorkflow=wf;
 const uc=compactUrlStatus(row.urlCheck);
 if(uc)out.urlCheck=uc;
 out.evidenceCompacted=true;
 return out;
}

export function compactRowsForStorage(rows){
 if(!Array.isArray(rows))return [];
 return rows.map(compactLeadForStorage);
}

// Strip duplicated large alias/termRules arrays from per-item run plans while keeping
// query identity, target scope, outcome, and traceability intact.
export function compactRunItem(item){
 if(!item||typeof item!=='object')return item;
 const out={};
 for(const [k,v]of Object.entries(item)){
  if(k==='plan'&&v&&typeof v==='object'){
   const slimPlan={};
   for(const pk of ['id','platform','domain','country','language','query','searchUrl','watchUrl','keywordCombination','keywordCombinationCount'])if(v[pk]!==undefined)slimPlan[pk]=v[pk];
   out.plan=slimPlan;
  }else out[k]=structuredClone(v);
 }
 return out;
}

export function compactRunRecord(run){
 if(!run||typeof run!=='object')return run;
 const out=structuredClone(run);
 if(Array.isArray(out.items))out.items=out.items.map(compactRunItem);
 return out;
}
