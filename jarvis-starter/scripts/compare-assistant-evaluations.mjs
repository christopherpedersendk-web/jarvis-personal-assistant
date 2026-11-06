import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {gradeEvaluation} from './assistant-evaluation.mjs';
export function compareEvaluations(baseline,hybrid) {
 const matching=baseline.backend==='baseline'&&hybrid.backend==='hybrid'&&baseline.model===hybrid.model&&
  baseline.datasetSha256===hybrid.datasetSha256&&baseline.coreSourceSha256===hybrid.coreSourceSha256;
 const before=gradeEvaluation(baseline),after=gradeEvaluation(hybrid);
 return {matching,baseline:before,hybrid:after,accepted:matching&&before.accepted&&after.accepted,
  tasks:(hybrid.results||[]).map(item=>{
   const previous=(baseline.results||[]).find(x=>x.id===item.id);
   return {id:item.id,baselinePassed:previous?.passed??null,hybridPassed:item.passed??null,
    baselineDurationMs:previous?.durationMs??null,hybridDurationMs:item.durationMs??null};
  }),costSavings:null,note:'Review each report’s answers, sources, actions, finalState and usage. Durations include setup. Null usage is unknown, not zero. No cost-saving claim.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const [a,b]=await Promise.all(process.argv.slice(2,4).map(p=>readFile(p,'utf8').then(JSON.parse)));const result=compareEvaluations(a,b);console.log(JSON.stringify(result,null,2));if(!result.accepted)process.exitCode=2;}
 catch{console.error('Provide two completed, independently reviewed evaluation files.');process.exitCode=1;}
}
