# GUI-verifikation

## Aktuel samlet kandidat – 5. november 2026

Kode `968a8dc028643f467b3af454beced449bd5803ce`, app-træ `3ca692656b835006832e7e343e820e524533510f`, [CI12](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42053601605). **990/990 Node-tests** bestået (32,403 s); ægte lokal hybrid-kilde@5 **75/80 = 93,75 %**, mål 90 %, 16 supplerende sikkerhedsspørgsmål og ingen ugyldige kildelækager; dependency-audit **0 fund**. **36/36 GUI-scenarier og4/4 dybe browserforløb bestået**: Chromium og WebKit på desktop og mobil.

Deadline-rydning nulstiller WebKits native datoeditor. Uændrede knap-/statuslabels og jobpreview omtegnes ikke ved blur/change. Fokuserede felter holdes over den faste bundmenu ved kompakt reflow. De eksisterende objekt-, revisions-, rettigheds- og kladdekontroller er bevaret. Job oprettes fortsat pauserede.

Syntetisk migration/backup/restore med to serverstarter er bestået. **Fysisk iPhone/desktop, faktisk browserzoom/OS-keyboard/mikrofon og konkret administrator-/driftsaccept er fortsat åbne. M6 er ikke endeligt accepteret; M7 er ikke udført.** Ingen merge, tag eller deployment.

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

## Tredje faktiske CI – d40d963

[Run 42036701067](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42036701067) kørte den eksakte commit `d40d963c4d672401a04d7633e4fab9ccb831b494`, Git-træ `d0a430e563a57d9a6512cf4dc40dac6436d170eb`, app-træ `f04b9b84f86b94e36557acfc121773b6c6affadb`. Begge checkouts var rene. De offentlige assets var uændrede under browserkørslen.

| Kontrol | Faktisk resultat | Miljø / begrænsning |
|---|---|---|
| Fuldt Node-regressionsjob | **988/988 bestået**, 0 fejl/skips, **33.916505 sekunder** | Node **24.22.2**, præcis kandidat |
| GUI-browsertest | **36/36 bestået** | Chromium **156.0.8078.80** og WebKit **27.2**, 320/366/390/768/1024/1440 CSS-px, normal/tom/fejl, syntetiske data |
| Dyb v5-browserregression | **1/4 bestået, 3 fejlet** | Chromium-mobil **bestod alle dybe flows**, herunder shopping, noter/hukommelse, konflikter og kladdebevaring. Chromium-desktop fejlede ved reduceret **695×475** px: et felt var tildækket. WebKit-desktop og WebKit-mobil fik ingen forventet POST fra opfølgningsformularen. |
| Browseridentitet og sikkerhed | Ingen ændrede assets under kørslen; GUI-matrixen registrerede ingen eksterne requests eller forbudte writes | Testserver og fixtures er syntetiske, og resultatet er ikke liveintegrationsevidens |

Den dybe regression beholder alle upstreams assertions og rapporterer hvert device separat med fejl og screenshot. At ét forløb består giver ikke de andre et grønt resultat. Brugeren kan gennemgå de faktiske fejl i [browserartifacts fra CI3](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42036701067/artifacts/13417754902); [Node-artifact](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42036701067/artifacts/13418812659). ZIP-SHA256: browser `cd818463088bf502601fc1693dd1483db29ec46f6fe90e0ed0c0c0c9138eb5f7`, unit `bef5c8acdedb16efee94f7525947d537544cfa07160355cd20fc0da0c1e3dd62`.

Efter CI3 blev den konkrete korte-skærm-fejl rettet i `gui.css`: toasten er ikke-interaktiv og flyttes til toppen ved højder på højst 640 px. Den tidligere faste bundplacering lå over det fokuserede felt under bundnavigationen på en skærm på 475 px. Den dybe regression blev også udvidet med formvaliditet, submit-/kliksporing og observerede HTTP-metoder omkring WebKit-opfølgning, uden at omgå formvalidering eller skjule den manglende POST. Disse ændringer blev faktisk prøvet i CI4 og CI5 nedenfor.

