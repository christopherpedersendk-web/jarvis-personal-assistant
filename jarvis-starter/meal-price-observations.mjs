import { createHash } from 'node:crypto';
import { ingredientIdentity } from './food-identity.mjs';
import { productPackage, productConstraints } from './shopping-planner.mjs';

export const MEAL_PRICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const money = amount => Math.round((amount + Number.EPSILON) * 100) / 100;
const amount = value => Math.round((value + Number.EPSILON) * 1000) / 1000;
const identity = item => ingredientIdentity(item.name) + '|' + item.unit;

// Pure local projection of already recorded reads. No network, inference of a
// product match, freshness from a containing draft, or use of a basket as stock.
export function observedMealPrices(state, now = new Date(), maxAgeMs = MEAL_PRICE_MAX_AGE_MS) {
  const latest = new Map();
  for (const draft of (state.shoppingDrafts || []).slice(0, 12)) for (const line of (draft.items || []).slice(0, 40)) {
    for (const [id, observation] of Object.entries(line.productObservations || {}).slice(0, 10)) {
      if (!observation || observation.productId !== id || !/^\d{1,18}$/.test(id) ||
          typeof observation.observedAt !== 'string' || !Number.isFinite(Date.parse(observation.observedAt))) continue;
      const timestamp = Date.parse(observation.observedAt), prior = latest.get(id);
      const product = (line.candidates || []).find(candidate => String(candidate.Id) === id);
      const record = { observation, timestamp, product, ingredient: line.ingredient,
        reviewedProductFingerprint: line.productId === id ? line.reviewedProductFingerprint : null,
        reviewedConstraintsFingerprint: line.productId === id ? line.reviewedConstraintsFingerprint : null,
        source: { kind: 'shopping-draft', id: draft.id, revision: draft.revision, lineId: line.lineId,
          productId: id, observedAt: observation.observedAt } };
      if (!prior || timestamp > prior.timestamp) latest.set(id, record);
      else if (timestamp === prior.timestamp && observation.evidenceFingerprint !== prior.observation.evidenceFingerprint)
        latest.set(id, { ...prior, ambiguous: true });
      // A matching snapshot in another line can supply the retained evidence for
      // the same read, but cannot clear an unavailable or ambiguous observation.
      else if (timestamp === prior.timestamp && !prior.product && product) latest.set(id, { ...prior, product });
    }
  }
  const quotes = new Map();
  for (const { observation, timestamp, product, ingredient, source, ambiguous,
    reviewedProductFingerprint, reviewedConstraintsFingerprint } of latest.values()) {
    if (ambiguous || timestamp > now.getTime() || now.getTime() - timestamp > maxAgeMs ||
        observation.available !== true || observation.availabilityKnown !== true || !product ||
        productConstraints(product).evidenceFingerprint !== observation.evidenceFingerprint) continue;
    const exactIdentity = ingredientIdentity(ingredient) === ingredientIdentity(product.Name);
    // A branded name only becomes a usable ingredient mapping through the
    // current explicitly reviewed line, never via fuzzy text or model inference.
    if (!exactIdentity && (reviewedProductFingerprint !== observation.evidenceFingerprint ||
        typeof reviewedConstraintsFingerprint !== 'string')) continue;
    const pack = productPackage(product), price = product.Price ?? product.ItemPrice;
    if (!pack || typeof price !== 'number' || !Number.isFinite(price) || price < 0 ||
        product.Currency && product.Currency !== 'DKK') continue;
    const key = identity({ name: ingredient, unit: pack.unit });
    if (!quotes.has(key)) quotes.set(key, []);
    quotes.get(key).push({ product, package: pack, priceDkk: price, observation, source,
      mapping: exactIdentity ? 'exact-identity' : 'reviewed-line', reviewedConstraintsFingerprint });
  }
  return quotes;
}

export function estimateMealRequirements(requirements, quotes, constraints = {}) {
  let knownProductsDkk = 0;
  const lines = [], unknownIngredients = [];
  for (const requirement of requirements) {
    if (!(requirement.quantity > 0)) continue;
    const candidates = (quotes.get(identity(requirement)) || []).flatMap(quote => {
      const assessment = productConstraints(quote.product, typeof constraints === 'function' ? constraints(requirement) : constraints);
      if (assessment.conflicts.length || quote.mapping === 'reviewed-line' &&
          quote.reviewedConstraintsFingerprint !== assessment.constraintsFingerprint) return [];
      const packages = Math.ceil(requirement.quantity / quote.package.quantity);
      return [{ quote, packages, costDkk: money(packages * quote.priceDkk), requiresProductReview: assessment.requiresReview }];
    }).sort((a, b) => a.costDkk - b.costDkk ||
      b.quote.observation.observedAt.localeCompare(a.quote.observation.observedAt) ||
      a.quote.source.productId.localeCompare(b.quote.source.productId));
    const chosen = candidates[0];
    if (!chosen) {
      unknownIngredients.push({ name: requirement.name, quantity: requirement.quantity, unit: requirement.unit,
        reason: 'Ingen aktuel, entydig og enhedskompatibel registreret varepris.' });
      continue;
    }
    knownProductsDkk = money(knownProductsDkk + chosen.costDkk);
    lines.push({ name: requirement.name, quantity: requirement.quantity, unit: requirement.unit,
      packages: chosen.packages, packageQuantity: chosen.quote.package.quantity, unitPriceDkk: chosen.quote.priceDkk,
      estimatedProductsDkk: chosen.costDkk, surplusQuantity: amount(chosen.packages * chosen.quote.package.quantity - requirement.quantity),
      requiresProductReview: chosen.requiresProductReview, evidenceFingerprint: chosen.quote.observation.evidenceFingerprint,
      source: chosen.quote.source });
  }
  const status = !requirements.some(item => item.quantity > 0) ? 'no-extra-ingredients'
    : unknownIngredients.length ? lines.length ? 'partial-observed-estimate' : 'unknown-until-retailer-lookup'
      : 'known-observed-estimate';
  const fingerprint = createHash('sha256').update(JSON.stringify({
    requirements: requirements.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
    lines: lines.map(({ name, quantity, unit, packages, unitPriceDkk, evidenceFingerprint, source }) =>
      ({ name, quantity, unit, packages, unitPriceDkk, evidenceFingerprint, productId: source.productId })),
    unknown: unknownIngredients.map(({ name, quantity, unit }) => ({ name, quantity, unit })),
  })).digest('hex');
  return { status, estimatedProductsDkk: unknownIngredients.length ? null : knownProductsDkk,
    knownProductsDkk, unknownIngredients, lines, basisFingerprint: fingerprint,
    observedAt: lines.length ? lines.map(line => line.source.observedAt).sort()[0] : null,
    maxObservationAgeHours: MEAL_PRICE_MAX_AGE_MS / 3_600_000,
    note: 'Kun et lokalt skøn over ekstra ingredienspakker fra allerede registrerede priser. Ikke levering, pant, poser, hel kurv eller garanti for fremtidig pris. Ukendte varer er ikke gratis.' };
}

export function marginalMealEstimate(before, after, requirementsBefore, requirementsAfter) {
  const prior = new Map(requirementsBefore.map(item => [identity(item), item.quantity]));
  const changed = new Set(requirementsAfter.filter(item => item.quantity > (prior.get(identity(item)) || 0)).map(identity));
  const unknownIngredients = after.unknownIngredients.filter(item => changed.has(identity(item)));
  return { estimatedProductsDkk: unknownIngredients.length ? null : money(Math.max(0, after.knownProductsDkk - before.knownProductsDkk)),
    unknownIngredients };
}
