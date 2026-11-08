// Parse both Retry-After forms without shortening a provider-requested delay.
export function retryAfterMs(value,now=Date.now()){
 if(typeof value!=='string'||!value.trim())return null;
 const text=value.trim(),delay=/^\d+(?:\.\d+)?$/.test(text)?Number(text)*1000:Date.parse(text)-now;
 return Number.isFinite(delay)?Math.max(0,delay):null;
}
