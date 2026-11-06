import {createOpenJarvis} from '../openjarvis.mjs';
import {ProviderControl} from '../provider-control.mjs';
import {DurableState} from '../durable-state.mjs';
import {pathToFileURL} from 'node:url';
export async function probeOpenJarvis({env=process.env,live=false,fetcher=fetch}={}){
 const store=new DurableState({initial:{},write:async()=>{}});await store.initialize();
 const control=new ProviderControl({state:store.state,save:()=>store.save(),transact:(...a)=>store.transact(...a),env:{JARVIS_API_CALLS_PER_DAY:'1'}});
 const integration=createOpenJarvis({env,control,fetcher});
 const report={at:new Date().toISOString(),live,enabled:integration.status().enabled,status:'not_run',
  scope:'One public web_search via configured local /tools/invoke; no Jarvis data, other tools, scheduler or Discord bot.'};
 if(!live)return report;
 if(!integration.status().enabled)throw new Error('OpenJarvis er ikke konfigureret til kontraktprøven.');
 try{const result=await integration.search('OpenClaw official documentation');return {...report,status:result.sources.length?'accepted':'incomplete',sourceCount:result.sources.length,requestCount:control.snapshot().calls};}
 catch{return {...report,status:'failed',requestCount:control.snapshot().calls};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await probeOpenJarvis({live:process.argv.includes('--live')});console.log(JSON.stringify(result,null,2));if(['failed','incomplete'].includes(result.status))process.exitCode=1;}
 catch{console.error('Kontraktprøven mangler lokal OpenJarvis-konfiguration eller adgang. Ingen credentials udskrives.');process.exitCode=1;}
}
