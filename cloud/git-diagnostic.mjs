// Output labels only. Never return raw Git stderr, URLs, credentials or payloads.
export function gitDiagnostic(text,{stage,exitCode}={}){
 const http=text.match(/(?:requested URL returned error:\s*|HTTP\/[\d.]+\s+)([45]\d\d)\b/i);
 const httpStatus=http?Number(http[1]):null;
 let reason='unknown';
 if(/GH006|GH013|protected branch|repository rule violations/i.test(text))reason='protection';
 else if(/non-fast-forward|fetch first|stale info/i.test(text))reason='conflict';
 else if(/rate limit|too many requests|secondary rate|abuse detection/i.test(text)||httpStatus===429)reason='rate-limit';
 else if(/permission denied \(publickey\)|authentication failed|could not read Username|invalid username or (?:password|token)|bad credentials/i.test(text)||httpStatus===401)reason='authentication';
 else if(/permission to .{0,300} denied|write access .{0,100}not granted|not allowed to push|access denied/i.test(text))reason='permission';
 else if(httpStatus)reason='http';
 const rejected=['protection','conflict','authentication','permission'].includes(reason)||httpStatus!==null&&httpStatus<500;
 return {stage:'git-'+stage,reason,httpStatus,status:httpStatus??(reason==='conflict'?409:0),exitCode:Number.isInteger(exitCode)?exitCode:null,confirmation:rejected?'rejected':'unconfirmed',refUpdate:stage==='push'?(rejected?'rejected':'unconfirmed'):'not-attempted'};
}
