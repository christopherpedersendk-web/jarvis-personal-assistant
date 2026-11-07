// Observed guest-contact form, 2026-11-07. Never an order/payment contract.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),decode=s=>String(s).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
const attribute=(s,k)=>new RegExp('\\b'+k+'=["\']([^"\']*)["\']','i').exec(s)?.[1];
const names=['__RequestVerificationToken','ControllerName','MethodName','Name','Address1','Address2','ZipCode','City','CountryCode','Phone','Mobile','AnonymousUser.Email','AnonymousUser.ConfirmEmail'];
export function proshopGuestForm(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>1000000)throw Error('Ugyldigt gæsteformulargrundlag.');
 const forms=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].filter(([,a])=>attribute(a,'action')==='/Basket/CheckOut/Register'&&attribute(a,'method')?.toLowerCase()==='post');
 if(forms.length!==1)throw Error('Den observerede gæsteformular mangler eller er tvetydig.');
 const fields=[...forms[0][2].matchAll(/<(input|select)\b([^>]*)>([\s\S]*?)(?=<input\b|<select\b|$)/gi)].map(([,tag,a,content])=>({tag,name:attribute(a,'name'),value:decode(attribute(a,'value')||''),max:attribute(a,'data-val-length-max'),content})).filter(x=>x.name);
 if(fields.length!==names.length||names.some(name=>fields.filter(f=>f.name===name).length!==1))throw Error('Gæsteformularens felter er ændret. Ingen kontaktoplysninger er sendt.');
 const field=name=>fields.find(f=>f.name===name);
 if(field('ControllerName').value!=='CheckOut'||field('MethodName').value!=='Register'||field('CountryCode').tag!=='select'||!/<option\b[^>]*value=["']DK["']/i.test(field('CountryCode').content))throw Error('Gæstekontrakten matcher ikke den observerede danske formular.');
 const limits={Name:'35',Address1:'35',Address2:'35',ZipCode:'7',City:'100',Phone:'16',Mobile:'16'};
 if(Object.entries(limits).some(([name,max])=>field(name).max!==max))throw Error('Butikkens valideringsgrænser er ændret. Gennemgå en ny kontrakt.');
 const token=field('__RequestVerificationToken').value;if(!token||token.length>2048||/[\x00-\x20\x7f]/u.test(token))throw Error('Butikkens aktuelle gæstetoken mangler.');
 return {token,contractHash:hash({action:'/Basket/CheckOut/Register',method:'POST',names,limits,country:'DK',controller:'CheckOut',operation:'Register'}),sourceHash:hash(html)};
}
function text(x,min,max){if(typeof x!=='string'||x.length<min||x.length>max||/[\x00-\x1f\x7f\u0400-\u04ff]/u.test(x)||x.trim()!==x)throw Error('Et kontaktfelt matcher ikke butikkens observerede grænser. Ret det i privat Stamdata; værdien er ikke sendt.');return x;}
export function proshopGuestPayload(token,contact){
 if(typeof token!=='string'||!token||token.length>2048||/[\x00-\x20\x7f]/u.test(token))throw Error('Ugyldigt gæstetoken.');
 if(!contact||Object.keys(contact).sort().join()!=='city,country,email,name,phone,postalCode,street')throw Error('Ukendte gæstekontaktfelter.');
 const name=text(contact.name,2,35),street=text(contact.street,2,35),city=text(contact.city,2,100),email=text(contact.email,3,254),phone=String(contact.phone||'').replace(/[ ()-]/g,'');
 if(name.split(/\s+/).length<2||!/^\+?\d{8,15}$/.test(phone)||phone.length>16||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||contact.country!=='DK'||contact.postalCode!=='2900')throw Error('Første gæsteforløb kræver fuldt navn, gyldig telefon/e-mail og eksplicit dansk adresse til 2900. Ret privat Stamdata; intet er sendt.');
 return {'__RequestVerificationToken':token,ControllerName:'CheckOut',MethodName:'Register',Name:name,Address1:street,Address2:'',ZipCode:'2900',City:city,CountryCode:'DK',Phone:phone,Mobile:'','AnonymousUser.Email':email,'AnonymousUser.ConfirmEmail':email};
}
export function guestContact(profile){return {name:profile.name,phone:profile.phone,email:profile.email,street:profile.delivery.street,postalCode:profile.delivery.postalCode,city:profile.delivery.city,country:profile.delivery.country};}