## Fjerde faktiske CI – 060759b

[Run 42041109366](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42041109366) verificerede præcis `060759b37cde8a9dd93eb640bcae4921a2de2811`, Git-træ `41a94361c0d143d810d3971cfac94344712682fe`, app-træ `8565e46145f291822b8157483c14a50c1381d6b7`, rene checkouts og uændrede offentlige assets under testen.

- Node **988/988 bestået**; normal/tom/fejl i Chromium og WebKit ved alle seks specificerede bredder: **36/36 bestået**.
- Den dybe browserregression: **2/4 bestået**, nemlig Chromium-desktop og Chromium-mobil. Desktop gennemførte nu også **695×475**-reflow og de lange v5-flows. WebKit-desktop og WebKit-mobil fejlede stadig ved første opfølgning; formularen var gyldig, men der kom intet forventet POST.
- Faktiske [browserbilleder, traces og rapporter](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42041109366/artifacts/13423750139) og [Node-resultat](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42041109366/artifacts/13421921035). Browser-ZIP blev downloaded, SHA256-kontrolleret og inspiceret lokalt; hash `7e9be77e5fc16e4d27c519ba03853391fa5a450f53333ddd54d6adfa6bb39b60`.

## Femte faktiske CI – 38be0cf

[Run 42043134148](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42043134148) verificerede `38be0cf4b197dbd1ea0b417b0d8bb2a02a9c4904`, Git-træ `58e8c9a1061909cf7c1da8a919cda06974211603`. Ændringen var udelukkende præcis browserhændelseslogning i regressionstesten.

- Node **988/988 bestået** og almindelig GUI-matrix **36/36 bestået**. Dyb regression **2/4 bestået**: Chromium begge enheder bestod; WebKit begge enheder fejlede stadig før API-anmodningen.
- WebKit-logging bekræftede `pointerdown`, `mousedown`, `pointerup` og `mouseup` på selve den gyldige, aktive **Opret opfølgning**-knap; der var **ingen `click` og ingen `submit`**, ingen dokumentnavigation og ingen POST. Den manglende handling kunne derfor ikke forklares med ugyldige felter, forkert form-ejerskab, overlay eller API-afslag.
- Den konkrete kandidatændring efter CI5 gør ændringsmarkeringens kontrolopdatering idempotent, så et `change` på det seneste tekstfelt under fokus-skift ikke genopretter submitknappens indhold mellem musehændelser. Den almindelige submit-eventhandler og dens API-kontrakt er uændrede. Virkningen af dette kodefix kræver særskilt browserverifikation.
- [CI5 browserartifacts](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42043134148/artifacts/13421799096) og [Node-artifact](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42043134148/artifacts/13423406855).


## Samlet releasekandidat – 5. november 2026

Kandidat `b128867abd570ee41e2065356bab5c90fa64ca34`, root-træ
`2039ef8c3ba836caccb332b035be341dcad7bcd1`.
[Samlet CI](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42047122858).

- WebKit-opgaveflowet på `87ae35e` stoppede efter rydning af deadline; ingen PATCH blev observeret, og det native datofelt var ugyldigt. Tidligere status om kun opfølgningsknappen er ikke det seneste fejlresultat.
- En eksplicit **Fjern deadline**-handling nulstiller hele det native felt og dets oprindelige tidsmetadata. Den markerer/persisterer kun kladden; normal revisionsbundet gemning foretager PATCH. Delvise datoer omfortolkes ikke automatisk til tomme gyldige værdier.
- Uændrede statuslabels genopbygges ikke ved blur/change, så pointergestus bevarer sit mål.
- Lokal Node 24.22.1: **989/989 bestået**, 0 fejl/skips, 27.586109939 s. Målrettet planeditor: **25/25**. Dette omfatter null-deadline efter kladde-reload, oprindelig revision og ingen write ved selve rydningen.
- Samme GUI-workflow kører nu også ægte lokal semantik, dependency-audit og parret baseline/kandidat-performance på den eksakte head-SHA. Node22 anvendes til model/performance, Node24 til GUI/fuld regression.
- Den fysiske acceptliste er rettet til fire hoveddestinationer. Fysisk Safari/skærmtastatur, faktisk browserzoom/mikrofon og administratorens driftsmiljø er fortsat ikke verificeret.

