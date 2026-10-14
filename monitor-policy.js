import {marketData,platforms} from './model.js?v=20261014-compact';
export const scopeVersion='20261014-global';
export function upgradeGlobalScope(state){
 if(state.monitorScopeVersion===scopeVersion)return false;
 state.config={...state.config,regions:[...new Set([...(state.config?.regions||[]),...Object.keys(marketData)])],platforms:[...new Set([...(state.config?.platforms||[]),...platforms.map(p=>p.id)])]};
 state.monitorScopeVersion=scopeVersion;state.cloudMode=true;state.schedule={...state.schedule,enabled:true,hour:9,timezone:'Asia/Shanghai'};state.cursor=0;state.completed=[];state.siteCursors={};return true;
}
export function nextDailyTime(hour,now=new Date()){
 const local=new Date(+now+8*3600000),date=local.toISOString().slice(0,10);let at=Date.parse(date+'T'+String(Math.floor(hour)).padStart(2,'0')+':'+String(Math.round((hour%1)*60)).padStart(2,'0')+':00+08:00');if(at<=+now)at+=86400000;return new Date(at).toISOString();
}
