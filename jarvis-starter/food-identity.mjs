// Conservative shared ingredient identity and exact-word exclusion matching.
// Do not infer conversions between raw, cooked, drained or piece weights.
export function foodWords(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('da-DK')
    .match(/[\p{L}\p{N}]+/gu) || [];
}

const ALIASES = new Map([
  ['rice', 'ris'], ['ris', 'ris'],
  ['tomato', 'tomat'], ['tomatoes', 'tomat'], ['tomat', 'tomat'], ['tomater', 'tomat'],
  ['egg', 'æg'], ['eggs', 'æg'], ['æg', 'æg'],
  ['potato', 'kartoffel'], ['potatoes', 'kartoffel'], ['kartofler', 'kartoffel'], ['kartoffel', 'kartoffel'],
  ['onion', 'løg'], ['onions', 'løg'], ['løg', 'løg'],
]);

export function ingredientIdentity(value) {
  const words = foodWords(value);
  return words.length === 1 ? (ALIASES.get(words[0]) || words[0]) : words.join(' ');
}

// Only explicit compatible units are converted. Pieces and raw/cooked/drained
// names remain distinct; no inferred piece weight enters planning or shopping.
export function canonicalIngredientAmount(item) {
  const conversions = { kg: ['g', 1000], l: ['ml', 1000], dl: ['ml', 100], cl: ['ml', 10] };
  const [unit, factor] = conversions[item.unit] || [item.unit, 1];
  return { name: String(item.name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('da-DK'),
    quantity: Math.round((item.quantity * factor + Number.EPSILON) * 1000) / 1000, unit };
}

export function ingredientAmountKey(item) {
  const normalized = canonicalIngredientAmount(item);
  return ingredientIdentity(normalized.name) + '|' + normalized.unit;
}

// The strictest recorded constraint belongs to the dishes using this exact
// canonical ingredient, not to every ingredient in a mixed dietary week.
export function ingredientConstraints(profile = {}, dishes = [], ingredient) {
  const identity = ingredientIdentity(typeof ingredient === 'object' ? ingredient?.name : ingredient);
  let diet = ['vegan', 'vegetarian'].includes(profile.diet) ? profile.diet : 'omnivore';
  for (const dish of dishes || []) {
    if (dish.skip) continue;
    const ingredients = dish.leftoverFromDate ? dish.ingredientBasis || [] : dish.ingredients || [];
    if (!ingredients.some(item => ingredientIdentity(item.name) === identity)) continue;
    if (dish.theme === 'vegan' || dish.diet === 'vegan') diet = 'vegan';
    else if (diet !== 'vegan' && (dish.theme === 'vegetarian' || dish.diet === 'vegetarian')) diet = 'vegetarian';
  }
  return { diet, avoid: [...new Set((Array.isArray(profile.avoid) ? profile.avoid : [])
    .filter(item => typeof item === 'string').slice(0, 20).map(item => item.normalize('NFKC').trim()
      .toLocaleLowerCase('da-DK').slice(0, 80)).filter(Boolean))].sort() };
}

export function ingredientMatchesAvoid(value, excluded) {
  const words = foodWords(value).map(word => ALIASES.get(word) || word);
  const target = foodWords(excluded).map(word => ALIASES.get(word) || word);
  if (!target.length) return false;
  if (ingredientIdentity(value) === ingredientIdentity(excluded)) return true;
  return words.some((_, index) => target.every((word, offset) => words[index + offset] === word));
}
