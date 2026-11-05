import { randomUUID, createHash } from 'node:crypto';
import { createJobTransitions } from './job-state-transition.mjs';
import { foodWords, ingredientIdentity, ingredientMatchesAvoid } from './food-identity.mjs';

const normal = value => String(value || '').normalize('NFKC').trim().toLocaleLowerCase('da-DK');
const idOf = product => String(product?.Id ?? '');
const validId = value => /^\d{1,18}$/.test(String(value));
const hashList = items => createHash('sha256').update(JSON.stringify(items)).digest('hex');
const basketHash = basket => hashList(basket.Lines.map(x => [String(x.Id), Number(x.Quantity)]).sort((a, b) => a[0].localeCompare(b[0])));
const clone = value => structuredClone(value);
const UNITS = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10], stk: ['stk', 1], fed: ['fed', 1] };

// This is a conservative conflict screen, not an allergen detector or a claim
// that a product is safe. Incomplete retailer text and vegan badges never clear
// the need for owner review. Only the fixed read-only product fields are data.
const FOOD_GROUPS = [
  { names: ['æg', 'egg', 'eggs'], diet: 'vegan', term: /^(?:æg(?:ge\p{L}*)?|æggene|egg(?:s|white\p{L}*|yolk\p{L}*|powder|protein)?)$/u },
  { names: ['mælk', 'milk'], diet: 'vegan', term: /^(?:mælk(?:e\p{L}*)?|komælk|sødmælk|letmælk|minimælk|skummetmælk(?:spulver)?|milk|whey|valle(?:pulver|protein)?|kasein|casein|laktose|lactose)$/u },
  { names: ['ost', 'cheese'], diet: 'vegan', term: /^(?:ost(?:e\p{L}*)?|cheese|parmesan|mozzarella|feta|cheddar|gouda|brie|emmentaler)$/u },
  { names: ['smør', 'butter'], diet: 'vegan', term: /^(?:smør(?:ret|fedt)?|butter|butterfat)$/u },
  { names: ['fløde', 'cream'], diet: 'vegan', term: /^(?:fløde\p{L}*|piskefløde|madlavningsfløde|cremefraiche|cream)$/u },
  { names: ['yoghurt', 'yogurt'], diet: 'vegan', term: /^(?:yoghurt|yogurt|skyr)$/u },
  { names: ['honning', 'honey'], diet: 'vegan', term: /^(?:honning|honey)$/u },
  { names: ['kød', 'meat'], diet: 'vegetarian', term: /^(?:kød(?:et|fars|boller)?|meat|oksekød\p{L}*|svinekød\p{L}*|kalvekød\p{L}*|lammekød\p{L}*|beef|pork|veal|lamb|bacon|skinke|ham|salami|pepperoni|pølse\p{L}*|sausage\p{L}*|gelatine|gelatin)$/u },
  { names: ['kylling', 'chicken'], diet: 'vegetarian', term: /^(?:kylling\p{L}*|chicken|hønse\p{L}*|kalkun\p{L}*|turkey|andekød|andebryst|duck)$/u },
  { names: ['fisk', 'fish'], diet: 'vegetarian', term: /^(?:fisk\p{L}*|fish|laks\p{L}*|salmon|tun|tuna|torsk|cod|sild|herring|ansjos\p{L}*|anchov\p{L}*|makrel|mackerel|reje\p{L}*|shrimp\p{L}*|prawn\p{L}*|krabbe\p{L}*|crab|musling\p{L}*|mussel\p{L}*|østers|oyster\p{L}*)$/u },
  { names: ['nødder', 'nuts'], term: /^(?:nød(?:der|de\p{L}*)|nuts?|hasselnød\p{L}*|valnød\p{L}*|cashew\p{L}*|mandel\p{L}*|mandler|almond\p{L}*|pistacie\p{L}*|pecan\p{L}*)$/u },
  { names: ['peanut', 'peanuts', 'jordnød', 'jordnødder'], term: /^(?:peanut\p{L}*|jordnød\p{L}*)$/u },
];
const evidenceKeys = ['Name', 'Unit', 'Description', 'Ingredients', 'Allergens', 'Price', 'ItemPrice', 'IsAvailable', 'Availability'];

function fieldText(value, depth = 0) {
  if (typeof value === 'string') return value.slice(0, 8000);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth >= 3 || !value || typeof value !== 'object') return '';
  return (Array.isArray(value) ? value : Object.values(value)).slice(0, 40)
    .map(item => fieldText(item, depth + 1)).join(' ').slice(0, 8000);
}

