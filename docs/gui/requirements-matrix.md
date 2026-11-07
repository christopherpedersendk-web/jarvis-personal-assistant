# GUI-kravmatrix

ID'erne henviser til den normative GUI-specifikation. Historiske v5-Rxx-ID'er har en anden betydning. Status er knyttet til den konkrete kodecommit og testkørsel angivet nedenfor. Fysisk enhedsaccept og liveintegrationer er særskilte, endnu ikke gennemførte kontroller.

| Krav | Implementeringsområde | Test / observerbart resultat | Status |
|---|---|---|---|
| R01 Bevar produktet | `gui-shell.js`, `index.html`, bevarede domænemodeller/API’er | T01: samme ID, type, data, kilder og rettigheder; fuld Node-regression | **Bestået CI12:** 990/990 Node og 4/4 dybe browserforløb; eksisterende kilder og revisionskontrakter bekræftet |
| R02 Navigation | `gui-navigation.js`, `gui-shell.js`, `app.js`, `index.html` | T02: gamle links, præcis kilde, tilbage/frem og genindlæsning | **Bestået CI12:** 36/36 GUI og 4/4 dyb navigation med reload/back/frem |
| R03 I dag | `organizer.js`, `gui-today.js`, `app.js`, `gui.css` | T03: normal/tom/frakoblet er forskellige, korrekt lokal dag | **Bestået CI12:** tre skærmtilstande, lokal dagsdato, kalenderkildeskel og lang historik |
| R04 Opgaver og kalender | `v5-plan.js`, `gui-calendar.js`, `v5-projects.js`, `gui-shell.js` | T01/T04: projekter bevarer detaljer; kalender uden uunderstøttet skrivning | **Bestået CI12:** WebKit og Chromium gemmer opgaver/opfølgninger med revision; kalender er læsende; ingen kalenderskrivning |
| R05 Madplan | `meals.js`, `gui-today.js`, oprindeligt `plan.shoppingList` | T05: gemt kontra forslag; samme listeidentitet; ingen skjult overførsel | **Bestået CI12:** fire dybe forløb tester madplan, planlagte rester og delt indkøbsliste; ingen skjult overførsel |
| R06 Noter og hukommelse | `organizer.js`, `memory-v49.js`, `v5-plan.js`, `gui-shell.js` | T01: ubekræftet forbliver ubekræftet; samme kilde og objekt | **Bestået CI12:** kilde/revision, forslag, bekræftelse og notehistorik i begge browsermotorer |
| R07 Hjem | `smart-home.js`, `index.html`, `gui.css` | T06: bekræftet resultat kontra fejl; utilgængelige kapabiliteter | **Bestået CI12:** isolerede Hue-succes/fejlscenarier ved 390 og 1024 px; fysisk enhed ikke testet |
| R08 Overvågninger | `gui-watches.js`, `job-policy.js`, `app.js` | T07: pause/revision; gammel observation og nyere fejl samtidigt | **Bestået CI12:** GUI/Node pause/genoptag, kilde, historik og forældet pris; syntetiske data |
| R09 Indstillinger | `gui-shell.js`, `settings-drafts.js`, `intelligence.js` | T04/T11: kapabiliteter, korrekt lokal gemning og kladder | **Bestået CI12:** seks kategorier, synlig capabilitygrænse, kladde og fejlkonflikt i dybe browserforløb |
| R10 System og opdatering | `system-health.js`, `update-manager.mjs`, `server.mjs` | T08: konkret testet målversion; ændret SHA må ikke genbruge godkendelse | **Bestået CI12:** Node og GUI uden testet målversion; ingen virkelig deployment udført |
| R11 Søgning | `intelligence.js`, `gui-navigation.js`, `gui-shell.js` | T09: originalt objekt; tom, indlæser og fejl adskilt | **Bestået CI12:** søgning åbner samme note/kilde og viser tom/fejl særskilt |
| R12 Samtale og kontekst | `chat-draft.js`, `gui-shell.js`, `app.js` | T10: kontekst fast ved afsendelse, sen respons og nyere kladde bevares | **Bestået CI12:** eksplicit chatkontekst, forsinket svar og nyere kladde i isoleret browser |
| R13 Kladder | `settings-drafts.js`, `chat-draft.js`, `app.js`, `meals.js` samt bevarede domænecontrollere | T11: navigation, fejl, konflikt og logout; ingen fantomgemning | **Bestået CI12:** 990/990 Node og 4/4 dybe browserforløb med kladde-/konflikt-/logoutkontrol |
| R14 Tilstande | `gui-calendar.js`, `gui-watches.js`, `smart-home.js`, `system-health.js` | T06/T12: data, kapabilitet og handling vises særskilt | **Bestået CI12:** normal/tom/fejl, frakoblet og forældet måling; ingen liveintegrationstest |
| R15 Visuelt system | `gui.css`, `index.html` | T12: faktisk tekstkontrast ≥4,5:1 og nødvendig kontrolgrænse ≥3:1 | **Bestået CI12 for målte stikprøver**; ingen komplet tilgængelighedscertificering |
| R16 Responsivitet | `gui.css`, `gui-shell.js` | T13/T14: seks CSS-bredder, ingen afklipning, fokus og handlinger kan nås | **Bestået CI12:** seks bredder × tre tilstande × to motorer og 695×475 reflow med synligt projektfelt |
| R17 Sprog og input | `gui-navigation.js`, `gui-today.js`, `gui-calendar.js`, `v5-plan.js` | T14/T15: fokus, 24-timersvisning, tidszone og dato uden tid | **Bestået CI12 for browser/DOM/DST-kontrakter**; fysisk OS-keyboard og skærmlæser endnu ikke afprøvet |
| R18 Aflevering | `scripts/gui-evidence.mjs`, `scripts/*visual-smoke.mjs`, `.github/workflows/gui-redesign.yml`, `docs/gui/` | T15: diff, screenshots, præcis kandidatidentitet og ærlige resultater | **Bestået CI12:** PR #8, faktiske CI12-artifacts og målinger; klar til kode-/UX-review uden produktionsrelease |

