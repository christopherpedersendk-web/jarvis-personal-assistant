import {fetchRecipeResource} from './recipe-fetch.mjs';

export const MEDIA_LIMITS = Object.freeze({images:2,imageBytes:10*1024*1024,pixels:20_000_000,videoBytes:30*1024*1024,seconds:60,frames:12});
const TYPES = {'image/jpeg':'image','image/png':'image','image/webp':'image','video/mp4':'video','video/webm':'video'};
const EXTENSIONS = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4',webm:'video/webm'};
const snowflake = value => /^\d{15,22}$/.test(String(value||''));
const fail = message => {throw new Error(message);};

// Signed CDN URLs are transient capabilities. No arbitrary URL, auth header,
// persistent URL, proxy, embed or second fetch path is accepted.
export function mediaCdnUrl(value,{channelId,id,now=Date.now()}={}) {
 let url;try{url=new URL(value);}catch{return null;}
 const path=url.pathname.match(/^\/attachments\/(\d{15,22})\/(\d{15,22})\/([^/]+)$/);
 let name;try{name=decodeURIComponent(path?.[3]||'');}catch{return null;}
 if(!path||!name||/[\\/\u0000-\u001f]/.test(name)||url.href.length>2048||url.protocol!=='https:'||url.port||url.username||url.password||url.hash||
  !['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)||path[1]!==channelId||path[2]!==id)return null;
 const keys=[...url.searchParams.keys()];
 if(keys.some(key=>!['ex','is','hm'].includes(key))||keys.length!==new Set(keys).size)return null;
 // Legacy unsigned CDN paths are allowed. Partial/expired signatures are not.
 if(keys.length){
  const ex=url.searchParams.get('ex'),issued=url.searchParams.get('is'),hm=url.searchParams.get('hm');
  if(!/^[a-f0-9]{8,12}$/i.test(ex||'')||!/^[a-f0-9]{8,12}$/i.test(issued||'')||!/^[a-f0-9]{64}$/i.test(hm||''))return null;
  if(parseInt(ex,16)*1000<=now||parseInt(issued,16)>parseInt(ex,16))return null;
 }
 return url;
}

export function discordMediaMetadata(attachments,channelId,{now=Date.now()}={}) {
 if(!Array.isArray(attachments)||!attachments.length)return {mediaAttachments:[],mediaCount:0,mediaError:null};
 const result={mediaAttachments:[],mediaCount:attachments.length,mediaError:null};
 try{
  if(!snowflake(channelId)||attachments.length>2)fail('Send højst to billeder eller én video ad gangen.');
  for(const a of attachments){
   const type=String(a.content_type||a.contentType||EXTENSIONS[String(a.filename||'').split('.').at(-1).toLowerCase()]||'').toLowerCase();
   const kind=TYPES[type],id=String(a.id||''),size=Number(a.size);
   if(!kind)fail('Brug JPEG, PNG, WebP, MP4 eller WebM. Andre vedhæftninger analyseres ikke.');
   if(!snowflake(id)||!Number.isSafeInteger(size)||size<12||size>(kind==='video'?MEDIA_LIMITS.videoBytes:MEDIA_LIMITS.imageBytes))fail('Filen overstiger grænsen: 10 MiB pr. billede eller 30 MiB pr. video.');
   const url=mediaCdnUrl(a.url,{channelId,id,now});
   if(!url)fail('Vedhæftningens Discord-link er ugyldigt eller udløbet. Upload filen igen.');
   result.mediaAttachments.push({id,channelId,kind,contentType:type,size,url:url.href});
  }
  if(result.mediaAttachments.some(a=>a.kind==='video')&&attachments.length!==1)fail('Send videoen alene, højst 60 sekunder.');
 }catch(error){result.mediaAttachments=[];result.mediaError=error.message;}
 return result;
}

export function mediaMagic(buffer,type) {
 if(!Buffer.isBuffer(buffer)||buffer.length<12)return false;
 if(type==='image/png')return buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(type==='image/jpeg')return buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
 if(type==='image/webp')return buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
 if(type==='video/mp4')return buffer.toString('ascii',4,8)==='ftyp';
 if(type==='video/webm')return buffer.subarray(0,4).equals(Buffer.from([26,69,223,163]));
 return false;
}

export async function downloadDiscordMedia(attachment,{signal,fetchResource=fetchRecipeResource,now=Date.now()}={}) {
 const parsed=discordMediaMetadata([attachment],attachment.channelId,{now});
 if(parsed.mediaError)fail(parsed.mediaError);
 const target=parsed.mediaAttachments[0];if(!target)fail('Vedhæftningen mangler.');
 const resource=await fetchResource(target.url,{kind:'media',signal,timeoutMs:15000,maxBytes:target.size,
  allowUrl:url=>Boolean(mediaCdnUrl(url.href,{...target,now}))});
 if(resource.contentType!==target.contentType||resource.buffer.length!==target.size||!mediaMagic(resource.buffer,target.contentType))fail('Filens indhold matcher ikke den oplyste type eller størrelse.');
 return {buffer:resource.buffer,contentType:target.contentType,kind:target.kind};
}
