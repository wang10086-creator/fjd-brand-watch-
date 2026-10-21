export async function requestPagesBuild(store){
 const page=await store.request('/pages');
 try{if(page.build_type==='workflow')await store.request('/actions/workflows/fjd-pages.yml/dispatches','POST',{ref:'main'});else await store.request('/pages/builds','POST',{});}catch(e){if(![409,429].includes(e.status))throw e}
}
