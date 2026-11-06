import assert from 'node:assert/strict';
import OpusScript from 'opusscript';
import * as dave from '@snazzah/davey';
import {generateDependencyReport} from '@discordjs/voice';
import {connectDiscordVoice} from './adapter.mjs';
const codec=new OpusScript(48000,2,OpusScript.Application.VOIP);
try{const encoded=codec.encode(Buffer.alloc(3840),960);assert.equal(codec.decode(encoded).length,3840);}finally{codec.delete();}
const session=new dave.DAVESession(dave.DAVE_PROTOCOL_VERSION,'111111111111111111','222222222222222222');
assert.equal(session.userId,'111111111111111111');session.reset();
assert.equal(typeof connectDiscordVoice,'function');assert.ok(Object.keys(dave).length);
assert.match(generateDependencyReport(),/DAVE Libraries/);
console.log('PASS: pinned voice adapter imports, native DAVE loads, synthetic Opus roundtrip works. No Discord connection or live audio was tested.');