Seneste faktisk afsluttede og fuldt beståede GUI-kørsel er **CI12** på [`968a8dc`, run 42053601605](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42053601605): **990/990 Node, 36/36 GUI-scenarier og 4/4 dybe browserforløb bestået**. Den præcise release-/model-/performanceevidens, ældre fejlede forløb, forklaringer og ZIP-artifacts står i [verification.md](verification.md). De isolerede grønne GUI-tests giver ikke liveintegrationer eller en automatisk releasegodkendelse.

## Testlag og deres grænser

- `npm test` omfatter backend-, HTTP- og DOM-kontrakter. Der kræves ingen rigtige konti eller eksterne skriverettigheder.
- `scripts/v5-visual-smoke.mjs` bevarer de dybe flows for historik, personlige opgaver, jobpolitik, projekter, kilder, hukommelse, noter, husstand og revisionskonflikter. Navigation, synlig adgang til editorer og primære labels følger GUI-kontrakten; objekt-, kladde-, revisions- og sikkerhedsassertions bevares. Upstreams nye Today-, notehistorik-, shopping- og leftover-flows er bevaret.
- `scripts/gui-visual-smoke.mjs` dokumenterer GUI-matrixen ved faktisk CI-kørsel med stabile syntetiske responses. API-mocks er ikke integrationstest eller bevis for livepriser.
- Browserrapporter og screenshots er bundet til commit og assethashes. Der rapporteres ikke en grøn browsermatrix på baggrund af syntax- eller DOM-kontrol.
- Fysisk mobilkeyboard, safe-area på konkrete enheder, faktisk browserzoom, mikrofon og reelle integrationer kræver særskilt adgang og er ikke dækket af viewportemulering.

## Konkrete automatiske kontroller

| Test-ID | Testfiler / browserflow | Dokumenteret grænse |
|---|---|---|
| T01–T02 | `gui-navigation`, `v5-source-navigation`, `v5-ui-contract`; præcist kilde-ID, gamle aliases, panel/kilde-roundtrip og secretary-opmærksomhed | Back/frem/reload og objektidentitet bestået i CI12-browsermatrix og dybe forløb |
| T03–T05 | `gui-today`, `v5-today-overview`, `v5-today-ui`, eksisterende meal/household/shopping-tests; dyb v5-smoke | Samme TodayOverview, husholdningsgrundlag, madplan-ID og read-only kalender; ingen livekalender |
| T06 | `gui-home`; GUI-smokens syntetiske Hue-succes/fejl ved 390/1024 px | Bekræftet vs ukendt API-resultat, ingen fysisk enhed |
| T07 | `gui-watches`, `gui-watch-actions`; GUI-smokens pause/genoptag | Gammel observation, nyere fejlet kontrol, revision og fælles editor; ingen prisresearch |
| T08 | `gui-deployment`, `v5-updater-ui`, eksisterende updater-durability; browser uden testet target | SHA og testtid bindes inde i durable commit; ingen deployment |
| T09–T11 | `v5-source-navigation`, `v5-chat-draft`, `v5-settings-ui`, `v5-text-drafts`, `gui-calendar-drafts`, øvrige kladdekontrakter; begge browser-runners | Én global chat, eksplicit kilde-prefix, fast sendekontekst og bevaret nyere kladde |
| T12–T14 | GUI-smoke ved 320/366/390/768/1024/1440, normal/tom/fejl, fokus/kontrast/reduceret højde | CI12 bestået 36/36 GUI og 4/4 dybe browserforløb, inklusive WebKit ved 695×475. Lokal navigation kan rulle i egen container; fysisk OS-tastatur/safe-area er ikke testet |
| T15 | `gui-today` og kalender-/DST-tests samt `gui-evidence` | Europe/Copenhagen, døgn på 23/25 timer; API-nøglefelter og runtimeopsætning følger reelle capabilities |
