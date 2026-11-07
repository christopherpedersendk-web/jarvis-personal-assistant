// Disposable, anonymous merchant acceptance. Explicit --cart authorizes one
// cart write at the observed 57 DKK item price; no addresses/login/payment sent.
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createProshopSession} from '../proshop-session.mjs';
import {Commerce} from '../commerce.mjs';import {DurableState} from '../durable-state.mjs';import {ProviderControl} from '../provider-control.mjs';
import {emptyMasterData,replaceMasterData} from '../master-data.mjs';
if(process.argv[2]!=='--live')throw Error('Explicit --live [--cart] required.');
const directory=await mkdtemp(join(tmpdir(),'jarvis-proshop-acceptance-'));
const store=new DurableState({initial:{},write:snapshot=>writeFile(join(directory,'journal.json'),snapshot,{mode:0o600})});await store.initialize();
const save=()=>store.save(),transact=(...args)=>store.transact(...args),control=new ProviderControl({state:store.state,save,transact});
const masterData=replaceMasterData(emptyMasterData(),{expectedRevision:0,defaultProfileId:null,profiles:[{id:'synthetic',label:'Synthetic acceptance only',name:'Test Person',phone:'12345678',email:'test@example.org',delivery:{street:'Testvej 1',postalCode:'2900',city:'Hellerup',country:'DK'},billing:null}]});
const commerce=new Commerce({state:store.state,save,transact,control,masterData:()=>masterData,enabled:true,proshopSession:id=>createProshopSession({file:join(directory,id+'.json')})});
const urls=['https://www.proshop.dk/USB-kabel/Sandberg-USB-C-to-USB-C-1m/3298156','https://www.proshop.dk/USB-kabel/Lippa-USB-C-to-USB-C-100W-10Gbps-cable-1m-White/3301651'];
const report={at:new Date().toISOString(),directory,sourceHashes:{},scope:'anonymous test only; checkout contact/address form never submitted; delivery/total to 2900 unknown',cases:[]};
for(const name of ['commerce.mjs','proshop.mjs','proshop-session.mjs']){const {readFile}=await import('node:fs/promises');report.sourceHashes[name]=createHash('sha256').update(await readFile(new URL('../'+name,import.meta.url))).digest('hex');}
try{
 const search=await commerce.researchProshop({query:'Sandberg USB-C'});report.cases.push({searchCandidates:search.candidates.length});
 const comparison=await commerce.researchProshop({urls});report.comparison=comparison.products;report.cases.push('actual product comparison; destination totals remain null');
 if(process.argv.includes('--cart')){
  const p=comparison.products[0];if(p.unitPriceMinor!==5700||p.minimumShippingMinor!==3900)throw Error('Observed test price changed; review before any write.');
  const row=await commerce.propose({store:'proshop',profileId:'synthetic',profileRevision:1,billingChoice:'same-as-delivery',currency:'DKK',paymentMethod:'manual',shippingMinor:3900,observedAt:p.observedAt,items:[{url:p.url,title:p.title,seller:p.seller,variant:'Hvid, 1 m, USB-C til USB-C',quantity:1,unitPriceMinor:5700}]});
  const result=await commerce.prepareProshop(row.id,{expectedRevision:row.revision,reviewHash:row.reviewHash});
  report.cart={status:result.order.status,lines:result.order.cart.lines,checkoutStage:result.order.cart.checkoutStage,sharedBasketLinkPresent:!!result.order.cart.shareUrl,handoffReady:result.order.cart.handoffReady,shippingMinor:result.order.cart.shippingMinor,deliveryToPostalCode:result.order.cart.deliveryToPostalCode};
  report.cases.push('actual Commerce review -> durable consume -> observed AddItem -> HTML and JSON readback -> GET checkout; no retry');
  try{await commerce.prepareProshop(row.id,{expectedRevision:row.revision,reviewHash:row.reviewHash});throw Error('duplicate was accepted');}catch(e){if(e.message==='duplicate was accepted')throw e;report.cases.push('duplicate approval rejected');}
 }
 report.status='passed';
}catch(error){report.status='failed_or_unknown';report.reason=error.message;process.exitCode=1;}
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));
