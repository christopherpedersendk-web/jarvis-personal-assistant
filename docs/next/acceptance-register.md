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

Historisk buildblokering: FFmpeg-download fejlede i runs 42359891574 og 42360165335. Løst i 7dfed08a5833982f16422b897d3d13e8077eaa8f: run 42364914792 bestod officiel signatur/checksum, build og faktisk decodercontainment/stop/cleanup. Ejerhost og modelaccept er stadig åbne.

## Samlet M1–M18-status, opfølgning 2026-11-07

Grundlag: b648b9808f23593bf3d159e438e399aa760eb46a. De seks beståede runs og 1.282 tests er registreret i evidence.json. Medie-workflow 42360165335 fejlede ved download før build. Efterfølgende ændring er alene CI-download/cache og dokumentation; CI-medieaccept er nu bestået på 7dfed08a i run 42364914792; ejerhost/modelaccept er fortsat åben. Ingen hel milestone lukkes.

| Milestone | Implementeret / præcis evidens | Manglende accept og næste handling |
|---|---|---|
| M1 Drift/restore/mobil | Backup-/restore- og UI-kode; unit/GUI run 42360165298 | Faktisk installationsbackup, restore og fysisk iPhone |
| M2 Stop/forbrug | Durable stop, leases og reservationer; unit run 42360165298 | Rigtig providerhangup, faktisk forbrug; ukendt er ikke nul |
| M3 Research/browser | Fælles handlers, kilder og Maps; runs 42360165228 og 42360165371 | Ejerhost/systemd og modelstyret ende-til-ende research |
| M4 Én madplan | Fælles revisions-/dedupe-kontrol; unit/GUI run 42360165298 | Ejer ændrer samme plan i web og Discord |
| M5 Discord voice | Runtime/policy run 42360165334 | Rigtig lyd ind/ud, ejerafgang og stop i testguild |
| M6 Dansk opgaveforståelse | 30-opgave-evaluator findes | Reel baseline/hybrid-kørsel, menneskelig bedømmelse, mindst 27/30 og alle kritiske |
| M7 OpenClaw runtime | Pinned kontrakt run 42360165228 | Målhostaccept; historiske 34 moderate fund er ikke ny audit |
| M8 Research på tværs af kanaler | Fælles research-handler og kilder | Model/Discord-testadgang; behold kendt fungerende rapportlevering |
| M9 Researchprocedurer | Fire profiler og versionskontrol | Faktisk modelkvalitet på hver profil |
| M10 Hybridmåling | Fælles datasæt og sammenligningsscript | Samme model/kode/datasæt; kvalitet, tid og målt forbrug; score og besparelse ukendt |
| M11 Skills | Katalog, filtre, kladder og versioner; GUI run 42360165298 | Fysisk mobil og reelt modelbaseret skillvalg |
| M12 Discord-kanaler | Kontrol og diagnoser; unit run 42360165298 | Testguild med Manage Channels, konkrete engangsreviews |
| M13 Billeder | Intake/isolationskode | Signaturverificeret build/containment bestået i run 42364914792 på 7dfed08a; model/ejerhost mangler |
| M14 Video | Begrænset decoding, stop og delvise resultater | Decoder/stop/cleanup bestået i run 42364914792 på 7dfed08a; faktisk video-/lydforståelse og ejerhost mangler |
| M15 Stamdata | Private revisioner, review, UI; run 42360165298 | Live DM, privat backup og sletning på installationen |
| M16 Handel | Ordregrundlag/manual handoff; native kontrakt run 42360165207 | Faktisk Chrome-egress, derefter særskilt login/kurv/checkout-kontrakt; ingen køb |
| M17 Madplan/Nemlig | Historik, variation, navneaggregation; unit run 42360165298 | Egne opskrifter, kildebevarelse og faktisk Nemlig-læsning |
| M18 Selvudvikling | Docker-reparation og kontrakter run 42360165207 (model/GitHub simuleret) | Rigtig testmodel/draft-PR; uafhængigt security-check og beskyttet main før agentgodkendelse |

