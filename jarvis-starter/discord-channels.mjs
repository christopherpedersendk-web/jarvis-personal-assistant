import { createHash, randomUUID } from 'node:crypto';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const snow = x => typeof x === 'string' && /^\d{17,20}$/.test(x);
const fail = message => Object.assign(new Error(message), { code: 'DISCORD_CHANNEL_REVIEW' });
export function discordChannelCommand(message) {
 const text=String(message||'').trim().replace(/^(?:kan du |vil du |jarvis[, ]+)(?:venligst )?/iu,'').replace(/ venligst[.!?]?$/iu,'');
 if(/^!kanal(?:\s|$)/iu.test(text))return text;
 // Capability questions have no name yet. Do not invent one or call the model.
 if(/^opret(?:te)? (?:en )?(?:privat )?(?:discord[- ]?)?(?:tekst)?kanal(?: på discord)?[.!?]?$/iu.test(text))return '!kanal hjælp';
 if(/^(?:vis|list) (?:mine |vores )?(?:discord[- ]?)?kanaler[.!?]?$/iu.test(text))return '!kanal liste';
 let m=/^opret(?:te)? (?:en )?(?:privat )?(?:discord[- ]?)?(?:tekst)?kanal (?:(?:med navnet|der hedder|som hedder) )?([a-z0-9æøå-]{1,100})[.!]?$/iu.exec(text);
 if(m)return '!kanal opret '+m[1].toLocaleLowerCase('da');
 m=/^(omdøb|slet) (?:discord[- ]?)?kanal (\d{17,20})(?: til ([a-z0-9æøå-]{1,100}))?[.!]?$/iu.exec(text);
 if(m)return `!kanal ${m[1].toLocaleLowerCase('da')} ${m[2]}${m[3]?' '+m[3].toLocaleLowerCase('da'):''}`;
 m=/^(?:brug|vælg) (?:discord[- ]?)?kanal (\d{17,20}) (?:til rapporter|som rapportkanal)[.!]?$/iu.exec(text);
 return m?'!kanal rapport '+m[1]:null;
}
const reviewedContent=r=>hash([r.action,r.target,r.payload,r.owner,r.guild,r.channel,r.basis,r.scope,r.boot,r.expires]);
// Only fixed, controller-owned diagnostics may be sent directly to Discord.
export async function discordChannelReply(controller,message,metadata){
 const command=controller.resolveCommand?.(message,metadata)||discordChannelCommand(message);if(!command)return null;
 try{return await controller.command(command,metadata);}
 catch(error){if(error.code==='DISCORD_CHANNEL_REVIEW')return error.message;throw error;}
}
// Only explicit owner commands enter this controller. No model gets execute authority.
export class DiscordChannels {
  constructor({state,transact,save,control,config,enabled=false,voiceChannelId='',selectReportChannel,fetcher=fetch,now=()=>Date.now()}) {
    Object.assign(this,{state,transact,save,control,config,enabled,voiceChannelId,selectReportChannel,fetcher,now}); this.boot=randomUUID(); this.pending=new Map();
  }
  conversationKey(meta){return JSON.stringify([meta.ownerId,meta.guildId,meta.channelId]);}
  resolveCommand(message,meta){
    const command=discordChannelCommand(message);if(command)return command;
    const key=this.conversationKey(meta),pending=this.pending.get(key);
    if(!pending)return null;
    if(pending.expires<=this.now()||pending.basis!==this.basis(this.config())){this.pending.delete(key);return null;}
    try{this.control.assertAllowed(pending.scope);}catch{this.pending.delete(key);return null;}
    if(/^(?:annull[eé]r|stop)[.!]?$/iu.test(message.trim())){this.pending.delete(key);return '!kanal annuller';}
    const name=/^(?:(?:den skal hedde|kald den|navnet er) )?([a-z0-9æøå][a-z0-9æøå-]{0,99})[.!]?$/iu.exec(message.trim());
    if(!name)return null;
    this.pending.delete(key);return '!kanal opret '+name[1].toLocaleLowerCase('da');
  }
  rows(){return this.state.discordChannelActions || [];}
  status(){
    const c=this.config();
    const reason=!this.enabled?'Kanalstyring er deaktiveret. Operatøren skal sætte JARVIS_DISCORD_CHANNELS=yes og genstarte tjenesten.':!c.enabled?'Discord-botten er deaktiveret i Indstillinger → Integrationer.':!c.token?'Discord-bottens credential mangler. Konfigurér det sikkert under Integrationer.':!snow(c.userId)?'Discord ejer-ID mangler eller er ugyldigt.':!snow(c.guildId)?'Discord Server ID mangler eller er ugyldigt. Brug serverens ID, ikke kanalens ID.':'';
    return {enabled:this.enabled,ready:!reason,reason,permissionsVerified:false,requiredPermissions:['Manage Channels','View Channel','Send Messages','Read Message History']};
  }
  auth(meta){
    const c=this.config();
    const status=this.status();if(!status.ready)throw fail(status.reason);
    if(meta.ownerId!==c.userId || meta.guildId!==c.guildId || !snow(meta.channelId)) throw fail('Kun ejeren i den valgte server kan styre kanaler.');
    this.control.assertAllowed(); return {...c};
  }
  basis(c){return hash([c.token,c.userId,c.guildId,c.reportChannelId,this.voiceChannelId,c.configurationRevision||0]);}
  async api(path,method,c,scope,body){
    return this.control.controlled(async signal=>{
      const response=await this.fetcher('https://discord.com/api/v10'+path,{method,redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)]),
        headers:{Authorization:`Bot ${c.token}`,'Content-Type':'application/json','X-Audit-Log-Reason':'Jarvis%20owner%20review'},...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok){await response.body?.cancel();const hint=({401:'Botcredential er ugyldigt eller udløbet.',403:'Botten mangler adgang eller Manage Channels. Kontrollér server- og kanalrettigheder; Administrator er ikke nødvendigt.',404:'Serveren eller kanalen findes ikke eller er utilgængelig for botten.',429:'Discords kaldgrænse er nået. Gennemgå status før et nyt forsøg.'})[response.status]||'Kontrollér Discord-forbindelsen.';throw fail(`Discord afviste kaldet (${Number(response.status)||0}). ${hint} Intet automatisk genforsøg.`);}
      const reader=response.body.getReader();let size=0;const parts=[];
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000)throw fail('Discord-svaret er for stort.');parts.push(value);}}finally{await reader.cancel();}
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    },scope);
  }
  channel(c,meta,target,protect=true){
    if(!target || !snow(target.id) || target.guild_id!==c.guildId || target.type!==0)throw fail('Kun tekstkanaler i den valgte server kan vælges.');
    if(protect&&[meta.channelId,c.reportChannelId,this.voiceChannelId].includes(target.id))throw fail('Aktiv samtale-, rapport- eller stemmekanal er beskyttet mod sletning.');
    return {id:target.id,guild_id:target.guild_id,type:target.type,name:target.name,parent_id:target.parent_id??null,
      permission_overwrites:target.permission_overwrites||[],topic:target.topic??null};
  }
  async command(message,meta){
    const c=this.auth(meta),scope=this.control.current();
    message=discordChannelCommand(message)||message;
    if(message.trim()==='!kanal annuller'){this.pending.delete(this.conversationKey(meta));return 'Kanalhandlingen er annulleret. Ingen ændring er sendt.';}
    if(message.trim()==='!kanal hjælp'){
      for(const [key,p]of this.pending)if(p.expires<=this.now())this.pending.delete(key);
      if(this.pending.size>=100)this.pending.clear();
      this.pending.set(this.conversationKey(meta),{expires:this.now()+120000,basis:this.basis(c),scope});
      return 'Kanalstyring er konfigureret, men Discord-rettighederne er endnu ikke kontrolleret. Hvad skal den private tekstkanal hedde? Skriv fx “Opret en privat kanal madplan”. Jeg viser et forslag, som du skal godkende her, før kanalen oprettes. Ingen kanal er oprettet. Du kan også svare med navnet alene eller skrive annuller.';}
    if(message.trim()==='!kanal liste'){
      const list=await this.api(`/guilds/${c.guildId}/channels`,'GET',c,scope);
      if(!Array.isArray(list))throw fail('Ugyldig kanalliste.');
      return list.filter(x=>x.type===0&&snow(x.id)).slice(0,50).map(x=>`${String(x.name||'').slice(0,100)} · ${x.id}${x.id===c.reportChannelId?' · rapportkanal':''}`).join('\n')||'Ingen tekstkanaler fundet.';
    }
    const match=/^!kanal (opret|slet|omdøb|rapport|godkend|status|annuller) (\S+)(?: (\S+))?$/iu.exec(message.trim());
    if(!match)return 'Brug !kanal liste, !kanal opret navn, !kanal omdøb ID nyt-navn, !kanal rapport ID, !kanal slet ID, !kanal godkend review-ID eller !kanal status review-ID.';
    const action=match[1].toLocaleLowerCase('da'),value=match[2],extra=match[3];
    if(action==='omdøb'?!extra:Boolean(extra))throw fail('Angiv præcis handling og dens parametre.');
    if(action==='status'){
      const r=this.rows().find(r=>r.id===value && r.owner===c.userId && r.guild===c.guildId);
      if(!r)throw fail('Ukendt kanalreview.');
      return JSON.stringify({id:r.id,status:r.status==='sending'?'unknown':r.status,action:r.action,target:r.target,result:r.result||null});
    }
    if(action==='annuller'){
      return this.transact(['discordChannelActions'],async()=>{
        const r=this.rows().find(x=>x.id===value);this.check(r,meta,c);r.status='cancelled';await this.save();return 'Kanalreview er annulleret. Ingen ændring er sendt.';
      });
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
      target=this.channel(c,meta,await this.api('/channels/'+value,'GET',c,scope),action==='slet');
      if(target.id!==value)throw fail('Discord returnerede en anden kanal.');
      if(action==='omdøb'){
        if(!/^[a-z0-9æøå][a-z0-9æøå-]{0,99}$/u.test(extra))throw fail('Brug små bogstaver, tal eller bindestreger i navnet.');
        payload={name:extra};
      }
      if(action==='rapport'){
        if(typeof this.selectReportChannel!=='function')throw fail('Valg af rapportkanal er ikke tilgængeligt.');
        if(value===c.reportChannelId)throw fail('Kanalen er allerede valgt til rapporter.');
        const bot=await this.api('/users/@me','GET',c,scope);
        // Sending personal reports must not widen access. Accept only the exact
        // owner/bot private layout Jarvis creates; uncertain permissions need UI review.
        const overwrites=target.permission_overwrites;
        if(!snow(bot.id)||overwrites.length!==3||!overwrites.some(x=>x.id===c.guildId&&x.type===0&&x.allow==='0'&&x.deny==='1024')||
          ![c.userId,bot.id].every(id=>overwrites.some(x=>x.id===id&&x.type===1&&x.allow==='68608'&&x.deny==='0')))
          throw fail('Rapporter kræver en privat ejer-/botkanal. Opret en med !kanal opret; offentlig levering godkendes ikke her.');
      }
    }
    const intent={id:randomUUID(),action,target,payload,owner:c.userId,guild:c.guildId,channel:meta.channelId,basis:this.basis(c),scope,
      boot:this.boot,expires:this.now()+120000,status:'ready'};
    intent.reviewHash=reviewedContent(intent);
    await this.transact(['discordChannelActions'],async()=>{
      this.control.assertAllowed(scope);if(this.basis(this.auth(meta))!==intent.basis)throw fail('Konfigurationen er ændret.');
      const rows=this.rows().filter(r=>r.status!=='ready'||r.expires>this.now());
      if(rows.length>=100)throw fail('Kanaljournalen er fuld; gennemgå den før nye handlinger.');
      this.state.discordChannelActions=[...rows,intent];await this.save();
    });
    return `${({opret:'Opret tekstkanal',slet:'SLET tekstkanal og dens beskeder permanent',omdøb:'Omdøb tekstkanal til '+extra,rapport:'Flyt fremtidige rapporter til denne private kanal'})[action]}: ${JSON.stringify(target.name)}${target.id?' (ID '+target.id+')':''}. Server: ${c.guildId}. ${action==='opret'?'Kun ejer og bot tildeles adgang; serveradministratorer kan også se kanalen.':''}\nGodkend inden 2 minutter i denne kanal: !kanal godkend ${intent.id}`;
  }
  check(r,meta,c){
    if(!r||r.status!=='ready'||r.owner!==c.userId||r.guild!==c.guildId||r.channel!==meta.channelId||r.boot!==this.boot||r.basis!==this.basis(c)||r.expires<=this.now()||r.reviewHash!==reviewedContent(r))throw fail('Review er brugt, ændret eller udløbet. Hent status; gennemgå en ny anmodning manuelt.');
    this.control.assertAllowed(r.scope);
  }
  async execute(id,meta,c){
    if(this.executing)throw fail('En kanalændring behandles allerede. Hent status før et nyt forsøg.');
    this.executing=true;
    try{return await this.executeReviewed(id,meta,c);}finally{this.executing=false;}
  }
  async executeReviewed(id,meta,c){
    let r=this.rows().find(r=>r.id===id);this.check(r,meta,c);
    if(r.action!=='opret'){
      const current=this.channel(c,meta,await this.api('/channels/'+r.target.id,'GET',c,r.scope),r.action==='slet');
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
      let result;
      if(r.action==='rapport'){
        await this.selectReportChannel({channelId:r.target.id,expectedConfig:c,scope:r.scope});
        result={id:r.target.id,guild_id:c.guildId,type:0};
      }else result=await this.api(r.action==='opret'?`/guilds/${c.guildId}/channels`:'/channels/'+r.target.id,({opret:'POST',slet:'DELETE',omdøb:'PATCH'})[r.action],c,r.scope,r.payload);
      if(!snow(result.id)||result.guild_id!==c.guildId||result.type!==0||(r.action==='slet'&&result.id!==r.target.id)||(r.action==='opret'&&result.name!==r.target.name)||(r.action==='omdøb'&&(result.id!==r.target.id||result.name!==r.payload.name)))throw fail('Uventet Discord-svar.');
      await this.transact(['discordChannelActions'],async()=>{const item=this.rows().find(x=>x.id===id);item.status='completed';item.result={id:result.id};await this.save();});
      return `${({opret:'Oprettet',slet:'Slettet',omdøb:'Omdøbt',rapport:'Rapportkanal valgt'})[r.action]}: ${r.payload?.name||r.target.name} (${result.id}).`;
    }catch(error){
      await this.transact(['discordChannelActions'],async()=>{this.rows().find(x=>x.id===id).status='unknown';await this.save();}).catch(()=>{});
      throw fail((error.code==='DISCORD_CHANNEL_REVIEW'?error.message+' ':'')+'Udfaldet er ukendt. Kontrollér Discord og !kanal status '+id+'. Der er ikke genforsøgt.');
    }
  }
}

