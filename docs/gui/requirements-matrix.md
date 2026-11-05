# GUI-kravmatrix

ID'erne henviser til den normative GUI-specifikation. Historiske v5-Rxx-ID'er har en anden betydning. **Afventer** betyder, at der endnu ikke foreligger evidens for den endelige kandidat; det betyder ikke bestået.

| Krav | Implementeringsområde | Test / observerbart resultat | Status |
|---|---|---|---|
| R01 Bevar produktet | `gui-shell.js`, `index.html`, bevarede domænemodeller/API’er | T01: samme ID, type, data, kilder og rettigheder; fuld Node-regression | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R02 Navigation | `gui-navigation.js`, `gui-shell.js`, `app.js`, `index.html` | T02: gamle links, præcis kilde, tilbage/frem og genindlæsning | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R03 I dag | `organizer.js`, `gui-today.js`, `app.js`, `gui.css` | T03: normal/tom/frakoblet er forskellige, korrekt lokal dag | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R04 Opgaver og kalender | `v5-plan.js`, `gui-calendar.js`, `v5-projects.js`, `gui-shell.js` | T01/T04: projekter bevarer detaljer; kalender uden uunderstøttet skrivning | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R05 Madplan | `meals.js`, `gui-today.js`, oprindeligt `plan.shoppingList` | T05: gemt kontra forslag; samme listeidentitet; ingen skjult overførsel | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R06 Noter og hukommelse | `organizer.js`, `memory-v49.js`, `v5-plan.js`, `gui-shell.js` | T01: ubekræftet forbliver ubekræftet; samme kilde og objekt | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R07 Hjem | `smart-home.js`, `index.html`, `gui.css` | T06: bekræftet resultat kontra fejl; utilgængelige kapabiliteter | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R08 Overvågninger | `gui-watches.js`, `job-policy.js`, `app.js` | T07: pause/revision; gammel observation og nyere fejl samtidigt | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R09 Indstillinger | `gui-shell.js`, `settings-drafts.js`, `intelligence.js` | T04/T11: kapabiliteter, korrekt lokal gemning og kladder | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R10 System og opdatering | `system-health.js`, `update-manager.mjs`, `server.mjs` | T08: konkret testet målversion; ændret SHA må ikke genbruge godkendelse | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R11 Søgning | `intelligence.js`, `gui-navigation.js`, `gui-shell.js` | T09: originalt objekt; tom, indlæser og fejl adskilt | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R12 Samtale og kontekst | `chat-draft.js`, `gui-shell.js`, `app.js` | T10: kontekst fast ved afsendelse, sen respons og nyere kladde bevares | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R13 Kladder | `settings-drafts.js`, `chat-draft.js`, `app.js`, bevarede domænecontrollere | T11: navigation, fejl, konflikt og logout; ingen fantomgemning | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R14 Tilstande | `gui-calendar.js`, `gui-watches.js`, `smart-home.js`, `system-health.js` | T06/T12: data, kapabilitet og handling vises særskilt | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R15 Visuelt system | `gui.css`, `index.html` | T12: faktisk tekstkontrast ≥4,5:1 og nødvendig kontrolgrænse ≥3:1 | Afventer browser |
| R16 Responsivitet | `gui.css`, `gui-shell.js` | T13/T14: seks CSS-bredder, ingen afklipning, fokus og handlinger kan nås | Afventer browser; fysisk keyboard særskilt |
| R17 Sprog og input | `gui-navigation.js`, `gui-today.js`, `gui-calendar.js`, `v5-plan.js` | T14/T15: fokus, 24-timersvisning, tidszone og dato uden tid | CI Node bestået; fuldt browserflow afventer korrigeret fixture |
| R18 Aflevering | `scripts/gui-evidence.mjs`, `scripts/*visual-smoke.mjs`, `.github/workflows/gui-redesign.yml`, `docs/gui/` | T15: diff, screenshots, præcis kandidatidentitet og ærlige resultater | 976/976 CI Node; første browserkørsels faktiske resultater dokumenteret |

Første CI: [`e454ec0`, run 42032130949](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42032130949). Node: **976/976**. Browser: **12/36** fejltilstandsforløb bestod; normal/tom stoppede ved manglende `agenda` i testfixture. Den dybe regression stoppede ved en gammel velkomsttekst-assertion. Disse to testopsætningsfejl er rettet og afventer ny browserkørsel. Ingen af de blokerede forløb tælles som bestået.

## Testlag og deres grænser

- `npm test` omfatter backend-, HTTP- og DOM-kontrakter. Der kræves ingen rigtige konti eller eksterne skriverettigheder.
- `scripts/v5-visual-smoke.mjs` bevarer de dybe flows for historik, personlige opgaver, jobpolitik, projekter, kilder, hukommelse, noter, husstand og revisionskonflikter. Navigation, synlig adgang til editorer og primære labels følger GUI-kontrakten; objekt-, kladde-, revisions- og sikkerhedsassertions bevares. Upstreams nye Today-, notehistorik-, shopping- og leftover-flows er bevaret.
- `scripts/gui-visual-smoke.mjs` dokumenterer GUI-matrixen ved faktisk CI-kørsel med stabile syntetiske responses. API-mocks er ikke integrationstest eller bevis for livepriser.
- Browserrapporter og screenshots er bundet til commit og assethashes. Der rapporteres ikke en grøn browsermatrix på baggrund af syntax- eller DOM-kontrol.
- Fysisk mobilkeyboard, safe-area på konkrete enheder, faktisk browserzoom, mikrofon og reelle integrationer kræver særskilt adgang og er ikke dækket af viewportemulering.

## Konkrete automatiske kontroller

| Test-ID | Testfiler / browserflow | Dokumenteret grænse |
|---|---|---|
| T01–T02 | `gui-navigation`, `v5-source-navigation`, `v5-ui-contract`; præcist kilde-ID, gamle aliases, panel/kilde-roundtrip og secretary-opmærksomhed | Faktisk back/frem/reload verificeres i browser-CI |
| T03–T05 | `gui-today`, `v5-today-overview`, `v5-today-ui`, eksisterende meal/household/shopping-tests; dyb v5-smoke | Samme TodayOverview, husholdningsgrundlag, madplan-ID og read-only kalender; ingen livekalender |
| T06 | `gui-home`; GUI-smokens syntetiske Hue-succes/fejl ved 390/1024 px | Bekræftet vs ukendt API-resultat, ingen fysisk enhed |
| T07 | `gui-watches`, `gui-watch-actions`; GUI-smokens pause/genoptag | Gammel observation, nyere fejlet kontrol, revision og fælles editor; ingen prisresearch |
| T08 | `gui-deployment`, `v5-updater-ui`, eksisterende updater-durability; browser uden testet target | SHA og testtid bindes inde i durable commit; ingen deployment |
| T09–T11 | `v5-source-navigation`, `v5-chat-draft`, `v5-settings-ui`, øvrige kladdekontrakter; begge browser-runners | Én global chat, eksplicit kilde-prefix, fast sendekontekst og bevaret nyere kladde |
| T12–T14 | GUI-smoke ved 320/366/390/768/1024/1440, normal/tom/fejl, fokus/kontrast/reduceret højde | Reelt browserbevis afventer; lokal navigation må rulle i sin egen container. Ingen fysisk OS-tastatur-/safe-area-test |
| T15 | `gui-today` og kalender-/DST-tests samt `gui-evidence` | Europe/Copenhagen, døgn på 23/25 timer; API-nøglefelter og runtimeopsætning følger reelle capabilities |
