// Forward browser policy headers only for the scoped isolated renderer.
export function browserResponseHeaders(headers,preserve=false){
 const names=['content-type','location','x-robots-tag'];
 if(preserve===true)names.push('content-security-policy','content-security-policy-report-only','referrer-policy','permissions-policy','access-control-allow-origin','access-control-allow-credentials','cross-origin-resource-policy','cross-origin-opener-policy','cross-origin-embedder-policy','x-content-type-options','x-frame-options');
 return Object.fromEntries(Object.entries(headers).filter(([key])=>names.includes(key)));
}
