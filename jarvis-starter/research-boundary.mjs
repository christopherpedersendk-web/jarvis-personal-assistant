// Server-owned scope fence, independent of model output and of tool descriptions.
// A voice lease keeps its scope until closed; a text turn gets a fresh scope.
const scopes=new WeakMap();
export function enforceResearchBoundary(control,scope,name,mutating) {
 let restricted=scopes.get(control);
 if(!restricted){restricted=new Set();scopes.set(control,restricted);}
 if(name==='search_web'){
  if(restricted.size>=10000&&!restricted.has(scope.requestId))throw new Error('Researchgrænsen kræver genstart efter afsluttede sessioner.');
  restricted.add(scope.requestId);
 }
 if(mutating&&restricted.has(scope.requestId))throw Object.assign(new Error(
  'Efter offentlig research kan denne samtaletur kun læse og foreslå. Send en ny konkret anmodning om ændringen; i stemme skal en ny session startes.'),
  {code:'RESEARCH_READ_ONLY',noActionTaken:true});
}
