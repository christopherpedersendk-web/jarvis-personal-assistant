import { randomUUID } from 'node:crypto';

export const DEFAULT_PLAYBOOK = `# JARVIS – sekretærens arbejdsinstruktioner

## Morgenrapport
- Skriv på dansk, kort og konkret.
- Prioritér verificerbare nyheder med dato og direkte kildelinks.
- Interesseområder: AI, cybersikkerhed, DORA, NIS2, IT-revision og Danmark/Norden.
- Fremhæv hvad der er nyt siden sidste rapport. Undgå gentagelser.
- Skeln mellem bekræftede forhold, vurderinger og usikkerhed.

## Overvågninger
- Notér altid produktnavn, nøjagtig variant, forhandler, valuta, pris, tidspunkt og kilde.
- Sammenlign med senest observerede resultat, hvis det findes.
- Skriv NO_CHANGE på første linje, hvis ingen væsentlig ændring kan dokumenteres.
- Skriv CHANGE på første linje, hvis en faktisk ændring kan dokumenteres.
- Hvis en pris ikke kan verificeres, så skriv det eksplicit.

## Personlig sekretær
- Husk præferencer på tværs af projekter, når brugeren udtrykkeligt beder dig huske dem.
- Forbered bookinger, køb og beskeder som forslag. Udfør aldrig en ekstern handling uden særskilt endelig godkendelse.
- Del aldrig API-nøgler, kundedata eller følsomme oplysninger.
`;

export class SecretaryCore {
  constructor({ state, save, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.state.playbook ??= DEFAULT_PLAYBOOK;
    this.state.memories ||= [];
    this.state.inbox ||= [];
    this.state.approvals ||= [];
  }

  async savePlaybook(content) {
    if (typeof content !== 'string' || !content.trim() || content.length > 15_000) throw new Error('Instruktionsdokumentet skal være 1–15.000 tegn.');
    this.state.playbook = content;
    await this.save();
    return this.state.playbook;
  }

  memoryContext() {
    return this.state.memories.filter(x => !x.archived).map(x => `- ${x.text}`).join('\n').slice(0, 8000);
  }

  async remember(text, projectId = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > 1200) throw new Error('Hukommelsespunktet skal være 1–1.200 tegn.');
    if (projectId !== null && (typeof projectId !== 'string' || projectId.length > 80)) throw new Error('Ugyldigt projekt-ID.');
    if (this.state.memories.filter(x => !x.archived).length >= 200) throw new Error('Højst 200 aktive hukommelsespunkter.');
    const item = { id: randomUUID(), text: text.trim(), projectId, archived: false, createdAt: this.now().toISOString() };
    this.state.memories.unshift(item);
    await this.save();
    return item;
  }

  async archiveMemory(id) {
    const item = this.state.memories.find(x => x.id === id && !x.archived);
    if (!item) throw new Error('Hukommelsespunktet findes ikke.');
    item.archived = true;
    await this.save();
    return item;
  }

  async addInbox({ title, text, kind = 'info', taskId = null }) {
    const item = { id: randomUUID(), title: String(title).slice(0, 120), text: String(text).slice(0, 2500),
      kind, taskId, read: false, at: this.now().toISOString() };
    this.state.inbox.unshift(item);
    this.state.inbox = this.state.inbox.slice(0, 100);
    await this.save();
    return item;
  }

  async readInbox(id) {
    const item = this.state.inbox.find(x => x.id === id);
    if (!item) throw new Error('Beskeden findes ikke.');
    item.read = true;
    await this.save();
    return item;
  }

  async proposeAction({ kind, title, description, url = '' }) {
    if (!['booking', 'purchase', 'message', 'other'].includes(kind)) throw new Error('Ugyldig handlingstype.');
    if (typeof title !== 'string' || !title.trim() || title.length > 120) throw new Error('Angiv en titel på højst 120 tegn.');
    if (typeof description !== 'string' || !description.trim() || description.length > 2000) throw new Error('Angiv en beskrivelse på højst 2.000 tegn.');
    if (url && (typeof url !== 'string' || !/^https:\/\//i.test(url) || url.length > 500)) throw new Error('Brug kun gyldige HTTPS-links.');
    const item = { id: randomUUID(), kind, title: title.trim(), description: description.trim(), url,
      status: 'pending', createdAt: this.now().toISOString() };
    this.state.approvals.unshift(item);
    this.state.approvals = this.state.approvals.slice(0, 100);
    await this.save();
    return item;
  }

  async decideAction(id, decision) {
    const item = this.state.approvals.find(x => x.id === id && x.status === 'pending');
    if (!item) throw new Error('Handlingen findes ikke eller er allerede behandlet.');
    if (!['approve', 'reject'].includes(decision)) throw new Error('Ugyldig beslutning.');
    // Approval is explicitly NOT execution; a future browser adapter must re-check authorization.
    item.status = decision === 'approve' ? 'approved_not_executed' : 'rejected';
    item.decidedAt = this.now().toISOString();
    await this.save();
    return item;
  }
}
