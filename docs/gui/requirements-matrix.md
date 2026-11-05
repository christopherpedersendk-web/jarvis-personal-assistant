# GUI-kravmatrix

ID'erne henviser til den normative GUI-specifikation. Historiske v5-Rxx-ID'er har en anden betydning. **Afventer** betyder, at der endnu ikke foreligger evidens for den endelige kandidat; det betyder ikke bestået.

| Krav | Implementeringsområde | Test / observerbart resultat | Status |
|---|---|---|---|
| R01 Bevar produktet | Eksisterende modeller/API'er, flytning af DOM | T01: samme ID, type, data, kilder og rettigheder; fuld Node-regression | Node-kontrakter verificeret; kandidat-CI afventer |
| R02 Navigation | Router, hovednavigation og lokale underfaner | T02: gamle links, præcis kilde, tilbage/frem og genindlæsning | Node-kontrakter verificeret; kandidat-CI afventer |
| R03 I dag | Dagsoversigt, kompakt chat og relevant fejl | T03: normal/tom/frakoblet er forskellige, korrekt lokal dag | Node-kontrakter verificeret; kandidat-CI afventer |
| R04 Opgaver og kalender | Planlægningsgrupper og kalender | T01/T04: projekter bevarer detaljer; kalender uden uunderstøttet skrivning | Node-kontrakter verificeret; kandidat-CI afventer |
| R05 Madplan | Eksisterende måltids- og indkøbseditorer | T05: gemt kontra forslag; samme listeidentitet; ingen skjult overførsel | Node-kontrakter verificeret; kandidat-CI afventer |
| R06 Noter og hukommelse | Noter i Planlægning, hukommelse i Indstillinger | T01: ubekræftet forbliver ubekræftet; samme kilde og objekt | Node-kontrakter verificeret; kandidat-CI afventer |
| R07 Hjem | Eksisterende smart home-kontroller | T06: bekræftet resultat kontra fejl; utilgængelige kapabiliteter | Node-kontrakter verificeret; kandidat-CI afventer |
| R08 Overvågninger | Monitorvisning og fælles jobeditor | T07: pause/revision; gammel observation og nyere fejl samtidigt | Node-kontrakter verificeret; kandidat-CI afventer |
| R09 Indstillinger | Seks kategorier og integrationskatalog | T04/T11: kapabiliteter, korrekt lokal gemning og kladder | Node-kontrakter verificeret; kandidat-CI afventer |
| R10 System og opdatering | Systemstatus og deploymentkontroller | T08: konkret testet målversion; ændret SHA må ikke genbruge godkendelse | Node-kontrakter verificeret; kandidat-CI afventer |
| R11 Søgning | Global søgning og kildekoordinator | T09: originalt objekt; tom, indlæser og fejl adskilt | Node-kontrakter verificeret; kandidat-CI afventer |
| R12 Samtale og kontekst | Én flytbar chat og eksisterende message-API | T10: kontekst fast ved afsendelse, sen respons og nyere kladde bevares | Node-kontrakter verificeret; kandidat-CI afventer |
| R13 Kladder | Eksisterende draft- og revisionsværn | T11: navigation, fejl, konflikt og logout; ingen fantomgemning | Node-kontrakter verificeret; kandidat-CI afventer |
| R14 Tilstande | Domænevisninger og feedback | T06/T12: data, kapabilitet og handling vises særskilt | Node-kontrakter verificeret; kandidat-CI afventer |
| R15 Visuelt system | Tokens og fælles kontrolstyling | T12: faktisk tekstkontrast ≥4,5:1 og nødvendig kontrolgrænse ≥3:1 | Afventer browser |
| R16 Responsivitet | Side-/bundnavigation, paneler og safe area | T13/T14: seks CSS-bredder, ingen afklipning, fokus og handlinger kan nås | Afventer browser; fysisk keyboard særskilt |
| R17 Sprog og input | Danske labels, tid og tastatur | T14/T15: fokus, 24-timersvisning, tidszone og dato uden tid | Node-kontrakter verificeret; kandidat-CI afventer |
| R18 Aflevering | Testværktøjer, CI og disse dokumenter | T15: diff, screenshots, præcis kandidatidentitet og ærlige resultater | 930-test baseline registreret; endelig kandidat-CI afventer |

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
