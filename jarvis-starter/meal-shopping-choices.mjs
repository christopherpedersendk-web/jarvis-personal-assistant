import { createHash } from 'node:crypto';
import { canonicalIngredientAmount, ingredientAmountKey, ingredientConstraints } from './food-identity.mjs';

const clone = value => structuredClone(value);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ordered = items => items.sort((a, b) => a.name.localeCompare(b.name, 'da') || a.unit.localeCompare(b.unit));

function basisFor(item, requirements, dishes, profile) {
  const key = ingredientAmountKey(item), required = requirements.find(row => ingredientAmountKey(row) === key);
  const sources = (dishes || []).filter(dish => !dish.skip).flatMap(dish => {
    const ingredients = (dish.ingredients || []).map(canonicalIngredientAmount)
      .filter(ingredient => ingredientAmountKey(ingredient) === key);
    if (!ingredients.length) return [];
    return [{ date: dish.date, recipeId: dish.recipeId || null,
      recipeSources: (dish.sourceRefs || []).filter(source => ['recipe', 'recipe-catalog', 'owner-meal'].includes(source.kind)),
      quantity: Math.round(ingredients.reduce((sum, row) => sum + row.quantity, 0) * 1000) / 1000 }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  return { quantity: required?.quantity || 0, requiredQuantity: required?.requiredQuantity || 0,
    pantryUsed: required?.pantryUsed || 0, sources, constraints: ingredientConstraints(profile, dishes, item) };
}

// Missing legacy provenance is kept explicitly unknown. Adoption is pure and
// becomes durable only with the next successful explicit plan/list mutation.
export function shoppingOverrides(plan, requirements, profile) {
  if (Array.isArray(plan.manualShoppingOverrides)) return clone(plan.manualShoppingOverrides);
  const rows = plan.shoppingList || [], prior = new Map();
  const wasEdited = rows.some(row => row.manuallyEdited);
  for (const row of [...(plan.manualShoppingExtras || []), ...(wasEdited ? rows : [])]) {
    const item = canonicalIngredientAmount(row);
    prior.set(ingredientAmountKey(item), { ...item, base: null, baseFingerprint: null,
      source: { kind: 'legacy-shopping-edit', planId: plan.id, revision: plan.shoppingRevision ?? plan.revision,
        at: plan.updatedAt || plan.shoppingGeneratedAt || null } });
  }
  // A whole-list edit also explicitly omitted the then-required rows.
  if (wasEdited) for (const item of requirements) if (!prior.has(ingredientAmountKey(item))) prior.set(ingredientAmountKey(item), {
    ...canonicalIngredientAmount(item), quantity: 0, base: null, baseFingerprint: null,
    source: { kind: 'legacy-shopping-edit', planId: plan.id, revision: plan.shoppingRevision ?? plan.revision,
      at: plan.updatedAt || plan.shoppingGeneratedAt || null } });
  return ordered([...prior.values()]);
}

export function projectShoppingChoices(plan, requirements, profile, conflicts = () => false, overrides = shoppingOverrides(plan, requirements, profile)) {
  const selected = new Map(requirements.filter(item => item.quantity > 0).map(item => [ingredientAmountKey(item), clone(item)]));
  const rows = [], extras = [];
  for (const choice of overrides) {
    const key = ingredientAmountKey(choice), current = basisFor(choice, requirements, plan.dishes, profile);
    const changed = !choice.baseFingerprint || choice.baseFingerprint !== fingerprint(current);
    const conflicting = choice.quantity > 0 && conflicts(choice, current.constraints);
    if (choice.quantity > 0) {
      const selectedItem = { ...canonicalIngredientAmount(choice), manuallyEdited: true };
      selected.set(key, selectedItem);
      if (!current.requiredQuantity) extras.push(canonicalIngredientAmount(choice));
    } else selected.delete(key);
    rows.push({ name: choice.name, unit: choice.unit, selectedQuantity: choice.quantity,
      computedQuantity: current.quantity, requiredQuantity: current.requiredQuantity, pantryUsed: current.pantryUsed,
      excluded: choice.quantity === 0, removedFromPlan: !current.requiredQuantity && Boolean(choice.base?.requiredQuantity),
      basisChanged: changed, conflicting, source: clone(choice.source), previousBasis: clone(choice.base),
      currentBasis: current, needsReview: changed || conflicting,
      reason: conflicting ? 'Det bevarede valg strider mod de aktuelle kost- eller ingrediensregler. Ret eller udelad varen.'
        : !choice.baseFingerprint ? 'Den tidligere listes oprindelige beregningsgrundlag er ukendt. Gennemgå dit bevarede valg.'
          : changed ? 'Beregningsgrundlaget er ændret. Din mængde er bevaret og skal gennemgås.'
            : choice.quantity === 0 ? 'Du har eksplicit udeladt varen. Den tilføjes ikke automatisk ved genberegning.'
              : 'Din gemte mængde er bevaret; den er ikke et bevis på køb eller lager.' });
  }
  const list = ordered([...selected.values()]);
  if (list.length > 60 || overrides.length > 120) throw new Error('Indkøbslisten har for mange varer eller manuelle valg. Del planen op; ingen valg er fjernet.');
  return { shoppingList: list, manualShoppingOverrides: clone(overrides), manualShoppingExtras: ordered(extras),
    shoppingNeedsReview: rows.some(row => row.needsReview),
    shoppingReview: { rows: ordered(rows), note: 'Beregnet behov minus bekræftet lager sammenholdes med dine absolutte listevalg. Afvigelser ændrer ikke lager eller Nemlig-kurv.' } };
}

export function editShoppingChoices(plan, requirements, profile, items, { useComputed = [], revision, at, conflicts } = {}) {
  const previous = shoppingOverrides(plan, requirements, profile), old = new Map(previous.map(item => [ingredientAmountKey(item), item]));
  const reset = new Set(useComputed.map(ingredientAmountKey));
  if (reset.size !== useComputed.length || [...reset].some(key => !old.has(key)))
    throw new Error('Vælg hvert eksisterende manuelt valg højst én gang, når den beregnede mængde skal bruges.');
  const wanted = new Map(items.map(item => [ingredientAmountKey(item), canonicalIngredientAmount(item)]));
  for (const key of reset) {
    const requirement = requirements.find(item => ingredientAmountKey(item) === key);
    if (requirement?.quantity > 0) wanted.set(key, canonicalIngredientAmount(requirement));
    else wanted.delete(key);
  }
  const candidates = new Map([...requirements, ...previous, ...(plan.shoppingList || []), ...items].map(item => [ingredientAmountKey(item), item]));
  const choices = [];
  for (const [key, item] of candidates) {
    if (reset.has(key)) continue;
    const current = basisFor(item, requirements, plan.dishes, profile), selected = wanted.get(key);
    const quantity = selected?.quantity || 0;
    // Saving an unchanged calculated row does not freeze it. Existing choices,
    // explicit zero rows and whole-list deletions remain durable intent.
    if (!old.has(key) && quantity === current.quantity && !(selected && quantity === 0)) continue;
    choices.push({ ...canonicalIngredientAmount(selected || item), quantity, base: current, baseFingerprint: fingerprint(current),
      source: { kind: 'shopping-list-edit', planId: plan.id, revision, at } });
  }
  const projected = projectShoppingChoices(plan, requirements, profile, conflicts, ordered(choices));
  if (projected.shoppingReview.rows.some(row => row.conflicting)) throw new Error('Indkøbslisten er i konflikt med dine madpræferencer. Fjern eller ret den berørte vare.');
  // Preserve the established edit response shape; metadata has its own model.
  projected.shoppingList = ordered([...wanted.values()].filter(item => item.quantity > 0).map(item => ({ ...item, manuallyEdited: true })));
  return projected;
}
