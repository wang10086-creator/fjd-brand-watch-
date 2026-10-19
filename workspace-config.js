import {normalizeConfig,normalizeSchedule} from './model.js?v=20261019-links';

// null in early cloud records meant "not configured", not an empty selection.
// Explicit empty arrays still mean that the user cleared the selection.
export function normalizeWorkspaceConfig(state,fallback={}){
 state.config=normalizeConfig(state.config||fallback.config);
 state.schedule=normalizeSchedule(state.schedule||fallback.schedule);
 const defaults={selectedBrandIds:null,customAliases:state.config.aliases,assetIds:['fjdynamics-shield','fjdynamics-wordmark'],customAssets:[],completed:[]};
 for(const [field,value] of Object.entries(defaults))if(!Array.isArray(state[field]))state[field]=structuredClone(Array.isArray(fallback[field])?fallback[field]:value);
 return state;
}
