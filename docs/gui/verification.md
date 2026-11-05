# GUI-verifikation

## Oprindelig ren basis – faktisk kørt 5. november 2026

| Felt | Registreret værdi |
|---|---|
| Lokal commit | `70eaf81ba64b20613b7cd073c265cced5418c3fa` |
| Git-træ | `b153cf9dde2c51ffc6e3be7fdcf66db541bb7189` |
| Fremgangsmåde | `git archive` til separat midlertidig mappe; ingen samtidige GUI-ændringer |
| Node / npm | `v24.22.1` / `11.9.0` |
| Kommando | `npm test` i `jarvis-starter` |
| Resultat | **674 bestået, 0 fejlet, 0 annulleret, 0 skipped, 0 todo** |
| Rapporteret varighed | 14942.541635 ms |
| Start / slut, UTC | 2026-11-05 12:21:14 / 12:21:29 |

Dette er baselinebevis, ikke evidens for den ændrede GUI. De nye kandidatresultater tilføjes efter faktisk kørsel. Ingen lokal browserstart er forsøgt igen; den kendte Chromium IPC/socket-begrænsning omgås ikke med eskalation.

## Opdateret ren v5-basis – efter fem nye upstream-commits

| Felt | Registreret værdi |
|---|---|
| Lokal upstream | `186e851932a3b69a230349d78ef2e181d40a4e2a` |
| Git-træ | `30c7b35e0503875e45dece029798d7b59981d2a1` |
| Sammenholdt remote | `feature/v5-foundation`, `9a04659e` |
| Fremgangsmåde | Ny separat `git archive`; ingen GUI-ændringer i baseline |
| Runtime / kommando | Node 24.22.1 / `npm test` |
| Faktisk resultat | **930 bestået, 0 fejlet, 0 annulleret, 0 skipped, 0 todo** |
| Rapporteret varighed | 24579.12782 ms |

Den opdaterede v5-basis indeholder de nye Today-kilder, notehistorik, indkøbsrettelser, planlagte rester og durable updater. De nye assertions er bevaret i GUI-grenen. Den gamle 674-test-baseline står ovenfor som historik og bruges ikke som det aktuelle sammenligningsgrundlag.

## Kandidatbundet CI-kontrakt

Den nye workflow `.github/workflows/gui-redesign.yml` er afgrænset til GUI-arbejdet. Pull requests til `feature/v5-foundation` eller `feature/gui-redesign` og en eksplicit `workflow_dispatch` kan køre verifikationen.

- Checkout anvender PR'ens konkrete head-SHA eller den eksplicit angivne kandidat-SHA, ikke en ubestemt seneste branch eller et skjult merge-træ.
- Node 24 og Playwright **1.64.1** anvendes; browserjobbet bruger den tilsvarende **v1.64.1-noble**-container. Container og npm-pakke skal matche.
- Unit-regression og browserverifikation er selvstændige job. Begge resultater skal læses; et grønt GUI-job gør ikke en rød v5-suite accepteret.
- Syntetiske servere bruger `test/helpers/synthetic-env.mjs`, egne datamapper og ingen arvede kontonøgler, proxyhooks eller produktionsflag.
- Browseren tillader kun den lokale testorigin. Faste fixtures og opsamling af requests beskytter mod utilsigtede kalenderwrites, beskeder, indkøb, kodegenerering, installation og deployment.
- Artifacts indeholder den faktiske checkoutidentitet, asset-/fixturehashes, resultater, screenshots og traces. Manglende eller fejlet kørsel rapporteres som sådan.

## Eksisterende v5-forhold og kandidatgrænse

`docs/v5/verification.md` og `docs/v5/progress.md` er den bevarede v5-historik. Den seneste upstream dokumenterer faktisk modeltest på `2f94679d`: hybrid **75/80 (93,75 %)**, samme låste datasæt, alle 16 sikkerhedsspørgsmål og nul ugyldige kildelækager. Den tilhørende audit har **0 fund**. De tidligere native model- og dependencyfejl er dermed ikke åbne fund på denne historiske kandidat; resultaterne tilskrives heller ikke automatisk GUI-kandidaten.

