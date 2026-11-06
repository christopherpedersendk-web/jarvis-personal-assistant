import {randomUUID} from 'node:crypto';
const snowflake=value=>/^\d{15,22}$/.test(String(value||''));
const day=time=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
// One owner, one explicitly selected guild channel, no autojoin/reconnect/replay.
export class DiscordVoice {
 constructor({state,transact,save,control,config,connect,transcribe,reply,speak,notify,now=()=>Date.now(),enabled=false,channelId='',secondsPerSession=300,secondsPerDay=1800}) {
  Object.assign(this,{state,transact,save,control,config,connect,transcribe,reply,speak,notify,now,enabled,channelId,secondsPerSession,secondsPerDay});
  if(!Number.isSafeInteger(secondsPerSession)||secondsPerSession<1||secondsPerSession>600||!Number.isSafeInteger(secondsPerDay)||secondsPerDay<secondsPerSession||secondsPerDay>7200)throw new Error('Ugyldig Discord-stemmegrænse.');
  this.active=null;this.busy=false;this.audioAbort=null;
 }
 async recover() { await this.transact(['discordVoiceSessions'],async()=>{
  for(const e of this.state.discordVoiceSessions||[])if(e.status!=='closed'){e.status='closed';e.reason='process_restart';}
  await this.save();
 }); }
 snapshot(){const entries=this.state.discordVoiceSessions||[];return {enabled:this.enabled,channelId:this.channelId,
  status:this.active?.status||'disconnected',ownerId:this.active?.ownerId||null,
  reservedSecondsToday:entries.filter(e=>e.day===day(this.now())).reduce((n,e)=>n+e.reservedSeconds,0),secondsPerDay:this.secondsPerDay,
  secondsPerSession:this.secondsPerSession,note:'Kun godkendt ejer; AI-genereret tale; ingen lydfiler gemmes. Sekund- og kaldgrænser, ikke kronebudget.'};}
 assertActive(id){if(!this.active||this.active.id!==id||this.active.status==='closing'||this.active.expiresAt<=this.now())throw new Error('Discord-stemmen er stoppet.');this.control.assertAllowed(this.active.scope);return this.active;}
 async join({ownerId,guildId,textChannelId}) {
  const config=this.config(),scope=this.control.current();this.control.assertAllowed(scope);
  if(!this.enabled||!snowflake(this.channelId))throw new Error('Discord-stemme er ikke aktiveret med en valgt serverkanal.');
  if(ownerId!==config.userId||guildId!==config.guildId||!snowflake(guildId)||!snowflake(textChannelId))throw new Error('Start stemme fra den godkendte bruger i den valgte server.');
  // Reserve synchronously before the first await; two joins cannot both connect.
  if(this.active)throw new Error('Discord-stemmen er allerede startet eller under tilslutning.');
  const session={id:randomUUID(),ownerId,guildId,channelId:this.channelId,textChannelId,scope,status:'connecting',day:day(this.now()),reservedSeconds:this.secondsPerSession,expiresAt:this.now()+this.secondsPerSession*1000};
  this.active=session;
  try {
   await this.transact(['discordVoiceSessions'],async()=>{
    this.assertActive(session.id);
    if(this.snapshot().reservedSecondsToday+this.secondsPerSession>this.secondsPerDay)throw new Error('Dagens reserverede Discord-stemmetid er opbrugt.');
    this.state.discordVoiceSessions=[...(this.state.discordVoiceSessions||[]).filter(e=>e.day===session.day),{...session}];await this.save();
   });
   const connection=await this.connect({...session,onAudio:pcm=>this.receive(session.id,ownerId,pcm),onDisconnect:()=>this.active===session?this.stop('connection_lost'):Promise.resolve()});
   if(this.active!==session){connection.close();throw new Error('Tilslutningen blev stoppet.');}
   session.connection=connection;this.assertActive(session.id);
   await this.notify(session.textChannelId,`JARVIS er forbundet til <#${session.channelId}>. Jeg lytter kun til <@${ownerId}>; kun dig og botten må være i kanalen. Svarstemmen er AI-genereret. Skriv !stemme stop for at afbryde.`);
   this.assertActive(session.id);session.status='listening';
   await this.transact(['discordVoiceSessions'],async()=>{const e=(this.state.discordVoiceSessions||[]).find(e=>e.id===session.id);if(e)e.status='listening';await this.save();});
   this.assertActive(session.id);
   session.timer=setTimeout(()=>this.stop('time_limit').catch(()=>{}),Math.max(1,session.expiresAt-this.now())).unref();
   connection.listen();
   return 'Stemmeforbindelsen er klar. Brug korte beskeder på højst 20 sekunder.';
  }catch(error){if(this.active===session)await this.stop('join_failed');throw error;}
 }
 async receive(id,userId,pcm){
  if(!this.active||this.active.id!==id||userId!==this.active.ownerId||this.active.status!=='listening'||this.busy)return;
  if(!Buffer.isBuffer(pcm)||pcm.length<19200||pcm.length>3840000||pcm.length%4!==0)return;
  this.busy=true;this.audioAbort=new AbortController();const abort=this.audioAbort;
  try {
   const session=this.assertActive(id);session.status='processing';
   await this.control.run(async()=>{
    const text=await this.transcribe(pcm,abort.signal);this.assertActive(id);
    if(!text.trim())return;
    if(/^(?:jarvis[ ,]+)?stop[.! ]*$/i.test(text)){await this.stop('owner_voice_stop');return;}
    const answer=await this.reply(text);this.assertActive(id);
    // Keep research sources in the selected text channel, not only in audio.
    await this.notify(session.textChannelId,answer);this.assertActive(id);
    const audio=await this.speak(answer.slice(0,1600),abort.signal);this.assertActive(id);
    await session.connection.play(audio);this.assertActive(id);
   },session.scope);
  }catch {if(this.active?.id===id){await this.notify(this.active.textChannelId,'Stemmebeskeden kunne ikke færdiggøres. Kontrollér historikken før en ny handling. Der er ikke genforsøgt automatisk.').catch(()=>{});await this.stop('turn_failed');}}
  finally{if(this.active?.id===id)this.active.status='listening';if(this.audioAbort===abort)this.audioAbort=null;this.busy=false;}
 }
 async stop(reason='owner_stop') {
  const session=this.active;if(!session)return;
  session.status='closing';this.control.revoke(session.scope);clearTimeout(session.timer);this.audioAbort?.abort();
  // Revoke and tear down before persistence or notification can block.
  this.active=null;try{session.connection?.close();}finally{
   await this.transact(['discordVoiceSessions'],async()=>{const e=(this.state.discordVoiceSessions||[]).find(e=>e.id===session.id);if(e){e.status='closed';e.reason=reason;}await this.save();});
  }
 }
}
