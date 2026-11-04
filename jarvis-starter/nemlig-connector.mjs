import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';

const READ_TOOLS = new Set(['search_products', 'get_product_details', 'get_basket']);
const WRITE_TOOL = 'set_basket_quantities';
const MAX_BYTES = 2_000_000;

function publicProduct(item) {
  if (!item || typeof item !== 'object') return null;
  const result = {};
  for (const key of ['Id', 'Name', 'Brand', 'Price', 'ItemPrice', 'UnitPrice', 'Unit', 'Description', 'Availability', 'IsAvailable', 'ProductNumber', 'Ingredients', 'Allergens', 'Nutrition']) {
    if (Object.hasOwn(item, key)) result[key] = item[key];
  }
  return Object.keys(result).length ? result : null;
}

function basketSummary(source) {
  if (!source || typeof source !== 'object') throw new Error('Nemlig returnerede en ugyldig kurv.');
  // The basket fingerprint must cover EVERY line. Refuse unknown formats rather
  // than authorizing a write against an incomplete/stale basket snapshot.
  if (!Array.isArray(source.Lines) || source.Lines.length > 500) throw new Error('Nemlig-kurvens linjer kunne ikke verificeres. Ingen ændringer tilladt.');
  const result = {};
  for (const key of ['NumberOfProducts', 'TotalProductsPrice', 'TotalProductDiscountPrice', 'TotalBagsPrice', 'TotalDepositsPrice', 'DeliveryPrice', 'TotalPrice', 'IsMinTotalValid', 'MinimumOrderTotal']) {
    if (Object.hasOwn(source, key)) result[key] = source[key];
  }
  result.Lines = Array.isArray(source.Lines) ? source.Lines.map(publicLine).filter(Boolean) : [];
  if (result.Lines.length !== source.Lines.length) throw new Error('Nemlig-kurven indeholder ukendte varelinjer. Ingen ændringer tilladt.');
  if (new Set(result.Lines.map(x => x.Id)).size !== result.Lines.length) throw new Error('Nemlig-kurven har gentagne vare-ID’er. Ingen ændringer tilladt.');
  return result;
}

function publicLine(line) {
  if (!line || typeof line !== 'object') return null;
  const id = String(line.Id ?? line.ProductNumber ?? '');
  const quantity = Number(line.Quantity);
  if (!/^\d{1,18}$/.test(id) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 9999) return null;
  const out = { Id: id, Quantity: quantity };
  for (const key of ['Name', 'Brand', 'ItemPrice', 'Price', 'DiscountSavings']) {
    if (Object.hasOwn(line, key)) out[key] = line[key];
  }
  return out;
}

function unpack(response) {
  if (response?.isError) throw new Error('Nemlig afviste forespørgslen.');
  if (response?.structuredContent) {
    const structured = response.structuredContent;
    return Object.hasOwn(structured, 'result') ? structured.result : structured;
  }
  const texts = (response?.content || []).filter(x => x?.type === 'text').map(x => x.text);
  if (!texts.length) throw new Error('Nemlig gav ikke et læsbart svar.');
  try { return JSON.parse(texts[0]); }
  catch { throw new Error('Nemlig returnerede ukendt dataformat.'); }
}

