import { createHash, randomUUID } from 'node:crypto';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snow = x => typeof x === 'string' && /^\d{17,20}$/.test(x);
const fail = message => Object.assign(new Error(message), { code: 'DISCORD_CHANNEL_REVIEW' });
// Only explicit owner commands enter this controller. No model gets execute authority.
export class DiscordChannels {
  constructor({state,transact,save,control,config,enabled=false,voiceChannelId='',fetcher=fetch,now=()=>Date.now()}) {
    Object.assign(this,{state,transact,save,control,config,enabled,voiceChannelId,fetcher,now}); this.boot=randomUUID();
  }
  rows(){return this.state.discordChannelActions || [];}
  auth(meta){
    const c=this.config();
    if(!this.enabled || !c.enabled || !c.token || !snow(c.userId) || !snow(c.guildId)) throw fail('Kanalstyring er ikke aktiveret og konfigureret.');
    if(meta.ownerId!==c.userId || meta.guildId!==c.guildId || !snow(meta.channelId)) throw fail('Kun ejeren i den valgte server kan styre kanaler.');
    this.control.assertAllowed(); return {...c};
  }
  basis(c){return hash([c.token,c.userId,c.guildId,c.reportChannelId,this.voiceChannelId]);}
  async api(path,method,c,scope,body){
    return this.control.controlled(async signal=>{
      const response=await this.fetcher('https://discord.com/api/v10'+path,{method,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
        headers:{Authorization:`Bot ${c.token}`,'Content-Type':'application/json','X-Audit-Log-Reason':'Jarvis%20owner%20review'},...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok){await response.body?.cancel();throw fail(`Discord afviste kaldet (${Number(response.status)||0}). Intet automatisk genforsøg.`);}
      const reader=response.body.getReader();let size=0;const parts=[];
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw fail('Discord-svaret er for stort.');parts.push(value);}}finally{await reader.cancel();}
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    },scope);
  }
  channel(c,meta,target){
    if(!target || !snow(target.id) || target.guild_id!==c.guildId || target.type!==0)throw fail('Kun tekstkanaler i den valgte server kan slettes.');
    if([meta.channelId,c.reportChannelId,this.voiceChannelId].includes(target.id))throw fail('Aktiv samtale-, rapport- eller stemmekanal er beskyttet.');
    return {id:target.id,guild_id:target.guild_id,type:target.type,name:target.name,parent_id:target.parent_id??null,
      permission_overwrites:target.permission_overwrites||[],topic:target.topic??null};
  }
  async command(message,meta){
    const c=this.auth(meta),scope=this.control.current();
    const match=/^!kanal (opret|slet|godkend|status) (\S+)$/iu.exec(message.trim());
    if(!match)return 'Brug !kanal opret kanalnavn, !kanal slet kanal-ID, !kanal godkend review-ID eller !kanal status review-ID.';
    const [,action,value]=match;
    if(action==='status'){
      const r=this.rows().find(r=>r.id===value && r.owner===c.userId && r.guild===c.guildId);
      if(!r)throw fail('Ukendt kanalreview.');
      return JSON.stringify({id:r.id,status:r.status==='sending'?'unknown':r.status,action:r.action,target:r.target,result:r.result||null});
    }
    if(action==='godkend')return this.execute(value,meta,c);
    let target,payload;
    if(action==='opret'){
      if(!/^[a-z0-9æøå][a-z0-9æøå-]{0,99}$/u.test(value))throw fail('Brug 1–100 små bogstaver, tal eller bindestreger.');
      const bot=await this.api('/users/@me','GET',c,scope);
      if(!snow(bot.id))throw fail('Ugyldigt bot-ID.');
      target={name:value};payload={name:value,type:0,permission_overwrites:[{id:c.guildId,type:0,allow:'0',deny:'1024'},
        {id:c.userId,type:1,allow:'68608',deny:'0'},{id:bot.id,type:1,allow:'68608',deny:'0'}]};
    }else{
      if(!snow(value))throw fail('Angiv et kanal-ID.');
      target=this.channel(c,meta,await this.api('/channels/'+value,'GET',c,scope));
    }
    const intent={id:randomUUID(),action,target,payload,owner:c.userId,guild:c.guildId,channel:meta.channelId,basis:this.basis(c),scope,
      boot:this.boot,expires:this.now()+120000,status:'ready'};
    await this.transact(['discordChannelActions'],async()=>{
      this.control.assertAllowed(scope);if(this.basis(this.auth(meta))!==intent.basis)throw fail('Konfigurationen er ændret.');
      const rows=this.rows().filter(r=>r.status!=='ready'||r.expires>this.now());
      if(rows.length>=100)throw fail('Kanaljournalen er fuld; gennemgå den før nye handlinger.');
      this.state.discordChannelActions=[...rows,intent];await this.save();
    });
    return `${action==='opret'?'Opret tekstkanal':'SLET tekstkanal og dens beskeder permanent'}: ${JSON.stringify(target.name)}${target.id?' (ID '+target.id+')':''}. Server: ${c.guildId}. ${action==='opret'?'Kun ejer og bot tildeles adgang; serveradministratorer kan også se kanalen.':''}\nGodkend inden 2 minutter i denne kanal: !kanal godkend ${intent.id}`;
  }
  check(r,meta,c){
    if(!r||r.status!=='ready'||r.owner!==c.userId||r.guild!==c.guildId||r.channel!==meta.channelId||r.boot!==this.boot||r.basis!==this.basis(c)||r.expires<=this.now())throw fail('Review er brugt, ændret eller udløbet. Hent status; gennemgå en ny anmodning manuelt.');
    this.control.assertAllowed(r.scope);
  }
  async execute(id,meta,c){
    if(this.executing)throw fail('En kanalændring behandles allerede. Hent status før et nyt forsøg.');
    this.executing=true;
    try{return await this.executeReviewed(id,meta,c);}finally{this.executing=false;}
  }
  async executeReviewed(id,meta,c){
    let r=this.rows().find(r=>r.id===id);this.check(r,meta,c);
    if(r.action==='slet'){
      const current=this.channel(c,meta,await this.api('/channels/'+r.target.id,'GET',c,r.scope));
      if(hash(current)!==hash(r.target))throw fail('Kanalen er ændret siden review. Gennemgå den igen.');
    }else{
      const channels=await this.api(`/guilds/${c.guildId}/channels`,'GET',c,r.scope);
      if(!Array.isArray(channels)||channels.some(x=>x.name===r.target.name))throw fail('Navnet findes allerede, eller kanallisten er ugyldig.');
    }
    r=await this.transact(['discordChannelActions'],async()=>{
      const item=this.rows().find(x=>x.id===id);this.check(item,meta,this.auth(meta));
      if(this.rows().some(x=>x.id!==id&&['sending','unknown'].includes(x.status)))throw fail('Et kanaludfald er uafklaret. Kontrollér Discord og journalen før nye ændringer.');
      item.status='sending';await this.save();return structuredClone(item);
    });
    try{
      this.control.assertAllowed(r.scope);if(this.basis(this.auth(meta))!==r.basis)throw fail('Konfigurationen er ændret.');
      const result=await this.api(r.action==='opret'?`/guilds/${c.guildId}/channels`:'/channels/'+r.target.id,r.action==='opret'?'POST':'DELETE',c,r.scope,r.payload);
      if(!snow(result.id)||result.guild_id!==c.guildId||result.type!==0||(r.action==='slet'&&result.id!==r.target.id)||(r.action==='opret'&&result.name!==r.target.name))throw fail('Uventet Discord-svar.');
      await this.transact(['discordChannelActions'],async()=>{const item=this.rows().find(x=>x.id===id);item.status='completed';item.result={id:result.id};await this.save();});
      return `${r.action==='opret'?'Oprettet':'Slettet'}: ${r.target.name} (${result.id}).`;
    }catch{
      await this.transact(['discordChannelActions'],async()=>{this.rows().find(x=>x.id===id).status='unknown';await this.save();}).catch(()=>{});
      throw fail('Udfaldet er ukendt. Kontrollér Discord og !kanal status '+id+'. Der er ikke genforsøgt.');
    }
  }
}
