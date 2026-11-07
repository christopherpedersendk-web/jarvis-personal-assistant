import { RESEARCH_PROFILES } from './research-workflow.mjs';

// Reviewed local metadata, not downloaded/executable marketplace skills. Changing
// this manifest requires code review. It grants neither gateway nor job rights.
const upstream = Object.freeze({ product:'OpenClaw', version:'2026.11.1', license:'MIT',
  commit:'4ffdd2047d192dd65554de3c8c46c0e0197c6e2a',
  url:'https://github.com/openclaw/openclaw/tree/4ffdd2047d192dd65554de3c8c46c0e0197c6e2a',
  integration:'Jarvis-gennemgået procedure via begrænset web_search; ikke en marketplace-installation' });
const samples = {
  restaurant:['Find italienske restauranter i Hellerup med kilder og Maps.','Undersøg en familieaktivitet i København på søndag.'],
  briefing:['Find tre aktuelle nyheder om AI og cybersikkerhed med primære kilder.','Undersøg nyheder om IT-revision den seneste uge.'],
  product:['Sammenlign priser på Sonos Era 100 med tidspunkt og kilder.','Undersøg en kompakt Spotify-afspiller uden at købe noget.'],
  recipe:['Find en vegetarisk opskrift med græskar og bønner med kilder.','Foreslå en nem pastaret; gem ikke noget endnu.'],
};
export function reviewedResearchSkills() {
  return Object.entries(samples).map(([id,examples]) => {
    const profile=RESEARCH_PROFILES[id];
    const contract={schemaVersion:1,purpose:profile.purpose,inputs:[profile.data],outputs:['Dansk opsummering med kilder, tidspunkt og usikkerhed.'],
      sources:['Offentlige søgeresultater; ingen privat hukommelse sendes til OpenClaw.'],tools:['search_web under den eksisterende serverpolitik; ingen writes.'],
      budget:{authority:'reviewed-job-policy',defaults:{maxRunsPerDay:1,maxOutputTokens:3500},maxResults:5},
      unknownPolicy:'Manglende kilder vises som delvist resultat; ingen skjult fallback eller automatisk retry.',
      examples:examples.map(input=>({input,expected:'Kilder og forbehold uden ekstern handling eller automatisk lagring.'})),tests:['test/research-workflow.test.mjs','test/openjarvis.test.mjs']};
    return {name:`openclaw-${id}`,version:profile.version,description:profile.purpose,
      triggers:[`openclaw-${id}`],permissions:'existing-authorized-tools-only',contract,
      body:`# ${profile.purpose}\n\n${profile.instruction}\n${profile.data}\nBackend vælges af Jarvis; en procedure kan ikke aktivere OpenClaw eller udvide rettigheder.\n\n## Kontrakt\n\n\`\`\`json\n${JSON.stringify(contract,null,2)}\n\`\`\``,
      presentation:{source:'openclaw',category:'research',title:profile.purpose,upstream,examples}};
  });
}
const localTitles={'daily-briefing':'Dagens overblik','personal-follow-up':'Opgaver og opfølgning','gift-planning':'Gaveplanlægning','meal-planning':'Madplan'};
const localExamples={
 'daily-briefing':['Giv mig et kort overblik over i dag med opgaver og manglende oplysninger.','Hvilke opfølgninger skal jeg tage stilling til denne uge?'],
 'personal-follow-up':['Hjælp mig med at prioritere mine åbne opgaver for i morgen.','Vis mine opfølgninger, og fortæl hvilke der mangler en dato.'],
 'gift-planning':['Hjælp mig med gaveidéer til næste fødselsdag på min liste. Spørg om budget, hvis det mangler.','Find mine gemte gaveidéer og deres kilder.'],
 'meal-planning':['Foreslå en enkel madplan til den kommende uge ud fra mine gemte præferencer. Spørg om hvem der spiser med, hvis det ikke er bekræftet.','Vis den aktive madplan og hjælp mig med at ændre én ret.'],
};
export function describeSkill(skill,{openJarvis={},modelConfigured=false,stopped=false,voiceEnabled=false}={}) {
  const hybrid=skill.presentation?.source==='openclaw';
  const enabled=!hybrid||openJarvis.enabled===true;
  const configured=modelConfigured&&(!hybrid||openJarvis.gatewayMode==='restricted-v1');
  const connected=!hybrid||openJarvis.connectionStatus==='ready';
  const historical=skill.current===false;
  const available=!historical&&enabled&&configured&&connected&&!stopped;
  const reason=historical?'Historisk version; vælg den aktuelle til en ny kladde. Eksisterende jobs bevarer deres version.':stopped?'Assistenten er stoppet.':!enabled?'OpenClaw er deaktiveret.':!modelConfigured?'Modeladgang er ikke konfigureret.':!configured?'Kræver den begrænsede gatewaykontrakt.':!connected?(openJarvis.connectionError||'Gatewayforbindelsen er endnu ikke kontrolleret.') : '';
  return {title:localTitles[skill.name]||skill.presentation?.title||skill.name,
    source:hybrid?'openclaw':'jarvis',category:hybrid?'research':skill.name==='meal-planning'?'madplan':'personlig',
    examples:skill.presentation?.examples||localExamples[skill.name]||[],
    channels:['webchat','discord',...(voiceEnabled?['discord-voice']:[])],
    provenance:hybrid?upstream:{product:'Jarvis',license:'repository',integration:'Lokalt versionsstyret procedure'},
    availability:{installed:true,configured,enabled,available,status:historical?'historical':available?'ready':enabled?'blocked':'disabled',reason,
      tested:false,lastTest:null,testNote:'Kataloget er ikke bevis for live model-/kanalaccept.',
      connectionCheckedAt:hybrid?openJarvis.lastCheckedAt||null:null},
    dataSharing:hybrid?'Kun korte offentlige søgeord sendes til OpenClaw og søgeudbyderen. Modellen behandler opgaven under Jarvis’ eksisterende politik.':'Nødvendig opgavekontekst kan sendes til den konfigurerede model; ingen nye tilladelser.',
    dependencies:hybrid?['Konfigureret tekstmodel','OpenClaw 2026.11.1','restricted-v1 gateway med web_search']:['Konfigureret tekstmodel','Eksisterende lokale domæner og jobpolitik'],
    limits:hybrid?'1–240 tegn pr. søgning, højst fem kilder pr. kald. Requests måles; tokens/pris fra OpenClaw er ukendt.':'Jobbets gennemgåede kørsels-/tokenlofter og fælles providerkontrol. Ingen samlet kronegrænse.',
    inputs:skill.contract?.inputs||['Se den præcise historiske procedure.'],outputs:skill.contract?.outputs||['Se den præcise historiske procedure.']};
}
