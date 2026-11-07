# Acceptregister efter v5.4.0

Status: ikke startet, under implementering, implementeret men ikke verificeret, verificeret eller blokeret. Commitgrundlag: PR19-kandidatens præcise SHA i GitHub og dens kandidatbundne CI-artefakter. Lokale resultater er knyttet til træet i evidence.json; efterfølgende commits arver dem ikke automatisk.

Alle åbne M1–M14-kriterier og deres betydninger videreføres uændret fra [v5.4 acceptance-register](../v5.4/acceptance-register.md), [inherited-acceptance](../v5.4/inherited-acceptance.md), [v5.2 register](../v5.2/acceptance-register.md) og v5.3-dokumenterne. Ejerens bekræftelse af Discord-tekst og rapportlevering bevares; dette er ikke bevis for kanalstyring eller voice.

| ID/kriterium | Status | Filer/evidens og begrænsning | Næste handling |
|---|---|---|---|
| M12.4 kanaldiagnose og danske intents | verificeret | discord-channels.mjs, integration-catalog.mjs, server.mjs; fokuserede regressioner | Ejer ser konkret diagnose i integrationer |
| M12.3 faktisk opret/omdøb/slet/rapportkanal | blokeret | Ingen godkendt testguild/botadgang i miljøet; fixture er ikke livebevis | Ejerprøve i særskilt server, Manage Channels uden Administrator |
| M15.1 stamdata/revision/sletning | verificeret | master-data.mjs, v5-settings-http.test.mjs: samtidige ændringer, 0600, restart, ingen data i state/logs | UI-accept og faktisk installationsbackup |
| M15.2 chat/DΜ-review | verificeret | Samme saveMasterData, bruger/kanal/generation/configuration-revision, 2 min engangsreview; HTTP-regression | Live DM-prøve; almindelig prosa gemmes ikke automatisk |
| M15.3 browser-UI/logout | verificeret | public/master-data.js, scripts/commerce-ui-smoke.mjs; CI på f1c26ae5: Chromium/WebKit 320/390/1280, konflikt bevaret, logout/overflow bestået; se evidence.json | Præsentationsopfølgning kræver ny kandidat-CI; fysisk iPhone særskilt |
| M16.1 ordregrundlag/manual handoff | verificeret | commerce.mjs/test: variant/sælger/pris/adresse/hash/revision/udløb/stop/restart/dubletter | UI og ejerprøve uden køb |
| M16.2 rigtig OpenClaw kontrolkontrakt | verificeret | Pinned 2026.11.1, commerce-browser-config.mjs, openclaw-browser-contract.mjs; native config/auth/status/tool-deny bestået lokalt | Gentag i kandidatens CI; ingen merchant/Chrome bekræftet |
| M16.3 offentlig produktlæsning/containment | implementeret men ikke verificeret | openclaw-browser-reader.mjs; fixture for faste endpoints/profil/redirect/cleanup; særskilt runtimeattestation | Godkendt isoleret host, Chrome og egressprøver før opt-in |
| M16.4 login, session, kurv og checkout | blokeret | Ikke implementeret. Ingen godkendt isoleret autentificeret merchantprofil eller gennemgået butikskontrakt for skrivende trin/bindende ordre | Operator/ejer godkender testprofil og konkret butikkontrakt; selvstændig skriverettighed og sandboxførst |
| M16.5 MobilePay/PayPal/Vipps/status | blokeret | Kun manuel overdragelse til varelinks; ingen merchantcredential, verificeret betalings-API eller transaktion. Vipps ikke dokumenteret for disse butikker | Faktisk understøttet merchantflow, særskilt ordre-review; aldrig appgodkendelse ved agenten |
| M17.1 historik/variation | verificeret | meal-variety.mjs, meal-planner.mjs; 24 syntetiske opskrifter/4 uger: før 9 unikke/3 gentagelser, efter 12/0 ved høj variation | Ejer vurderer egne opskrifter/præferencer; ingen modelscore |
| M17.2 kost/låste valg/én plan | verificeret | Eksisterende plan/pris/lager-regressioner bevares; balanceret rangering justeret efter fundne regressioner | Ejerprøve på tværs af chat/Discord og UI |
| M17.3 flere opskriftskilder | implementeret men ikke verificeret | Researchkladde til eksisterende indbakke; Arla/Valdemarsro/Madens Verden. Ingen masseimport af rettighedsbeskyttet indhold | Reel research, kildebevarelse og menneskelig gennemgang |
| M17.4 Nemlig navnesøgning/mængder | verificeret | shopping-search-list.mjs, shopping-planner.mjs; navn med 200 g og samme rene navn giver én søgning, ingen kurvwrite | Kompakt browseroversigt og faktisk Nemlig læseprøve |
| M18.1 beskyttet udviklingspipeline | verificeret | self-development*.mjs; lukket filscope, patchversion, protected-tests, ingen main/deploy/retry ved ukendt udfald | Faktisk Docker-regression i kandidat-CI |
| M18.2 rigtig sandbox-reparation | verificeret | self-development-smoke.mjs: faktisk Docker i CI 42359288984 på 5b8c4f6: fejl før/fix efter, hostkode uændret. Model/GitHub er syntetiske | Ny kandidat skal bestå samme prøve; rigtig model/PR særskilt |
| M18.3 rigtig model og draft-PR | blokeret | Ingen separat legitim testmodel-/fine-grained udviklingscredential; tests af transport tæller ikke som rigtig PR | Sikkert konfigureret testadgang med begrænset GitHub token |
| M18.4 agentgodkendelse/præcis SHA | implementeret men ikke verificeret | Check-/workflow-/SHA-/expirybinding tests; funktionen OFF | Konfigurér uafhængigt beskyttet security-check og branch protection; separat credential uden checks/workflowwrite |
| M18.5 deployment | blokeret | Ingen ny automatisk deployment eller produktionsaktivering i mandatet | Ejerbeslutning, særskilt tjeneste, backup/health/rollbackprøve |

M1 restore/fysisk mobil, M2 faktisk providerstop, M3 faktisk gateway/research, M5 rigtig voice og M6/M10 mindst 30 modelopgaver er fortsat åbne på de historiske betingelser. Ingen score er opfundet. Smart Home afventer lokal agent; kalenderwrite og rigtige køb er ikke aktiveret.

Supplerende buildblokering: medie-decoderens obligatoriske FFmpeg source/signature-download fejlede også i run 42359891574 (TLS reset/timeouts). Faktisk decodercontainment blev derfor ikke kørt på den kandidat. Ingen produktions-/releaseaccept uden en vellykket signaturverificeret build og containmentprøve.
