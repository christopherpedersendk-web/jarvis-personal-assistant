# Acceptregister M7–M10

Filer er relative til repository. Kandidatcommit fremgår af PR-hovedet; app-træ og
lokal testkørsel registreres i evidence.json (historisk) og
release-preparation-evidence.json (5.3.0-pakken). Status gælder kun den angivne evidens.
M1–M6's fulde historik bevares i ../v5.2/acceptance-register.md.

| ID / kriterium | Status | Filer og evidens | Begrænsning / næste handling |
|---|---|---|---|
| M7.1 Versionsfast runtime og begrænset gateway | verificeret | jarvis-starter/openclaw-runtime/{pin.json,package-lock.json,config.mjs,run.mjs,gateway.mjs}; faktisk installeret 2026.11.1 validerer config | Systemd-isolation på ejerens host er ikke afprøvet; test unit før aktivering |
| M7.2 Forkert credential / forbudte tools | verificeret | scripts/openclaw-runtime-probe.mjs; faktisk runtime 401 / fem 404; test/openjarvis-gateway.test.mjs | CI kræves på præcis kandidat |
| M7.3 Timeout, ugyldigt svar, mismatch, stop | verificeret | openjarvis-transport.mjs, openjarvis.mjs; transport-/stop-regression; fælles durable provider-stoptests | HTTP-afbrydelse beviser ikke leverandørens afslutning; udfald forbliver ukendt, ingen retry |
| M7.4 Offentlig research med kilder | verificeret | CI 42298434948 på 4d9f376b05f41a6da8e92b66585450226279cebd: rigtig søgning, 5 kilder på den daværende kandidat | Lokal provider_error bevares; ejerinstallation skal stadig testes |
| M7.5 Ingen ekstra bot/scheduler | verificeret | frisk config med channels={}, cron+triggers off, heartbeat 0m, kun parallel-plugin | Kontroller servicehostens separation; ingen eksisterende OpenClaw-state genbruges |
| M7.6 Afhængighedsreview | implementeret men ikke verificeret | pin/lock, upstream MIT, zod 4.6.6 og npm 12.2.2 overrides; audit 0 high/critical | 34 moderate dependency findings består; fuld upstream-sikkerhed er ikke certificeret |
| M8.1 Fælles kontrakt og minimal gatewaydata | verificeret | research-workflow.mjs, secretary-tools/server; text/discord/voice handler-tests | Rigtig modelforståelse og Discord-transport ikke dækket af mocks |
| M8.2 Rapportbackend og bevarede kilder | verificeret | server.mjs, task-engine.mjs; hybrid rapport-/resume-regression | Live model/rapportlevering skal testes i særskilt testinstallation |
| M8.3 Lokal revision / højst én mutation | verificeret | eksisterende ActionJournal/domænetests i komplet suite; research returnerer mutations=[] | OpenClaw udfører ingen mutationer; ejerprøve af faktiske tværkanalforløb mangler |
| M8.4 Restaurant/nyheder/rapporter live i begge kanaler | blokeret | handler-tests bevarer kilder og Maps | Mangler modelcredential og Discord-testforbindelse; gatewayresearch verificeret i CI, ikke på ejerens host |
| M9.1 Fire gennemgåede researchprocedurer | implementeret men ikke verificeret | research-workflow.mjs RESEARCH_PROFILES; profilvalg-/authority-tests | Modelkvalitet er ikke dokumenteret af handler-tests |
| M9.2 Kun eksisterende browser/review | verificeret | eksisterende BrowserResearch/Workspace/isolation-tests; faktisk gateway afviser browser/web_fetch | Real-modelprøve mangler; præcis kandidats browser-CI fremgår af PR #17 |
| M9.3 Injection kan ikke give gatewayrettigheder | verificeret | faste inputfelter/allowlist, ingen callbacks/mutationer, servervalgt backend; negative tests | Ingen påstand om universel modelsikkerhed; 30 kritiske modelcases kræves særskilt |
| M10.1 Sammenligningsharness | verificeret | scripts/assistant-evaluation.mjs og compare-assistant-evaluations.mjs; dry run + negative grader-tests | Faktiske modelkørsler er ikke udført |
| M10.2 >=27/30 og alle kritiske sikkerhedsopgaver | blokeret | baseline=not_run, hybrid=not_run, score=null | Ingen legitim OpenAI-testcredential; ejer kan køre via sikker lokal konfiguration |
| M10.3 Dokumenteret besparelse og fjernelse af gammel kode | blokeret | Ingen besparelse påstås; ingen erstatningskode slettet | Afventer sammenlignelig måling og funktionel accept; rollback bevarer baseline |
| M1 rest: faktisk restore / fysisk mobil | blokeret | v5.2-register og tidligere syntetiske tests bevaret | Faktisk backup, servicehost og fysisk iPhone ikke tilgængelig |
| M2 rest: faktisk providerhangup | blokeret | v5.2-register; durable stoptests køres igen | Provider-/stemmeadgang mangler |
| M3 rest: live model- og gatewayresearch | blokeret | Ny M7-test erstatter ikke faktisk ejerinstallation | Se M7.4/M8.4 |
| M4 rest: ejerprøve af tværkanalredigering | blokeret | Eksisterende dedupe/revision/mobiltests bevares | Ejerinstallation ikke tilgængelig |
| M5 rest: rigtig Discord-lyd | blokeret | Eksisterende native/stoptests bevares | Godkendt testkanal og lydadgang mangler; produktion fortsat OFF |
| M6 rest: rigtig dansk modelevaluering | blokeret | Flyttet til M10.2 uden opfundet score | Modelcredential mangler |

## Releaseforberedelse

| ID / kriterium | Status | Filer og evidens | Begrænsning / næste handling |
|---|---|---|---|
| PREP.1 v5.3.0 pakke-/tag-/skemavalidering | verificeret | package.json; check-release-version.mjs accepterer v5.3.0 og afviser v5.2.1; komplet suite 1.206 bestået | Intet tag oprettet; kontroller igen på faktisk merge-/releasecommit |
| PREP.2 Kandidatens CI og review | implementeret men ikke verificeret | PR #17; release-preparation-evidence.json | Status ved dokumentets oprettelse; se checks på præcis PR-HEAD før merge |
| PREP.3 Faktisk installation og rollback | blokeret | release-candidate.md; eksisterende deploy-/restoretests | Server, backup og ejers stagingaccept mangler; ingen produktionsændring udført |
