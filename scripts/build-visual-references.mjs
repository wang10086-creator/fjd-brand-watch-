import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {shapeSignature} from '../visual-match.js';
const images=JSON.parse(execFileSync('python3',['cloud/picture-source.py','--references'],{maxBuffer:60*1024*1024}));
const refs=images.map(({rgba,...r})=>({...r,signature:shapeSignature({...r,data:Buffer.from(rgba,'base64')})})).filter(r=>r.signature).map(({width,height,...r})=>r);
writeFileSync('assets/visual-references.json',JSON.stringify({version:1,method:'background-normalized-shape-32',references:refs})+'\n');console.log('Prepared reference signatures:',refs.length);
