import {readFile,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openJarvisDiagnostics} from '../openjarvis-diagnostics.mjs';
const report=openJarvisDiagnostics(process.env);
const add=(id,status,reason)=>report.checks.push({id,status,reason});
try {
 const pin=JSON.parse(await readFile(new URL('../openclaw-runtime/pin.json',import.meta.url)));
 const runtime=JSON.parse(await readFile(new URL('../openclaw-runtime/node_modules/openclaw/package.json',import.meta.url)));
 const plugin=JSON.parse(await readFile(new URL('../openclaw-runtime/node_modules/@openclaw/parallel-plugin/package.json',import.meta.url)));
 add('installed-packages',runtime.version===pin.version&&plugin.version===pin.version?'verified':'invalid','Installerede pakkeversioner sammenholdt med pin; dette beviser ikke runtimeadfærd.');
}catch{add('installed-packages','unverified','Installeret runtime/plugin eller pin kunne ikke læses.');}
try {
 const f=await lstat('/etc/openjarvis-research.env');
 const privateFile=f.isFile()&&!f.isSymbolicLink()&&(f.mode&0o077)===0;
 add('credential-file',privateFile?'verified':'invalid','Kun filtype/rettigheder kontrolleret; indholdet er ikke læst.');
}catch{add('credential-file','unverified','Tjenestens credentialfil kunne ikke inspiceres.');}
try {
 const {stdout}=await promisify(execFile)('systemctl',['show','openjarvis-research.service','--property=LoadState,DynamicUser,User,NoNewPrivileges,ProtectSystem,ProtectHome,PrivateTmp'],{timeout:3000,maxBuffer:8192});
 const p=Object.fromEntries(stdout.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 const loaded=p.LoadState==='loaded';
 const hardened=loaded&&(p.DynamicUser==='yes'||Boolean(p.User&&p.User!=='root'))&&p.NoNewPrivileges==='yes'&&p.ProtectSystem==='strict'&&['yes','true'].includes(p.ProtectHome)&&['yes','true'].includes(p.PrivateTmp);
 add('systemd',hardened?'verified':loaded?'invalid':'unverified','Effektive systemd-egenskaber læst; ingen tjeneste er startet eller ændret. Dette beviser ikke browser-egress.');
}catch{add('systemd','unverified','Systemd-egenskaber er ikke tilgængelige.');}
console.log(JSON.stringify(report,null,2));
