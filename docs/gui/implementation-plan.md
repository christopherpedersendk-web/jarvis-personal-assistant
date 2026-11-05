# JARVIS GUI redesign – implementeringsplan

## Mandat og udgangspunkt

Dette arbejde implementerer den godkendte GUI-specifikation (R01–R18 og T01–T15) på den eksisterende v5-kodebase. Her betegner **GUI-Rxx/GUI-Txx** specifikationens ID'er; de er ikke de historiske Rxx-ID'er i `docs/v5/`.

- Isoleret branch: `feature/gui-redesign`.
- Publiceringsbasis: remote `118f932dc53574b9de454f300ee7200f22eeeeaa`, træ `3a4620b59b3d4c1164119de88eed46da9d45593a`, identisk med lokal `cda86ce87724544782d71f93d846f57b151e8134`. De sidste to upstream-ændringer til 320 px indstillinger og Hjem-reflowtest er også bevaret.
- Efter første publicering er upstreams `e33cb15d3799ff2f2d5999d83e4910d055646568` (lokal `3aa734a40ec77e85ad7a1acaaff74fc55f0f2ef3`, træ `da0adc59d281f4df857165ea3e5ec1106a83a690`) også sammenholdt. Dens ekstra native formvaliderings- og manglende HTTP-diagnostik er bevaret i den dybe browserrunner. PR #8 har fortsat `feature/v5-foundation` som base; den eksisterende PR #7/releaseplan er ikke ændret.
- Oprindelig lokal basiscommit: `70eaf81ba64b20613b7cd073c265cced5418c3fa`.
- Oprindeligt basistræ: `b153cf9dde2c51ffc6e3be7fdcf66db541bb7189`.
- Træet er ved arbejdets start sammenholdt med `feature/v5-foundation`, remote `2f94679d` (den fulde remote-identitet registreres ved publicering).
- Oprindelig ren basis, udpakket med `git archive`: **674/674 tests bestået**, Node 24.22.1, ingen fejl eller skips.
- Under arbejdet blev fem nye v5-commits bevaret via lokal upstream `186e851932a3b69a230349d78ef2e181d40a4e2a`, træ `30c7b35e0503875e45dece029798d7b59981d2a1`, svarende til remote `9a04659e`. Den nye rene `git archive`-baseline består **930/930 tests**. GUI-WIP blev gemt før integrationen; nye Today-, updater-, shopping-, kilde- og browsergarantier er bevaret. Se [verification.md](verification.md).

Eksisterende objekter, rettigheder, revisionsværn, kladder og API'er bevares. Arbejdet omfatter ikke en ny agentmotor, nye integrationer, nye godkendelsesrettigheder, release eller produktionsdeployment. Syntetiske screenshots er layoutreference, ikke produktionsdata.

Den konkrete kortlægning af formularer, objekter, API’er, rettigheder og kladders livscyklus står i [data-and-capabilities.md](data-and-capabilities.md).

## GUI1 – kortlægning

Kortlæg eksisterende DOM-ID'er, datatyper, formularer, kilde-ID'er og URL'er før flytning. Der findes allerede revisioner og konflikthåndtering for noter, hukommelse, personlige opgaver, baggrundsjobs, projekter og flere indstillingsfelter. Disse flows skal genbruges. Kalenderen bevarer den dokumenterede læseadgang; integrationskatalogets status er ikke bevis for en fungerende ekstern forbindelse.

Den eksisterende samtale har én global historik og et `message`-payload. GUI-kontekst skal derfor være synlig og eksplicit i den eksisterende anmodning; der opfindes ikke et nyt serverbaseret samtale-ID eller en ny kontekst-API.

## GUI2 – navigation og fælles layout

Fire primære destinationer: I dag, Planlægning, Hjem og Overvågninger. Indstillinger er en fast sekundær indgang. Søgning og samtale er tilgængelige globalt. Samme eksisterende formular og composer flyttes mellem værter; ingen dubletter af IDs eller uafhængige kopier af kladder.

