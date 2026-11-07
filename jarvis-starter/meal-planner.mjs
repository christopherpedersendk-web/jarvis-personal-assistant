import {shoppingSearchList} from './shopping-search-list.mjs';
import {varietyPenalty} from './meal-variety.mjs';
import { activeMealPlan } from './meal-plan-selection.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { canonicalIngredientAmount, ingredientAmountKey, ingredientConstraints } from './food-identity.mjs';
import { observedMealPrices, estimateMealRequirements, marginalMealEstimate } from './meal-price-observations.mjs';
import { shoppingOverrides, projectShoppingChoices, editShoppingChoices } from './meal-shopping-choices.mjs';
import { productConflicts } from './shopping-planner.mjs';

// Illustrative recipes, never retailer prices or claims about allergen safety.
const RECIPES = Object.freeze([
  { id: 'bean-chili', title: 'Chili med bønner og ris', diet: 'vegan', minutes: 35, ingredients: [['kidneybønner', 400, 'g'], ['hakkede tomater', 400, 'g'], ['ris', 160, 'g'], ['løg', 1, 'stk'], ['peberfrugt', 2, 'stk']] },
  { id: 'pumpkin-pasta', title: 'Pasta med bagt græskar', diet: 'vegan', minutes: 35, ingredients: [['pasta', 200, 'g'], ['græskar', 500, 'g'], ['hvidløg', 2, 'fed'], ['spinat', 100, 'g']] },
  { id: 'lentil-soup', title: 'Linsesuppe med brød', diet: 'vegan', minutes: 30, ingredients: [['røde linser', 220, 'g'], ['gulerødder', 3, 'stk'], ['løg', 1, 'stk'], ['hakkede tomater', 400, 'g'], ['brød', 1, 'stk']] },
  { id: 'bean-tacos', title: 'Tacos med sorte bønner', diet: 'vegan', minutes: 25, ingredients: [['sorte bønner', 400, 'g'], ['tortillas', 6, 'stk'], ['peberfrugt', 1, 'stk'], ['tomater', 3, 'stk'], ['salat', 1, 'stk']] },
  { id: 'couscous', title: 'Couscous med grønt og kikærter', diet: 'vegan', minutes: 20, ingredients: [['couscous', 200, 'g'], ['kikærter', 400, 'g'], ['agurk', 1, 'stk'], ['tomater', 3, 'stk'], ['citron', 1, 'stk']] },
  { id: 'vegetable-curry', title: 'Grøntsagskarry med kokosmælk', diet: 'vegan', minutes: 30, ingredients: [['ris', 160, 'g'], ['kokosmælk', 400, 'ml'], ['broccoli', 1, 'stk'], ['gulerødder', 3, 'stk'], ['kikærter', 400, 'g']] },
  { id: 'tomato-pasta', title: 'Pasta med tomatsauce og grønt', diet: 'vegan', minutes: 25, ingredients: [['pasta', 200, 'g'], ['hakkede tomater', 400, 'g'], ['løg', 1, 'stk'], ['spinat', 100, 'g']] },
  { id: 'omelette', title: 'Omelet med kartofler og salat', diet: 'vegetarian', minutes: 25, ingredients: [['æg', 4, 'stk'], ['kartofler', 400, 'g'], ['salat', 1, 'stk'], ['tomater', 2, 'stk']] },
  { id: 'chicken-rice', title: 'Kylling med ris og grøntsager', diet: 'omnivore', minutes: 35, ingredients: [['kyllingebryst', 350, 'g'], ['ris', 160, 'g'], ['broccoli', 1, 'stk'], ['gulerødder', 2, 'stk']] },
]);

const DIETS = ['omnivore', 'vegetarian', 'vegan'];
export const MEAL_THEMES = Object.freeze(['everyday', 'child_friendly', 'vegan', 'vegetarian', 'date', 'party', 'quick']);
export const HOUSEHOLD_OCCASIONS = Object.freeze(['ordinary', 'holiday', 'absence']);
const baseProfile = Object.freeze({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null });
const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('da-DK');
const clone = value => structuredClone(value);
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const UNITS = new Set(['g', 'kg', 'ml', 'l', 'dl', 'cl', 'stk', 'fed', 'tsk', 'spsk', 'pakke']);
const THEME_LABELS = { everyday: 'Hverdag', child_friendly: 'Børnevenlig', vegan: 'Vegansk', vegetarian: 'Vegetarisk', date: 'Date', party: 'Fest', quick: 'Hurtig' };
const RECIPE_THEMES = {
  'bean-chili': ['everyday', 'party'], 'pumpkin-pasta': ['date', 'vegetarian'],
  'lentil-soup': ['everyday'], 'bean-tacos': ['child_friendly', 'party'],
  couscous: ['quick', 'date'], 'vegetable-curry': ['everyday', 'party'],
  'tomato-pasta': ['child_friendly', 'quick'], omelette: ['quick', 'everyday'],
  'chicken-rice': ['child_friendly', 'everyday'],
};

function validateIngredients(value, { allowZero = false, max = 60 } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new Error('Ugyldig ingrediensliste.');
  return value.map(item => {
    if (!isObject(item) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 ||
        !UNITS.has(item.unit) || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) ||
        item.quantity < 0 || (!allowZero && round(item.quantity) <= 0) || item.quantity > 1_000_000) {
      throw new Error('Ingredienser skal have navn, gyldigt antal og en understøttet enhed.');
    }
    return { name: item.name.trim().replace(/\s+/g, ' '), quantity: round(item.quantity), unit: item.unit };
  });
}

function round(value) { return Math.round((value + Number.EPSILON) * 1000) / 1000; }

function canonicalAmount(item) {
  return canonicalIngredientAmount(item);
}

function ingredientKey(item) { return ingredientAmountKey(item); }

function sameIngredients(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function scaleIngredients(basis, baseServings, servings) {
  if (!Number.isFinite(baseServings) || baseServings <= 0) throw new Error('Opskriftens grundportioner mangler.');
  return basis.map(item => ({ ...item, quantity: round(item.quantity * servings / baseServings) })).filter(item => item.quantity > 0);
}

function validateTheme(theme = 'everyday') {
  if (!MEAL_THEMES.includes(theme)) throw new Error('Vælg et understøttet tema for dagen.');
  return theme;
}

// Editable cooking estimates, not nutritional recommendations or proof that a
// particular dish is suitable for a child's age. The owner can override them.
function estimatedChildPortion(age) { return age <= 5 ? 0.5 : age <= 12 ? 0.75 : 1; }

function validatePortion(value = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 3) throw new Error('Portionsfaktor skal være 0,25–3.');
  return round(value);
}

function validateChildren(value) {
  if (!Array.isArray(value) || value.length > 24) throw new Error('Angiv højst 24 børn med alder og portionsfaktor.');
  return value.map(item => {
    if (!isObject(item) || !Number.isInteger(item.age) || item.age < 0 || item.age > 17) throw new Error('Børns alder skal være et helt tal fra 0 til 17.');
    const portion = validatePortion(item.portion ?? estimatedChildPortion(item.age));
    // Only a user-supplied date records when an age was checked. Historic ages
    // remain undated; neither migration nor saving another field renews them.
    if (item.ageRecordedAt !== undefined && item.ageRecordedAt !== null) parseDay(item.ageRecordedAt);
    return { age: item.age, portion,
      ...(item.ageRecordedAt ? { ageRecordedAt: item.ageRecordedAt } : {}) };
  });
}

function validateAttendance(value) {
  if (!isObject(value) || !Number.isInteger(value.adults) || value.adults < 0 || value.adults > 24) throw new Error('Antal voksne skal være 0–24.');
  const children = validateChildren(value.children);
  const adultPortion = validatePortion(value.adultPortion ?? 1);
  if (value.adults + children.length > 24) throw new Error('Højst 24 personer pr. dag.');
  return { adults: value.adults, children, ...(adultPortion !== 1 ? { adultPortion } : {}) };
}

function validateDay(value) {
  const attendance = validateAttendance(value);
  const guests = value.guests === undefined ? null : validateAttendance(value.guests);
  const occasion = value.occasion ?? 'ordinary';
  if (!HOUSEHOLD_OCCASIONS.includes(occasion)) throw new Error('Vælg almindelig dag, ferie eller fravær.');
  if (attendance.adults + attendance.children.length + (guests?.adults || 0) + (guests?.children.length || 0) > 24)
    throw new Error('Højst 24 personer pr. dag, inklusive gæster.');
  if (value.skip !== undefined && typeof value.skip !== 'boolean') throw new Error('Spring dag over skal være sand eller falsk.');
  const theme = validateTheme(value.theme);
  if (occasion === 'absence') return { adults: 0, children: [], theme, skip: true, occasion };
  return { ...attendance, theme,
    skip: Boolean(value.skip) || attendance.adults + attendance.children.length + (guests?.adults || 0) + (guests?.children.length || 0) === 0,
    ...(guests && (guests.adults || guests.children.length) ? { guests } : {}),
    ...(occasion !== 'ordinary' ? { occasion } : {}) };
}

