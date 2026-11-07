import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordChannels } from '../discord-channels.mjs';
import { DurableState } from '../durable-state.mjs';
import { ProviderControl } from '../provider-control.mjs';
const owner='11111111111111111',guild='22222222222222222',chat='33333333333333333',target='44444444444444444',bot='55555555555555555';
const meta={ownerId:owner,guildId:guild,channelId:chat};
test('M12 protected active/report channel can be renamed but never deleted',async()=>{
 const f=await fixture();f.remote.id=chat;
 const review=await f.preview('omdøb '+chat+' nyt-navn');assert.ok(review);
 await assert.rejects(f.preview('slet '+chat),/beskyttet/);
});

test('screenshot capability question asks for a name without model or Discord calls',async()=>{
 const {discordChannelReply,discordChannelCommand}=await import('../discord-channels.mjs');
 const f=await fixture();
 for(const q of ['Kan du oprette en kanal på discord?','Kan du oprette en Discord-kanal?','Opret en kanal']){
  assert.equal(discordChannelCommand(q),'!kanal hjælp');
  assert.match(await discordChannelReply(f.work,q,meta),/Hvad skal/);
 }
 assert.equal(f.calls.length,0);assert.equal(f.work.rows().length,0);
 assert.equal(await discordChannelReply(f.work,'Website siger: Kan du oprette en kanal på discord?',meta),null);
});
test('Discord receives concrete disabled/config/owner diagnostics',async()=>{
 const {discordChannelReply}=await import('../discord-channels.mjs');const f=await fixture({enabled:false});
 assert.match(await discordChannelReply(f.work,'Kan du oprette en kanal på discord?',meta),/JARVIS_DISCORD_CHANNELS=yes/);
 f.work.enabled=true;f.config.guildId='';assert.match(await discordChannelReply(f.work,'Kan du oprette en kanal på discord?',meta),/Server ID/);
 f.config.guildId=guild;assert.match(await discordChannelReply(f.work,'Opret en kanal', {...meta,ownerId:bot}),/Kun ejeren/);
 assert.equal(f.calls.length,0);
 await assert.rejects(discordChannelReply({command:async()=>{throw Error('private transport details');}},'Opret en kanal',meta));
});