| Gammel indgang / kilde | Ny destination |
|---|---|
| `home` | `?view=home` |
| `plan`, `personal-task:*`, `follow-up:*` | `?view=plan&section=tasks&kind=personal` |
| `tasks`, `task:*` | `?view=plan&section=tasks&kind=agent`; monitor-kilder omdirigeres til `watches` efter læsning af det originale job |
| `meals`, `meal-*`, `household*`, `recipe`, `shopping-draft`, `nemlig-proposal` | `?view=plan&section=meals` |
| `organizer`, kilde `organizer:*` | `?view=plan&section=notes` |
| `projects`, kilde `project:*` | `?view=plan&section=tasks&kind=projects` |
| `memory:*`, `claim:*` | `?view=settings&section=profile` |
| `skill:*` | `?view=settings&section=automations` |
| `knowledge` uden konkret kilde | `?view=home&panel=search` |
| `smart-home` | `?view=smart-home` |
| `system` | `?view=settings&section=system` |
| `calendar`, `google-calendar:*` | `?view=plan&section=calendar`; kalenderkilden bevarer præcis kalender/event/dato/fetchedAt |
| `secretary` | `?view=home&attention=1`; den eksisterende opmærksomhedssektion åbnes |

Kilde-ID'et bevares som `source`. `panel=search` eller `panel=chat` kan ligge oven på den aktuelle destination, også med en præcis kilde. Tilbage/frem og genindlæsning skal genskabe relevant destination og søgekontekst. Gamle links er kompatibilitetsindgange, ikke ekstra hovedfaner.

## GUI3 – skærme og tilstande

- I dag: kompakt samtale, relevant dagligt indhold og handlinger, som kræver opmærksomhed. Upstreams `TodayOverview` og stabile kildekort genbruges; normale nul-tællere og teknisk drift ligger i en sekundær sektion.
- Planlægning: Opgaver, Kalender, Madplan samt Noter og lister. Personlige opgaver, agentarbejde og kodeprojekter beholder særskilte detaljer.
- Overvågninger: eksisterende `category=monitor`-jobs med eksisterende politik, observationer og revisionsbundne handlinger. Der tilføjes ikke fiktive målprisfelter eller en ny prismotor.
- Indstillinger: seks kategorier, reelle kapabiliteter og særskilt system/deploymentstatus. En gemt indstilling giver ikke automatisk godkendelse af en opdatering. Den eksisterende durable updater bevares; GUI-godkendelsen bindes til konkret version, SHA og testtid inde i dens serialiserede commit.
- Kladder og fejl: ingen skjult overskrivning; gemt kræver faktisk bekræftelse. Seneste forsøg, seneste succes og gammel kendt værdi holdes adskilt.

## GUI4 – verifikation og aflevering

1. Kør den uændrede Node-suite på en separat basis og den fulde suite på kandidaten. Registrér nye fejl særskilt fra allerede eksisterende v5-forhold.
2. Tilpas den eksisterende dybe v5-browserregression til de nye destinationer. Bevar dens assertions om identitet, konflikt, rå kladder, rettigheder og fravær af utilsigtede writes.
3. Kør en separat GUI-browsermatrix med det samme dokumenterede fixturesæt: Chromium og WebKit, bredder 320/366/390/768/1024/1440 CSS-px og normal/tom/fejl. Kontrollér relevante flows og målte kontraster.
4. Bind browserresultater til den faktisk udcheckede commit, Git-træet, browserversionerne og hashes af offentlige assets og testfixture. Optag screenshots og traces også ved fejl.
5. Aflever reviewbar diff, opdateret [kravmatrix](requirements-matrix.md), faktiske testresultater og tydelige begrænsninger. Lokale DOM-dobler er ikke browserbevis. Et reduceret CSS-viewport er ikke et fysisk mobilkeyboard.

Den lokale browserstarter er kendt blokeret af IPC/socket-begrænsninger. Den startes ikke gentagne gange eller via eskalation. Den nye `gui-redesign.yml` kører kandidatspecifik browserverifikation på GitHub uden produktionshandlinger; Node- og browserjob er adskilt, så en uafhængig v5-testfejl ikke skjuler GUI-evidens.