Adgang kontrolleret i arbejdsmiljøet: Docker og Tailscale findes ikke; SSH_AUTH_SOCK, OPENAI_API_KEY og begrænset gateway-URL/token er ikke konfigureret. GitHub viser main uden branch protection; rulesets-read returnerer 403 med krav om Pro eller public repository. Ingen beskyttelse er ændret. Dette blokerer M18-agentgodkendelse, ikke en særskilt ejerautoriseret manuel merge efter relevante checks.

Se [næste reviewbare pakke](next-package.md) for rækkefølge, reproducerbare evalueringskommandoer og særskilte acceptkriterier.

## Afsluttende CI-evidens

Alle syv workflows er bestået på 7dfed08a5833982f16422b897d3d13e8077eaa8f, inklusive 1.282 unit-tests uden fejl/skips og mediecontainment. Runs: 42364914938, 42364914886, 42364914951, 42364914846, 42364914875, 42364914792, 42364914842. Det afsluttende evidenscommit ændrer kun docs/next og anvender [skip ci]; applikations- og workflowindhold er identisk med den testede kandidat. Merge-SHA findes i PR #19. Dette afslutter CI-blokeringen, ikke de åbne live-/målhostkriterier.

## Afgrænset diagnostik-PR efter #19

Se [leverance og faktisk udførte kontroller](diagnostics-delivery.md). M3/M7 får secretsikker diagnostik; M6/M10 får separat setup-/HTTP-tid og bevaret forbrugsgrundlag. 11 fokuserede lokale tests bestået, uden Docker/modeladgang. Alle øvrige M1–M18-kriterier videreføres; utilgængelige liveprøver er ikke planlagte opgaver i denne PR. Gamle næste-handling-kolonner er historiske acceptkrav, ikke en påstand om tilgængelig adgang.

## Reviewbare kladder — opfølgning 2026-11-07

Kodekandidat: `1ecdb7031369e0202b7ca729a3da2176aa556a5d`, direkte fra main `1249eba457ec866da00f3005e6a79b8d1aa8973f`. PR #20 på `54a54fb0272736896f1e106df55b9724cda2a530` er separat og ikke kopieret. Version/schema: 5.4.0 / 1, readableFrom 0. Historiske resultater ovenfor gælder fortsat alene deres anførte revisioner.

| Eksisterende kriterium | Ny implementering og faktisk evidens | Åben begrænsning |
|---|---|---|
| M16.1 ordregrundlag | Redigér/annullér med revision; nyt hash/review ved ændringer; gamle reviews og afsluttede kladder afvises. 10 commerce-tests omfatter disse lokale kontroller og browserkontrakter. | Formularer syntakskontrolleret, ikke ny browser-/ejeraccept; særskilt faktureringsvalg og produktsammenligning ikke udvidet. |
| M16.3 produktlæsning | Returnerer faktisk observeret URL, requestedUrl, tidspunkt og snapshot-hash. URL kontrolleres før/efter snapshot; skift/cleanupfejl returnerer ikke et godkendt resultat. Simuleret transport, ingen Chrome. | Ingen ny netværkscontainment eller live merchantaccept. Tekst er stadig utroværdige data. |
| M18.1 udviklingspipeline | Lokale udviklingskladder med ønske, fil, version og acceptkriterier; revision/annullering og eksplicit start. Før/efter-kode og base-SHA bevares også ved utilgængelig isolation. 14 fokuserede tests med simuleret model/sandbox/GitHub. | Ingen ny eksekveringsrettighed; Dockerkravet for genereret kode er bevaret. |
| M16.1 / M18.1 API | 2 tests af det faktiske routeudsnits argumentbinding og konfliktstatus. Eksisterende autentifikationsgrænse inspiceret og uændret. | Dette er routekontrakter, ikke fuld HTTP-/sikkerheds- eller GUI-accept. |
| M1–M15 samt M17 | Betydning og eksisterende evidens uændret. Ingen nye ændringer i scheduler, hukommelse, madplan, Nemlig, Discord eller evalueringsdatasæt. | Tidligere manglende ejeraccept er fortsat åben, ikke planlagte kørsler i denne pakke. |
| M16.2/M16.4/M16.5 og M18.2–M18.5 | Historisk status videreført; ingen nye livepåstande. | Login/session/kurv/checkout, betaling og rigtig JARVIS-produceret PR er ikke verificeret af denne leverance. |

