import {ingredientIdentity} from './food-identity.mjs';
export function recipeFamily(recipe){return [...new Set((recipe.ingredientBasis||recipe.ingredients||[]).map(i=>ingredientIdentity(i.name)))].sort().join('|');}
export function varietyPenalty(recipe,history=[],selected=[],strength='balanced'){
 if(!['balanced','high','favorites'].includes(strength))throw new Error('Ukendt variationsvalg.');const family=recipeFamily(recipe);if(!family)return 0;
 const weight=strength==='high'?80:strength==='favorites'?12:40;
 const used=selected.some(d=>!d.skip&&recipeFamily(d)===family);
 const recency=history.slice(0,6).reduce((sum,p,index)=>sum+(p.dishes||[]).filter(d=>!d.skip&&recipeFamily(d)===family).reduce((n,d)=>n+(d.outcome==='cooked'?2:d.outcome==='not_cooked'?.25:d.manuallySelected?1.5:1),0)/(index+1),0);
 const cuisine=recipe.cuisine?selected.filter(d=>d.cuisine===recipe.cuisine).length:0,method=recipe.method?selected.filter(d=>d.method===recipe.method).length:0;
 return (used?(strength==='high'?1000:.5):0)+Math.min(500,recency*weight)+cuisine*4+method*3;
}