function validateDays(value) {
  if (!isObject(value) || Object.keys(value).length > 180) throw new Error('Husstandskalenderen kan have højst 180 dagsvalg.');
  const result = {};
  for (const [date, input] of Object.entries(value)) { parseDay(date); result[date] = validateDay(input); }
  return result;
}

// A rhythm contains 1–4 ordered weeks, keyed by ISO weekday (1=Monday).
// A concrete date in `days` always takes precedence over the rhythm.
function validateRhythm(value) {
  if (value === null) return null;
  if (!isObject(value) || !Array.isArray(value.weeks) || !value.weeks.length || value.weeks.length > 4) {
    throw new Error('Familierytmen skal indeholde 1–4 uger.');
  }
  const anchorMonday = value.anchorMonday;
  if (parseDay(anchorMonday).getUTCDay() !== 1) throw new Error('Familierytmens startdato skal være en mandag.');
  const weeks = value.weeks.map(week => {
    if (!isObject(week) || Object.keys(week).some(day => !/^[1-7]$/.test(day))) throw new Error('Brug ugedagene 1–7 i familierytmen.');
    return Object.fromEntries(Object.entries(week).map(([weekday, attendance]) => [weekday, validateDay(attendance)]));
  });
  return { anchorMonday, weeks };
}

function rhythmDay(household, date) {
  const rhythm = household.rhythm;
  if (!rhythm?.weeks?.length) return null;
  const diffDays = Math.round((parseDay(date).getTime() - parseDay(rhythm.anchorMonday).getTime()) / 86400000);
  const week = ((Math.floor(diffDays / 7) % rhythm.weeks.length) + rhythm.weeks.length) % rhythm.weeks.length;
  const weekday = String(parseDay(date).getUTCDay() || 7);
  return rhythm.weeks[week][weekday] || null;
}

function sameValue(a, b) { return isDeepStrictEqual(a, b); }

function checkHouseholdRevision(current, expected) {
  // Optional only for compatibility with existing in-process v4 callers. The
  // owner UI always supplies the revision it actually displayed.
  if (expected === undefined) return;
  if (!Number.isInteger(expected) || expected !== (current.revision || 1)) {
    const error = new Error('Husstanden er ændret et andet sted. Dine rettelser er ikke gemt; genindlæs det aktuelle grundlag først.');
    error.code = 'REVISION_CONFLICT';
    throw error;
  }
}

function checkProfileRevision(current, expected) {
  if (expected === undefined) return;
  if (!Number.isInteger(expected) || expected !== (current.revision || 1)) {
    const error = new Error('Madpræferencerne er ændret et andet sted. Dine rettelser er ikke gemt; genindlæs før du gemmer.');
    error.code = 'REVISION_CONFLICT'; throw error;
  }
}

function attendanceMeaning(value) {
  const children = items => (items || []).map(({ age, portion }) => ({ age, portion }));
  return { adults: value.adults, adultPortion: value.adultPortion ?? 1, children: children(value.children),
    guests: { adults: value.guests?.adults || 0, adultPortion: value.guests?.adultPortion ?? 1, children: children(value.guests?.children) },
    occasion: value.occasion || 'ordinary', theme: value.theme, skip: value.skip,
    servings: value.servings, householdConfirmed: value.householdConfirmed };
}

function householdSourceRef(attendance, date) {
  return { kind: attendance.attendanceSource === 'day-override' ? 'household-day' :
    attendance.attendanceSource === 'recurring-rhythm' ? 'household-rhythm' : 'household', date };
}

// One read-only rule resolver for meals, memory and other local planning.
// Unknown attendance is not a zero-person household and not calendar evidence.
// Only MealPlanner passes the old profile's provisional portion estimate.
export function resolveHouseholdAttendance(household, date, { fallbackServings = null } = {}) {
  parseDay(date);
  const override = household?.days?.[date];
  const repeating = override || !household ? null : rhythmDay(household, date);
  if (override || repeating || household?.configured) {
    const attendance = validateDay(override || repeating || { adults: household.adults,
      adultPortion: household.adultPortion ?? 1, children: household.children, theme: 'everyday', skip: false });
    const guests = attendance.guests || { adults: 0, children: [] };
    const servings = round(attendance.adults * (attendance.adultPortion ?? 1) +
      attendance.children.reduce((sum, child) => sum + child.portion, 0) +
      guests.adults * (guests.adultPortion ?? 1) + guests.children.reduce((sum, child) => sum + child.portion, 0));
    const skip = Boolean(attendance.skip) || attendance.occasion === 'absence' || servings === 0;
    return { ...attendance, adultPortion: attendance.adultPortion ?? 1, guests,
      occasion: attendance.occasion || 'ordinary', servings: skip ? 0 : servings,
      skip, householdConfirmed: true,
      attendanceSource: override ? 'day-override' : repeating ? 'recurring-rhythm' : 'household-defaults' };
  }
  return { adults: null, adultPortion: 1, children: [], guests: { adults: 0, children: [] }, occasion: 'ordinary',
    theme: 'everyday', skip: false, servings: fallbackServings, householdConfirmed: false, attendanceSource: 'legacy-unconfirmed' };
}

function validateInventoryItems(value, timestamp) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Lageret må have højst 100 varer.');
  const rows = value.map(item => {
    const [ingredient] = validateIngredients([{ name: item?.name, quantity: item?.quantity, unit: item?.unit }], { allowZero: true });
    const normalized = canonicalAmount(ingredient);
    const lastConfirmedAt = item.lastConfirmedAt ?? timestamp;
    if (typeof lastConfirmedAt !== 'string' || Number.isNaN(Date.parse(lastConfirmedAt))) throw new Error('Angiv en gyldig dato for senest bekræftet lager.');
    const expiresAt = item.expiresAt ?? null;
    if (expiresAt !== null) parseDay(expiresAt);
    return { ...normalized, lastConfirmedAt, expiresAt };
  });
  const keys = rows.map(ingredientKey);
  if (new Set(keys).size !== keys.length) throw new Error('Lageret kan kun have én registreret række pr. ingrediens og enhed.');
  return rows;
}

export function validateMealProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Ugyldige madpræferencer.');
  const householdSize = Number(input.householdSize);
  const diet = input.diet;
  const budgetDkk = input.budgetDkk === '' || input.budgetDkk === null || input.budgetDkk === undefined ? null : Number(input.budgetDkk);
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 12) throw new Error('Antal personer skal være 1–12.');
  if (!DIETS.includes(diet)) throw new Error('Vælg almindelig, vegetarisk eller vegansk mad.');
  if (budgetDkk !== null && (!Number.isInteger(budgetDkk) || budgetDkk < 50 || budgetDkk > 10000)) throw new Error('Budget skal være 50–10.000 kr.');
  if (!Array.isArray(input.avoid) || input.avoid.length > 20 || input.avoid.some(x => typeof x !== 'string' || x.length > 80)) throw new Error('Ugyldig liste over ingredienser, der skal undgås.');
  let pantry;
  try { pantry = validateIngredients(input.pantry, { allowZero: true }); }
  catch { throw new Error('Ugyldigt lager af madvarer.'); }
  return {
    householdSize, diet, budgetDkk,
    avoid: [...new Set(input.avoid.map(normalize).filter(Boolean))],
    pantry: pantry.map(x => ({ ...x, name: normalize(x.name) })),
  };
}

function localToday(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dato skal være YYYY-MM-DD.');
  const day = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value) throw new Error('Ugyldig dato.');
  return day;
}

