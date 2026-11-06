// Synthetic process preload for HTTP and browser smoke tests only. Never imported by the application.
export const browserNetworkFixture = `
import https from 'node:https'; import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module'; import { EventEmitter } from 'node:events'; import { PassThrough } from 'node:stream';
globalThis.fetch=async()=>{throw new Error('No external fetch in this test')};
globalThis.WebSocket=class{constructor(){throw new Error('No external sockets in this test')}};
dns.lookup=async host=>{if(host!=='restaurant.example.org')throw new Error('Unexpected host');return [{address:'93.184.216.34',family:4}]};
https.request=(url,options,callback)=>{if(url.hostname!=='restaurant.example.org'||options.method!=='GET'||options.headers.Authorization||options.headers.Cookie)throw new Error('Unexpected network request');
const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=200;res.headers={'content-type':'text/html'};callback(res);res.end('<title>Syntetisk menu</title><p>To retter. Ingen reservation udført.</p>')});return req;}; syncBuiltinESMExports();`;