Den samlede v5/M6-releasegate er fortsat ikke accepteret i upstream-dokumenterne. Ny kandidat kræver sine egne fulde browser-, model/audit- og performancegates. Fysisk iPhone/desktop, faktisk zoom/mikrofon og administratorens isolerede restore er fortsat særskilte krav. GUI-workflowen installerer kun sin testafhængighed i et midlertidigt miljø og foretager ingen produktionshandlinger.

Nye fejl i navigation, synlighed, kildeplacering eller kladder registreres som GUI-kandidatfejl og bortforklares ikke med historisk v5-status.

## Resultatlog for GUI-kandidaten

Lokale resultater er fra den reviewbare arbejdsgren efter integration af `186e851…`, før den endelige CI-commit. De er ikke et rent commitbaseret browserbevis.

| Kontrol | Faktisk resultat | Begrænsning |
|---|---|---|
| Målrettet merge-regression | **48/48 bestået**, 520.092132 ms | Node: nav, updater, deployment, Hjem, kildeinitialisering og HTML-kontrakt |
| Fuld lokal regression efter alle rettelser | **976/976 bestået**, 0 fejlet/skipped, 24422.906995 ms | `npm test`, Node 24.22.1; efter navkontrakt- og logout/kladderettelser. Første kørsel var 968/969 med én efterfølgende rettet gammel nav-labelassertion |
| K1/K5 efter kontrakttilpasning | **6/6 bestået** | Statisk struktur og kontrastberegner; ingen påstand om faktisk browserlayout |
| Scriptsyntax | Begge browser-runners, evidenshelper og fixture består `node --check` | Ingen browserstart |
| Workflowstruktur | YAML kan parses; to separate verifikationsjob | Ingen CI-kørsel er udført af denne kontrol |
| Faktisk fixture | Normal Today har én præcis kalenderkilde; tom har nul i en dækket periode; fejl svarer 503 | Genereres med den faktiske `buildCommandCenter` på faste syntetiske data |
| Chromium/WebKit-matrix | **Afventer kandidatbundet CI** | 36 scenarier: to engines × seks bredder × tre tilstande |
| Dybe v5-browserflows | **Afventer kandidatbundet CI** | Fire desktop/mobil-forløb, upstreams nye assertions bevaret |

CI-artifacts angiver konkret SHA, Git-/app-træ, browserversioner, asset-/fixturehashes og faktisk resultat. Et fejlet eller ikke kørt scenarie forbliver fejlet eller afventer. Fysisk keyboard/safe-area, virkelige integrationer og produktionsdeployment er ikke testet her.

## Første faktiske CI – e454ec0

[Run 42032130949](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42032130949) kørte den præcise commit `e454ec0776ecea85314b68a3d0e8e8f08781fc7d`, Git-træ `5286fca212deb2a1209848d2646c9baff29e1e7f`, app-træ `83b9238cdc41b12dc656f52997049deaea53b232`. `trackedChanges` var tom, og browserens assets var uændrede gennem kørslen.

- CI Node 24.22.1: **976/976 bestået**, 0 fejl/skips, 31.686149 sekunder.
- Chromium **156.0.8078.80** og WebKit **27.2** startede i det fastlåste Playwright-miljø.
- Alle **36** GUI-scenarier blev forsøgt; de **12 fejltilstandsforløb** bestod. De 24 normal-/tomforløb stoppede før skærmenes øvrige kontroller, fordi den syntetiske dashboardresponse manglede `agenda`, som den rigtige server føjer til `buildCommandCenter`. Fixture er rettet til samme responsekontrakt; resultaterne afventer genkørsel.
- Den dybe v5-smoke stoppede ved en gammel forventning om et hardcodet personnavn i overskriften. Det nye GUI bruger den specificerede titel **I dag**. Assertionen er tilpasset til den faktiske titel og ordmellemrum; resten af forløbet er endnu ikke godkendt fra denne kørsel.
- Der var nul registrerede runtimefejl, eksterne requests eller ikke tilladte writes i GUI-matrixen. Dette gør ikke de 24 blokerede forløb bestået.
- Faktiske screenshots af desktop og mobil er gennemgået. Tre konkrete CSS-rettelser til disclosures, tom Hjem-ramme og knapafstand følger med næste kandidat.

