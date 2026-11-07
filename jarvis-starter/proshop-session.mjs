// Merchant-specific, observed 2026-11-07: POST /Basket/AddItem with productId
// and the current product form token. No login, payment or order-submit writes.
import {request as httpsRequest} from 'node:https';
import {lookup as dnsLookup} from 'node:dns/promises';
import {constants} from 'node:fs';
import {open,mkdir,lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {publicInternetAddress} from './recipe-fetch.mjs';
const origin='https://www.proshop.dk';
export function proshopProductUrl(value){const u=new URL(value);if(u.origin!==origin||u.username||u.password||u.search||u.hash||!/^\/[^/]+\/[^/]+\/\d{7}$/.test(u.pathname))throw Error('Brug et konkret offentligt Proshop-varelink.');return u;}
// Session cookies remain outside state, model prompts, logs and API results.
export function createProshopSession({file,lookup=dnsLookup,request=httpsRequest}={}){
 if(!file)throw Error('Privat Proshop-sessionsfil mangler.');let busy=false,cookies={};
 async function load(){await mkdir(dirname(file),{recursive:true,mode:0o700});const dir=await lstat(dirname(file));if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077))throw Error('Proshop-session kræver privat mappe (0700).');try{const f=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=await f.stat();if(!st.isFile()||(st.mode&0o077)||st.size>64000)throw Error('Ugyldig privat sessionsfil.');cookies=JSON.parse(await f.readFile('utf8'));}finally{await f.close();}}catch(e){if(e.code!=='ENOENT')throw e;}}
 async function persist(){const f=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);try{await f.writeFile(JSON.stringify(cookies));await f.sync();}finally{await f.close();}}
 async function call(path,{productId,token,signal}={}){
  if(busy)throw Error('Proshop-sessionen er optaget.');busy=true;
  try{
   const url=new URL(path,origin),search=url.pathname==='/'&&url.searchParams.size===1&&url.searchParams.has('s')&&url.searchParams.get('s').length<=200;
   if(url.origin!==origin||url.username||url.password||(!search&&url.search)||url.hash)throw Error('Proshop-destination afvist.');
   const writing=path==='/Basket/AddItem';
   if(!writing&&!search&&!['/Basket','/Basket/CheckOut','/login','/api/ApiBasket/Get'].includes(path)&&!/^\/Basket\/Shared\/[a-zA-Z0-9-]{1,100}$/.test(path))proshopProductUrl(url.href);
   if(writing&&(!/^\d{7}$/.test(productId)||typeof token!=='string'||!/^[-a-zA-Z0-9_]{1,200}$/.test(token)))throw Error('Butikkens aktuelle kurveformular mangler.');
   await load();signal?.throwIfAborted();
   const abort=AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])]);
   const addresses=await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>abort.addEventListener('abort',()=>reject(Error('DNS-tidsgrænse')),{once:true}))]);
   if(!addresses.length||addresses.some(x=>!publicInternetAddress(x.address)))throw Error('Butikkens netværksadresse er ikke offentlig.');abort.throwIfAborted();
   const address=addresses[0],body=writing?new URLSearchParams({productId,token}).toString():null;
   const result=await new Promise((resolve,reject)=>{
    const req=request(url,{method:writing?'POST':'GET',agent:false,signal:abort,rejectUnauthorized:true,servername:url.hostname,
     lookup:(host,options,callback)=>host!==url.hostname?callback(Error('DNS mismatch')):options?.all?callback(null,[address]):callback(null,address.address,address.family),
     headers:{'User-Agent':'JARVIS-RecipeMemory/4.9',Accept:'text/html,application/json','Accept-Encoding':'identity',...(Object.keys(cookies).length?{Cookie:Object.entries(cookies).map(([k,v])=>k+'='+v).join('; ')}:{}),...(writing?{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body),Origin:origin}:{} )}},res=>{
      const parts=[];let bytes=0;
      res.on('data',chunk=>{bytes+=chunk.length;if(bytes>1000000)res.destroy(Error('Proshop-svar er for stort.'));else parts.push(chunk);});
      res.on('error',()=>reject(Error('Proshop-forbindelsen blev afbrudt.')));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,html:Buffer.concat(parts).toString('utf8')}));
     });req.on('error',()=>reject(Error('Proshop-kald fejlede; intet automatisk genforsøg.')));req.end(body);
   });
   for(const value of result.headers['set-cookie']||[]){const pair=/^([^=;\s]+)=([^;\r\n]*)/.exec(value);if(!pair||value.length>8192||/;\s*domain=(?!\.?www\.proshop\.dk(?:;|$)|\.?proshop\.dk(?:;|$))/i.test(value))continue;if(/;\s*max-age=0(?:;|$)/i.test(value))delete cookies[pair[1]];else cookies[pair[1]]=pair[2];}
   if(Buffer.byteLength(JSON.stringify(cookies))>32000)throw Error('Sessionsgrænsen er nået.');await persist();
   const location=result.headers.location;
   // Never follow an authentication/payment redirect or replay a POST.
   if(location){const next=new URL(location,origin);return {status:result.status,redirectOrigin:next.origin,redirectPath:next.pathname,html:result.html};}
   if(result.status!==200)throw Error('Proshop afviste kaldet ('+result.status+'). Ingen automatisk gentagelse.');
   if(result.headers['content-encoding']&&result.headers['content-encoding']!=='identity')throw Error('Proshop-kodning afvist.');
   return {status:result.status,html:result.html};
  }finally{busy=false;}
 }
 return {search:(query,options)=>{if(typeof query!=='string'||!query.trim()||query.length>200)throw Error('Ugyldig Proshop-søgning.');return call('/?'+new URLSearchParams({s:query}),options);},details:options=>call('/api/ApiBasket/Get',options),importShared:(key,options)=>{if(!/^[a-zA-Z0-9-]{1,100}$/.test(key))throw Error('Ugyldigt kurvelink.');return call('/Basket/Shared/'+key,options);},product:(url,options)=>call(proshopProductUrl(url).pathname,options),basket:options=>call('/Basket',options),checkout:options=>call('/Basket/CheckOut',options),add:options=>call('/Basket/AddItem',options)};
}
