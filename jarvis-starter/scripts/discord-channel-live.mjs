// Explicit, bounded owner-authorized REST acceptance. Never starts a gateway,
// changes production settings or deletes an existing channel. No retry on error.
import {readFile,mkdtemp,writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DiscordChannels,discordChannelReply} from '../discord-channels.mjs';
import {DiscordGateway} from '../discord-gateway.mjs';
import {DurableState} from '../durable-state.mjs';
import {ProviderControl} from '../provider-control.mjs';
if(process.argv[2]!=='--live'||!process.argv[3])throw Error('Explicit --live <private-settings-path> required.');
const config={...JSON.parse(await readFile(process.argv[3],'utf8')).discord};
if(!config.enabled||!config.token||!config.guildId||!config.userId)throw Error('Existing owner/guild/report configuration required.');
const directory=await mkdtemp(join(tmpdir(),'jarvis-discord-acceptance-'));await chmod(directory,0o700);
let initial={};
if(process.argv[4]){
 if(!/^\/tmp\/jarvis-discord-acceptance-[a-zA-Z0-9]+$/.test(process.argv[4]))throw Error('Invalid recovery directory');
 initial=JSON.parse(await readFile(join(process.argv[4],'journal.json'),'utf8'));if(typeof initial==='string')initial=JSON.parse(initial);
 if(initial.discordChannelActions?.length!==1||initial.discordChannelActions[0].action!=='opret'||initial.discordChannelActions[0].status!=='completed')throw Error('Only a confirmed creation may be resumed; unknown outcomes need manual inspection');
}
const store=new DurableState({initial,write:async snapshot=>writeFile(join(directory,'journal.json'),snapshot,{mode:0o600})});await store.initialize();
const state=store.state,save=()=>store.save(),transact=(...a)=>store.transact(...a),control=new ProviderControl({state,save,transact});
const originalReport=config.reportChannelId;
// The test has no incoming conversation. Use an existing text channel only as
// review context; do not send to it. No production report target is required.
const response=await fetch('https://discord.com/api/v10/guilds/'+config.guildId+'/channels',{headers:{Authorization:'Bot '+config.token},signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error('Cannot read review context');
const existing=await response.json(),context=existing.find(x=>x.type===0);if(!context)throw Error('No text channel context');
const meta={ownerId:config.userId,guildId:config.guildId,channelId:context.id};
const report={at:new Date().toISOString(),scope:'one new private disposable channel; production configuration unchanged',cases:[],journalDirectory:directory};
const channels=new DiscordChannels({state,save,transact,control,config:()=>config,enabled:true,selectReportChannel:async({channelId})=>{config.reportChannelId=channelId;}});
async function approve(command){await channels.command(command,meta);const r=channels.rows().at(-1);const answer=await channels.command('!kanal godkend '+r.id,meta);if(channels.rows().find(x=>x.id===r.id)?.status!=='completed')throw Error('Review not completed');return {answer,row:r};}
try{
 let create=channels.rows()[0];
 if(!create){
  await discordChannelReply(channels,'Kan du oprette en kanal på discord?',meta);
  await discordChannelReply(channels,'jarvis-acceptance-'+Date.now(),meta);
  create=channels.rows().at(-1);await channels.command('!kanal godkend '+create.id,meta);
 }
 create=channels.rows().find(x=>x.id===create.id);
 if(create.status!=='completed')throw Error('Create outcome unconfirmed');
 const id=create.result.id,name=create.target.name;
 if(!/^jarvis-acceptance-\d+$/.test(name))throw Error('Not a disposable test channel');
 const actual=await channels.api('/channels/'+id,'GET',config,control.current());
 if(actual.name!==name||actual.guild_id!==config.guildId)throw Error('Recovered channel mismatch');
 report.testChannelId=id;report.cases.push('name continuation + reviewed private creation (confirmed by readback)');
 await approve('!kanal omdøb '+id+' '+name+'-ok');report.cases.push('reviewed rename');
 await approve('!kanal rapport '+id);report.cases.push('private report choice in isolated configuration only');
 const gateway=new DiscordGateway({onMessage:async()=>''});gateway.config={...config};
 const delivery=await gateway.sendReply(id,'Afgrænset JARVIS-acceptprøve.\n| Vare | Pris | Link |\n|---|---|---|\n| Testkabel | 57,00 kr. | https://www.proshop.dk/ |',gateway.generation);
 if(!delivery.complete)throw Error('Delivery unconfirmed');report.cases.push('actual REST message delivery of mobile formatted table');
 const fetched=await channels.api('/channels/'+id+'/messages?limit=1','GET',config,control.current());
 if(!Array.isArray(fetched)||!fetched[0]?.content.includes('Pris: 57,00 kr.')||fetched[0].content.includes('|---'))throw Error('Message readback failed');
 report.cases.push('actual message readback preserves price/link');
 config.reportChannelId=originalReport;
 await approve('!kanal slet '+id);report.cases.push('reviewed deletion of only newly created test channel');
 const list=await channels.api('/guilds/'+config.guildId+'/channels','GET',config,control.current());
 if(list.some(c=>c.id===id))throw Error('Deleted channel still present');report.cases.push('deletion readback');report.status='passed';
}catch{report.status='failed_or_unknown';report.notice='No automatic retry. Inspect private journal and Discord before another run.';process.exitCode=1;}
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
