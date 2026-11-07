import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDiscordTables} from '../discord-format.mjs';
import {DiscordGateway} from '../discord-gateway.mjs';
const table='| Butik | Kabel | Fragt | I alt | Oplyst levering |\n|---|---:|---:|---:|---|\n| [Lippa](https://example.org/cable) | 29 kr. | 29 kr. | **58 kr.** | 1–3 hverdage |';
test('screenshot product comparison renders labelled entries with links and exact amounts',()=>{
 const result=formatDiscordTables(table);
 assert.match(result,/- Butik: \[Lippa\]\(https:\/\/example.org\/cable\)/);
 assert.match(result,/Fragt: 29 kr\./);assert.match(result,/I alt: \*\*58 kr\.\*\*/);assert.match(result,/Oplyst levering: 1–3 hverdage/);assert.doesNotMatch(result,/\|---/);
 assert.equal(formatDiscordTables(result),result);
});
test('code fences, prose and malformed tables remain unchanged; escaped pipes are preserved',()=>{
 for(const text of ['A | B','| A | B |\nnot a separator\n| 1 | 2 |','~~~md\n'+table+'\n~~~','\x60\x60\x60\n'+table+'\n\x60\x60\x60'])assert.equal(formatDiscordTables(text),text);
 const converted=formatDiscordTables('| Name | Value |\n|---|---|\n| a\\|b | unknown |');assert.match(converted,/a\\\|b/);assert.match(converted,/Value: unknown/);
});
test('actual sendReply formats before bounded delivery and retains redaction/mention suppression',async()=>{
 const sent=[],token='synthetic-discord-secret';
 const gateway=new DiscordGateway({onMessage:async()=>'',fetcher:async(url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'1'});}});
 gateway.config={token};const delivery=await gateway.sendReply('33333333333333333',table+'\n'+token+'\n@everyone',gateway.generation);
 assert.ok(delivery.complete);assert.ok(sent.every(x=>x.content.length<=1900));assert.ok(sent.every(x=>x.allowed_mentions.parse.length===0));
 const content=sent.map(x=>x.content).join('\n');assert.match(content,/I alt: \*\*58 kr/);assert.equal(content.includes(token),false);assert.doesNotMatch(content,/\|---/);
});

