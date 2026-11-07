// Deterministic planner comparison, not an evaluation of model understanding.
// Supply the unmodified baseline source from main 5ed0733 as an explicit file.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MealPlanner} from '../meal-planner.mjs';
const path=process.argv[2];if(!path)throw new Error('Supply baseline meal-planner.mjs.');
const baseline=await readFile(path,'utf8');
if(createHash('sha256').update(baseline).digest('hex')!=='9977da9e384dcb1ecd9fdcb53604220377e321b558d56440e31b4db2568481ec')throw new Error('Baseline source does not match pinned v5.4.0.');
const resolved=baseline.replace(/from '\.\/([^']+)'/g,(_,p)=>`from '${new URL('../'+p,import.meta.url).href}'`);
const {MealPlanner:Legacy}=await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'));
const recipes=Array.from({length:24},(_,i)=>({id:'fixture-'+i,title:'Syntetisk ret '+i,diet:'vegan',minutes:20,servings:2,ingredients:[{name:'syntetisk-grønt-'+i,quantity:200,unit:'g'}],favorite:i===0,themes:['everyday'],sourceRef:{kind:'recipe',id:'source-'+i,revision:1}}));
async function measure(Type){const planner=new Type({state:{},recipes:()=>structuredClone(recipes),now:()=>new Date('2026-11-07T12:00:00Z')});const ids=[];for(let w=0;w<4;w++){const p=await planner.createPlan({startDate:'2026-11-'+String(8+7*w).padStart(2,'0'),days:3,variation:'high'});if(p.dishes.some(d=>!d.recipeId.startsWith('fixture-')))throw new Error('Fixture source not used.');ids.push(...p.dishes.map(d=>d.recipeId));}return {proposals:ids.length,uniqueRecipes:new Set(ids).size,repeatedSelections:ids.length-new Set(ids).size,ids};}
const before=await measure(Legacy),after=await measure(MealPlanner);
if(after.repeatedSelections>=before.repeatedSelections)throw new Error('No measured reduction in this dataset.');
const result={scope:'deterministic synthetic planner comparison; not model quality or owner data',baselineCommit:'5ed073367e6db86b3bb6af9aee6376a3c85fbf35',baselineSourceSha256:createHash('sha256').update(baseline).digest('hex'),candidate:process.env.JARVIS_CANDIDATE_SHA||'local working tree',before,after};
await mkdir('artifacts/commerce',{recursive:true});await writeFile('artifacts/commerce/meal-variety-benchmark.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
