import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {syntheticServerEnv} from '../test/helpers/synthetic-env.mjs';
const require=createRequire(import.meta.url),{chromium,webkit}=require('playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'jarvis-skills-menu-'));
const portProbe=createServer();await new Promise(r=>portProbe.listen(0,'127.0.0.1',r));const port=portProbe.address().port;await new Promise(r=>portProbe.close(r));
const origin=`http://127.0.0.1:${port}`,token='synthetic-skills-menu-owner-access',report={at:new Date().toISOString(),candidate:process.env.GITHUB_SHA||null,status:'running',checks:[],scope:'Synthetic server/UI; no live model or physical iPhone'};
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:syntheticServerEnv({dataDir:dir,accessToken:token,port,modelKey:'sk-synthetic-skills-only-test-key'}),stdio:['ignore','pipe','pipe']});let logs='';for(const stream of[child.stdout,child.stderr])stream.on('data',d=>{logs=(logs+d).slice(-2000);});
let browser;const artifacts=root+'artifacts/gui/skills';await mkdir(artifacts,{recursive:true});
try{
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(origin+'/health',{signal:AbortSignal.timeout(200)})).ok){ready=true;break;}}catch{}await delay(50);}assert.ok(ready,logs);
 for(const [engine,name]of[[chromium,'chromium'],...(process.env.JARVIS_REQUIRE_WEBKIT==='yes'?[[webkit,'webkit']]:[])]){
  browser=await engine.launch({headless:true,...(name==='chromium'&&process.env.JARVIS_TEST_CHROMIUM?{executablePath:process.env.JARVIS_TEST_CHROMIUM}:{})});
  for(const width of[320,390,1280]){
   const context=await browser.newContext({viewport:{width,height:850}}),page=await context.newPage();let posts=0;
   await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
   page.on('request',request=>{if(request.method()==='POST')posts++;});
   await page.addInitScript(value=>localStorage.setItem('jarvisAccessToken',value),token);
   await page.goto(origin+'/?view=settings&section=skills');await page.locator('#settings-skills').waitFor({state:'visible'});
   await page.locator('.catalog-card[data-skill-id="meal-planning"][data-skill-version="1.1.0"]').waitFor();
   assert.equal(await page.locator('#skills-catalog .catalog-card').count(),12);
   await page.locator('#skills-source').selectOption('openclaw');assert.equal(await page.locator('#skills-catalog .catalog-card:visible').count(),4);
   assert.equal(await page.locator('#skills-catalog .catalog-card:visible button:not(:disabled)').count(),0,'disabled gateway cannot execute/enable skills');
   await page.locator('#skills-source').selectOption('jarvis');await page.locator('#skills-query').fill('Madplan');
   const card=page.locator('[data-skill-id="meal-planning"][data-skill-version="1.1.0"]');
   await card.getByText('Data, rettigheder og tilgængelighed',{exact:true}).click();assert.match(await card.innerText(),/Testet: nej|ikke.*live|Kataloget/i);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal document overflow');
   await page.screenshot({path:`${artifacts}/${name}-${width}.png`,fullPage:true});
   const before=posts;await card.getByRole('button',{name:'Prøv skill',exact:true}).focus();await page.keyboard.press('Enter');
   await page.locator('#message').waitFor({state:'visible'});assert.match(await page.locator('#message').inputValue(),/^Brug meal-planning version 1.1.0:/);assert.equal(posts,before,'trial only opens unsent draft');
   const draft=await page.locator('#message').inputValue();await page.reload();assert.equal(await page.locator('#message').inputValue(),draft,'draft survives reload');
   await page.locator('a[data-tab="settings"]:visible').first().click();await page.locator('[data-settings-tab="skills"]').click();
   await page.locator('#skills-query').fill('');await page.locator('#skills-source').selectOption('');
   await page.locator('#logout').click();assert.equal(await page.locator('#skills-catalog .catalog-card').count(),0);assert.equal(await page.locator('#skills-query').inputValue(),'');
   report.checks.push({engine:name,version:browser.version(),width,filters:'passed',keyboard:'passed',draft:'passed',logout:'passed',overflow:false});await context.close();
  }
  await browser.close();browser=null;
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=error.message;throw error;}
finally{await browser?.close();if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}await rm(dir,{recursive:true,force:true});await writeFile(artifacts+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
