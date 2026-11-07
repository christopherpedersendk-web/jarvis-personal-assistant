import {createHash} from 'node:crypto';
import {proshopProductUrl} from './proshop-session.mjs';
const digest=x=>createHash('sha256').update(x).digest('hex');
const decode=x=>x.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&nbsp;/g,' ');
const text=html=>decode(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
export function proshopProduct(html,url,now=new Date().toISOString()){
 const u=proshopProductUrl(url),id=u.pathname.split('/').at(-1);let product;
 for(const [,raw]of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  let parsed;try{parsed=JSON.parse(raw);}catch{continue;}if(parsed['@type']==='Product'&&String(parsed.sku)===id){if(product)throw Error('Modstridende eller gentagne produktdata. Gennemgå en ny observation.');product=parsed;}
 }
 const offer=product?.offers;
 if(!product||Array.isArray(offer)||offer?.priceCurrency!=='DKK'||!/^\d+(?:\.\d{1,2})?$/.test(String(offer.price))||typeof product.name!=='string'||!product.name.trim()||typeof offer.seller?.name!=='string')throw Error('Proshops produktkontrakt kunne ikke bekræftes.');
 const unitPriceMinor=Math.round(Number(offer.price)*100),plain=text(html);if(!Number.isSafeInteger(unitPriceMinor)||unitPriceMinor<0||unitPriceMinor>10000000)throw Error('Produktprisen er ugyldig eller uden for grænsen.');
 const shipping=/Billigste fragt \(privatkunde\)\s*(\d+(?:[.,]\d{2})?)\s*kr\./i.exec(plain);
 const delivery=/(?:På lager\s*[-–]\s*Leveres [a-zæøå]+)|(?:På lager\s*[-–]\s*)?\d+(?:\s*[-–]\s*\d+)?\s*dages levering/i.exec(plain)?.[0]||null;
 return {store:'proshop',productId:id,url:u.href,title:product.name.slice(0,160),seller:offer.seller.name.slice(0,160),unitPriceMinor,currency:'DKK',
  minimumShippingMinor:shipping?Math.round(Number(shipping[1].replace(',','.'))*100):null,
  shippingMinor:null,totalMinor:null,delivery,postalCode:null,deliveryToPostalCode:null,
  observedAt:now,sourceHash:digest(html),trust:'untrusted-web-data',notice:'Billigste fragt er en offentlig minimumspris. Samlet pris og levering til dit postnummer er ukendt indtil checkout.'};
}
export function proshopAddForm(html,productId){
 const forms=[...html.matchAll(/<form\b[^>]*action=["']\/Basket\/AddItem["'][^>]*>([\s\S]*?)<\/form>/gi)];
 for(const [whole,content]of forms){
  if(!/method=["']post["']/i.test(whole))continue;
  const fields={};for(const [,attrs]of content.matchAll(/<input\b([^>]+)>/gi)){const name=/\bname=["']([^"']+)["']/i.exec(attrs)?.[1],value=/\bvalue=["']([^"']*)["']/i.exec(attrs)?.[1];if(name)fields[name]=decode(value||'');}
  if(fields.productId===productId&&/^[-a-zA-Z0-9_]{1,200}$/.test(fields.token||''))return {productId,token:fields.token};
 }
 throw Error('Den observerede Proshop-kurveformular er ændret eller mangler. Ingen skrivning er sendt.');
}
export function proshopBasket(html){
 const events=[...html.matchAll(/data-gtm-click=["']([^"']+)["']/gi)].map(([,raw])=>{try{return JSON.parse(decode(raw));}catch{return null;}}).filter(x=>x?.event==='begin_checkout');
 if(!events.length||events.some(e=>JSON.stringify(e.ecommerce)!==JSON.stringify(events[0].ecommerce)))throw Error('Proshops kurvekontrakt er ændret. Gennemgå kurven manuelt.');
 const items=events[0].ecommerce?.items;if(!Array.isArray(items)||items.length>20)throw Error('Ugyldigt faktisk kurveindhold.');
 const lines=items.map(i=>{if(!/^\d{7}$/.test(String(i.item_id))||!Number.isSafeInteger(i.quantity)||i.quantity<1||typeof i.price!=='number'||!Number.isFinite(i.price)||i.price<0)throw Error('Ugyldig kurvelinje.');return {productId:String(i.item_id),quantity:i.quantity,unitPriceMinor:Math.round(i.price*100),title:typeof i.item_name==='string'?i.item_name.slice(0,160):null};});
 return {lines,sourceHash:digest(html),shippingMinor:null,deliveryToPostalCode:null};
}
export function assertProshopBasket(basket,order){
 if(order.items.length!==1||basket.lines.length!==1)throw Error('Kurven skal indeholde præcis den ene godkendte vare.');
 const expected=order.items[0],actual=basket.lines[0];
 if(actual.productId!==proshopProductUrl(expected.url).pathname.split('/').at(-1)||actual.quantity!==expected.quantity||actual.unitPriceMinor!==expected.unitPriceMinor)throw Error('Faktisk kurv afviger fra vare, antal eller godkendt pris. Ny gennemgang kræves.');
}
export function proshopSearchLinks(html){
 const found=new Map();for(const [,href]of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)){
  try{const u=proshopProductUrl(new URL(decode(href),'https://www.proshop.dk').href);if(u.pathname.startsWith('/USB-kabel/'))found.set(u.href,{url:u.href,title:decodeURIComponent(u.pathname.split('/')[2]).replace(/-/g,' ')});}catch{}
  if(found.size>=20)break;
 }return [...found.values()];
}
export function proshopDetails(raw){
 const data=JSON.parse(raw);if(data.Currency!=='DKK'||!Array.isArray(data.Lines)||data.IsAnonymous!==true||!/^[a-zA-Z0-9-]{1,100}$/.test(data.ShareLink))throw Error('Anonym kurvedeling kunne ikke bekræftes.');
 const lines=data.Lines.map(i=>{if(!/^\d{7}$/.test(i.ProductId)||!Number.isSafeInteger(i.Quantity)||i.Quantity<1||typeof i.PriceWithVat!=='number'||!Number.isFinite(i.PriceWithVat)||i.PriceWithVat<0)throw Error('Ugyldig faktisk kurvedetalje.');return {productId:i.ProductId,quantity:i.Quantity,unitPriceMinor:Math.round(i.PriceWithVat*100)};});
 return {lines,shareUrl:'https://www.proshop.dk/Basket/Shared/'+data.ShareLink,sourceHash:digest(raw),shippingMinor:null,deliveryToPostalCode:null};
}

// Observed anonymous customer-details step, 2026-11-07. This identifies the
// read-only contract; it grants no right to register, log in or submit an order.
export function proshopCheckout(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>1000000)throw Error('Ugyldigt checkoutgrundlag.');
 const forms=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].filter(([,attrs])=>/\baction=["']\/Basket\/CheckOut\/Register["']/i.test(attrs)&&/\bmethod=["']post["']/i.test(attrs));
 if(forms.length!==1)return {stage:'unconfirmed',guestSupported:false,sourceHash:digest(html),shippingMinor:null,totalMinor:null};
 const names=[...forms[0][2].matchAll(/<(?:input|select)\b[^>]*\bname=["']([^"']+)["']/gi)].map(([,name])=>decode(name));
 const required=['__RequestVerificationToken','ControllerName','MethodName','Name','Address1','ZipCode','City','CountryCode','Phone','AnonymousUser.Email','AnonymousUser.ConfirmEmail'];
 const supported=required.every(name=>names.filter(n=>n===name).length===1);
 return {stage:supported?'customer_details':'unconfirmed',guestSupported:supported,sourceHash:digest(html),shippingMinor:null,totalMinor:null};
}