Dette var stoppunktet før CI8; det efterfølgende faktiske resultat følger nedenfor.


### Isoleret restoreøvelse på kandidatens app-indhold

Faktisk kørt 2026-11-05 14:41 UTC med Node24.22.1. En syntetisk skema0-state blev startet med den rigtige server, migreret, stoppet og kopieret som et samlet datamappeinventar. Kopien blev hashkontrolleret, gendannet til en separat mappe og startet/genstartet med `/health` version5.0.0 og `/ready` storage.ready=true. Den oprindelige migrationsbackup og den eksplicitte manuelle markør/revision var bevaret. Backupinventaret blev ikke ændret.

[Maskinlæsbar evidens](../v5/evidence/gui-release-restore.json). Inventaret indeholdt state, migrationsbackup og updaterjournal. Dette er en konkret syntetisk restore-/genstartsprøve, ikke en komplet prøve af produktionscredentials, Discordjournal, mediearkiv, projekter eller administratorens servicekonfiguration. Disse driftskontroller forbliver åbne.

### Samlet model-, audit- og performanceresultat

På `b128867`, CI42047122858: Node **989/989**, 0 fejl/skips, 26.181474241 s. Semantisk hybrid-kilde@5 **75/80 (93,75 %)** med uændret 90 %-mål. Audit af den installerede valgfrie modelruntime: **0 fund**.

Performancejobbet er en måling, ikke et generelt løfte om hurtigere adfærd. Samme syntetiske datasæt og benchmark på Node22.23.4:

| Måling | v4.9.1 | Samlet V5-kandidat |
|---|---:|---:|
| Fuld state p95 | 15,187 ms | 14,667 ms |
| Bootstrap p95 / payload | Ikke tilgængelig | 2,562 ms / 7.123 bytes |
| Retrieval p95 | 10,305 ms | 15,429 ms |
| Durable writes p95 | 7,202 ms | 13,371 ms |
| Målt RSS-peak | 93.396.992 bytes | 111.292.416 bytes |

Bootstrap reducerer datamængden sammenlignet med baseline fuld state på165.621 bytes. Retrieval og writes er langsommere i denne serie, og hukommelsen er højere; disse resultater skjules ikke af det grønne workflow. Ingen produktionslatens, faktiske modelomkostninger eller serverkapacitetsgaranti kan udledes. Nul reelle modelkald, eksterne værktøjskald, aktiverede jobs eller kurveskrivninger. [Begge målinger](../v5/evidence/gui-release-performance.json).

### Første samlede kandidat: faktisk browserfejl og opfølgning

CI42047122858 på `b128867` bestod Node989/989, GUI-matrix36/36, semantik/audit og performancemåling. Den dybe regression bestod Chromium desktop/mobil, men fejlede i begge WebKit-profiler: selv efter `.value = ''` var det native deadlinefelt ugyldigt. Den nye direkte assertion fangede dette før PATCH; resultatet er **2/4, ikke godkendt**.

Opfølgende kandidat `eb7f1547c6c9edcbb9edcbd441a8dd238069f4cb` nulstiller datokontrollens interne editor ved kortvarigt at skifte samme element til teksttype, rydde værdien og genskabe datetime-local-typen. Elementidentitet, labels, listeners og normal validering bevares. Den eksplicitte handling flytter ikke fokus tilbage ind i den tomme segmenteditor. Målrettet regression25/25 består. Den samme browserassertion og alle øvrige flows skal bestå på denne kandidat; intet fejlet resultat ommærkes.

### Anden samlede kandidat og bredere WebKit-rettelse

CI42048971546 på `eb7f1547` bestod Node989/989, GUI36/36, semantik75/80 og audit0. Deadline-rydning, opgavegemning og opfølgning passerede nu i WebKit. Begge WebKit-profiler stoppede senere ved oprettelse af et syntetisk **pauset** job; Chromium desktop/mobil bestod. Resultatet for hele den dybe suite er fortsat2/4.

