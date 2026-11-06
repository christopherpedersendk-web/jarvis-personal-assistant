// Storage order is newest first. Older plans are history, never a second active
// plan. A read projection avoids migrating or deleting the owner's records.
export function activeMealPlan(plans=[]) {
 return plans.find(plan=>plan&&plan.id&&!plan.archived&&Array.isArray(plan.dishes))||null;
}