function evidence(product) {
  return evidenceKeys.map(key => [key, fieldText(product?.[key])]);
}

function plainText(value) {
  return normal(value).replace(/<[^>]{0,2000}>/g, ' ')
    .replace(/&(?:aelig|#230|#x0*e6);/gi, 'æ')
    .replace(/&(?:oslash|#248|#x0*f8);/gi, 'ø')
    .replace(/&(?:aring|#229|#x0*e5);/gi, 'å')
    .replace(/&[^;\s]{1,20};/g, ' ');
}

function tokens(value) { return plainText(value).match(/[\p{L}\p{N}]+/gu) || []; }

function includesAvoid(text, term) {
  const words = tokens(text); const wanted = tokens(term);
  if (!wanted.length) return false;
  const group = FOOD_GROUPS.find(item => item.names.includes(normal(term)));
  if (group) return words.some(word => group.term.test(word));
  // Shared exact word/phrase rules; "ris" must not occur inside "frisk".
  return ingredientMatchesAvoid(text, term);
}

function constraintsFor(meals, state, plan, ingredient) {
  const profile = typeof meals.profile === 'function' ? meals.profile() : state.mealProfile || {};
  let diet = ['vegan', 'vegetarian'].includes(profile.diet) ? profile.diet : 'omnivore';
  for (const dish of plan.dishes || []) {
    if (dish.skip || !(dish.ingredients || []).some(item => normal(item.name) === normal(ingredient))) continue;
    if (dish.theme === 'vegan' || dish.diet === 'vegan') diet = 'vegan';
    else if (diet !== 'vegan' && (dish.theme === 'vegetarian' || dish.diet === 'vegetarian')) diet = 'vegetarian';
  }
  return { diet, avoid: [...new Set((Array.isArray(profile.avoid) ? profile.avoid : [])
    .filter(item => typeof item === 'string').slice(0, 20).map(item => normal(item).slice(0, 80)).filter(Boolean))].sort() };
}

export function productConstraints(product, constraints = {}) {
  const diet = constraints.diet || 'omnivore';
  const avoid = Array.isArray(constraints.avoid) ? constraints.avoid : [];
  const texts = evidence(product).filter(([key]) => key !== 'Unit');
  const conflict = [];
  for (const term of avoid) if (texts.some(([, value]) => includesAvoid(value, term))) conflict.push(`undgå: ${term}`);
  if (diet !== 'omnivore') for (const [key, value] of texts) {
    // An explicitly named plant substitute is uncertain, not automatically
    // approved. A vegan word elsewhere or a badge never masks "med æg/mælk".
    const text = key === 'Name' ? plainText(value).replace(/\b(?:vegansk|vegetabilsk|plantebaseret)\s+(?:ost|smør|fløde|yoghurt|yogurt|kylling|kød)\b/gu, 'plantealternativ') : value;
    const words = tokens(text);
    for (const group of FOOD_GROUPS) {
      if (!group.diet || group.diet === 'vegan' && diet !== 'vegan') continue;
      if (words.some(word => group.term.test(word))) conflict.push(`${diet}: ${group.names[0]}`);
    }
  }
  return { conflicts: [...new Set(conflict)], requiresReview: diet !== 'omnivore' || avoid.length > 0,
    evidenceFingerprint: hashList(evidence(product)), constraintsFingerprint: hashList({ diet, avoid }) };
}

function reviewed(item, assessment) {
  return item.reviewedProductFingerprint === assessment.evidenceFingerprint &&
    item.reviewedConstraintsFingerprint === assessment.constraintsFingerprint;
}

export function productPackage(product) {
  // Only interpret an explicit retailer package unit, never a nutritional or
  // unit-price number, and never infer a weight for a piece of fruit.
  if (typeof product?.Unit !== 'string') return null;
  const m = product.Unit.trim().match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|stk)\.?$/i);
  if (!m) return null;
  const amount = Number(m[1].replace(',', '.'));
  const [unit, factor] = UNITS[m[2].toLowerCase()];
  return amount > 0 && amount * factor <= 100000 ? { quantity: amount * factor, unit } : null;
}

function price(product) {
  const value = product?.Price ?? product?.ItemPrice;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function available(product) {
  return product.IsAvailable !== false && product.Availability !== false &&
    !['unavailable', 'soldout', 'outofstock'].includes(normal(product.Availability));
}

function matchScore(ingredient, product) {
  const query = normal(ingredient);
  const name = normal(product.Name);
  if (ingredientIdentity(query) === ingredientIdentity(name)) return 100;
  if (name === query) return 100;
  const words = foodWords(query);
  return words.length && words.every(w => foodWords(name).includes(w)) ? 80 : 0;
}

export class ShoppingPlanner {
  constructor({ state, meals, nemlig, save = async () => {}, transact, now = () => new Date() }) {
    this.state = state; this.meals = meals; this.nemlig = nemlig; this.save = save; this.now = now;
    this.transact = transact || createJobTransitions(state);
    this.state.shoppingDrafts ||= [];
    this.preparing = new Set();
  }

  list() { return clone(this.state.shoppingDrafts.slice(0, 12)); }

  get(id) {
    const draft = this.state.shoppingDrafts.find(x => x.id === id);
    if (!draft) throw new Error('Indkøbsforslaget findes ikke.');
    return draft;
  }

  current(draft) {
    const plan = this.meals.getPlan(draft.planId);
    if (plan.status !== 'shopping_ready' || plan.revision !== draft.planRevision ||
        plan.householdStale || plan.profileStale || plan.recipeStale || hashList(plan.shoppingList) !== draft.listFingerprint) {
      throw new Error('Madplanen eller indkøbslisten er ændret. Opret et nyt indkøbsforslag.');
    }
    this.meals.assertRecipeSources?.(plan.dishes || []);
    return plan;
  }

  async create(planId) {
    const plan = this.meals.getPlan(planId);
    if (plan.status !== 'shopping_ready' || !Number.isInteger(plan.revision)) throw new Error('Gennemgå madplanen og opret først indkøbslisten.');
    if (!plan.shoppingList?.length) throw new Error('Indkøbslisten er tom; der er intet at foreslå.');
    if (plan.shoppingList.length > 40) throw new Error('Del indkøbslisten op i højst 40 ingredienser ad gangen.');
    const source = { planId, planRevision: plan.revision, listFingerprint: hashList(plan.shoppingList) };
    this.current(source);
    const items = clone(plan.shoppingList);
    const basket = await this.nemlig.basket();
    const basketQuantities = new Map(basket.Lines.map(x => [String(x.Id), x.Quantity]));
    const used = new Set();
    const draft = { id: randomUUID(), ...source, basketFingerprint: basketHash(basket), revision: 1, status: 'draft', createdAt: this.now().toISOString(),
      items: [], warnings: ['Varematch er forslag. Kontroller variant, mærkning, pakningsstørrelse og antal før overførsel.'],
      budgetTargetDkk: plan.budgetTargetDkk ?? null, estimatedProductsDkk: null, priceCheckedAt: null };
    // Two read-only lookups at a time; never start dozens of MCP subprocesses.
    for (let i = 0; i < items.length; i += 2) {
      const found = await Promise.all(items.slice(i, i + 2).map(async ingredient => {
        try { return { ingredient, products: await this.nemlig.search(ingredient.name, 5) }; }
        catch { return { ingredient, products: [], error: true }; }
      }));
      for (const { ingredient, products, error } of found) {
        const constraints = constraintsFor(this.meals, this.state, this.current(draft), ingredient.name);
        const candidates = products.filter(x => validId(idOf(x)) && available(x) && !productConstraints(x, constraints).conflicts.length)
          .sort((a, b) => matchScore(ingredient.name, b) - matchScore(ingredient.name, a)).slice(0, 5);
        const selected = candidates.find(x => matchScore(ingredient.name, x) > 0 && !used.has(idOf(x)));
        const pack = productPackage(selected);
        const unit = UNITS[ingredient.unit];
        let quantity = 0;
        let reason = error ? 'Nemlig kunne ikke læses. Prøv igen senere.' : 'Vælg selv variant og antal pakker; mængden kunne ikke beregnes sikkert.';
        let productId = '';
        let existingQuantity = 0;
        if (selected && pack && unit && pack.unit === unit[0]) {
          const needed = Math.ceil(ingredient.quantity * unit[1] / pack.quantity);
          existingQuantity = basketQuantities.get(idOf(selected)) || 0;
          const additional = Math.max(0, needed - existingQuantity);
          if (Number.isInteger(additional) && additional <= 30) {
            productId = idOf(selected); quantity = additional; used.add(productId);
            reason = `${needed} pakke(r) ud fra oplyst ${selected.Unit}; ${existingQuantity} allerede i kurven. Kontroller varematch.`;
          } else reason = 'Beregnet mængde er over grænsen på 30 pakker. Kontroller manuelt.';
        }
        if (!candidates.length && !error) reason = 'Ingen tilgængelige varer fundet. Ret ingrediensen eller find et alternativ.';
        const assessment = productConstraints(selected, constraints);
        if (assessment.requiresReview) reason += ' Kostvalg eller undgå-liste kræver din gennemgang af mærkning og ingredienser; dette er ikke en allergisikkerhedskontrol.';
        draft.items.push({ lineId: randomUUID(), ingredient: ingredient.name, neededQuantity: ingredient.quantity,
          unit: ingredient.unit, candidates, productId, quantity, existingQuantity, reason,
          needsReview: !productId || assessment.requiresReview, excluded: false });
      }
    }
    this.current(draft); // Plan may have been edited while lookups were running.
    this.estimate(draft);
    draft.priceCheckedAt = this.now().toISOString();
    return this.transact(['shoppingDrafts'], async () => {
      this.current(draft);
      this.state.shoppingDrafts.unshift(draft);
      this.state.shoppingDrafts = this.state.shoppingDrafts.slice(0, 12);
      await this.save();
      return clone(draft);
    });
  }

  estimate(draft) {
    let total = 0; let unknown = false;
    for (const item of draft.items) {
      if (!item.productId || item.quantity === 0) { if (!item.excluded && item.needsReview) unknown = true; continue; }
      const unitPrice = price(item.candidates.find(x => idOf(x) === item.productId));
      if (unitPrice === null) unknown = true;
      else total += unitPrice * item.quantity;
    }
    draft.estimatedProductsDkk = unknown ? null : Math.round(total * 100) / 100;
    draft.priceNote = 'Kun foreslåede ekstra varer; ikke levering, pant, poser eller en garanti for checkout-prisen.';
    draft.overBudget = draft.estimatedProductsDkk !== null && draft.budgetTargetDkk !== null && draft.estimatedProductsDkk > draft.budgetTargetDkk;
  }

  async update(id, { expectedRevision, items } = {}, { reviewedByOwner = false } = {}) {
    return this.transact(['shoppingDrafts', 'nemligProposals'], async () => {
    const draft = this.get(id); const plan = this.current(draft);
    if (this.preparing.has(id)) throw new Error('Forslaget behandles. Vent et øjeblik.');
    if (!Number.isInteger(expectedRevision) || expectedRevision !== draft.revision) throw new Error('Forslaget blev ændret. Genindlæs før du gemmer.');
    if (!Array.isArray(items) || items.length !== draft.items.length) throw new Error('Ret alle linjer i det viste forslag. Brug 0 for at udelade en vare.');
    const seen = new Set();
    const next = items.map(input => {
      const old = draft.items.find(x => x.lineId === input?.lineId);
      if (!old || seen.has(old.lineId)) throw new Error('Ukendt eller gentaget indkøbslinje.');
      seen.add(old.lineId);
      const productId = String(input.productId || '');
      const quantity = input.quantity;
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > 30) throw new Error('Vælg 0–30 pakker.');
      if (productId && !old.candidates.some(x => idOf(x) === productId)) throw new Error('Vælg en faktisk fundet vare.');
      if (quantity > 0 && !productId) throw new Error('Vælg varen, før antal angives.');
      const product = old.candidates.find(x => idOf(x) === productId);
      const assessment = productConstraints(product, constraintsFor(this.meals, this.state, plan, old.ingredient));
      if (productId && (!available(product) || assessment.conflicts.length)) throw new Error('Den valgte vare er utilgængelig eller i konflikt med kostvalg/undgå-listen. Vælg et andet produkt.');
      const changed = old.productId !== productId || old.quantity !== quantity;
      const needsReview = reviewedByOwner !== true && (old.needsReview || changed || assessment.requiresReview && !reviewed(old, assessment));
      return { ...old, productId, quantity, excluded: quantity === 0,
        needsReview, reason: 'Antal og variant tilrettet; gennemgå mærkning og antal før overførsel. Ingen garanti for allergisikkerhed.',
        reviewedProductFingerprint: reviewedByOwner === true ? assessment.evidenceFingerprint : changed ? null : old.reviewedProductFingerprint,
        reviewedConstraintsFingerprint: reviewedByOwner === true ? assessment.constraintsFingerprint : changed ? null : old.reviewedConstraintsFingerprint };
    });
    draft.items = next; draft.revision++; draft.status = 'draft'; draft.updatedAt = this.now().toISOString();
    this.estimate(draft);
    for (const proposal of this.state.nemligProposals || []) if (proposal.status === 'pending' && proposal.sourceDraft?.id === id) proposal.status = 'superseded';
    await this.save();
    return clone(draft);
    });
  }

  async propose(id, { expectedRevision } = {}) {
    const draft = clone(this.get(id)); this.current(draft);
    if (expectedRevision !== draft.revision || !Number.isInteger(expectedRevision)) throw new Error('Forslaget blev ændret. Genindlæs før du fortsætter.');
    if (draft.status !== 'draft' || this.preparing.has(id)) throw new Error('Kurvforslaget er allerede oprettet eller behandles.');
    if (draft.items.some(x => x.needsReview)) throw new Error('Vælg eller udelad først alle uafklarede varelinjer og gem forslaget.');
    const quantities = new Map();
    for (const item of draft.items) if (item.productId && item.quantity > 0) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
    if (!quantities.size) throw new Error('Ingen ekstra varer er valgt.');
    if ([...quantities.values()].some(q => q > 30)) throw new Error('Samlet antal må højst være 30 pr. vare.');
    this.preparing.add(id);
    try {
      // Refresh product identity through the fixed read-only details tool. No
      // stale search cache or user-entered product ID authorizes a basket write.
      let refreshed = false; let conflict = false;
      for (const productId of quantities.keys()) {
        const product = await this.nemlig.details(productId);
        const plan = this.current(draft);
        for (const item of draft.items.filter(x => x.productId === productId && x.quantity > 0)) {
          const original = item.candidates.find(x => idOf(x) === productId);
          const assessment = productConstraints(product, constraintsFor(this.meals, this.state, plan, item.ingredient));
          if (!available(product) || assessment.conflicts.length) {
            item.candidates = item.candidates.filter(x => idOf(x) !== productId);
            item.productId = ''; item.quantity = 0; item.excluded = false; item.needsReview = true;
            item.reviewedProductFingerprint = null; item.reviewedConstraintsFingerprint = null;
            item.reason = 'Friske vareoplysninger viste en konflikt med kostvalg/undgå-listen eller manglende tilgængelighed. Vælg et andet produkt.';
            refreshed = true; conflict = true;
          } else if (productConstraints(original, constraintsFor(this.meals, this.state, plan, item.ingredient)).evidenceFingerprint !== assessment.evidenceFingerprint ||
              assessment.requiresReview && !reviewed(item, assessment)) {
            item.candidates = item.candidates.map(candidate => idOf(candidate) === productId ? clone(product) : candidate);
            item.needsReview = true; item.reviewedProductFingerprint = null; item.reviewedConstraintsFingerprint = null;
            item.reason = 'Vareoplysninger eller kostgrundlag er ændret. Genindlæs og gennemgå ingredienser, mærkning, pakningsstørrelse og antal igen.';
            refreshed = true;
          }
        }
      }
      draft.priceCheckedAt = this.now().toISOString();
      this.current(draft);
      if (draft.revision !== expectedRevision) throw new Error('Forslaget blev ændret. Genindlæs.');
      if (refreshed) {
        draft.revision++; draft.updatedAt = this.now().toISOString(); this.estimate(draft);
        await this.transact(['shoppingDrafts'], async () => {
          if (this.get(id).revision !== expectedRevision) throw new Error('Forslaget blev ændret. Genindlæs.');
          this.current(draft);
          this.state.shoppingDrafts[this.state.shoppingDrafts.findIndex(item => item.id === id)] = draft;
          await this.save();
        });
        throw new Error(conflict ? 'Friske Nemlig-oplysninger viste en kostkonflikt. Ingen kurvændring. Genindlæs og vælg andre varer.' :
          'Vareoplysningerne blev opdateret. Genindlæs, gennemgå og gem varevalgene igen før kurvforslaget oprettes.');
      }
      const proposal = await this.nemlig.propose([...quantities].map(([productId, quantity]) => ({ productId, quantity })), {
        sourcePlan: { id: draft.planId, revision: draft.planRevision }, sourceDraft: { id, revision: draft.revision },
        expectedBasketFingerprint: draft.basketFingerprint,
      });
      return proposal;
    } finally { this.preparing.delete(id); }
  }
}