26 unikke fokuserede tests bestået, nul fejl/skips. Filhashes og de enkelte kørsler står i evidence.json under reviewableDrafts. Intet helt milestone lukkes. UI viser kun manuel betalingsoverdragelse; MobilePay/PayPal præsenteres ikke som implementerede betalingsflows.

De tidligere målhost- og ejerprøver ovenfor er udestående acceptkrav, ikke denne PR's arbejdsplan. Den aktuelle afgrænsning og de resterende konkrete produktmangler er i next-package.md.

## Staging-sammenlægning

Ejer har efter udviklingsleverancen autoriseret merge og staging-release. PR #9, #20 og #21 er merget; versionen klargøres som 5.5.0, schema 1/readableFrom 0. De tidligere formuleringer om ingen merge/release beskriver det oprindelige udviklingsmandat. Ingen nye hele milestones lukkes. Se [samlet staging-evidens og begrænsninger](../releases/v5.5.0-staging.md). Ingen deployment eller produktionsaktivering.

## Discord-ejerfund 2026-11-07 — M12/M16

Ejerens screenshots viser et generisk afslag på “Kan du oprette en kanal på discord?” og en rå Markdown-tabel ved produktsammenligning. Livebotversionen kan ikke udledes af billedet. Koden på main 14292e2 havde en reproducerbar routingmangel: kanalforespørgsler uden navn faldt gennem til modellen.

M12: forespørgslen går nu til eksisterende kanalcontroller. Ved gyldig opsætning spørges der efter navn, uden API-kald eller oprettelse. Ved manglende aktivering/Server ID gives konkret konfigurationsdiagnose. Controllerens faste fejl vises direkte; uventede fejl går stadig til eksisterende sikker fejlbehandling. Ejer/server/review/stop/engangsforbrug er bevaret. Dette er lokalt verificeret, ikke faktisk kanaloprettelse i ejerens guild.

M16/præsentation: Discord-levering omskriver Markdown-tabeller til poster med feltnavne og bevarede links, beløb og leveringsoplysninger. Redaction, længdegrænse og mention-suppression bevares. Ingen ny påstand om korrekt livepris eller lager.

19 fokuserede tests bestået, nul fejl/skips; server syntakskontrolleret. Tests bruger simuleret Discord-transport og sendte ingen beskeder. Præcise kodehashes i evidence.json. Ingen hel milestone lukkes.

Kurv/checkout-afslaget på billedet afspejler en reel åben M16.4-funktion, som denne routing-/formateringsrettelse ikke implementerer. Målhostens version/flag/rettigheder er stadig uverificeret. Ret kode før separat installationsbeslutning; ingen deployment eller ny release i denne opfølgning.

## M13/M17 — vedhæftet opskriftsbillede uden tekst

Yderligere ejerscreenshot viser “Generel medieanalyse er deaktiveret”. Det er en featuretilstand, ikke bevis for decoderfejl. Svaret er ændret til konkret vejledning: vedhæft billedet igen med “Gem opskrift:” i samme besked (PNG/JPEG/WebP, højst 2 MB) for det eksisterende separate opskriftsindtag. Automatisk udtræk loves ikke; kladden kræver gennemgang. En efterfølgende løs tekstbesked genbruger ikke en tidligere vedhæftning.

Ingen medieflag er aktiveret, og ingen automatisk indholdsklassifikation eller gemning er tilføjet. To nye lokale tests bekræfter vejledning uden hentning/dekodning/model/lagring og bevaret ejer-/stopkontrol. Tidligere 19 PR-tests er ikke genkørt. Ingen liveaccept eller deployment; M13/M17 er fortsat åbne.
