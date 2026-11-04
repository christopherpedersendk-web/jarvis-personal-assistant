import { randomUUID } from 'node:crypto';

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
const baseProfile = Object.freeze({ householdSize: 2, diet: 'omnivore', avoid: [], pantry: [], budgetDkk: null });
const normalize = value => String(value || '').trim().toLocaleLowerCase('da-DK');

export function validateMealProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Ugyldige madpræferencer.');
  const householdSize = Number(input.householdSize);
  const diet = input.diet;
  const budgetDkk = input.budgetDkk === '' || input.budgetDkk === null || input.budgetDkk === undefined ? null : Number(input.budgetDkk);
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 12) throw new Error('Antal personer skal være 1–12.');
  if (!DIETS.includes(diet)) throw new Error('Vælg almindelig, vegetarisk eller vegansk mad.');
  if (budgetDkk !== null && (!Number.isInteger(budgetDkk) || budgetDkk < 50 || budgetDkk > 10000)) throw new Error('Budget skal være 50–10.000 kr.');
  if (!Array.isArray(input.avoid) || input.avoid.length > 20 || input.avoid.some(x => typeof x !== 'string' || x.length > 80)) throw new Error('Ugyldig liste over ingredienser, der skal undgås.');
  if (!Array.isArray(input.pantry) || input.pantry.length > 60 || input.pantry.some(x =>
    !x || typeof x.name !== 'string' || x.name.length > 80 || !['g', 'ml', 'stk', 'fed'].includes(x.unit) ||
    !Number.isFinite(x.quantity) || x.quantity < 0 || x.quantity > 100000)) throw new Error('Ugyldigt lager af madvarer.');
  return {
    householdSize, diet, budgetDkk,
    avoid: [...new Set(input.avoid.map(normalize).filter(Boolean))],
    pantry: input.pantry.map(x => ({ name: normalize(x.name), quantity: Math.round(x.quantity), unit: x.unit })),
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

function ingredientsFor(dishes, profile) {
  const combined = new Map();
  for (const dish of dishes) for (const ingredient of dish.ingredients) {
    const key = `${normalize(ingredient.name)}|${ingredient.unit}`;
    const current = combined.get(key) || { name: ingredient.name, unit: ingredient.unit, quantity: 0 };
    current.quantity += ingredient.quantity;
    combined.set(key, current);
  }
  for (const pantryItem of profile.pantry) {
    const found = combined.get(`${normalize(pantryItem.name)}|${pantryItem.unit}`);
    if (found) found.quantity = Math.max(0, found.quantity - pantryItem.quantity);
  }
  return [...combined.values()].filter(x => x.quantity > 0).sort((a, b) => a.name.localeCompare(b.name, 'da'));
}

export class MealPlanner {
  constructor({ state, save = async () => {}, now = () => new Date() }) {
    this.state = state;
    this.save = save;
    this.now = now;
    this.state.mealProfile ||= { ...baseProfile, avoid: [], pantry: [] };
    this.state.mealPlans ||= [];
  }

  profile() { return { ...this.state.mealProfile, avoid: [...this.state.mealProfile.avoid], pantry: [...this.state.mealProfile.pantry] }; }
  plans() { return this.state.mealPlans.slice(0, 12); }

  async setProfile(input) {
    this.state.mealProfile = { ...validateMealProfile(input), updatedAt: this.now().toISOString(), source: 'user-entered' };
    await this.save();
    return this.profile();
  }

  async resetProfile() {
    this.state.mealProfile = { ...baseProfile, avoid: [], pantry: [] };
    await this.save();
    return this.profile();
  }

  async createPlan({ startDate = localToday(this.now()), days = 5, calendarBusyDates = [] } = {}) {
    const date = parseDay(startDate);
    if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('Madplanen skal dække 1–7 dage.');
    if (!Array.isArray(calendarBusyDates) || calendarBusyDates.length > 14 || calendarBusyDates.some(x => typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x))) throw new Error('Ugyldig kalenderoversigt.');
    const profile = this.profile();
    const choices = RECIPES.filter(recipe =>
      (profile.diet === 'omnivore' || recipe.diet === 'vegan' || (profile.diet === 'vegetarian' && recipe.diet === 'vegetarian')) &&
      !recipe.ingredients.some(([name]) => profile.avoid.some(term => normalize(name).includes(term))));
    if (choices.length < days) throw new Error('For få egnede opskrifter. Justér dine madpræferencer.');
    const busy = new Set(calendarBusyDates);
    const rotation = (date.getUTCDate() + date.getUTCMonth()) % choices.length;
    const available = [...choices.slice(rotation), ...choices.slice(0, rotation)];
    const dishes = Array.from({ length: days }, (_, index) => {
      const day = addDays(date, index);
      const shortEvening = busy.has(day);
      const candidateIndex = shortEvening ? available.reduce((best, recipe, i) => recipe.minutes < available[best].minutes ? i : best, 0) : 0;
      const [recipe] = available.splice(candidateIndex, 1);
      return {
      date: day, recipeId: recipe.id, title: recipe.title, minutes: recipe.minutes, busyDay: shortEvening,
      servings: profile.householdSize,
      ingredients: recipe.ingredients.map(([name, amount, unit]) => ({ name, quantity: Math.ceil(amount * profile.householdSize / 2), unit })),
    }; });
    const plan = {
      id: randomUUID(), status: 'draft', createdAt: this.now().toISOString(), startDate,
      days, servings: profile.householdSize, budgetTargetDkk: profile.budgetDkk,
      priceStatus: 'unknown-until-retailer-lookup', calendarAware: busy.size > 0, dishes,
      shoppingList: ingredientsFor(dishes, profile),
    };
    this.state.mealPlans.unshift(plan);
    this.state.mealPlans = this.state.mealPlans.slice(0, 12);
    await this.save();
    return plan;
  }

  getPlan(id) {
    const plan = this.state.mealPlans.find(x => x.id === id);
    if (!plan) throw new Error('Madplanen findes ikke.');
    return plan;
  }
}
