import test from 'node:test';
import assert from 'node:assert/strict';
import {effectiveMealPlans,buildPlanningSuggestions} from '../planning-advisor.mjs';
test('overlapping historical meal plans produce one attendance reminder and preserve history',()=>{
 const dish={date:'2026-11-06',adults:null,householdConfirmed:false};
 const state={mealPlans:[{id:'new',dishes:[dish]},{id:'old',dishes:[dish]}]};
 const before=JSON.stringify(state);
 assert.deepEqual(effectiveMealPlans(state).map(p=>p.id),['new']);
 const reminders=buildPlanningSuggestions({state,now:new Date('2026-11-06T12:00:00Z')}).filter(s=>s.id.endsWith(':attendance'));
 assert.equal(reminders.length,1);assert.equal(reminders[0].source.id,'new');assert.equal(JSON.stringify(state),before);
});
test('explicit skipped day overrides old food and older plans stay historical',()=>{
 const plans=effectiveMealPlans({mealPlans:[{id:'new',dishes:[{date:'2026-11-06',skip:true}]},
 {id:'old',dishes:[{date:'2026-11-06'},{date:'2026-11-07'}]}]});
 assert.equal(plans[0].dishes[0].skip,true);assert.equal(plans.length,1);
});