function addDays(day, days) {
  const next = new Date(day.getTime()); next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function ingredientsFor(dishes, profile, { includeSatisfied = false } = {}) {
  const combined = new Map();
  for (const dish of dishes.filter(x => !x.skip)) for (const source of dish.ingredients) {
    const ingredient = canonicalAmount(source);
    const key = ingredientKey(ingredient);
    const current = combined.get(key) || { name: ingredient.name, unit: ingredient.unit, quantity: 0, requiredQuantity: 0, pantryUsed: 0 };
    current.quantity = round(current.quantity + ingredient.quantity);
    current.requiredQuantity = current.quantity;
    combined.set(key, current);
  }
  for (const source of profile.pantry) {
    const pantryItem = canonicalAmount(source);
    const found = combined.get(ingredientKey(pantryItem));
    if (found) {
      const used = Math.min(found.quantity, pantryItem.quantity);
      found.quantity = round(found.quantity - used);
      found.pantryUsed = round(found.pantryUsed + used);
    }
  }
  return [...combined.values()].filter(x => includeSatisfied || x.quantity > 0).sort((a, b) => a.name.localeCompare(b.name, 'da') || a.unit.localeCompare(b.unit));
}

function effectiveDiet(profile, theme) {
  if (profile.diet === 'vegan' || theme === 'vegan') return 'vegan';
  if (profile.diet === 'vegetarian' || theme === 'vegetarian') return 'vegetarian';
  return 'omnivore';
}

function ingredientConflicts(ingredients, diet, avoid = []) {
  // One conservative text rule set for recipe ingredients, list edits and
  // retailer products. This is not a food-safety/allergen guarantee.
  return ingredients.some(item => productConflicts({ Name: item.name }, { diet, avoid }).length > 0);
}

function compatible(recipe, profile, theme) {
  const diet = effectiveDiet(profile, theme);
  const allowed = diet === 'omnivore' || recipe.diet === 'vegan' || diet === 'vegetarian' && recipe.diet === 'vegetarian';
  return allowed && !ingredientConflicts(recipe.ingredients, effectiveDiet({ diet }, recipe.diet), profile.avoid);
}

function assertCompatible(dish, profile) {
  if (dish.skip) return;
  if (!compatible(dish, profile, dish.theme)) throw new Error(`Retten “${dish.title}” stemmer ikke med kostvalg eller ingredienser, der skal undgås. Ret forslaget først.`);
}

function validRecipe(value) {
  if (!isObject(value) || typeof value.id !== 'string' || !/^[\p{L}\p{N}._:-]{1,120}$/u.test(value.id) ||
      typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 || !DIETS.includes(value.diet) ||
      !Number.isInteger(value.minutes) || value.minutes < 1 || value.minutes > 720 ||
      typeof value.servings !== 'number' || !Number.isFinite(value.servings) || value.servings <= 0 || value.servings > 100 ||
      !Array.isArray(value.ingredients) || !value.ingredients.length) throw new Error('Opskriften mangler bekræftede ingredienser, kostvalg eller portioner.');
  const ingredients = validateIngredients(value.ingredients);
  const themes = Array.isArray(value.themes) ? value.themes.filter(x => MEAL_THEMES.includes(x)).slice(0, 7) : [];
  const sourceRef = value.sourceRef && value.sourceRef.kind === 'recipe' && typeof value.sourceRef.id === 'string'
    ? { kind: 'recipe', id: value.sourceRef.id.slice(0, 120), ...(Number.isInteger(value.sourceRef.revision) ? { revision: value.sourceRef.revision } : {}) }
    : { kind: 'recipe-catalog', id: value.id };
  return { id: value.id, title: value.title.trim(), diet: value.diet, minutes: value.minutes, servings: value.servings,
    ingredients, themes, sourceRef, cuisine:typeof value.cuisine==='string'?value.cuisine.slice(0,40):null, method:typeof value.method==='string'?value.method.slice(0,40):null, favorite: value.favorite === true, doNotSuggest: value.doNotSuggest === true };
}

function checkRevision(plan, expected) {
  if (!Number.isInteger(expected) || expected !== plan.revision) throw new Error('Madplanen er ændret. Genindlæs den aktuelle revision før du gemmer.');
}

function planServings(dishes) {
  const numbers = [...new Set(dishes.filter(x => !x.skip).map(x => x.servings))];
  return numbers.length === 1 ? numbers[0] : null;
}

function pricingConstraints(dishes, profile) {
  return requirement => ingredientConstraints(profile, dishes, requirement);
}

function scoreObservedPrices(rows, budgetPerDinner) {
  const known = rows.map(row => row.price.estimatedProductsDkk).filter(value => value !== null);
  const low = Math.min(...known), high = Math.max(...known);
  for (const row of rows) {
    const cost = row.price.estimatedProductsDkk;
    // Unknown is not zero: it receives no price assertion or price advantage.
    // A bounded confidence/comparison bonus cannot overturn hard dietary rules,
    // and does not purport to find the cheapest product in the whole market.
    row.priceScore = cost === null ? 0 : 1 + (high > low ? 3 * (high - cost) / (high - low) : 0) +
      (budgetPerDinner !== null && cost <= budgetPerDinner ? 2 : 0);
    row.score += row.priceScore + Math.min(row.reusedIngredients.length, 4) * 0.75;
  }
}

const LEFTOVER_RECIPE_FIELDS = ['recipeId', 'title', 'minutes', 'diet', 'baseServings', 'ingredientBasis',
  'ingredients', 'reasons', 'sourceRefs', 'manuallySelected'];
function restorePlannedLeftovers(dishes) {
  return dishes.map(original => {
    const dish = clone(original);
    if (dish.leftoverOriginal) {
      const saved = dish.leftoverOriginal;
      for (const field of LEFTOVER_RECIPE_FIELDS) delete dish[field];
      Object.assign(dish, clone(saved));
    }
    if (dish.leftoverCookingOriginal) dish.ingredients = clone(dish.leftoverCookingOriginal.ingredients);
    for (const field of ['leftoverOriginal', 'leftoverCookingOriginal', 'leftoverFromDate', 'plannedCookServings', 'leftoverTargets', 'leftoverNote']) delete dish[field];
    return dish;
  });
}

function checkedLeftoverLinks(value, dishes) {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Planlæg højst seks forbindelser til rester inden for denne uge.');
  const dates = new Set(dishes.map(dish => dish.date)), targets = new Set();
  const links = value.map(link => {
    if (!isObject(link)) throw new Error('Angiv kildedag, måldag, portioner og tid til rester.');
    parseDay(link.fromDate); parseDay(link.toDate);
    if (!dates.has(link.fromDate) || !dates.has(link.toDate) || link.fromDate >= link.toDate)
      throw new Error('Rester skal planlægges fra en tidligere dag til en senere dag i samme madplan.');
    if (targets.has(link.toDate)) throw new Error('En dag kan kun modtage én planlagt restefordeling.');
    targets.add(link.toDate);
    if (typeof link.servings !== 'number' || !Number.isFinite(link.servings) || link.servings <= 0 || link.servings > 72 ||
        !Number.isInteger(link.minutes) || link.minutes < 1 || link.minutes > 720)
      throw new Error('Angiv 0–72 positive portioner og 1–720 minutter som dit eget tidsestimat.');
    return { fromDate: link.fromDate, toDate: link.toDate, servings: round(link.servings), minutes: link.minutes };
  });
  if (links.some(link => targets.has(link.fromDate))) throw new Error('Rester kan ikke planlægges i kæder. Vælg den oprindelige tilberedningsdag.');
  return links.sort((a, b) => a.toDate.localeCompare(b.toDate));
}

function linkedDates(plan) { return new Set((plan.plannedLeftovers || []).flatMap(link => [link.fromDate, link.toDate])); }

function applyPlannedLeftovers(plan, dishes, links, profile) {
  const restored = restorePlannedLeftovers(dishes), byDate = new Map(restored.map(dish => [dish.date, dish]));
  for (const link of links) {
    const source = byDate.get(link.fromDate), target = byDate.get(link.toDate);
    if (source.skip || target.skip || !source.ingredientBasis?.length || !source.baseServings)
      throw new Error('Begge dage skal have et måltid, og kildedagen skal have gennemgåede ingredienser.');
    if (link.servings !== target.servings) throw new Error('Planlagte rester skal dække måldagens fulde registrerede portionsantal. Ret fordelingen eksplicit ved ændringer.');
    const sameExisting = (plan.plannedLeftovers || []).some(prior => sameValue(prior, link));
    if (target.locked && !sameExisting) throw new Error('Lås måldagen op, før dens ret erstattes med planlagte rester.');
    if (!compatible({ ...source, ingredients: source.ingredientBasis }, profile, target.theme))
      throw new Error('Kildens ingredienser eller kosttype passer ikke til måldagens kostvalg. Ingen restefordeling er gemt.');
    source.leftoverCookingOriginal ||= { ingredients: clone(source.ingredients) };
    source.leftoverTargets ||= [];
    source.leftoverTargets.push({ date: link.toDate, servings: link.servings });
    source.plannedCookServings = round(source.servings + source.leftoverTargets.reduce((sum, row) => sum + row.servings, 0));
    if (source.plannedCookServings > 144) throw new Error('Højst 144 tilberedte portioner kan planlægges fra én kildedag.');
    source.ingredients = scaleIngredients(source.ingredientBasis, source.baseServings, source.plannedCookServings);
    source.leftoverNote = 'Planlagt tilberedning: ' + source.plannedCookServings + ' portioner, heraf ' + source.servings +
      ' denne dag og ' + source.leftoverTargets.reduce((sum, row) => sum + row.servings, 0) + ' til senere valgte dage. Ikke bekræftet tilberedt eller på lager.';
    target.leftoverOriginal = Object.fromEntries(LEFTOVER_RECIPE_FIELDS.filter(field => Object.hasOwn(target, field)).map(field => [field, clone(target[field])]));
    Object.assign(target, { recipeId: source.recipeId, title: ('Planlagte rester: ' + source.title).slice(0, 160),
      diet: source.diet, minutes: link.minutes, ingredientBasis: clone(source.ingredientBasis), baseServings: source.baseServings,
      ingredients: [], manuallySelected: true, leftoverFromDate: source.date,
      reasons: ['Du har planlagt ' + link.servings + ' portioner fra tilberedningen ' + source.date + '. Der regnes ikke nye ingredienser på denne dag.',
        'Dette er en plan, ikke bevis på tilberedning, opbevaring, holdbarhed eller indtag. Kontrollér den faktiske mad, før planen følges.'],
      leftoverNote: 'Planlagte rester fra ' + source.date + ' · ' + link.servings + ' portioner · dit tidsestimat ' + link.minutes + ' min.',
      sourceRefs: (source.sourceRefs || []).filter(ref => !['household', 'household-day', 'household-rhythm'].includes(ref.kind))
        .map(clone).concat([householdSourceRef(target, target.date), { kind: 'meal-plan', id: plan.id, date: source.date,
          dishFingerprint: createHash('sha256').update(JSON.stringify({ recipeId: source.recipeId, ingredientBasis: source.ingredientBasis,
            baseServings: source.baseServings, sourceRefs: source.sourceRefs })).digest('hex') }]) });
  }
  return restored;
}

export class MealPlanner {
  constructor({ state, save = async () => {}, now = () => new Date(), recipes = () => [] }) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.recipeSupplier = recipes;
    this.state.mealProfile ||= { ...baseProfile, avoid: [], pantry: [] };
    this.state.mealPlans ||= [];
    this.state.mealHousehold ||= { configured: false, adults: null, children: [], days: {}, rhythm: null, revision: 1 };
    this.state.mealInventory ||= { configured: false, items: [], revision: 1 };
    // The old release generated a list at draft creation. Preserve it as history,
    // but require review before an old plan can produce a new cart proposal.
    for (const plan of this.state.mealPlans) {
      if (plan.schemaVersion === 2) continue;
      plan.legacyShoppingList = clone(plan.shoppingList || []);
      plan.shoppingList = []; plan.shoppingGeneratedAt = null; plan.shoppingRevision = null;
      plan.schemaVersion = 2; plan.revision = 1; plan.status = 'draft'; plan.needsReview = true;
      plan.householdStale = false; plan.profileStale = false; plan.recipeStale = false;
      plan.staleReason = 'Importeret fra v4.8. Gennemgå forslaget før ny indkøbsliste.';
      plan.dishes = (plan.dishes || []).map(dish => {
        const builtin = RECIPES.find(recipe => recipe.id === dish.recipeId);
        return { ...dish, theme: 'everyday', diet: builtin?.diet || 'omnivore', adults: null, children: [],
          householdConfirmed: false, attendanceSource: 'legacy-unconfirmed', skip: false,
          baseServings: dish.servings || plan.servings || this.profile().householdSize,
          ingredientBasis: clone(dish.ingredients || []), reasons: ['Tidligere gemt forslag; husstand ikke fordelt på voksne og børn.'],
          sourceRefs: [{ kind: 'recipe-catalog', id: dish.recipeId || 'legacy' }] };
      });
    }
  }

  profile() { return clone(this.state.mealProfile); }
  activePlanId() { return activeMealPlan(this.state.mealPlans)?.id || null; }
  plans() {
    const quotes = observedMealPrices(this.state, this.now());
    return this.state.mealPlans.slice(0, 12).map(plan => {
      const priceEstimate = this.estimatePlanPrices(plan, quotes);
      const pricingStale = Boolean(plan.priceEstimate && plan.priceEstimate.basisFingerprint !== priceEstimate.basisFingerprint);
      const { shoppingReview, shoppingNeedsReview } = this.shoppingProjection(plan);
      return { ...clone(plan), isActive:plan.id===this.activePlanId(), shoppingReview, shoppingNeedsReview, shoppingSearchList:shoppingSearchList(plan.shoppingList||[]), priceEstimate, priceStatus: priceEstimate.status, pricingStale,
        needsReview: plan.needsReview || pricingStale || shoppingNeedsReview };
    });
  }
  household() { return clone(this.state.mealHousehold); }

  priceContext(planId = null) {
    return { profile: this.profile(), pantry: this.pantryAvailableFor(planId), quotes: observedMealPrices(this.state, this.now()) };
  }

  shoppingRequirements(plan) {
    return ingredientsFor(plan.dishes, { ...this.profile(), pantry: this.pantryAvailableFor(plan.id) }, { includeSatisfied: true });
  }

  shoppingChoiceConflicts(item, constraints) {
    return ingredientConflicts([item], constraints.diet, constraints.avoid);
  }

  shoppingProjection(plan) {
    return projectShoppingChoices(plan, this.shoppingRequirements(plan), this.profile(), this.shoppingChoiceConflicts);
  }

  preserveShoppingChoices(plan) {
    if (!Array.isArray(plan.manualShoppingOverrides))
      plan.manualShoppingOverrides = shoppingOverrides(plan, this.shoppingRequirements(plan), this.profile());
  }

  assertShoppingReviewed(plan) {
    if (plan.shoppingNeedsReview || this.shoppingProjection(plan).shoppingNeedsReview)
      throw new Error('Indkøbslistens manuelle valg kræver gennemgang mod det aktuelle behov. Ingen kurvændring.');
  }

  estimatePlanPrices(plan, quotes = observedMealPrices(this.state, this.now())) {
    if (plan.householdStale || plan.profileStale || plan.recipeStale) return {
      status: 'stale-basis', estimatedProductsDkk: null, knownProductsDkk: null, budgetStatus: 'unknown',
      unknownIngredients: [], lines: [], basisFingerprint: null, observedAt: null,
      note: 'Madplanens grundlag er ændret. Gennemgå planen før et aktuelt prisoverslag beregnes.' };
    const profile = this.profile();
    const reviewedList = plan.status === 'shopping_ready' && plan.shoppingRevision === plan.revision;
    const projection = this.shoppingProjection(plan), requiresShoppingReview = Boolean(plan.shoppingNeedsReview || projection.shoppingNeedsReview);
    const requirements = reviewedList ? clone(plan.shoppingList) : projection.shoppingList;
    const estimate = estimateMealRequirements(requirements, quotes, pricingConstraints(plan.dishes, profile));
    const budget = plan.budgetTargetDkk ?? null;
    return { ...estimate, scope: reviewedList ? requiresShoppingReview ? 'saved-local-shopping-list-awaiting-review' : 'reviewed-local-shopping-list' : 'planned-ingredients-and-manual-extras',
      requiresShoppingReview,
      budgetTargetDkk: budget, budgetStatus: budget === null ? 'not-set' : estimate.knownProductsDkk > budget ? 'over'
        : estimate.estimatedProductsDkk === null ? 'unknown' : 'within' };
  }

  recordPlanPrices(plan) {
    plan.priceEstimate = this.estimatePlanPrices(plan);
    plan.priceStatus = plan.priceEstimate.status;
  }

  priceCandidate(recipe, servings, theme, selected, context) {
    const dish = { ingredients: scaleIngredients(recipe.ingredients, recipe.servings, servings), diet: recipe.diet, theme };
    const beforeRequirements = ingredientsFor(selected, { ...context.profile, pantry: context.pantry });
    const afterRequirements = ingredientsFor([...selected, dish], { ...context.profile, pantry: context.pantry });
    const constraints = pricingConstraints([...selected, dish], context.profile);
    const before = estimateMealRequirements(beforeRequirements, context.quotes, constraints);
    const after = estimateMealRequirements(afterRequirements, context.quotes, constraints);
    const used = new Set(selected.filter(item => !item.skip).flatMap(item => item.ingredients.map(ingredientKey)));
    return { price: marginalMealEstimate(before, after, beforeRequirements, afterRequirements),
      reusedIngredients: recipe.ingredients.filter(item => used.has(ingredientKey(item))).map(item => item.name) };
  }

  // Stock remains user-confirmed data. Reservations are computed from currently
  // reviewed plans; cart transfers, meal drafts and deliveries do not alter it.
  inventory() {
    const inventory = this.state.mealInventory;
    const reservations = this.inventoryReservations();
    return { ...clone(inventory), items: inventory.items.map(item => {
      const reserved = reservations.get(ingredientKey(item)) || 0;
      const expired = Boolean(item.expiresAt && item.expiresAt < localToday(this.now()));
      return { ...clone(item), reservedQuantity: reserved,
        availableQuantity: expired ? 0 : Math.max(0, round(item.quantity - reserved)), expired };
    }) };
  }

  inventoryReservations(excludePlanId = null) {
    const reserved = new Map();
    if (!this.state.mealInventory.configured) return reserved;
    const available = new Map(this.state.mealInventory.items.filter(item =>
      !item.expiresAt || item.expiresAt >= localToday(this.now())).map(item => [ingredientKey(item), item.quantity]));
    for (const plan of this.state.mealPlans.filter(item => item.id !== excludePlanId && item.status === 'shopping_ready' &&
      !item.householdStale && !item.profileStale && !item.recipeStale).slice().reverse()) {
      const required = ingredientsFor(plan.dishes, { ...this.profile(), pantry: [] });
      for (const item of required) {
        const key = ingredientKey(item);
        const used = Math.min(item.quantity, Math.max(0, round((available.get(key) || 0) - (reserved.get(key) || 0))));
        if (used > 0) reserved.set(key, round((reserved.get(key) || 0) + used));
      }
    }
    return reserved;
  }

  pantryAvailableFor(planId = null) {
    if (!this.state.mealInventory.configured) return this.profile().pantry;
    const reserved = this.inventoryReservations(planId);
    return this.state.mealInventory.items.filter(item => !item.expiresAt || item.expiresAt >= localToday(this.now()))
      .map(item => ({ name: item.name, unit: item.unit, quantity: Math.max(0, round(item.quantity - (reserved.get(ingredientKey(item)) || 0))) }));
  }

  async setInventory({ expectedRevision, items } = {}) {
    const current = this.state.mealInventory;
    if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) throw new Error('Lageret er ændret. Genindlæs før du gemmer.');
    const checked = validateInventoryItems(items, this.now().toISOString());
    if (current.configured && sameValue(checked, current.items)) return this.inventory();
    this.state.mealInventory = { configured: true, items: checked, revision: current.revision + 1, updatedAt: this.now().toISOString() };
    this.invalidatePlans('Det registrerede lager er ændret. Genberegn indkøb efter din nye beholdning.', { profile: true });
    await this.save();
    return this.inventory();
  }

  recipes() {
    const builtins = RECIPES.map(recipe => ({ ...recipe, servings: 2,
      ingredients: recipe.ingredients.map(([name, quantity, unit]) => ({ name, quantity, unit })),
      themes: RECIPE_THEMES[recipe.id] || [], sourceRef: { kind: 'recipe-catalog', id: recipe.id } }));
    const added = this.recipeSupplier();
    const recipes = new Map(builtins.map(recipe => [recipe.id, validRecipe(recipe)]));
    for (const input of Array.isArray(added) ? added.slice(0, 200) : []) {
      try { const recipe = validRecipe(input); if (!recipes.has(recipe.id)) recipes.set(recipe.id, recipe); }
      catch { /* An incomplete inbox item must never become a usable recipe. */ }
    }
    return [...recipes.values()];
  }

  invalidatePlans(reason, { dates = null, household = false, profile = false } = {}) {
    for (const plan of this.state.mealPlans) {
      if (dates && !plan.dishes.some(dish => dates.includes(dish.date))) continue;
      this.preserveShoppingChoices(plan);
      plan.revision++; plan.status = 'draft'; plan.needsReview = true;
      plan.shoppingList = []; plan.shoppingGeneratedAt = null; plan.shoppingRevision = null;
      plan.householdStale ||= household; plan.profileStale ||= profile;
      plan.staleReason = reason; plan.updatedAt = this.now().toISOString();
    }
  }

  async invalidateRecipe(id) {
    let changed = false;
    for (const plan of this.state.mealPlans) {
      if (!plan.dishes.some(dish => dish.sourceRefs?.some(source => source.kind === 'recipe' && source.id === id))) continue;
      this.preserveShoppingChoices(plan);
      plan.revision++; plan.status = 'draft'; plan.needsReview = true; plan.recipeStale = true;
      plan.shoppingList = []; plan.shoppingGeneratedAt = null; plan.shoppingRevision = null;
      plan.staleReason = 'En gemt opskrift er ændret eller fjernet. Vælg en aktuel ret og gennemgå madplanen.';
      plan.updatedAt = this.now().toISOString(); changed = true;
    }
    if (changed) await this.save();
    return { changed };
  }

  async setProfile(input) {
    const next = validateMealProfile(input);
    const current = this.profile();
    checkProfileRevision(current, input.expectedRevision);
    if (sameValue(next, Object.fromEntries(Object.keys(next).map(key => [key, current[key]])))) return current;
    this.state.mealProfile = { ...next, revision: (current.revision || 1) + 1, updatedAt: this.now().toISOString(), source: 'user-entered' };
    this.invalidatePlans('Madpræferencer eller lager er ændret. Gennemgå madplanen igen.', { profile: true });
    await this.save();
    return this.profile();
  }

  async resetProfile({ expectedRevision } = {}) {
    const current = this.profile();
    checkProfileRevision(current, expectedRevision);
    const next = { ...baseProfile, avoid: [], pantry: [] };
    if (sameValue(next, Object.fromEntries(Object.keys(next).map(key => [key, current[key]])))) return current;
    this.state.mealProfile = { ...next, revision: (current.revision || 1) + 1 };
    this.invalidatePlans('Madpræferencer er nulstillet. Gennemgå madplanen igen.', { profile: true });
    await this.save();
    return this.profile();
  }

  async setHousehold(input) {
    if (!isObject(input)) throw new Error('Ugyldige husstandsoplysninger.');
    const previous = this.household();
    checkHouseholdRevision(previous, input.expectedRevision);
    const attendance = validateAttendance({ adultPortion: previous.adultPortion, ...input });
    const days = input.days === undefined ? previous.days : validateDays(input.days);
    const rhythm = input.rhythm === undefined ? previous.rhythm || null : validateRhythm(input.rhythm);
    if (previous.configured && sameValue({ ...attendance, days, rhythm },
      { ...validateAttendance(previous), days: previous.days, rhythm: previous.rhythm || null })) return previous;
    const dates = [...new Set(this.state.mealPlans.flatMap(plan => plan.dishes.map(dish => dish.date)))];
    const before = new Map(dates.map(date => [date, attendanceMeaning(this.attendanceFor(date))]));
    this.state.mealHousehold = { configured: true, ...attendance, days, rhythm,
      revision: (this.state.mealHousehold.revision || 0) + 1, updatedAt: this.now().toISOString() };
    const changedDates = dates.filter(date => !sameValue(before.get(date), attendanceMeaning(this.attendanceFor(date))));
    if (changedDates.length) this.invalidatePlans('Husstanden er ændret. Opdatér portioner fra husstanden og gennemgå planen.', { dates: changedDates, household: true });
    await this.save();
    return this.household();
  }

  async setDay(date, input) {
    parseDay(date);
    if (!isObject(input)) throw new Error('Ugyldigt dagsvalg.');
    const current = this.household();
    checkHouseholdRevision(current, input.expectedRevision);
    const defaults = current.days[date] || (current.configured ? this.attendanceFor(date) : {});
    const day = validateDay({ ...defaults, ...input });
    if (!Object.hasOwn(current.days, date) && Object.keys(current.days).length >= 180) throw new Error('Husstandskalenderen kan have højst 180 dagsvalg.');
    if (sameValue(current.days[date], day)) return current;
    const before = attendanceMeaning(this.attendanceFor(date));
    this.state.mealHousehold.days[date] = day;
    this.state.mealHousehold.revision = (current.revision || 0) + 1;
    this.state.mealHousehold.updatedAt = this.now().toISOString();
    if (!sameValue(before, attendanceMeaning(this.attendanceFor(date))))
      this.invalidatePlans(`Husstanden eller temaet den ${date} er ændret. Opdatér portioner og gennemgå planen.`, { dates: [date], household: true });
    await this.save();
    return this.household();
  }

  async removeDay(date, { expectedRevision } = {}) {
    parseDay(date);
    checkHouseholdRevision(this.state.mealHousehold, expectedRevision);
    if (Object.hasOwn(this.state.mealHousehold.days, date)) {
      const before = attendanceMeaning(this.attendanceFor(date));
      delete this.state.mealHousehold.days[date];
      this.state.mealHousehold.revision = (this.state.mealHousehold.revision || 0) + 1;
      this.state.mealHousehold.updatedAt = this.now().toISOString();
      if (!sameValue(before, attendanceMeaning(this.attendanceFor(date))))
        this.invalidatePlans(`Dagsvalget den ${date} er fjernet. Gennemgå standardhusstanden.`, { dates: [date], household: true });
      await this.save();
    }
    return this.household();
  }

  attendanceFor(date) {
    return resolveHouseholdAttendance(this.state.mealHousehold, date, { fallbackServings: this.profile().householdSize });
  }

  assertRecipeSources(dishes) {
    const current = new Map(this.recipes().filter(recipe => recipe.sourceRef.kind === 'recipe').map(recipe => [recipe.sourceRef.id, recipe.sourceRef]));
    for (const dish of dishes.filter(item => !item.skip)) for (const source of dish.sourceRefs || []) {
      if (source.kind !== 'recipe') continue;
      const found = current.get(source.id);
      if (!found || found.revision !== source.revision) throw new Error('En gemt opskrift er ændret eller fjernet. Vælg retten igen eller erstat den før en ny indkøbsliste.');
    }
  }

  async createPlan({ startDate = localToday(this.now()), days = 5, calendarBusyDates = [], variation = 'balanced' } = {}) {
    if(!['balanced','high','favorites'].includes(variation))throw new Error('Vælg balanceret variation, høj variation eller favoritter.');
    const date = parseDay(startDate);
    if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('Madplanen skal dække 1–7 dage.');
    if (!Array.isArray(calendarBusyDates) || calendarBusyDates.length > 100) throw new Error('Ugyldig kalenderoversigt.');
    for (const day of calendarBusyDates) parseDay(day);
    const profile = this.profile();
    const catalog = this.recipes();
    const busy = new Set(calendarBusyDates);
    const used = new Set();
    const recent = new Set(this.state.mealPlans.slice(0, 3).flatMap(plan => plan.dishes.map(dish => dish.recipeId)));
    const pantryKeys = new Set(this.pantryAvailableFor().filter(item => item.quantity > 0).map(ingredientKey));
    const context = this.priceContext(), selectedDishes = [];
    const dishes = Array.from({ length: days }, (_, index) => {
      const day = addDays(date, index);
      const shortEvening = busy.has(day);
      const attendance = this.attendanceFor(day);
      if (attendance.skip) return { date: day, recipeId: null, title: 'Ingen mad hjemme', minutes: 0,
        diet: profile.diet, ...attendance, busyDay: shortEvening, ingredients: [], ingredientBasis: [], baseServings: 1,
        householdBasis: attendanceMeaning(attendance), manualServings: false, manualTheme: false, manualSkip: false,
        reasons: ['Dagen er fravalgt eller ingen er registreret hjemme.'], sourceRefs: [householdSourceRef(attendance, day)] };
      const choices = catalog.filter(recipe => !recipe.doNotSuggest && compatible(recipe, profile, attendance.theme));
      if (!choices.length) throw new Error(`Ingen egnede opskrifter den ${day}. Tilføj en gennemgået opskrift, som opfylder kostvalget og undgå-listen.`);
      const scored = choices.map((recipe, order) => ({ recipe, ...this.priceCandidate(recipe, attendance.servings, attendance.theme, selectedDishes, context), score:
        (used.has(recipe.id) ? -1000 : 0) + (recipe.themes.includes(attendance.theme) ? 8 : 0) +
        (recipe.sourceRef.kind === 'recipe' ? 5 : 0) + (recipe.favorite ? 8 : 0) + -varietyPenalty(recipe,variation!=='high'&&recipe.sourceRef.kind==='recipe'&&choices.filter(r=>r.sourceRef.kind==='recipe').length===1?[]:this.state.mealPlans,selectedDishes,variation) +
        recipe.ingredients.filter(item => pantryKeys.has(ingredientKey(item))).length * 0.5 -
        (shortEvening || attendance.theme === 'quick' ? recipe.minutes * 2 : 0),
        tie: (order + date.getUTCDate() + index) % choices.length }));
      scoreObservedPrices(scored, profile.budgetDkk === null ? null : profile.budgetDkk / days);
      scored.sort((a, b) => b.score - a.score || a.tie - b.tie || a.recipe.id.localeCompare(b.recipe.id));
      const choice = scored[0], recipe = choice.recipe;
      const reasons = [attendance.householdConfirmed ? 'Portioner fra din gemte husstand for dagen.' : 'Foreløbigt portionsantal fra madpræferencer; voksne og børn er ikke bekræftet.'];
      if (attendance.children.length) reasons.push('Børneportioner er redigerbare køkkenestimater, ikke ernæringsanbefalinger.');
      if (shortEvening) reasons.push('Kalenderen markerer en travl dag; hurtigere retter prioriteres. Kalenderen bruges ikke til at gætte, hvem der er hjemme.');
      if (attendance.theme !== 'everyday') reasons.push(recipe.themes.includes(attendance.theme) || ['vegan', 'vegetarian'].includes(attendance.theme)
        ? `Valgt med dagens tema: ${THEME_LABELS[attendance.theme]}.` : `Dagens tema er ${THEME_LABELS[attendance.theme]}; kontrollér selv, at retten passer.`);
      if (recipe.sourceRef.kind === 'recipe') reasons.push('Fra en gennemgået opskrift i din opskriftshukommelse.');
      if (recipe.ingredients.some(item => pantryKeys.has(ingredientKey(item)))) reasons.push('Retten bruger ingredienser fra dit oplyste lager.');
      if(varietyPenalty(recipe,[],selectedDishes,variation)>0)reasons.push('Lignende ingredienssammensætning gentages, fordi det egnede udvalg er begrænset.');
      if (used.has(recipe.id)) reasons.push('En ret gentages, fordi udvalget er begrænset af dine valg.');
      if (choice.reusedIngredients.length) reasons.push('Ved forslaget blev råvaregenbrug med ugens øvrige valgte retter prioriteret: ' + choice.reusedIngredients.join(', ') + '. Det er ikke bevis på rester eller beholdning.');
      reasons.push(choice.price.estimatedProductsDkk === null
        ? 'Der mangler aktuelle, entydige varepriser til prisdelen af dette forslag. Ukendt pris regnes ikke som gratis.'
        : 'Forslagets prisprioritering bruger kun allerede registrerede varepriser og bekræftet lager. Se det aktuelle ugeoverslag; ingen nye vareopslag er foretaget.');
      used.add(recipe.id);
      const dish = {
        date: day, recipeId: recipe.id, title: recipe.title, diet: recipe.diet, minutes: recipe.minutes, cuisine:recipe.cuisine||null, method:recipe.method||null,
        locked: false,
        ...attendance, busyDay: shortEvening, ingredientBasis: clone(recipe.ingredients), baseServings: recipe.servings,
        householdBasis: attendanceMeaning(attendance), manualServings: false, manualTheme: false, manualSkip: false,
        ingredients: scaleIngredients(recipe.ingredients, recipe.servings, attendance.servings), reasons,
        sourceRefs: [clone(recipe.sourceRef), householdSourceRef(attendance, day), { kind: 'meal-profile' }],
      };
      selectedDishes.push(dish); return dish;
    });
    const plan = {
      id: randomUUID(), schemaVersion: 2, revision: 1, status: 'draft', createdAt: this.now().toISOString(), updatedAt: this.now().toISOString(), startDate,
      days, variation, servings: planServings(dishes), budgetTargetDkk: profile.budgetDkk,
      priceStatus: 'unknown-until-retailer-lookup', calendarAware: busy.size > 0, dishes,
      needsReview: true, householdStale: false, profileStale: false, recipeStale: false, staleReason: null,
      shoppingList: [], shoppingGeneratedAt: null, shoppingRevision: null,
      manualShoppingExtras: [], manualShoppingOverrides: [], shoppingNeedsReview: false,
    };
    this.recordPlanPrices(plan);
    this.state.mealPlans.unshift(plan);
    this.state.mealPlans = this.state.mealPlans.slice(0, 12);
    await this.save();
    return plan;
  }

  async updatePlan(id, input = {}) {
    const plan = this.getPlan(id);
    checkRevision(plan, input.expectedRevision);
    if (input.refreshHousehold !== undefined && typeof input.refreshHousehold !== 'boolean') throw new Error('Ugyldigt valg af husstandsopdatering.');
    if (plan.householdStale && !input.refreshHousehold) throw new Error('Husstanden er ændret. Opdatér portioner fra husstanden før du gemmer.');
    const changes = input.dishes === undefined && input.refreshHousehold ? plan.dishes.map(dish => ({ date: dish.date })) : input.dishes;
    if (!Array.isArray(changes) || changes.length !== plan.dishes.length) throw new Error('Alle madplanens dage skal medsendes.');
    const byDate = new Map(changes.map(dish => [dish?.date, dish]));
    if (byDate.size !== changes.length || changes.some(dish => !isObject(dish) || !plan.dishes.some(current => current.date === dish.date))) throw new Error('Madplanens datoer må ikke ændres eller gentages.');
    const linked = linkedDates(plan);
    for (const previous of plan.dishes.filter(dish => linked.has(dish.date))) {
      const patch = byDate.get(previous.date);
      const recipeChange = ['recipeId', 'servings', 'theme', 'skip', 'title', 'minutes', 'diet', 'ingredients']
        .some(field => patch[field] !== undefined && !sameValue(patch[field], previous[field]));
      const householdChange = input.refreshHousehold && !sameValue(previous.householdBasis || attendanceMeaning(previous), attendanceMeaning(this.attendanceFor(previous.date)));
      if (recipeChange || householdChange) throw new Error('Dagen indgår i planlagte rester. Fjern den berørte restefordeling eksplicit, før ret, portioner, husstand eller ingredienser ændres. Andre dages valg bevares.');
    }
    const catalog = new Map(this.recipes().map(recipe => [recipe.id, recipe]));
    const profile = this.profile();
    const dishes = plan.dishes.map(previous => {
      const patch = byDate.get(previous.date);
      const previousBasis = previous.householdBasis || attendanceMeaning(previous);
      const refreshed = input.refreshHousehold ? this.attendanceFor(previous.date) : null;
      const basis = refreshed ? attendanceMeaning(refreshed) : previousBasis;
      const basisChanged = refreshed && !sameValue(previousBasis, basis);
      const attendance = refreshed ? { ...refreshed,
        servings: previous.manualServings && !refreshed.skip ? previous.servings : refreshed.servings,
        theme: previous.manualTheme ? previous.theme : refreshed.theme,
        skip: refreshed.skip || (previous.manualSkip ? previous.skip : false),
      } : {
        adults: previous.adults, children: clone(previous.children), householdConfirmed: previous.householdConfirmed,
        adultPortion: previous.adultPortion ?? 1, guests: clone(previous.guests || { adults: 0, children: [] }), occasion: previous.occasion || 'ordinary',
        attendanceSource: previous.attendanceSource, servings: previous.servings, theme: previous.theme, skip: previous.skip,
      };
      const theme = validateTheme(patch.theme ?? attendance.theme);
      if (patch.locked !== undefined && typeof patch.locked !== 'boolean') throw new Error('Låsning af en madplansdag skal være sand eller falsk.');
      if (patch.skip !== undefined && typeof patch.skip !== 'boolean') throw new Error('Spring dag over skal være sand eller falsk.');
      const servings = patch.servings ?? attendance.servings;
      if (typeof servings !== 'number' || !Number.isFinite(servings) || servings < 0 || servings > 72) throw new Error('Portioner skal være 0–72.');
      const skip = (patch.skip ?? attendance.skip) || servings === 0;
      let source = previous;
      let changedRecipe = false;
      if (patch.recipeId !== undefined && !(patch.recipeId === null && skip)) {
        const selected = catalog.get(patch.recipeId);
        if (!selected) throw new Error('Vælg en eksisterende gennemgået opskrift.');
        const priorSource = previous.sourceRefs?.find(item => item.kind === 'recipe');
        changedRecipe = patch.recipeId !== previous.recipeId || selected.sourceRef.kind === 'recipe' && selected.sourceRef.revision !== priorSource?.revision;
        if (changedRecipe) source = selected;
      }
      if (!skip && !source.recipeId && !source.id && input.refreshHousehold && patch.ingredients === undefined) {
        source = [...catalog.values()].filter(recipe => compatible(recipe, profile, theme))
          .sort((a, b) => previous.busyDay || theme === 'quick' ? a.minutes - b.minutes : a.id.localeCompare(b.id))[0];
        if (!source) throw new Error('Ingen egnet opskrift til den nye hjemmedag. Tilføj en gennemgået opskrift først.');
        changedRecipe = true;
      }
      if (!skip && !source.recipeId && !source.id && (!patch.title || !patch.ingredients || !patch.diet)) throw new Error('Vælg en ret og ingredienser til dagen.');
      const title = patch.title ?? source.title;
      const minutes = patch.minutes ?? source.minutes;
      const diet = patch.diet ?? source.diet;
      if (typeof title !== 'string' || !title.trim() || title.length > 160 ||
          !Number.isInteger(minutes) || minutes < (skip ? 0 : 1) || minutes > 720 || !DIETS.includes(diet)) throw new Error('Retten skal have titel, tilberedningstid og kosttype.');
      let baseServings = changedRecipe ? source.servings : source.baseServings;
      let ingredientBasis = changedRecipe ? clone(source.ingredients) : clone(source.ingredientBasis || source.ingredients);
      if (patch.ingredients !== undefined && (changedRecipe || !sameIngredients(patch.ingredients, previous.ingredients))) {
        ingredientBasis = validateIngredients(patch.ingredients);
        baseServings = servings || 1;
      }
      const manuallyReplacedRecipe = !changedRecipe && (patch.recipeId === undefined || patch.recipeId === previous.recipeId) && (
        patch.title !== undefined && patch.title !== previous.title ||
        patch.minutes !== undefined && patch.minutes !== previous.minutes ||
        patch.diet !== undefined && patch.diet !== previous.diet ||
        patch.ingredients !== undefined && !sameIngredients(patch.ingredients, previous.ingredients));
      // An edit to one day must not rewrite the explanations, snapshots or
      // manual choices of every other day in the same weekly plan.
      const explicitChange = ['servings', 'theme', 'skip', 'locked'].some(key =>
        patch[key] !== undefined && patch[key] !== previous[key]);
      if (!basisChanged && !changedRecipe && !manuallyReplacedRecipe && !explicitChange) {
        assertCompatible(previous, profile);
        return clone(previous);
      }
      if (!skip && (!ingredientBasis.length || !baseServings)) throw new Error('Tilføj konkrete ingredienser til retten, før der oprettes indkøbsliste.');
      const ingredients = skip ? [] : scaleIngredients(ingredientBasis, baseServings, servings);
      const manual = patch.servings !== undefined ? servings !== basis.servings : Boolean(previous.manualServings);
      const dish = { ...previous, ...attendance, theme, skip, locked: patch.locked ?? Boolean(previous.locked), servings: skip ? 0 : round(servings), title: title.trim(), minutes, diet,
        householdBasis: clone(basis), manualServings: manual,
        manualTheme: patch.theme !== undefined ? theme !== basis.theme : Boolean(previous.manualTheme),
        manualSkip: patch.skip !== undefined ? Boolean(patch.skip) !== basis.skip : Boolean(previous.manualSkip),
        recipeId: changedRecipe ? source.id : manuallyReplacedRecipe ? `custom:${previous.date}` : previous.recipeId || (!skip && patch.ingredients ? `custom:${previous.date}` : null),
        baseServings, ingredientBasis, ingredients,
        manuallySelected: Boolean(previous.manuallySelected || manuallyReplacedRecipe || changedRecipe && patch.recipeId !== undefined),
        sourceRefs: changedRecipe ? [clone(source.sourceRef), householdSourceRef(attendance, previous.date), { kind: 'meal-profile' }] :
          manuallyReplacedRecipe ? [{ kind: 'owner-meal', date: previous.date }, householdSourceRef(attendance, previous.date), { kind: 'meal-profile' }] :
          basisChanged ? [...clone(previous.sourceRefs || []).filter(ref => !['household', 'household-day', 'household-rhythm'].includes(ref.kind)),
            householdSourceRef(attendance, previous.date)] : clone(previous.sourceRefs || []),
        reasons: [input.refreshHousehold ? 'Husstandsgrundlaget er opdateret; dine retter og manuelle valg er bevaret.' : 'Forslaget er tilrettet af dig.',
          ...(manual ? ['Portionsantal er manuelt tilrettet og bevares ved husstandsopdatering; kontrollér det mod dagens fremmøde.'] : []),
          'Kostvalg og undgå-liste er kontrolleret; vareetiketter skal stadig gennemgås.'],
      };
      assertCompatible(dish, profile);
      return dish;
    });
    const withLeftovers = plan.plannedLeftovers?.length ? applyPlannedLeftovers(plan, dishes, plan.plannedLeftovers, profile) : dishes;
    this.assertRecipeSources(withLeftovers);
    this.preserveShoppingChoices(plan);
    plan.dishes = withLeftovers; plan.servings = planServings(withLeftovers); plan.revision++;
    plan.status = 'draft'; plan.shoppingList = []; plan.shoppingGeneratedAt = null; plan.shoppingRevision = null;
    plan.needsReview = true; plan.householdStale = false; plan.profileStale = false; plan.recipeStale = false; plan.staleReason = null;
    plan.budgetTargetDkk = profile.budgetDkk; plan.updatedAt = this.now().toISOString();
    this.recordPlanPrices(plan);
    await this.save();
    return plan;
  }

  async buildShoppingList(id, { expectedRevision } = {}) {
    const plan = this.getPlan(id);
    checkRevision(plan, expectedRevision);
    if (plan.householdStale || plan.profileStale || plan.recipeStale) throw new Error('Planens grundlag er ændret. Gennemgå og gem madplanen før indkøbslisten oprettes.');
    this.assertRecipeSources(plan.dishes);
    for (const dish of plan.dishes) assertCompatible(dish, this.profile());
    const projected = this.shoppingProjection(plan);
    Object.assign(plan, projected);
    plan.revision++; plan.shoppingRevision = plan.revision; plan.status = 'shopping_ready'; plan.needsReview = plan.shoppingNeedsReview;
    plan.shoppingGeneratedAt = this.now().toISOString(); plan.updatedAt = this.now().toISOString(); plan.staleReason = null;
    this.recordPlanPrices(plan);
    await this.save();
    return plan;
  }

  async editShoppingList(id, { expectedRevision, items, useComputed = [] } = {}) {
    const plan = this.getPlan(id);
    checkRevision(plan, expectedRevision);
    if (plan.status !== 'shopping_ready' || !plan.shoppingGeneratedAt || plan.householdStale || plan.profileStale || plan.recipeStale) throw new Error('Opret en aktuel indkøbsliste fra den gennemgåede madplan først.');
    const checked = validateIngredients(items, { allowZero: true });
    const keys = checked.map(ingredientKey);
    if (new Set(keys).size !== keys.length) throw new Error('Samme vare og enhed må kun stå én gang på indkøbslisten.');
    if (!Array.isArray(useComputed) || useComputed.length > 120) throw new Error('Ugyldigt valg af beregnede mængder.');
    const resets = validateIngredients(useComputed.map(item => ({ ...item, quantity: 0 })), { allowZero: true, max: 120 });
    const projected = editShoppingChoices(plan, this.shoppingRequirements(plan), this.profile(), checked,
      { useComputed: resets, revision: plan.revision + 1, at: this.now().toISOString(), conflicts: this.shoppingChoiceConflicts });
    Object.assign(plan, projected); plan.needsReview = plan.shoppingNeedsReview;
    plan.revision++; plan.shoppingRevision = plan.revision; plan.updatedAt = this.now().toISOString();
    this.recordPlanPrices(plan);
    await this.save();
    return plan;
  }

  getPlan(id) {
    const plan = this.state.mealPlans.find(x => x.id === id);
    if (!plan) throw new Error('Madplanen findes ikke.');
    return plan;
  }

  async recordOutcome(id,{expectedRevision,date,outcome}={}){
    const plan=this.getPlan(id);checkRevision(plan,expectedRevision);if(!['selected','cooked','not_cooked'].includes(outcome))throw new Error('Vælg valgt, tilberedt eller ikke tilberedt.');const dish=plan.dishes.find(d=>d.date===date&&!d.skip);if(!dish)throw new Error('Vælg en planlagt maddag.');dish.outcome=outcome;dish.outcomeSource='user-report';dish.outcomeRecordedAt=this.now().toISOString();plan.revision++;plan.status='draft';plan.needsReview=true;await this.save();return clone(plan);
  }
  async setPlannedLeftovers(id, { expectedRevision, links } = {}) {
    const plan = this.getPlan(id);
    checkRevision(plan, expectedRevision);
    const checked = checkedLeftoverLinks(links, plan.dishes);
    if (sameValue(checked, plan.plannedLeftovers || [])) return plan;
    if (checked.length && (plan.householdStale || plan.profileStale || plan.recipeStale))
      throw new Error('Gennemgå planens ændrede grundlag før en ny restefordeling. Eksisterende fordelinger kan fjernes eksplicit.');
    const dishes = applyPlannedLeftovers(plan, plan.dishes, checked, this.profile());
    let restoredRecipeStale = false;
    try { this.assertRecipeSources(dishes); }
    catch (error) { if (checked.length) throw error; restoredRecipeStale = true; }
    this.preserveShoppingChoices(plan);
    plan.dishes = dishes; plan.plannedLeftovers = checked; plan.servings = planServings(dishes);
    plan.revision++; plan.status = 'draft'; plan.needsReview = true;
    plan.shoppingList = []; plan.shoppingGeneratedAt = null; plan.shoppingRevision = null;
    plan.recipeStale ||= restoredRecipeStale;
    if (restoredRecipeStale) plan.staleReason = 'Et tidligere manuelt valg er gendannet, men opskriften er ændret. Vælg den aktuelle opskrift før indkøb.';
    plan.updatedAt = this.now().toISOString(); this.recordPlanPrices(plan);
    await this.save(); return plan;
  }

  // Regenerate only days the owner has left unlocked, preserving existing
  // household counts, manual portions, sources for locked dishes and extras.
  async regenerateUnlocked(id, { expectedRevision } = {}) {
    const plan = this.getPlan(id);
    checkRevision(plan, expectedRevision);
    if (plan.householdStale || plan.profileStale || plan.recipeStale) throw new Error('Planens grundlag er ændret. Gennemgå den, før der foreslås nye retter.');
    const profile = this.profile();
    const catalog = this.recipes();
    const linked = linkedDates(plan);
    const retained = dish => dish.locked || dish.skip || dish.manuallySelected || dish.recipeId?.startsWith('custom:') || linked.has(dish.date);
    const selectedDishes = plan.dishes.filter(retained).map(clone);
    const selected = new Set(selectedDishes.filter(dish => !dish.skip).map(dish => dish.recipeId));
    const context = this.priceContext(id);
    const dishes = plan.dishes.map(previous => {
      if (retained(previous)) return clone(previous);
      const choices = catalog.filter(recipe => !recipe.doNotSuggest && compatible(recipe, profile, previous.theme));
      if (!choices.length) throw new Error(`Ingen egnede opskrifter den ${previous.date}.`);
      const candidates = choices.map(recipe => ({ recipe, ...this.priceCandidate(recipe, previous.servings, previous.theme, selectedDishes, context), score: (selected.has(recipe.id) ? -100 : 0) +
        (recipe.id === previous.recipeId ? -10 : 0) - varietyPenalty(recipe,this.state.mealPlans.filter(p=>p.id!==id),selectedDishes,plan.variation||'balanced') + (recipe.favorite ? 8 : 0) + (recipe.themes.includes(previous.theme) ? 5 : 0) -
        (previous.busyDay || previous.theme === 'quick' ? recipe.minutes : 0) }));
      scoreObservedPrices(candidates, profile.budgetDkk === null ? null : profile.budgetDkk / plan.days);
      candidates.sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));
      const recipe = candidates[0].recipe;
      selected.add(recipe.id);
      const dish = { ...clone(previous), recipeId: recipe.id, title: recipe.title, diet: recipe.diet, minutes: recipe.minutes,
        ingredientBasis: clone(recipe.ingredients), baseServings: recipe.servings,
        ingredients: scaleIngredients(recipe.ingredients, recipe.servings, previous.servings),
        reasons: ['Nyt forslag til en ulåst dag ud fra din registrerede husstand, dagens tema og kostvalg.',
          ...(candidates[0].reusedIngredients.length ? ['Råvarer deles med andre valgte retter i ugeforslaget: ' + candidates[0].reusedIngredients.join(', ') + '. Dette er ikke registreret lager eller færdiglavede rester.'] : []),
          candidates[0].price.estimatedProductsDkk === null ? 'Manglende varepriser er ukendte, ikke nul.' : 'Registrerede priser indgår i ugeoverslaget; intet eksternt opslag er startet.'],
        sourceRefs: [clone(recipe.sourceRef), householdSourceRef(previous, previous.date), { kind: 'meal-profile' }] };
      selectedDishes.push(dish); return dish;
    });
    this.assertRecipeSources(dishes);
    this.preserveShoppingChoices(plan);
    plan.dishes = dishes; plan.servings = planServings(dishes); plan.revision++;
    plan.status = 'draft'; plan.needsReview = true; plan.shoppingList = []; plan.shoppingGeneratedAt = null;
    plan.shoppingRevision = null; plan.updatedAt = this.now().toISOString();
    this.recordPlanPrices(plan);
    await this.save();
    return plan;
  }

  // Swap two selected meals while retaining the attendance, portion estimate,
  // theme and calendar context of each destination date.
  async swapDishes(id, { expectedRevision, firstDate, secondDate } = {}) {
    const plan = this.getPlan(id);
    checkRevision(plan, expectedRevision);
    if (plan.householdStale || plan.profileStale || plan.recipeStale) throw new Error('Gennemgå det ændrede grundlag før retterne flyttes.');
    parseDay(firstDate); parseDay(secondDate);
    const first = plan.dishes.find(dish => dish.date === firstDate);
    const second = plan.dishes.find(dish => dish.date === secondDate);
    if (!first || !second || firstDate === secondDate) throw new Error('Vælg to forskellige datoer i madplanen.');
    if (linkedDates(plan).has(firstDate) || linkedDates(plan).has(secondDate)) throw new Error('Fjern den berørte restefordeling eksplicit, før retter flyttes.');
    if (first.locked || second.locked) throw new Error('Lås dagene op, før retterne flyttes.');
    if (first.skip || second.skip) throw new Error('Vælg to måltidsdage før retterne byttes.');
    const move = (source, target) => ({ ...clone(target), recipeId: source.recipeId,
      manuallySelected: true,
      title: source.title, minutes: source.minutes, diet: source.diet,
      ingredientBasis: clone(source.ingredientBasis), baseServings: source.baseServings,
      ingredients: scaleIngredients(source.ingredientBasis, source.baseServings, target.servings),
      reasons: ['Retten er flyttet manuelt fra en anden dag; portioner er tilpasset dagens registrerede husstand.'],
      sourceRefs: (source.sourceRefs || []).filter(ref => !['household', 'household-day', 'household-rhythm', 'meal-profile'].includes(ref.kind))
        .map(ref => ref.kind === 'owner-meal' ? { ...ref, date: target.date } : ref)
        .concat([householdSourceRef(target, target.date), { kind: 'meal-profile' }]) });
    const movedFirst = move(second, first);
    const movedSecond = move(first, second);
    assertCompatible(movedFirst, this.profile()); assertCompatible(movedSecond, this.profile());
    this.assertRecipeSources([movedFirst, movedSecond]);
    this.preserveShoppingChoices(plan);
    plan.dishes = plan.dishes.map(dish => dish.date === firstDate ? movedFirst : dish.date === secondDate ? movedSecond : dish);
    plan.servings = planServings(plan.dishes); plan.revision++; plan.status = 'draft'; plan.needsReview = true;
    plan.shoppingList = []; plan.shoppingGeneratedAt = null; plan.shoppingRevision = null;
    plan.updatedAt = this.now().toISOString();
    this.recordPlanPrices(plan);
    await this.save();
    return plan;
  }
}
