import {randomUUID,createHash} from 'node:crypto';
import {masterDataFingerprint,shareProfile} from './master-data.mjs';
import {proshopProduct,proshopAddForm,proshopBasket,assertProshopBasket,proshopSearchLinks,proshopDetails} from './proshop.mjs';
import {rejectSecrets} from './privacy.mjs';
export const STORES=Object.freeze({proshop:{origin:'https://www.proshop.dk',methods:['manual'],terms:'https://www.proshop.dk/handelsbetingelser.htm'},amazon:{origin:'https://www.amazon.de',methods:['manual'],terms:'https://www.amazon.de/gp/help/customer/display.html'}});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
function closed(v,fields){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)))throw new Error('Ugyldige ordreoplysninger.');}
function text(x,max){if(typeof x!=='string'||!x.trim()||x.length>max||/[\x00-\x1f\x7f]/u.test(x))throw new Error('En vareoplysning mangler.');rejectSecrets(x);return x.trim();}
function integer(x,max){if(!Number.isSafeInteger(x)||x<0||x>max)throw new Error('Angiv kendte beløb i mindste valutaenhed og et gyldigt antal.');return x;}
export function storeUrl(value,store){const u=new URL(value);if(!STORES[store]||u.origin!==STORES[store].origin||u.username||u.password||u.hash||value.length>2048)throw new Error('Brug en offentlig HTTPS-adresse hos den valgte butik.');for(const [key]of u.searchParams)if(/token|secret|session|auth|email|phone|address|payment/i.test(key))throw new Error('Links med persondata eller sessionsoplysninger må ikke gemmes.');return u.href;}
export function validateOrder(input){closed(input,['store','profileId','profileRevision','currency','shippingMinor','items','paymentMethod','observedAt','billingChoice']);if(input.billingChoice!==undefined&&!['same-as-delivery','profile-billing'].includes(input.billingChoice))throw new Error('Vælg faktureringsadresse eksplicit.');const store=STORES[input.store];if(!store||!store.methods.includes(input.paymentMethod))throw new Error('Betalingsmetoden er ikke dokumenteret for denne butik. Vælg manuel checkout.');if(!['DKK','EUR'].includes(input.currency))throw new Error('Vælg DKK eller EUR uden automatisk valutaomregning.');if(!Array.isArray(input.items)||!input.items.length||input.items.length>20)throw new Error('Ordren skal indeholde 1–20 varelinjer.');const items=input.items.map(item=>{closed(item,['url','title','variant','seller','quantity','unitPriceMinor']);const quantity=integer(item.quantity,30);if(!quantity)throw new Error('Antal skal være mindst én.');return {url:storeUrl(item.url,input.store),title:text(item.title,160),variant:text(item.variant,160),seller:text(item.seller,160),quantity,unitPriceMinor:integer(item.unitPriceMinor,10000000)};});const shippingMinor=integer(input.shippingMinor,1000000),totalMinor=items.reduce((s,i)=>s+i.quantity*i.unitPriceMinor,shippingMinor);if(totalMinor>100000000)throw new Error('Ordren overstiger klargøringsgrænsen.');if(typeof input.observedAt!=='string'||!Number.isFinite(Date.parse(input.observedAt)))throw new Error('Pristidspunkt mangler.');return {...input,items,shippingMinor,totalMinor};}
export class Commerce{
 constructor({state,save,transact,control,masterData,enabled=false,proshopSession=null,now=()=>Date.now()}){Object.assign(this,{state,save,transact,control,masterData,enabled,proshopSession,now});}
 rows(){return this.state.commerceOrders||[];}
 async recover(){await this.transact(['commerceOrders'],async()=>{for(const r of this.rows())if(r.status==='preparing')r.status='unknown';else if(['draft','reviewed'].includes(r.status))r.status='stopped';await this.save();});}
 status(){return {enabled:this.enabled,browserWritesEnabled:false,proshopCartEnabled:Boolean(this.proshopSession),checkoutHandoffEnabled:false,sharedBasketHandoffEnabled:Boolean(this.proshopSession),paymentInitiationEnabled:false,note:'Ordrekladde og manuel butiksoverdragelse. Ingen betaling eller bestilling sendes af Jarvis.'};}
 list(){return structuredClone(this.rows());}
 assert(){this.control.assertAllowed();if(!this.enabled)throw new Error('Indkøbsklargøring er deaktiveret.');}
 validate(input){const order=validateOrder(input),data=this.masterData();shareProfile(data,{profileId:input.profileId,expectedRevision:input.profileRevision,origin:STORES[input.store].origin,allowedOrigins:Object.values(STORES).map(s=>s.origin)});if(Date.parse(order.observedAt)>this.now()+60000||this.now()-Date.parse(order.observedAt)>900000)throw new Error('Priserne skal være kontrolleret inden for 15 minutter.');return {order,data};}
 async revise(id,input){closed(input,['expectedRevision','order']);return this.transact(['commerceOrders'],async()=>{this.assert();const row=this.rows().find(r=>r.id===id);if(!row||row.status!=='draft'||row.revision!==input.expectedRevision)throw new Error('Ordrekladden er ændret eller afsluttet. Bevar dine rettelser og hent den aktuelle status.');this.control.assertAllowed(row.scope);const {order,data}=this.validate(input.order);const next={...order,id:row.id,revision:row.revision+1,status:'draft',profileFingerprint:masterDataFingerprint(data),scope:this.control.current(),expires:this.now()+120000,createdAt:row.createdAt,updatedAt:new Date(this.now()).toISOString(),paymentStatus:'not_initiated',orderStatus:'not_submitted'};next.reviewHash=hash(next);this.state.commerceOrders=this.rows().map(r=>r.id===id?next:r);await this.save();return structuredClone(next);});}
 async cancel(id,input){closed(input,['expectedRevision']);return this.transact(['commerceOrders'],async()=>{const row=this.rows().find(r=>r.id===id);if(!row||row.status!=='draft'||row.revision!==input.expectedRevision)throw new Error('Ordrekladden er ændret eller afsluttet.');row.status='cancelled';row.revision++;await this.save();return structuredClone(row);});}
 async propose(input){this.assert();return this.transact(['commerceOrders'],async()=>{this.assert();const {order,data}=this.validate(input);if(this.rows().length>=100)throw new Error('Gennemgå ordrearkivet før flere kladder.');const row={...order,id:randomUUID(),revision:1,status:'draft',profileFingerprint:masterDataFingerprint(data),scope:this.control.current(),expires:this.now()+120000,createdAt:new Date(this.now()).toISOString(),paymentStatus:'not_initiated',orderStatus:'not_submitted'};row.reviewHash=hash(row);this.state.commerceOrders=[...this.rows(),row];await this.save();return structuredClone(row);});}
 review(row,input){this.assert();this.control.assertAllowed(row.scope);if(row.status!=='draft'||row.revision!==input.expectedRevision||row.reviewHash!==input.reviewHash||this.now()>=row.expires||masterDataFingerprint(this.masterData())!==row.profileFingerprint)throw new Error('Ordre, pris, adresse eller review er ændret/udløbet. Opret et nyt gennemgået forslag.');const {reviewHash,...basis}=row;if(hash(basis)!==reviewHash)throw new Error('Ordregrundlaget er ændret.');}
 async handoff(id,input){closed(input,['expectedRevision','reviewHash']);return this.transact(['commerceOrders'],async()=>{const row=this.rows().find(r=>r.id===id);if(!row)throw new Error('Ordrekladde findes ikke.');this.review(row,input);row.status='handed_off';row.revision++;row.handoffAt=new Date(this.now()).toISOString();await this.save();return {order:structuredClone(row),links:row.items.map(i=>i.url),notice:'Åbn varerne i din egen browser og gennemgå kurv, pris, levering, sælger og betaling hos butikken. Jarvis har ikke oprettet en ordre, startet en betaling eller sendt dine adresser. En efterfølgende betaling/ordre har ukendt udfald for Jarvis, indtil den er verificeret særskilt.'};});}
 async researchProshop(input){
  closed(input,['query','urls']);this.assert();if(!this.proshopSession)throw new Error('Proshop-testadapteren er ikke konfigureret.');
  if(this.researching)throw new Error('En Proshop-søgning behandles allerede.');this.researching=true;
  try{return await this.control.controlled(async signal=>{
   const session=this.proshopSession('research');
   if(input.query!==undefined){if(input.urls!==undefined||typeof input.query!=='string'||!input.query.trim()||input.query.length>200)throw new Error('Angiv én søgning på højst 200 tegn.');rejectSecrets(input.query);return {candidates:proshopSearchLinks((await session.search(input.query,{signal})).html)};}
   if(!Array.isArray(input.urls)||!input.urls.length||input.urls.length>3)throw new Error('Vælg 1–3 Proshop-produkter til sammenligning.');
   const products=[];for(const url of input.urls){const page=await session.product(url,{signal});products.push(proshopProduct(page.html,url));}return {products};
  });}finally{this.researching=false;}
 }
 async prepareProshop(id,input){
  closed(input,['expectedRevision','reviewHash']);if(!this.proshopSession)throw new Error('Proshop-kurveadapteren er ikke konfigureret i dette testmiljø.');
  if(this.rows().some(x=>x.status==='unknown'))throw new Error('Et tidligere handelsudfald er ukendt. Inspicér session og journal før nye kurveændringer.');
  if(this.preparing)throw new Error('En Proshop-kurveopgave er allerede aktiv. Hent status før et nyt forsøg.');
  this.preparing=true;let consumed=false,writeStarted=false,row;
  try{
   row=this.rows().find(x=>x.id===id);if(!row)throw new Error('Ordrekladden findes ikke.');this.review(row,input);
   if(row.store!=='proshop'||row.currency!=='DKK'||row.paymentMethod!=='manual'||row.items.length!==1||row.items[0].quantity!==1||!row.billingChoice)throw new Error('Proshop-prøven kræver én vare, antal 1, DKK, manuel betaling og eksplicit faktureringsvalg.');
   const profile=this.masterData().profiles.find(p=>p.id===row.profileId);
   if(row.billingChoice==='profile-billing'&&!profile.billing)throw new Error('Den valgte særskilte faktureringsadresse mangler.');
   const session=this.proshopSession(id),scope=row.scope;
   return await this.control.controlled(async signal=>{
    const basket=proshopBasket((await session.basket({signal})).html);if(basket.lines.length)throw new Error('Testkurven er ikke tom. Der ændres ikke i eksisterende varer.');
    const page=await session.product(row.items[0].url,{signal}),product=proshopProduct(page.html,row.items[0].url);
    // Concrete first merchant/variant contract. Widen only after observation.
    if(product.productId!=='3298156'||row.items[0].variant!=='Hvid, 1 m, USB-C til USB-C'||!/Farve\s+Hvid/i.test(page.html.replace(/<[^>]*>/g,' '))||product.seller!==row.items[0].seller||product.title!==row.items[0].title||product.unitPriceMinor!==row.items[0].unitPriceMinor)throw new Error('Vare, variant, sælger eller pris afviger fra den observerede Proshop-kontrakt. Gennemgå et nyt forslag.');
    const form=proshopAddForm(page.html,product.productId);
    row=await this.transact(['commerceOrders'],async()=>{const current=this.rows().find(x=>x.id===id);this.review(current,input);current.status='preparing';current.revision++;await this.save();return structuredClone(current);});consumed=true;
    const check=()=>{this.assert();this.control.assertAllowed(scope);if(this.rows().find(x=>x.id===id)?.status!=='preparing'||masterDataFingerprint(this.masterData())!==row.profileFingerprint)throw new Error('Ordre, adresse eller stoptilstand er ændret.');};
    check();writeStarted=true;await session.add({...form,signal});check();
    const actual=proshopBasket((await session.basket({signal})).html);check();assertProshopBasket(actual,row);
    const details=proshopDetails((await session.details({signal})).html);check();assertProshopBasket(details,row);
    const checkout=await session.checkout({signal});check();
    const addressStep=checkout.status===200&&/<form\b[^>]*action=["']\/Basket\/CheckOut\/Register["']/i.test(checkout.html);
    return this.transact(['commerceOrders'],async()=>{check();const current=this.rows().find(x=>x.id===id);current.status='cart_verified';current.cart={lines:actual.lines,sourceHash:actual.sourceHash,verifiedAt:new Date(this.now()).toISOString(),checkoutStage:addressStep?'customer_details':'unconfirmed',shippingMinor:null,deliveryToPostalCode:null,paymentMethods:[],handoffReady:false,shareUrl:details.shareUrl};await this.save();return {order:structuredClone(current),notice:'Den faktiske testkurv er verificeret. Åbn butikkens delte kurv og vælg selv at lægge varerne i din egen kurv. Kontrollér eksisterende varer og priser dér. Checkout afventer brugerens login eller kontakt-/adressevalg. Fragt og levering til postnummeret er ukendt. Ingen adresse, betaling eller ordre er sendt. Delingslinket overfører kun varevalg, ikke cookies eller kontaktoplysninger.'};});
   },scope);
  }catch(error){if(consumed)await this.transact(['commerceOrders'],async()=>{const r=this.rows().find(x=>x.id===id);r.status=writeStarted?'unknown':'stopped';await this.save();}).catch(()=>{});throw new Error(consumed?'Proshop-udfaldet kræver manuel inspektion. Ingen automatisk gentagelse; hent status.':error.message);}
  finally{this.preparing=false;}
 }
 async stop(){await this.transact(['commerceOrders'],async()=>{for(const row of this.rows())if(row.status==='draft')row.status='stopped';else if(row.status==='preparing')row.status='unknown';await this.save();});}
}

