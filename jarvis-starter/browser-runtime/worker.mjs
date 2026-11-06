import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
const lines=createInterface({input:process.stdin});
let boot, counter=0;const waiting=new Map();
const initialized=new Promise(resolve=>boot=resolve);
lines.on('line',line=>{
 const message=JSON.parse(line);
 if(message.type==='start') boot(message);
 else if(message.type==='resource'&&waiting.has(message.id)){waiting.get(message.id)(message);waiting.delete(message.id);}
});
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const {url}=await initialized;
let browser, stage='launch';
try {
 browser=await chromium.launch({headless:true,chromiumSandbox:true});
 stage='context';
 const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,permissions:[],javaScriptEnabled:true});
 await context.routeWebSocket('**/*',socket=>socket.close());
 let page;
 await context.route('**/*',async route=>{
  const request=route.request();
  if(request.method()!=='GET'||!['document','script','stylesheet','xhr','fetch'].includes(request.resourceType())) return route.abort();
  if(request.isNavigationRequest()&&page&&(request.frame()!==page.mainFrame()||request.url()!==url)) return route.abort();
  const id=++counter;
  const result=await new Promise(resolve=>{waiting.set(id,resolve);send({type:'request',id,url:request.url()});});
  if(!result.ok) return route.abort();
  await route.fulfill({status:200,contentType:result.contentType,body:Buffer.from(result.body,'base64')});
 });
 page=await context.newPage();
 context.on('page',popup=>{if(popup!==page)popup.close().catch(()=>{});});
 page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
 stage='navigation';
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:10000});
 await page.waitForLoadState('networkidle',{timeout:2500}).catch(()=>{});
 stage='extract';
 const html=await page.content();
 if(Buffer.byteLength(html)>500000) throw new Error('Page too large');
 send({type:'result',html});
} catch(error) {
 const reason=/sandbox|namespace|Operation not permitted/i.test(error.message)?'sandbox':/Executable doesn.t exist/i.test(error.message)?'executable':'runtime';
 send({type:'error',stage,reason});process.exitCode=1;
}
finally{await browser?.close();lines.close();process.stdin.destroy();}