// Small, fixed stdio MCP client. Only allowlisted tools are reachable; no generic
// user-supplied method or command is ever passed to the child process.
export function callLocalNemligMcp(name, args = {}, { directory = process.env.NEMLIG_MCP_DIR, command = process.env.NEMLIG_MCP_UV, timeoutMs = 60_000 } = {}) {
  if (!(READ_TOOLS.has(name) || name === WRITE_TOOL)) throw new Error('MCP-værktøjet er ikke godkendt til JARVIS.');
  if (process.env.NEMLIG_ENABLE_LIVE !== 'yes' || !directory || !command || !isAbsolute(directory) || !isAbsolute(command)) {
    throw new Error('Nemlig MCP er ikke aktiveret eller korrekt konfigureret.');
  }
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME || '/nonexistent',
    LANG: 'C.UTF-8', PYTHONUNBUFFERED: '1',
    ...(process.env.NEMLIG_USER ? { NEMLIG_USER: process.env.NEMLIG_USER } : {}),
    ...(process.env.NEMLIG_PASS ? { NEMLIG_PASS: process.env.NEMLIG_PASS } : {}),
  };
  return new Promise((resolve, reject) => {
    // The owner must have run uv sync --frozen at install time. Do not sync or
    // download new dependencies while JARVIS is handling a shopping request.
    const child = spawn(command, ['--directory', directory, 'run', '--no-sync', '--offline', 'nemlig-mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'], env, shell: false,
    });
    let finished = false; let bytes = 0; let initialized = false;
    const timer = setTimeout(() => fail(new Error('Nemlig MCP svarede ikke inden tidsgrænsen.')), timeoutMs);
    function finish(value, error) {
      if (finished) return;
      finished = true; clearTimeout(timer); lines.close(); child.kill('SIGTERM');
      if (error) reject(error); else resolve(value);
    }
    function fail(error) { finish(null, error); }
    function send(message) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'); }
    const lines = createInterface({ input: child.stdout });
    child.stdin.on('error', () => {}); // EPIPE on startup/timeout is handled by child error/exit.
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BYTES) fail(new Error('Nemlig MCP-svar overskred størrelsesgrænsen.')); });
    child.stderr.on('data', () => {}); // Never log third-party stderr; credentials may be present.
    child.on('error', () => fail(new Error('Nemlig MCP kunne ikke startes.')));
    child.on('exit', () => { if (!finished) fail(new Error('Nemlig MCP lukkede forbindelsen.')); });
    lines.on('line', line => {
      if (finished || !line.trim()) return;
      let response;
      try { response = JSON.parse(line); } catch { fail(new Error('Nemlig MCP udsendte ugyldig JSON.')); return; }
      if (response.id === 1 && !initialized) {
        if (response.error || !response.result) { fail(new Error('Nemlig MCP-initialisering fejlede.')); return; }
        initialized = true;
        send({ method: 'notifications/initialized' });
        send({ id: 2, method: 'tools/call', params: { name, arguments: args } });
      } else if (response.id === 2) {
        if (response.error) { fail(new Error('Nemlig MCP kunne ikke udføre forespørgslen.')); return; }
        try { finish(unpack(response.result)); } catch (error) { fail(error); }
      }
    });
    send({ id: 1, method: 'initialize', params: {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'jarvis', version: '4.9.0' },
    } });
  });
}