Artifacts: [unit](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42032130949/artifacts/13415834353) og [browser/screenshots/traces](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42032130949/artifacts/13416549000). ZIP-hashes er henholdsvis `e94d1c3ce6d0d819a1082f0f7f2855d29bf9416a31ebf56b847a4241ee6d80d0` og `ccfd3946e8e35917d8609f6ccc0d6b86165dadd61b53f90c4e0dea0826da8797`.

## Anden faktiske CI – b859a71

[Run 42034114557](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42034114557) kørte `b859a71ffa2769b3e3f12b3acf5af0c6caef93c1`, Git-træ `efff8519d99bba9f7abbe7e2b647d801d3ef5a21`, app-træ `77e62f8b24cbebe5500a3320c4c55cc65824c9c6`. Begge checkouts var rene. Assets var uændrede under browserkørslen.

| Testlag | Faktisk resultat | Miljø / begrænsning |
|---|---|---|
| Fuld Node-regression | **976/976 bestået**, 0 fejl/skips, 31.327199 sekunder | Unit-job: Node **24.22.2**; workflowen vælger major 24 |
| GUI-matrix | **36/36 bestået** | Chromium **156.0.8078.80**, WebKit **27.2**, Playwright 1.64.1, browser-job Node **24.22.1** |
| Isolerede API-kontroller | Nul runtimefejl, eksterne requests eller forbudte writes | Faste syntetiske fixtures; ingen liveintegrationstest |
| Dyb v5-browserregression | **Fejlet på første desktop-forløb** | Samtalefeltets bund var 1073,5 px ved skærmhøjde 950 px. Senere assertions og de andre device-forløb blev ikke nået |

GUI-matrixen dokumenterer de tre tilstande på alle seks bredder samt søgning, fokus/returfokus, eksplicit chatkontekst, forsinket svar og readonly kalender. Den dybe regression er fortsat en selvstændig, ikke godkendt gate på denne kandidat.

De målte kontraststikprøver ved 1024 px var: composer-tekst **16,866:1**, feltgrænse **3,510:1**, fokusring **8,198:1**, Send **9,203:1** og aktiv navigation **7,179:1**. Det dokumenterer de målte kombinationer, ikke en fuldstændig kontrastcertificering af alle komponenter. Body, textarea, toolbarbutton og synlige selects arver samme sans-serif-stack i begge engines.

Gennemgangen af de faktiske screenshots viste overskydende højdefordeling i desktop-grid og for stor historik på I dag. Næste kandidat fastlægger toolbarens række og beregner loggens disponible højde ud fra den faktiske composer og bundnavigation. Handlinger og fejl beholder deres højde; siden kan stadig rulle ved utilstrækkelig skærmplads. Den oprindelige first-screen-assertion er bevaret, og desktop-afstanden mellem toolbar og indhold bliver målt særskilt.

En konkret kodeaudit fandt også sene svar efter logout i secretary-læsning, opskriftsimport og direkte Nemlig-læsninger samt risiko for at rydde et nyere kalender-ID efter gemning. Disse afgrænsede guards og målrettede regressionscases indgår i næste kandidat. AI-manglende-opsætning får en synlig lokal vej til eksisterende serveropsætning.

Artifacts: [unit](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42034114557/artifacts/13417986386) og [browser/screenshots/traces](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42034114557/artifacts/13418241469). ZIP-hashes: `8e6f917f89b8e384be3313cb39d734530ae1cc110c9dd6df093d329e6839216b` og `f896f7261b43f2e7f5021ae60e469bb03af6076807e7f0bc4a9648db074cb4ce`.

## Lokal kontrol af rettelser efter CI2

`npm test` med Node **24.22.1**: **988/988 bestået**, 0 fejl/skips, **29.547465024 sekunder**. De 12 ekstra cases dækker forsinkede secretary-læsninger og kalender-/opskrifts-/Nemlig-responses, ejerskift, logout, nyere kladder og bekræftet gemning efterfulgt af læsefejl. Den målrettede måltids-/kalenderregression består **34/34**. Disse tests bruger kode-/DOM-dobler og isolerede domæner; layout- og deep-browserresultater for næste kandidat afventes fortsat.
