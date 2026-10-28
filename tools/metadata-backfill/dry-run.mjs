import {readFile} from 'node:fs/promises';
import {planBatch,hash} from './contract.mjs';
const args=process.argv.slice(2);
if(args.length<2||args.length>3||args.some(x=>x.startsWith('--')))throw Error('Usage: node tools/metadata-backfill/dry-run.mjs snapshot.json candidates.json [previous-plan.json]; offline dry-run only');
const snapshot=JSON.parse(await readFile(args[0],'utf8')), candidates=JSON.parse(await readFile(args[1],'utf8'));
const previous=args[2]?JSON.parse(await readFile(args[2],'utf8')):null;
if(previous&&(previous.snapshot_hash!==hash(snapshot)||previous.candidate_hash!==hash(candidates)))throw Error('resume-input-changed');
console.log(JSON.stringify(planBatch(snapshot,candidates,{cursor:previous?.next_cursor??0,paused:previous?.paused??false}),null,2));