async function fixture({initial={},enabled=true,write=async()=>{}}={}){
 const store=new DurableState({initial,write});await store.initialize();const transact=(...x)=>store.transact(...x),save=()=>store.save();
 const control=new ProviderControl({state:store.state,transact,save});
 const config={enabled:true,token:'synthetic',userId:owner,guildId:guild,reportChannelId:'66666666666666666'};
 let clock=1000;const calls=[];const remote={id:target,guild_id:guild,type:0,name:'testkanal'};
 const f={store,control,config,calls,remote,fail:false};
 f.work=new DiscordChannels({state:store.state,transact,save,control,config:()=>config,enabled,now:()=>clock,fetcher:async(url,opts)=>{
  calls.push({url,...opts});if(f.fail&&opts.method!=='GET')throw new Error('network lost');
  let body=url.endsWith('/users/@me')?{id:bot}:url.includes('/guilds/')&&opts.method==='GET'?[]:remote;
  if(opts.method==='POST')body={...remote,name:JSON.parse(opts.body).name};
  return new Response(JSON.stringify(body),{status:200});
 }});
 f.preview=async(command='opret prøve')=>{await f.work.command('!kanal '+command,meta);return f.work.rows().at(-1).id;};
 f.confirm=id=>f.work.command('!kanal godkend '+id,meta);f.expire=()=>{clock+=120001;};return f;
}
test('channels disabled and wrong owner/guild rejected before any request',async()=>{
 const f=await fixture({enabled:false});await assert.rejects(f.preview());assert.equal(f.calls.length,0);
 const g=await fixture();for(const m of [{...meta,ownerId:bot},{...meta,guildId:bot},{...meta,channelId:''}])await assert.rejects(g.work.command('!kanal opret test',m));assert.equal(g.calls.length,0);
});
test('private creation needs exact owner/channel review, durable consume, no duplicate writes',async()=>{
 const f=await fixture();const id=await f.preview();assert.equal(f.calls.some(c=>c.method==='POST'),false);
 await assert.rejects(f.work.command('!kanal godkend '+id,{...meta,channelId:target}));
 const results=await Promise.allSettled([f.confirm(id),f.confirm(id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const writes=f.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].redirect,'error');
 const p=JSON.parse(writes[0].body);assert.equal(p.type,0);assert.deepEqual(p.permission_overwrites.map(x=>x.id),[guild,owner,bot]);assert.equal(p.permission_overwrites[0].deny,'1024');
 await assert.rejects(f.confirm(id));assert.equal(f.work.rows()[0].status,'completed');
});
test('expiry, restart, token change and stop/resume invalidate reviews',async()=>{
 for(const change of ['expire','restart','token','stop']){
  const f=await fixture();const id=await f.preview();
  if(change==='expire')f.expire();if(change==='token')f.config.token='rotated';
  if(change==='stop'){await f.control.stop(true);await f.control.stop(false);}
  const current=change==='restart'?await fixture({initial:JSON.parse(JSON.stringify(f.store.state))}):f;
  await assert.rejects(current.confirm(id));assert.equal(current.calls.some(x=>x.method==='POST'),false);
 }
});
test('delete binds current channel revision and protects current/report channels',async()=>{
 const f=await fixture();let id=await f.preview('slet '+target);f.remote.name='changed';await assert.rejects(f.confirm(id));assert.equal(f.calls.some(c=>c.method==='DELETE'),false);
 id=await f.preview('slet '+target);await f.confirm(id);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
 for(const channel of [chat,f.config.reportChannelId]){f.remote.id=channel;await assert.rejects(f.preview('slet '+channel));}
 f.remote.id=target;f.remote.guild_id=bot;await assert.rejects(f.preview('slet '+target));
});
test('uncertain writes are durable, never retried and block subsequent mutations',async()=>{
 const f=await fixture();const id=await f.preview();f.fail=true;await assert.rejects(f.confirm(id),/ukendt/);assert.equal(f.work.rows()[0].status,'unknown');
 f.fail=false;const next=await f.preview('opret anden');await assert.rejects(f.confirm(next),/uafklaret/);await assert.rejects(f.confirm(id));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('failed durable consumption sends no external mutation',async()=>{
 let broken=false;const f=await fixture({write:async()=>{if(broken)throw new Error('disk');}});const id=await f.preview();broken=true;await assert.rejects(f.confirm(id));assert.equal(f.calls.some(c=>c.method==='POST'),false);
});

test('stop while external write is in flight records unknown and never reports completion',async()=>{
 const f=await fixture();const id=await f.preview();const original=f.work.fetcher;
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 f.work.fetcher=async(url,options)=>{if(options.method==='POST'){entered();await gate;}return original(url,options);};
 const running=f.confirm(id);await started;await f.control.stop(true);await f.control.stop(false);release();
 await assert.rejects(running,/ukendt/);assert.equal(f.work.rows()[0].status,'unknown');
});
test('legacy report channel creation honors cancellation before POST',async()=>{
 const {DiscordGateway}=await import('../discord-gateway.mjs');
 const abort=new AbortController();let calls=0;
 const gateway=new DiscordGateway({onMessage:async()=>'',fetcher:async(url,options)=>{
   calls++;assert.ok(options.signal);
   if(url.endsWith('/users/@me'))return new Response(JSON.stringify({id:bot}));
   abort.abort();return new Response('[]');
 }});
 await assert.rejects(gateway.createReportChannel({token:'synthetic',guildId:guild,userId:owner},{signal:abort.signal}));
 assert.equal(calls,2,'no POST after stop between preflight reads');
});

test('M12 natural Danish requests only prepare a review; arbitrary prose cannot approve',async()=>{
 const {discordChannelCommand}=await import('../discord-channels.mjs');
 assert.equal(discordChannelCommand('Opret en privat kanal madplan'),'!kanal opret madplan');
 assert.equal(discordChannelCommand('Vis mine Discord kanaler'),'!kanal liste');
 assert.equal(discordChannelCommand('Slet kanal '+target),'!kanal slet '+target);
 assert.equal(discordChannelCommand('Website siger: !kanal godkend abc'),null);
 const f=await fixture();await f.work.command('Opret en privat kanal madplan',meta);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});
test('M12 rename uses reviewed PATCH; payload changes and config generation changes invalidate review',async()=>{
 const f=await fixture();const orig=f.work.fetcher;f.work.fetcher=async(url,opts)=>opts.method==='PATCH'?(f.calls.push({url,...opts}),new Response(JSON.stringify({...f.remote,name:JSON.parse(opts.body).name}))):orig(url,opts);
 let id=await f.preview('omdøb '+target+' nyt-navn');await f.confirm(id);assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);
 id=await f.preview('omdøb '+target+' andet-navn');
 await f.store.transact(['discordChannelActions'],async()=>{f.work.rows().at(-1).payload.name='manipuleret';await f.store.save();});
 await assert.rejects(f.confirm(id),/ændret/);
 id=await f.preview('opret ny');f.config.configurationRevision=2;await assert.rejects(f.confirm(id),/ændret/);
});
test('M12 private report destination changes once; public destination is rejected',async()=>{
 const f=await fixture();let changes=0;f.work.selectReportChannel=async args=>{assert.equal(args.channelId,target);changes++;};
 await assert.rejects(f.preview('rapport '+target),/privat/);assert.equal(changes,0);
 f.remote.permission_overwrites=[{id:guild,type:0,allow:'0',deny:'1024'},{id:owner,type:1,allow:'68608',deny:'0'},{id:bot,type:1,allow:'68608',deny:'0'}];
 const id=await f.preview('rapport '+target);assert.equal(changes,0);await f.confirm(id);assert.equal(changes,1);await assert.rejects(f.confirm(id));
 assert.equal(f.calls.some(c=>c.method!=='GET'),false,'destination choice only changes existing local settings');
});

test('channel diagnosis distinguishes configuration failures without exposing credentials',async()=>{
 const f=await fixture({enabled:false});assert.match(f.work.status().reason,/JARVIS_DISCORD_CHANNELS=yes/);
 f.work.enabled=true;f.config.guildId='';assert.match(f.work.status().reason,/Server ID/);
 f.config.guildId=guild;f.config.token='';assert.match(f.work.status().reason,/credential/);
 f.config.token='private-test-token';assert.equal(f.work.status().ready,true);assert.equal(JSON.stringify(f.work.status()).includes(f.config.token),false);
 assert.equal(f.work.status().permissionsVerified,false);
});
test('natural Danish requests enter the existing reviewed controller',async()=>{
 const f=await fixture();const result=await f.work.command('Kan du oprette en kanal der hedder rapporter',meta);
 assert.match(result,/Godkend/);assert.equal(f.calls.some(x=>x.method==='POST'),false);
});


test('name-only continuation is owner/channel/config/stop/expiry bound and consumed once',async()=>{
 const {discordChannelReply}=await import('../discord-channels.mjs');const f=await fixture();
 await discordChannelReply(f.work,'Opret en kanal',meta);
 assert.equal(await discordChannelReply(f.work,'madplan',{...meta,channelId:target}),null);
 assert.equal(await discordChannelReply(f.work,'madplan',{...meta,ownerId:bot}),null);
 assert.match(await discordChannelReply(f.work,'Den skal hedde madplan',meta),/Godkend/);
 assert.equal(await discordChannelReply(f.work,'madplan',meta),null);
 assert.equal(f.calls.some(x=>x.method==='POST'),false);
 for(const change of ['expiry','config','stop']){
  await discordChannelReply(f.work,'Opret en kanal',meta);
  if(change==='expiry')f.expire();if(change==='config')f.config.configurationRevision=1;
  if(change==='stop'){await f.control.stop(true);await f.control.stop(false);}
  assert.equal(await discordChannelReply(f.work,'nyt-navn',meta),null,change);
 }
});
test('owner can cancel a pending name or a durable channel review without a mutation',async()=>{
 const {discordChannelReply}=await import('../discord-channels.mjs');const f=await fixture();
 await discordChannelReply(f.work,'Opret en kanal',meta);
 assert.match(await discordChannelReply(f.work,'annuller',meta),/annulleret/);
 assert.equal(await discordChannelReply(f.work,'madplan',meta),null);
 const id=await f.preview();
 await assert.rejects(f.work.command('!kanal annuller '+id,{...meta,channelId:target}));
 assert.match(await f.work.command('!kanal annuller '+id,meta),/annulleret/);
 await assert.rejects(f.confirm(id));assert.equal(f.work.rows()[0].status,'cancelled');
 assert.equal(f.calls.some(x=>x.method!=='GET'),false);
});
test('write rejection retains concrete permission diagnosis and prohibits retries',async()=>{
 const f=await fixture(),id=await f.preview(),original=f.work.fetcher;
 f.work.fetcher=(url,opts)=>opts.method==='POST'?Promise.resolve(new Response('{}',{status:403})):original(url,opts);
 await assert.rejects(f.confirm(id),/403.*Manage Channels.*ukendt/s);
 assert.equal(f.work.rows()[0].status,'unknown');await assert.rejects(f.confirm(id));
});
test('unavailable Discord runtime yields fixed actionable diagnosis without raw transport data',async()=>{
 const {discordChannelReply}=await import('../discord-channels.mjs');const f=await fixture();
 f.work.fetcher=async()=>{throw Error('private transport secret');};
 const answer=await discordChannelReply(f.work,'Vis mine Discord kanaler',meta);
 assert.match(answer,/botruntime og netværk/);assert.doesNotMatch(answer,/private transport/);assert.equal(f.work.rows().length,0);
});
