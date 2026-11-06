import { randomUUID } from 'node:crypto';
const localDay = time => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const live = entry => entry.status !== 'closed';
const positive = (value, fallback, max) => { const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error('Ugyldig stemmegrænse.'); return n; };
export class VoiceSessions {
  constructor({ state, transact, save, control, hangup, now = () => Date.now(), env = {} }) {
    Object.assign(this, {state, transact, save, control, hangup, now}); this.timers = new Map();
    this.secondsPerSession = positive(env.JARVIS_VOICE_SECONDS_PER_SESSION, 600, 3600);
    this.secondsPerDay = positive(env.JARVIS_VOICE_SECONDS_PER_DAY, 3600, 86400);
  }
  entries() { return this.state.voiceSessions || []; }
  async reserve(scope, owner) {
    this.control.assertAllowed(scope);
    return this.transact(['voiceSessions'], async () => {
      this.control.assertAllowed(scope);
      const day = localDay(this.now()), entries = this.entries();
      if (entries.some(live)) throw new Error('En stemmesession er aktiv eller uafklaret. Afslut den før en ny.');
      if (entries.filter(e => e.day === day).reduce((n,e) => n + e.reservedSeconds,0) + this.secondsPerSession > this.secondsPerDay)
        throw new Error('Dagens reserverede stemmetid er opbrugt.');
      const entry = {id:randomUUID(),owner,scope,day,status:'creating',callId:null,
        reservedSeconds:this.secondsPerSession,expiresAt:this.now()+this.secondsPerSession*1000};
      this.state.voiceSessions = [...entries.filter(e => e.day === day || live(e)),entry];
      await this.save(); return entry.id;
    });
  }
  async rejected(id,status) {
    if(![400,401,403,404,422,429].includes(status))return; // 5xx/timeouts may have created a call.
    await this.transact(['voiceSessions'],async()=>{
      const e=this.entries().find(e=>e.id===id);if(!e||e.callId)throw new Error('Stemmeafvisningen er ikke entydig.');
      e.status='closed';e.reason='provider_rejected';await this.save();
    });
  }
  async attach(id, location) {
    const url = new URL(location || '', 'https://api.openai.com');
    const match = /^\/v1\/realtime\/calls\/([A-Za-z0-9_-]{1,200})$/.exec(url.pathname);
    if (url.origin !== 'https://api.openai.com' || !match || url.search || url.hash || url.username || url.password)
      throw new Error('Udbyderen returnerede ikke en gyldig opkaldsreference.');
    try { await this.transact(['voiceSessions'], async () => {
      const e = this.entries().find(e=>e.id===id); if (!e) throw new Error('Ukendt stemmesession.');
      e.callId=match[1]; e.status='active'; await this.save();
    }); } catch (error) { await this.hangup(match[1]).catch(()=>false); throw error; }
    const e=this.entries().find(e=>e.id===id);
    this.timers.set(id,setTimeout(()=>this.close(id).catch(()=>{}),Math.max(1,e.expiresAt-this.now())).unref());
    try { this.control.assertAllowed(e.scope); } catch(error) { await this.close(id); throw error; }
  }
  authorize(id, owner) {
    const e=this.entries().find(e=>e.id===id);
    if (!e || e.owner!==owner || e.status!=='active' || e.expiresAt<=this.now()) throw new Error('Stemmesessionen er udløbet eller stoppet.');
    this.control.assertAllowed(e.scope); return e.scope;
  }
  async close(id, owner) {
    const entry=this.entries().find(e=>e.id===id);
    if (!entry || (owner && entry.owner!==owner)) throw new Error('Ukendt stemmesession.');
    if (!live(entry)) return;
    this.control.revoke(entry.scope);
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    await this.transact(['voiceSessions'],async()=>{this.entries().find(e=>e.id===id).status='closing';await this.save();});
    let closed=false;
    try { if (entry.callId) closed=await this.hangup(entry.callId); }
    catch { /* Never report remote termination without provider confirmation. */ }
    await this.transact(['voiceSessions'],async()=>{this.entries().find(e=>e.id===id).status=closed?'closed':'unknown';await this.save();});
  }
  async closeAll() { for (const e of this.entries().filter(live)) await this.close(e.id); }
  snapshot() { return {active:this.entries().filter(e=>e.status==='active').length,
    unresolved:this.entries().filter(e=>live(e)&&e.status!=='active').length,
    secondsPerSession:this.secondsPerSession,secondsPerDay:this.secondsPerDay,
    reservedSecondsToday:this.entries().filter(e=>e.day===localDay(this.now())).reduce((n,e)=>n+e.reservedSeconds,0),
    coverage:'Reserved wall-clock seconds, not measured audio tokens or a currency budget.'}; }
}