function fingerprint(basket) {
  return createHash('sha256').update(JSON.stringify((basket.Lines || [])
    .map(x => [String(x.Id), Number(x.Quantity)]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex');
}

export class NemligShopping {
  constructor({ state, save = async () => {}, callTool = callLocalNemligMcp, now = () => new Date(), validateSourcePlan = () => {} }) {
    this.state = state; this.save = save; this.callTool = callTool; this.now = now;
    this.validateSourcePlan = validateSourcePlan;
    this.state.nemligProposals ||= [];
    for (const proposal of this.state.nemligProposals) if (proposal.status === 'applying') {
      proposal.status = 'unknown';
      proposal.result = { message: 'Overførslen blev afbrudt ved genstart. Kontroller kurven på Nemlig. JARVIS prøver ikke automatisk igen.' };
    }
    this.applying = false;
    this.seenProducts = new Map();
  }

  enabled() { return this.callTool !== callLocalNemligMcp || (process.env.NEMLIG_ENABLE_LIVE === 'yes' && Boolean(process.env.NEMLIG_MCP_DIR && process.env.NEMLIG_MCP_UV)); }
  status() { return { configured: this.enabled(), canPlaceOrder: false, approvalRequired: true,
    proposals: this.state.nemligProposals.slice(0, 10).map(x => ({ ...x, revision: x.revision || 1 })) }; }

  async search(query, limit = 10) {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) throw new Error('Skriv et konkret varenavn.');
    const raw = await this.callTool('search_products', { query: query.trim(), limit: Math.min(20, Math.max(1, Number(limit) || 10)) });
    if (!Array.isArray(raw)) throw new Error('Nemlig returnerede et uventet søgeresultat.');
    const products = raw.slice(0, 20).map(publicProduct).filter(Boolean);
    for (const product of products) if (/^\d{1,18}$/.test(String(product.Id))) {
      this.seenProducts.set(String(product.Id), { name: String(product.Name || '').slice(0, 120), seenAt: this.now().getTime() });
    }
    if (this.seenProducts.size > 500) this.seenProducts.clear();
    return products;
  }

  async basket() { return basketSummary(await this.callTool('get_basket', {})); }

  async details(productId) {
    const id = String(productId);
    if (!/^\d{1,18}$/.test(id)) throw new Error('Ugyldigt produkt-ID.');
    const product = publicProduct(await this.callTool('get_product_details', { product_id: id }));
    if (!product || String(product.Id) !== id || typeof product.Name !== 'string' || !product.Name.trim()) throw new Error('Varen kunne ikke verificeres hos Nemlig.');
    if (product.IsAvailable === false || product.Availability === false) throw new Error('Varen er ikke tilgængelig. Vælg et alternativ.');
    this.seenProducts.set(id, { name: product.Name.slice(0, 120), seenAt: this.now().getTime() });
    return product;
  }

  assertSourceCurrent(proposal) {
    if (proposal.sourcePlan) {
      const plan = this.state.mealPlans?.find(x => x.id === proposal.sourcePlan.id);
      if (!plan || plan.status !== 'shopping_ready' || plan.revision !== proposal.sourcePlan.revision) throw new Error('Madplanen eller indkøbslisten er ændret. Opret et nyt kurvforslag.');
      this.validateSourcePlan(plan);
    }
    if (proposal.sourceDraft) {
      const draft = this.state.shoppingDrafts?.find(x => x.id === proposal.sourceDraft.id);
      if (!draft || draft.revision !== proposal.sourceDraft.revision) throw new Error('Indkøbsforslaget er ændret. Opret et nyt kurvforslag.');
    }
  }

  additions(items, before) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new Error('Vælg 1–50 varer.');
    const ids = new Set();
    for (const item of items) {
      if (!item || !/^\d{1,18}$/.test(String(item.productId)) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 30) throw new Error('Ugyldigt produkt-ID eller antal.');
      const seen = this.seenProducts.get(String(item.productId));
      if (!seen || this.now().getTime() - seen.seenAt > 30 * 60_000) throw new Error('Søg efter varen på Nemlig, før den foreslås til kurven.');
      if (ids.has(String(item.productId))) throw new Error('Samme vare må kun forekomme én gang.');
      ids.add(String(item.productId));
    }
    const existing = new Map(before.Lines.map(x => [String(x.Id), x]));
    return items.map(item => {
      const current = existing.get(String(item.productId));
      const previous = Number(current?.Quantity || 0);
      const target = previous + item.quantity;
      if (target > 99) throw new Error('Maksimalt 99 stk. af samme vare i en foreslået kurv.');
      return { productId: String(item.productId), name: String(current?.Name || this.seenProducts.get(String(item.productId))?.name || '').slice(0, 120), add: item.quantity, previous, target };
    });
  }

  async propose(items, { sourcePlan = null, sourceDraft = null, expectedBasketFingerprint = null } = {}) {
    if (this.applying) throw new Error('Der behandles allerede en godkendt kurv. Vent et øjeblik.');
    const source = {};
    for (const [key, ref] of Object.entries({ sourcePlan, sourceDraft })) if (ref) {
      if (!/^[0-9a-f-]{36}$/.test(ref.id) || !Number.isInteger(ref.revision) || ref.revision < 1) throw new Error('Ugyldig kilde til kurvforslag.');
      source[key] = { id: ref.id, revision: ref.revision };
    }
    this.assertSourceCurrent(source);
    const before = await this.basket();
    if (expectedBasketFingerprint && fingerprint(before) !== expectedBasketFingerprint) throw new Error('Nemlig-kurven er ændret siden indkøbsforslaget. Beregn et nyt forslag.');
    const additions = this.additions(items, before);
    this.assertSourceCurrent(source);
    const proposal = {
      id: randomUUID(), status: 'pending', createdAt: this.now().toISOString(),
      expiresAt: new Date(this.now().getTime() + 15 * 60_000).toISOString(),
      basketFingerprint: fingerprint(before), additions, revision: 1, ...source,
    };
    this.state.nemligProposals.unshift(proposal);
    this.state.nemligProposals = this.state.nemligProposals.slice(0, 20);
    await this.save();
    return proposal;
  }

  async revise(id, { expectedRevision, items } = {}) {
    if (this.applying) throw new Error('Der behandles allerede en kurv. Vent et øjeblik.');
    const proposal = this.pending(id, expectedRevision);
    this.applying = true;
    try {
      const basket = await this.basket();
      this.pending(id, expectedRevision);
      if (fingerprint(basket) !== proposal.basketFingerprint) throw new Error('Nemlig-kurven blev ændret siden forslaget. Opret et nyt forslag.');
      const originalIds = new Set(proposal.additions.map(x => x.productId));
      if (!Array.isArray(items) || items.some(x => !originalIds.has(String(x?.productId)))) throw new Error('Vælg nye varer i indkøbsforslaget, før et nyt kurvforslag oprettes.');
      const additions = this.additions(items, basket);
      proposal.additions = additions; proposal.revision = expectedRevision + 1; proposal.updatedAt = this.now().toISOString();
      await this.save();
      return proposal;
    } finally { this.applying = false; }
  }

  pending(id, expectedRevision) {
    const proposal = this.state.nemligProposals.find(x => x.id === id);
    if (!proposal || proposal.status !== 'pending') throw new Error('Forslaget findes ikke eller er allerede behandlet.');
    if (!Number.isInteger(expectedRevision) || expectedRevision !== (proposal.revision || 1)) throw new Error('Kurvforslaget blev ændret. Genindlæs og gennemgå det nyeste forslag.');
    const expires = Date.parse(proposal.expiresAt);
    if (!Number.isFinite(expires) || expires <= this.now().getTime()) throw new Error('Kurvforslaget er udløbet. Opret et nyt.');
    this.assertSourceCurrent(proposal);
    return proposal;
  }

  async approve(id, approvedByOwner, expectedRevision) {
    // An authenticated, deliberate click on the displayed proposal is the
    // approval. A missing or false flag must never mutate the real basket.
    if (approvedByOwner !== true) throw new Error('Kurvændringen kræver udtrykkelig godkendelse via Overfør til Nemlig.');
    if (this.applying) throw new Error('Der behandles allerede en godkendt kurv.');
    const proposal = this.pending(id, expectedRevision);
    this.applying = true;
    try {
      const actual = await this.basket();
      this.pending(id, expectedRevision); // Sources/revision can change while the read is pending.
      if (fingerprint(actual) !== proposal.basketFingerprint) throw new Error('Nemlig-kurven blev ændret siden forslaget. Opret et nyt forslag.');
      proposal.status = 'applying'; proposal.approvedAt = this.now().toISOString();
      await this.save(); // Mark single-use BEFORE external mutation.
      try { this.assertSourceCurrent(proposal); }
      catch (error) { proposal.status = 'superseded'; await this.save(); throw error; }
      try {
        const result = await this.callTool(WRITE_TOOL, { items: proposal.additions.map(x => ({ product_id: x.productId, quantity: x.target })) });
        const outcomes = Array.isArray(result.results) ? result.results : [];
        const expectedIds = new Set(proposal.additions.map(x => x.productId));
        const outcomeIds = outcomes.map(x => String(x.product_id));
        const returnedBasket = result.basket ? basketSummary(result.basket) : null;
        const returnedQuantities = new Map((returnedBasket?.Lines || []).map(x => [x.Id, x.Quantity]));
        const complete = outcomes.length === expectedIds.size && new Set(outcomeIds).size === expectedIds.size &&
          outcomes.every(x => x.status === 'ok' && expectedIds.has(String(x.product_id))) &&
          (!returnedBasket || proposal.additions.every(x => returnedQuantities.get(x.productId) === x.target));
        proposal.status = complete ? 'completed' : 'partial';
        proposal.result = { outcomes: outcomes.map(x => ({ productId: String(x.product_id), status: x.status === 'ok' ? 'ok' : 'failed' })),
          basket: returnedBasket, hasBasketError: Boolean(result.basket_error) };
      } catch {
        proposal.status = 'unknown';
        proposal.result = { message: 'Kurven kan være delvist opdateret. Kontroller den på Nemlig før et nyt forsøg.' };
      }
      await this.save();
      return proposal;
    } finally { this.applying = false; }
  }

  async decline(id) {
    if (this.applying) throw new Error('Der behandles allerede en kurv. Vent et øjeblik.');
    const proposal = this.state.nemligProposals.find(x => x.id === id);
    if (!proposal || proposal.status !== 'pending') throw new Error('Forslaget kan ikke afvises.');
    proposal.status = 'declined';
    await this.save();
    return proposal;
  }
}
