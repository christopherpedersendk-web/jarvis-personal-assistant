// Explicit synthetic provider transport for disposable test processes only.
// The application has no production mock flag and never imports this module.
export const realtimeNetworkFixture = `
let syntheticCalls=0;
globalThis.fetch=async (input,options={})=>{
 const url=new URL(input);
 if(url.origin!=='https://api.openai.com'||options.method!=='POST')throw new Error('Unexpected external request');
 if(url.pathname==='/v1/realtime/calls'){
  if(!(options.body instanceof FormData))throw new Error('Invalid synthetic session');
  const session=JSON.parse(options.body.get('session'));
  if(!session.tools.length||session.audio.input.transcription.model!=='gpt-live-transcribe')throw new Error('Unsupported WebRTC transcription configuration');
  return new Response('v=0\\r\\nsynthetic-answer',{status:201,headers:{location:'/v1/realtime/calls/synthetic-'+(++syntheticCalls)}});
 }
 if(/^\\/v1\\/realtime\\/calls\\/synthetic-\\d+\\/hangup$/.test(url.pathname))return new Response(null,{status:200});
 throw new Error('Unexpected external request');
};`;
