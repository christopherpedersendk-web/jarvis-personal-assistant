# Videreførte M1–M10-kriterier

Kontrolleret mod de bevarede v5.2/v5.3-registre. Originale IDs, historisk status og næste handling bevares. Historisk verificerede rækker med åbne delprøver medtages også. Alle øvrige rækker findes uændret i originalregistrene; deres gamle evidens overføres ikke automatisk til den nye kandidat.

## v5.2

Kilde: [oprindeligt register](../v5.2/acceptance-register.md).

| ID / prioritet | Acceptkriterium | Status | Filer / commit | Test og begrænsning | Næste handling / konkret blokering |
|---|---|---|---|---|---|
| M1.5 / 1 | Faktisk backup, konfiguration og fysisk Safari er accepteret | blokeret | Driftsvejledning | Ikke udført. | Mangler faktisk offline backup/konfigurationsmapping, isoleret målhost og fysisk iPhone. |
| M2.5 / 1 | Faktisk aktiv WebRTC-call afsluttes hos udbyderen | blokeret | `voice-sessions.mjs`, `/api/voice/close` | Officiel hangup-kontrakt + syntetiske tests; ingen live call. | Mangler modeladgang og en faktisk WebRTC-session. Ukendt opkald uden call-ID kræver manuel udbyderafklaring. |
| M3.1 / 1 | Restaurant/nyheder/rapporter bevarer resumé, kilder og Maps i alle kanaler | verificeret | `web-research.mjs`, `secretary-tools.mjs`, `server.mjs`, `test/v51-conversation-research.test.mjs`; PR/C4/C5 | Fælles handlers, kildeappend, Maps-kodning, kildefejl, paused jobs og engangsudførelse testes. | Handler-/HTTP-evidens. Naturligt sprog mod faktiske modeller i begge kanaler er særskilt blokeret. Ejerens fungerende Discord-rapportlevering tilsidesættes ikke. |
| M3.2 / 1 | OpenClaw følger faktisk dokumenteret `/tools/invoke`-kontrakt | verificeret | `openjarvis.mjs`, runtimeprobe; CI 42343014053 på 42fde6d | Rigtig installeret 2026.11.1-runtime: fem offentlige kilder, forkert credential 401, forbudte tools 404. | Ejerens gateway/systemd er stadig ikke testet; den nye CI-evidens erstatter ikke målhostaccept. |
| M3.5 / 1 | Virkelig restaurant-/rapportresearch virker ende-til-ende | blokeret | Evaluator DA21–DA25 og driftsvejledning | Ikke livekørt her. | Offentlig browserlæsning er bestået i CI (P). Modelstyret research og rapporternes samlede kanalforløb mangler API/gateway og valgt testkanal; aktivering på målhost kræver ejerens testbeslutning. |
| M5.3 / 2 | Rigtigt opkald med UDP/DAVE, lyd ind/ud og fysisk stop | blokeret | Driftsvejledning | Ikke udført; funktionen er OFF. | Mangler godkendt Discord-kanal, bot-/modeladgang, serverens UDP-netværk og bruger med mikrofon. |
| M6.3 / 2 | Mindst 27/30 reelle danske modelopgaver og alle kritiske prøver består | blokeret | `scripts/assistant-evaluation.mjs`, `scripts/fixtures/danish-assistant-tasks.json`; C4/C5 | Harness og negativ grading-test bestået. Liveevaluering har status `not_run`; ingen 27/30-score foreligger. | Mangler lokal API-adgang/modelvalg. Kør isolerede scenarier, bedøm tekst OG gemt state; failures og ændret dataset kan ikke godkendes som beståede. |
| M3.8 / 1 | Faktisk Discord-kanalstyring og sammenhængende browserresearch | blokeret | Driftsvejledning afsnit 7–8 | Ingen live kanalændring udført. | Mangler godkendt testserver, botrettigheder/modeladgang og browser-runtime på målhost; produktion forbliver OFF. |

## v5.3

Kilde: [oprindeligt register](../v5.3/acceptance-register.md).

| ID / kriterium | Status | Filer og evidens | Begrænsning / næste handling |
|---|---|---|---|
| M7.6 Afhængighedsreview | implementeret men ikke verificeret | pin/lock, upstream MIT, zod 4.6.6 og npm 12.2.2 overrides; audit 0 high/critical | 34 moderate dependency findings består; fuld upstream-sikkerhed er ikke certificeret |
| M8.4 Restaurant/nyheder/rapporter live i begge kanaler | blokeret | handler-tests bevarer kilder og Maps | Mangler modelcredential og Discord-testforbindelse; gatewayresearch verificeret i CI, ikke på ejerens host |
| M9.1 Fire gennemgåede researchprocedurer | implementeret men ikke verificeret | research-workflow.mjs RESEARCH_PROFILES; profilvalg-/authority-tests | Modelkvalitet er ikke dokumenteret af handler-tests |
| M10.2 >=27/30 og alle kritiske sikkerhedsopgaver | blokeret | baseline=not_run, hybrid=not_run, score=null | Ingen legitim OpenAI-testcredential; ejer kan køre via sikker lokal konfiguration |
| M10.3 Dokumenteret besparelse og fjernelse af gammel kode | blokeret | Ingen besparelse påstås; ingen erstatningskode slettet | Afventer sammenlignelig måling og funktionel accept; rollback bevarer baseline |
| M1 rest: faktisk restore / fysisk mobil | blokeret | v5.2-register og tidligere syntetiske tests bevaret | Faktisk backup, servicehost og fysisk iPhone ikke tilgængelig |
| M2 rest: faktisk providerhangup | blokeret | v5.2-register; durable stoptests køres igen | Provider-/stemmeadgang mangler |
| M3 rest: live model- og gatewayresearch | blokeret | Ny M7-test erstatter ikke faktisk ejerinstallation | Se M7.4/M8.4 |
| M4 rest: ejerprøve af tværkanalredigering | blokeret | Eksisterende dedupe/revision/mobiltests bevares | Ejerinstallation ikke tilgængelig |
| M5 rest: rigtig Discord-lyd | blokeret | Eksisterende native/stoptests bevares | Godkendt testkanal og lydadgang mangler; produktion fortsat OFF |
| M6 rest: rigtig dansk modelevaluering | blokeret | Flyttet til M10.2 uden opfundet score | Modelcredential mangler |
| PREP.2 Kandidatens CI og review | implementeret men ikke verificeret | PR #17; release-preparation-evidence.json | Historisk status ved dokumentets oprettelse. PR #17 er nu merged og v5.3.0-grundlaget kontrolleret; den nye PR #18 kræver sine egne checks |
| PREP.3 Faktisk installation og rollback | blokeret | release-candidate.md; eksisterende deploy-/restoretests | Server, backup og ejers stagingaccept mangler; ingen produktionsændring udført |
