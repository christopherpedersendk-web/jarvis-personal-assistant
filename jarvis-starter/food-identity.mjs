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

export function ingredientMatchesAvoid(value, excluded) {
  const words = foodWords(value).map(word => ALIASES.get(word) || word);
  const target = foodWords(excluded).map(word => ALIASES.get(word) || word);
  if (!target.length) return false;
  if (ingredientIdentity(value) === ingredientIdentity(excluded)) return true;
  return words.some((_, index) => target.every((word, offset) => words[index + offset] === word));
}