`00cdee8e` retter jobeditorens gentagne change-/blur-omtegning. Kandidat `096bbe2d490bb1e76067dc2ab1aa1b6046d194aa` bevarer denne ændring og sikrer også stabile, uændrede actionlabels i claim-/projekteditorerne. Regressionen kontrollerer, at et uændret change-event bevarer både jobknappens tekstnode og previewets børn; gemning opretter stadig kun et pauset job.

Lokalt: målrettet editorregression60/60. En fuld kørsel inden integration af den samtidige jobrettelse gav989/990 med timeout i den uændrede project-agent-test `refuses rollback when a file has been modified outside agent` (JavaScript-syntakskontrol). En efterfølgende isoleret serie med project-agent, jobeditor og planeditor bestod42/42 på2.117847064 s, uden ændrede produktions- eller testtimeouts. Den fejlede fulde kørsel bevares som fejl, ikke ommærket som succes. Den efterfølgende rene CI11 bestod990/990; det lokale timeoutresultat er fortsat historisk registreret.

Lokalt app-træ for `096bbe2d`: `d04251d64e8f7b58919a8a19141e95b77595322e`. [CI42051097831](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42051097831) tester denne samlede kandidat. Seneste tidligere parrede måling findes i [gui-release-performance-final.json](../v5/evidence/gui-release-performance-final.json) og er eksplicit bundet til `eb7f1547`, ikke denne nyere kandidat.

### CI11 og den sidste reflowrettelse

CI42051097831 (`096bbe2d`) bestod990/990 Node,36/36 GUI, semantik75/80, audit0 og performancemåling. Den dybe suite bestod3/4: Chromium desktop/mobil og WebKit mobil. WebKit desktop fejlede ved695×475, hvor projektets titelfelt (top424,5/bund468,5) lå bag bundmenuen (top403). Det var en faktisk fokus-/tildækningsfejl, ikke en test der kunne udelades.

Den samtidige GUI-rettelse `968a8dc0` tilføjer root scroll-padding og en afgrænset focusin-kontrol for workspace-kontroller bag fast navigation. Overlays og desktopnavigation undtages. Ingen assertions er svækket. CI12 kontrollerer den samlede kode igen.

### Aktuel parret performancemåling og modelinventar

CI12 på968a8dc0, Node22.23.4, samme syntetiske datasæt og benchmark modv4.9.1. Fuld state p95:10,014 →15,037 ms; retrieval6,068 →13,969 ms; durable write3,988 →10,545 ms. Kandidatbootstrap p951,829 ms og7.123 bytes mod baselines fulde state165.621 bytes. Målt RSS93.618.176 →110.735.360 bytes. Der er højere omkostninger på nogle operationer; grøn målejobstatus er ikke en latensgaranti eller en påstand om generelt forbedret hastighed.

[Parret performance](../v5/evidence/gui-release-performance-968a8dc0.json) og [model/audit](../v5/evidence/gui-release-semantic-968a8dc0.json) fastholder præcis revision, datasæt, misses og inventar. Modeltesten måler kilderetrieval, ikke genererede svars faktuelle korrekthed. Ingen faktiske eksterne modelkald, aktiverede jobs eller kurveskrivninger i benchmark.

### Afsluttet CI12 – samlet automatisk gate bestået

På968a8dc0 bestod **990/990 Node**, **36/36 GUI** og **4/4 dybe browserforløb** (Chromium desktop/mobil og WebKit desktop/mobil). Den tidligere blokerende WebKit-desktop-reflowkontrol er nu bestået. Semantik75/80, audit0 og parret performance er kørt på samme app-træ. CI-run42053601605 opbevarer screenshots, traces, accessibility-report og præcis checkout-/assethashbinding. Dokumentationsopdateringen efter dette kodecheckpoint ændrer ikke app-træet3ca692656b835006832e7e343e820e524533510f.

Dette lukker de reproducerede automatiske browserblokeringer. Det registrerer ikke fysisk enhedsaccept, administratorens komplette restore eller M6/M7-godkendelse.
