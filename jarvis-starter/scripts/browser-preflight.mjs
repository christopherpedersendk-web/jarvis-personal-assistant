// Synthetic CI-only diagnostic. No website, app settings or credentials enter it.
import {spawnSync} from 'node:child_process';
import {browserContainerArgs} from '../isolated-browser.mjs';
const args=browserContainerArgs(process.env.JARVIS_BROWSER_IMAGE,'jarvis-browser-preflight');
args.splice(args.length-1,0,'--entrypoint=node');
const script="import('playwright').then(async({chromium})=>{try{const b=await chromium.launch({headless:true,chromiumSandbox:true});await b.close();}catch(e){console.error(e.message);process.exitCode=1}})";
const r=spawnSync('docker',[...args,'-e',script],{encoding:'utf8',timeout:20000,maxBuffer:16000});
console.log(r.stdout||'');console.error(r.stderr||'');
spawnSync('docker',['rm','-f','jarvis-browser-preflight'],{timeout:5000,stdio:'ignore'});
if(r.status!==0)process.exitCode=1;
