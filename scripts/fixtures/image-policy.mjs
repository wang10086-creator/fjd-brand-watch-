import {activateImagePolicy,enrollNewImages} from '../../cloud/image-policy.js';
// Pre-existing matcher unit fixtures represent already enrolled post-cutover leads.
export function enrolled(state,rows=state.rows){
 if(!state.imagePolicy){const fresh={rows:[],monitor:{}};activateImagePolicy(fresh,{at:'2026-10-01T00:00:00Z'});enrollNewImages(fresh,rows,'2026-10-02T00:00:00Z');state.imagePolicy=fresh.imagePolicy;}return state;
}
