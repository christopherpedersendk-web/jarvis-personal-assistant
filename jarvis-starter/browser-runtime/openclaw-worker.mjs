// Runs only inside a networkless, non-root container. No production credential.
import {chromium} from 'playwright';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {commerceBrowserConfig} from './commerce-browser-config.mjs';
const lines=createInterface({input:process.stdin}),send=x=>process.stdout.write(JSON.stringify(x)+'\n'),waiting=new Map();let boot,counter=0;
const initialized=new Promise(r=>boot=r);
lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.type==='start')boot(m);else if(m.type==='resource'&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}});
const {url}=await initialized,approved=new URL(url);if(approved.protocol!=='https:'||!['www.proshop.dk','www.amazon.de'].includes(approved.hostname)||approved.search||approved.hash)throw Error('Invalid public target');
const dir=await mkdtemp('/tmp/jarvis-openclaw-'),token=randomBytes(32).toString('hex'),port=18890,origin='http://127.0.0.1:'+(port+2);await mkdir(dir+'/workspace');
const config=commerceBrowserConfig({port,token,workspace:dir+'/workspace'});config.browser.executablePath=chromium.executablePath();await writeFile(dir+'/openclaw.json',JSON.stringify(config),{mode:0o600});
const env={PATH:'/usr/bin:/bin',HOME:dir,TMPDIR:dir,OPENCLAW_STATE_DIR:dir,OPENCLAW_CONFIG_PATH:dir+'/openclaw.json',OPENCLAW_NO_AUTO_UPDATE:'1',OPENCLAW_DISABLE_BONJOUR:'1',OPENCLAW_EAGER_BROWSER_CONTROL_SERVER:'1'};
let child,browser,target,stage='startup';const blocked={requests:0,writes:0,websockets:0,popups:0};
const call=async(path,{method='GET',body,timeoutMs=15000}={})=>{const u=new URL(path,origin);u.searchParams.set('profile','jarvis-commerce');const r=await fetch(u,{method,redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});if(!r.ok){await r.body?.cancel();throw Error('Native browser operation rejected');}const parts=[];let size=0;for await(const x of r.body){size+=x.length;if(size>100000)throw Error('Native response too large');parts.push(x);}return JSON.parse(Buffer.concat(parts));};
try{
 const pkg=JSON.parse(await readFile('/openclaw/node_modules/openclaw/package.json','utf8'));if(pkg.version!=='2026.11.1')throw Error('Runtime pin mismatch');
 child=spawn(process.execPath,['/openclaw/node_modules/openclaw/openclaw.mjs','gateway','run'],{env,cwd:dir,stdio:'ignore'});let ready=false;
 for(let i=0;i<240;i++){try{await call('/',{timeoutMs:400});ready=true;break;}catch{}if(child.exitCode!==null)break;await new Promise(r=>setTimeout(r,250));}if(!ready)throw Error('Native gateway unavailable');
 stage='launch';await call('/start',{method:'POST'});browser=await chromium.connectOverCDP('http://127.0.0.1:'+(port+11));const context=browser.contexts()[0];await context.clearPermissions();
 await context.routeWebSocket('**/*',socket=>{blocked.websockets++;socket.close();});
 await context.route('**/*',async route=>{
  const request=route.request();let u;try{u=new URL(request.url());}catch{blocked.requests++;return route.abort();}
  if(request.method()!=='GET'){blocked.writes++;return route.abort();}
  if(u.origin!==approved.origin||u.search||u.hash||!['document','script','stylesheet','xhr','fetch'].includes(request.resourceType())||(request.isNavigationRequest()&&u.href!==approved.href)){blocked.requests++;return route.abort();}
  const id=++counter,result=await new Promise(resolve=>{const timer=setTimeout(()=>{waiting.delete(id);resolve({ok:false});},9000);waiting.set(id,m=>{clearTimeout(timer);resolve(m);});send({type:'request',id,url:u.href});});
  if(!result.ok){blocked.requests++;return route.abort();}await route.fulfill({status:200,contentType:result.contentType,body:Buffer.from(result.body,'base64')});
 });
 let expectingOwnPage=false,ownedPage;
 context.on('page',page=>{if(expectingOwnPage&&!ownedPage)ownedPage=page;else{blocked.popups++;page.close().catch(()=>{});}page.on('dialog',d=>d.dismiss().catch(()=>{}));page.on('download',d=>d.cancel().catch(()=>{}));});
 stage='navigation';expectingOwnPage=true;const opened=await call('/tabs/open',{method:'POST',body:{url:approved.href}});expectingOwnPage=false;target=opened.suggestedTargetId||opened.targetId;if(typeof target!=='string'||!target||target.length>160)throw Error('Missing own tab');
 const check=async()=>{const tabs=await call('/tabs'),tab=(Array.isArray(tabs)?tabs:tabs.tabs)?.find(t=>t.targetId===target||t.suggestedTargetId===target);if(!tab||tab.url!==approved.href)throw Error('Destination changed');};
 await check();stage='snapshot';const result=await call('/snapshot?targetId='+encodeURIComponent(target)+'&format=ai&maxChars=20000');await check();if(typeof result.snapshot!=='string'||result.snapshot.length>25000)throw Error('Invalid snapshot');
 stage='cleanup';await call('/tabs/'+encodeURIComponent(target),{method:'DELETE',timeoutMs:5000});target=null;
 send({type:'result',url:approved.href,snapshot:result.snapshot,snapshotHash:createHash('sha256').update(result.snapshot).digest('hex'),runtime:pkg.version,blocked});
}catch{send({type:'error',stage});process.exitCode=1;}
finally{if(target)await call('/tabs/'+encodeURIComponent(target),{method:'DELETE',timeoutMs:3000}).catch(()=>{});await browser?.close().catch(()=>{});child?.kill('SIGTERM');for(const resolve of waiting.values())resolve({ok:false});waiting.clear();lines.close();process.stdin.destroy();setTimeout(()=>{child?.kill('SIGKILL');process.exit(process.exitCode||0);},1500);}
