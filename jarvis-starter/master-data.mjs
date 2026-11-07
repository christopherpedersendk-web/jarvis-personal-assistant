import {createHash,randomUUID} from 'node:crypto';
import {rejectSecrets} from './privacy.mjs';
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
function keys(x,allowed){if(!plain(x)||Object.keys(x).some(k=>!allowed.includes(k)))throw new Error('Uventede stamdatafelter. Betalingsoplysninger og credentials må ikke gemmes her.');}
function text(x,max,required=true){if(typeof x!=='string'||x.length>max||/[\x00-\x1f\x7f]/u.test(x)||required&&!x.trim())throw new Error('Et stamdatafelt mangler eller er ugyldigt.');rejectSecrets(x);if(/(?:\d[ -]?){16,19}/u.test(x))throw new Error('Betalingskortnumre må ikke gemmes i stamdata.');return x.trim();}
function address(x){keys(x,['street','postalCode','city','country']);const a={street:text(x.street,160),postalCode:text(x.postalCode,20),city:text(x.city,100),country:text(x.country,2).toUpperCase()};if(!/^[A-Z]{2}$/.test(a.country))throw new Error('Land skal være en landekode på to bogstaver.');return a;}
export const emptyMasterData=()=>({revision:0,profiles:[],defaultProfileId:null,history:[]});
export function replaceMasterData(current,input,now=new Date().toISOString()){
 keys(input,['expectedRevision','profiles','defaultProfileId']);if(input.expectedRevision!==current.revision)throw Object.assign(new Error('Stamdata er ændret. Hent den aktuelle revision før du gemmer.'),{status:409});
 if(!Array.isArray(input.profiles)||input.profiles.length>8)throw new Error('Højst otte adresseprofiler.');
 const profiles=input.profiles.map(p=>{keys(p,['id','label','name','phone','email','delivery','billing']);const id=text(p.id,60);if(!/^[a-zA-Z0-9-]+$/.test(id))throw new Error('Ugyldigt profil-ID.');const email=text(p.email,254);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Ugyldig e-mail.');const phone=text(p.phone,30);if(!/^\+?[\d ()-]{6,30}$/.test(phone)||phone.replace(/\D/g,'').length>15)throw new Error('Ugyldigt telefonnummer.');return {id,label:text(p.label,60),name:text(p.name,100),phone,email,delivery:address(p.delivery),billing:p.billing===null?null:address(p.billing)};});
 if(new Set(profiles.map(p=>p.id)).size!==profiles.length)throw new Error('Profil-ID må kun forekomme én gang.');
 if(input.defaultProfileId!==null&&!profiles.some(p=>p.id===input.defaultProfileId))throw new Error('Vælg en eksisterende standardadresse eller intet standardvalg.');
 return {revision:current.revision+1,profiles,defaultProfileId:input.defaultProfileId,history:[...(current.history||[]),{revision:current.revision+1,at:now,operation:'explicit_replace',profileCount:profiles.length}].slice(-100)};
}
export function masterDataFingerprint(data){return createHash('sha256').update(JSON.stringify([data.revision,data.profiles,data.defaultProfileId])).digest('hex');}
export function shareProfile(data,{profileId,expectedRevision,origin,allowedOrigins}){
 if(expectedRevision!==data.revision)throw new Error('Adresserevisionen er ændret.');const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'||!allowedOrigins.includes(origin))throw new Error('Butikken er ikke godkendt til datadeling.');const p=data.profiles.find(p=>p.id===profileId);if(!p)throw new Error('Vælg en gemt adresse.');return {origin,revision:data.revision,fingerprint:masterDataFingerprint(data),profile:structuredClone(p)};
}
// Reviews contain proposed PII only in process memory, never model history/logs.
export class MasterDataReviews{
 constructor({read,write,now=()=>Date.now()}){Object.assign(this,{read,write,now});this.pending=new Map();}
 preview(input,identity){const next=replaceMasterData(this.read(),input);if(this.pending.size>=20)for(const [id,r]of this.pending)if(r.expires<=this.now())this.pending.delete(id);if(this.pending.size>=20)throw new Error('For mange adressekladder.');const id=randomUUID();this.pending.set(id,{input:structuredClone(input),identity,revision:this.read().revision,expires:this.now()+120000});return {id,revision:next.revision,profiles:next.profiles.map(p=>({id:p.id,label:p.label})),defaultProfileId:next.defaultProfileId};}
 async approve(id,identity){const r=this.pending.get(id);this.pending.delete(id);if(!r||r.identity!==identity||r.expires<=this.now()||r.revision!==this.read().revision)throw new Error('Adressereview er udløbet, ændret eller allerede brugt.');return this.write(r.input);}
 clear(){this.pending.clear();}
}
