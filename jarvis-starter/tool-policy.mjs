// Shared server policy. Capability grants cannot be supplied by a model or website.
const deferred = new Set(['list_hue_devices','set_hue_light','activate_hue_scene','sonos_control','develop_code_project']);
export function assertToolPolicy(name) {
  if(deferred.has(name)) throw Object.assign(new Error(name === 'develop_code_project'
    ? 'Kodeændringer kræver særskilt gennemgang i Projekter. Ingen ændring udført.'
    : 'Smart Home afventer den lokale netværksagent. Ingen enhed er kontaktet.'),
    {code:'CAPABILITY_DEFERRED',noActionTaken:true});
}
export function availableAssistantTools(tools) { return tools.filter(tool=>!deferred.has(tool.name)); }
export function deferredHomeRoute(path) {
 return /^\/api\/smart-home\/(?:hue\/(?:pair|resources|control|scene)|sonos\/(?:connect|groups|action))$/.test(path);
}
