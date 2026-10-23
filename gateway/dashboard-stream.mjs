// Validate the original authenticated JSON without materializing its histories.
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import streamJson from 'stream-json';
const {parser}=streamJson;
export async function validateDashboardCompressed(compressed,{maxBytes=2*1024**3,maxMilliseconds=45000}={}){
 const started=Date.now(),source=Readable.from([compressed]),inflate=createGunzip(),tokens=parser({packKeys:true,streamKeys:false,packStrings:false,streamStrings:true,packNumbers:false,streamNumbers:true});
 let plainBytes=0,count=0,rootObject=false,ready=false,stateObject=false,rows=false,monitor=false;const stack=[];
 inflate.on('data',chunk=>{plainBytes+=chunk.length;if(plainBytes>maxBytes)inflate.destroy(Error('云端台账超出安全读取上限，原数据保留'))});
 const pumping=pipeline(source,inflate,tokens,{signal:AbortSignal.timeout(maxMilliseconds)});pumping.catch(()=>{});
 function path(){const parent=stack.at(-1);return !parent?'':parent.path===''?parent.key:parent.path==='state'?'state.'+parent.key:null}
 function mark(at,name){if(at==='')rootObject=name==='startObject';if(at==='ready')ready=name==='trueValue';if(at==='state'){stateObject=name==='startObject';rows=false;monitor=false}if(at==='state.rows')rows=name==='startArray';if(at==='state.monitor')monitor=name==='startObject'}
 try{
  for await(const token of tokens){if(++count%1024===0&&Date.now()-started>maxMilliseconds)throw Error('云端台账流式验证超时，原数据保留');
   const name=token.name;
   if(name==='keyValue'){if(stack.length<=2)stack.at(-1).key=token.value;continue}
   if(name==='startObject'||name==='startArray'){const at=path();mark(at,name);if(stack.length>=1024)throw Error('云端台账嵌套超出安全读取范围');stack.push({path:at,key:null});continue}
   if(name==='endObject'||name==='endArray'){stack.pop();continue}
   if(['startString','startNumber','trueValue','falseValue','nullValue'].includes(name))mark(path(),name);
  }
  await pumping;if(!rootObject||!ready||!stateObject||!rows||!monitor)throw Error('云端台账尚未准备完成或结构不完整');
  return {plainBytes};
 }catch(error){source.destroy();inflate.destroy();tokens.destroy();await pumping.catch(()=>{});throw error}
}
