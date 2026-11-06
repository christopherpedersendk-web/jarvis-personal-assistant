import test from 'node:test';
import assert from 'node:assert/strict';
import {browserContainerArgs,createIsolatedBrowser} from '../isolated-browser.mjs';
test('dynamic browser stays disabled unless explicitly configured with a local immutable image',()=>{
 assert.equal(createIsolatedBrowser({env:{}}),null);
 assert.throws(()=>createIsolatedBrowser({env:{JARVIS_DYNAMIC_BROWSER:'yes',JARVIS_BROWSER_IMAGE:'latest'}}));
});
test('browser container has no network, host mounts, elevated capabilities or writable root',()=>{
 const args=browserContainerArgs('sha256:'+'a'.repeat(64),'synthetic');
 for(const flag of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=1000:1000','--pull=never','--ipc=private'])assert.ok(args.includes(flag));
 for(const flag of ['--privileged','--network=host','-v','--mount','--ipc=host'])assert.ok(!args.includes(flag));
});
