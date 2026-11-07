import {localEndpoint} from './openjarvis-transport.mjs';
// Pure configuration inspection. Never contacts a service or echoes input values.
export function openJarvisDiagnostics(env = {}, observed = {}) {
 const checks=[];
 const add=(id,status,reason)=>checks.push({id,status,reason});
 add('enabled',env.OPENJARVIS_ENABLED==='yes'?'configured':'disabled',env.OPENJARVIS_ENABLED==='yes'?'Research er aktiveret i konfigurationen.':'Research er slået fra.');
 let endpoint=false;
 try {localEndpoint(env.OPENJARVIS_GATEWAY_URL||'http://127.0.0.1:18789');endpoint=true;}catch{}
 add('endpoint',endpoint?'configured':'invalid',endpoint?'Adressen er begrænset til loopback; faktisk lytteadresse er ikke målt.':'Gateway-adressen opfylder ikke loopback-kontrakten.');
 add('contract',env.OPENJARVIS_GATEWAY_MODE==='restricted-v1'?'configured':'unverified','Den gennemgåede kontrakt er restricted-v1.');
 add('credential',typeof env.OPENJARVIS_GATEWAY_TOKEN==='string'&&env.OPENJARVIS_GATEWAY_TOKEN.length>=32?'configured':'invalid','Researchcredential skal være særskilt og mindst 32 tegn; operatoradskillelse kan ikke bevises fra klienten.');
 const fresh=Number.isFinite(Date.parse(observed.lastCheckedAt))&&Date.now()-Date.parse(observed.lastCheckedAt)>=0&&Date.now()-Date.parse(observed.lastCheckedAt)<60000;
 add('runtime',fresh&&observed.connectionStatus==='ready'?'verified':'unverified',fresh&&observed.connectionStatus==='ready'?'Gatewayens versions- og værktøjskontrakt svarede korrekt.':'Ingen frisk, bestået runtimekontrol.');
 add('host-isolation','unverified','Tjenestebruger, systemd, filrettigheder og faktisk netværksisolation er ikke observeret af klienten.');
 return {checks,readyForResearch:env.OPENJARVIS_ENABLED==='yes'&&checks.filter(x=>['endpoint','contract','credential'].includes(x.id)).every(x=>x.status==='configured')&&checks.find(x=>x.id==='runtime').status==='verified',hostAccepted:false};
}
