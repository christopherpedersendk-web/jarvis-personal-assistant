# Fortsæt JARVIS / OpenJarvis: skills og multimodal Discord

Du er implementeringsansvarlig for JARVIS / OpenJarvis. Fortsæt den eksisterende
kode, færdiggør åbne acceptkriterier og implementér nedenstående udvidelser.
Dette er en instruks om at implementere, teste og levere kode. Stop ikke efter
analyse, en roadmap eller den første mindre rettelse.

## 1. Kontroller aktuelt grundlag først

Repository: https://github.com/christopherpedersendk-web/jarvis-personal-assistant
OpenClaw: https://github.com/openclaw/openclaw
Seneste kendte udviklings-PR: https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/17

v5.3.0 er forberedt som releasemål. Antag ikke, at merge, tag, deployment eller
aktivering er sket: verificér main, PR-status, åbne PR'er, taggets commit, faktisk
pakkeversion/skema, CI og ejerens seneste driftsbekræftelser. Tidligere kodekandidat
48acd3962d1ea5443cdfe7f2c6de351ce3e1331f havde 1.206 lokale tests og fem grønne
CI-workflows. Det er historisk evidens, ikke automatisk evidens for nyere kode.

Læs først:

- docs/v5.3/progress.md, acceptance-register.md, evidence.json,
  release-preparation-evidence.json, release-candidate.md og operations.md.
- docs/v5.2/acceptance-register.md, operations-and-acceptance.md og security-boundaries.md.
- Relevante v5.1-dokumenter, repositoryinstruktioner og den faktiske implementering.

Hvis PR #17 er merged, fortsæt fra opdateret main i en ny isoleret gren. Hvis den
fortsat er åben, vurder om arbejdet bør bygge på dens gren eller leveres separat,
så en igangværende releasekandidat ikke ændres uden tydelig adskillelse.
Bevar andre åbne PR'er og brugerdata.

Kontroller især disse eksisterende komponenter, før du bygger noget nyt:

- skills-registry.mjs, research-workflow.mjs, /api/skills,
  public/intelligence.js, gui-shell.js og job-policy.js. Der findes allerede et
  procedurekatalog under indstillinger/automatiseringer og præcis versionsvisning.
- openjarvis.mjs, openjarvis-transport.mjs, openclaw-runtime/, research-boundary.mjs,
  controlled-tool.mjs, ProviderControl og det fælles værktøjskatalog.
- discord-gateway.mjs, discord-channels.mjs, discord-voice.mjs,
  discord-audio.mjs og discord-voice-runtime/. Kanaler og stemme er allerede opt-in.
- recipe-fetch.mjs og recipe-memory.mjs. Discord-billeder findes allerede som
  afgrænset opskriftsindtag; det er ikke generel billed- eller videoforståelse.
- BrowserResearch/Workspace, isoleret browser, ActionJournal og TaskEngine.

Ejerens bekræftelse af fungerende Discord-tekst og rapportlevering står ved magt.
M1–M10 er ikke automatisk afsluttet ved release. Viderefør hvert åbent kriterium
med samme identitet, reel status og konkret næste handling.

## 2. Mandat og arkitektur

Du må læse, oprette en udviklingsgren/worktree, implementere, installere nødvendige
testafhængigheder, køre isolerede tests, committe, pushe og oprette/opdatere draft-PR.
Du må ikke automatisk merge, tagge, deploye eller aktivere nye produktionsfunktioner.
Bed aldrig om secrets i chatten. Brug kun legitimt konfigureret testadgang.

Jarvis ejer fortsat personlige data, madplan, opskrifter, lister, hukommelse,
rapportplanlægning, jobhistorik, godkendelser, handlingsjournal og Discord-botten.
Ingen konkurrerende bots, parallelle datalagre, ekstra schedulere eller nye identiteter.
Genbrug dokumenterede OpenClaw-kontrakter; kopiér ikke store interne moduler.
OpenClaw-token er ikke i sig selv read-only. Bevar gatewayens eksplicitte allowlist
og adskillelse af operatorcredential fra Jarvis' begrænsede researchcredential.

Smart Home afventer lokal netværksagent. Kalenderændringer, browserlogin,
formularafsendelse, køb og booking er fortsat udskudt.

## 3. Prioriteter

P1 = nødvendige forbedringer og sikkerhed; udfør først. P2 = næste udvidelse efter
dens afhængigheder. Fortsæt med uafhængige P1-opgaver, hvis en liveprøve er blokeret.
Manglende produktionsadgang må ikke stoppe implementering eller isolerede tests.

### P1 — Fortsæt M7–M10 og åbne M1–M6-kriterier

- Kontroller den aktuelle OpenClaw-version, plugin, lockfile, officielle API-kontrakter
  og dependency-audit. Historisk var 34 moderate fund åbne, 0 high/critical efter
  fastlåste patchoverrides. Undersøg hver relevant advisory, eksponering og rettelse;
  dokumentér resterende risiko. Ingen blind audit fix --force eller nedgradering.
- Afprøv den faktiske systemd-isolation og gatewaykontrakt i en godkendt testhost,
  hvis tilgængelig. Bevar mismatch-, stop-, auth-, timeout- og policytests.
- Verificér restaurant-, nyheds-, produkt- og opskriftsresearch samt rapportlevering
  gennem webchat og Discord. Bevar kilder/Maps, delvise resultater og tydelige fejl.
- M10: Kør samme mindst 30 danske opgaver mod baseline og hybrid med en rigtig model,
  samme dataset/model og dokumenteret kodegrundlag. Bedøm forståelse, tools, kilder,
  gemt resultat, svartid og tilgængeligt forbrug. Hybridkandidaten skal opnå mindst
  27/30 og bestå alle kritiske sikkerhedsprøver. Bevar også baselinefejl som evidens;
  en dårlig baseline må ikke skjules eller ommærkes som succes.
- Handler- og retrievaltests er ikke modelbedømmelse. Uden adgang: not_run, score=null.
  Fjern først redundant kode efter dokumenteret dækning og afprøvet tilbageførsel.
- Fysisk iPhone, faktisk backup/restore og providerhangup kræver egne prøver.
  Bevar historikken; markér konkrete adgangsblokeringer uden at lukke kriterierne.

### P1 — M11: Bedre skills og et samlet overblik i Jarvis-menuen

Formål: Jeg skal kunne se, hvad Jarvis kan, finde den rigtige funktion og forstå,
hvorfor en skill er klar, deaktiveret eller blokeret.

Lever:

- Et tydeligt menupunkt “Skills” i den eksisterende navigation, kompakt på iPhone
  og brugbart på desktop. Genbrug eksisterende katalog/UI og undgå et parallelt katalog.
- Søgning og filtre efter kategori, status og kilde (Jarvis/OpenClaw). Vis navn,
  dansk formål, eksempler, version, oprindelse, sidste test og tilgængelige kanaler.
- Detaljevisning af input/output, data der forlader Jarvis, rettigheder,
  afhængigheder, kendte grænser, forbrugsmåling og årsag til blokering.
  Skeln mellem installeret, konfigureret, testet og faktisk aktiveret.
- Integrér gennemgåede OpenClaw-capabilities via en dokumenteret, versionsbundet
  metadata-kontrakt eller et lokalt gennemgået manifest. Udvid ikke gatewayens
  administrations-/filadgang for at hente kataloget. Ingen automatisk marketplace-installation.
- “Prøv skill” åbner en synlig, redigerbar kladde i chatten; klik må ikke sende,
  installere, godkende eller udføre en handling uden det relevante brugertrin.
- Bedre dansk skillvalg med afklaring ved tvetydighed og samme adfærd i web/Discord.
  Brug ikke alene keyword-tests som bevis for modellens forståelse.
- Versionerede ændringer må ikke ændre tidligere godkendte jobs eller deres hashbinding.
  Serveren validerer aktivering/rettigheder; UI eller skilltekst kan ikke give adgang.

Accept: Ét katalog, ingen dubletter af samme version, korrekt status ved gatewaynedbrud,
ingen falsk “testet”-markering, keyboard-/skærmlæseradgang, mobilvisning uden vandret
overløb og uændret binding af eksisterende rapportjobs. Test stale reviews og logout.

### P1 — M12: Discord-kanaler og daglig betjening

Udbyg eksisterende DiscordChannels og den eksisterende bot:

- Bevar eksplicit opret/slet/status/review. Gør kanaloversigt, oprettelse, omdøbning
  og valg af rapportkanal til tydelige brugerforløb. Understøt naturlige danske
  anmodninger og entydige kommandoer; genbrug samme serverhandler og journal.
- En generel model eller et website må ikke ændre kanalrettigheder eller vælge
  vilkårlige guilds/brugere. Tilladte servere og ejer fastsættes på serveren.
- Opret som udgangspunkt private kanaler med eksplicit adgang. Kræv mindst mulige
  Discord-permissions; ikke Administrator som genvej.
- Bind review til ejer, guild, kanal, handling, parametre, revision, credential-
  konfiguration, stopgeneration og udløb. Sletning kræver konkret engangsreview.
  Beskyt aktiv samtale-, rapport- og stemmekanal mod utilsigtet sletning.
- Vis ventende/udført/ukendt udfald. Håndtér rate limits uden dobbelt oprettelse
  eller skjult retry efter et muligt udført POST. Et kanalnavn er ikke en idempotensnøgle.

Accept: Samme anmodning/review kan højst udføre én ændring. Forkert ejer/guild,
ændrede parametre, udløbet review og stop afvises før mutation. Test providerfejl,
leveringsdubletter og netværksbrud. Liveprøve kun i en særskilt godkendt testserver.

### P1 — Færdiggør M5: Discord-stemme

- Genbrug eksisterende join/leave/stop og lydruntime. Ingen ekstra bot.
- Tydelig start/stop/status i Discord og Jarvis, synlig lyttestatus før optagelse,
  eksplicit valgt kanal og kun den autoriserede ejer som lydkilde.
- Test anden deltagers ankomst, ejerens afgang, gatewaybrud, mute, decoderfejl,
  udbyderfejl, sessiontimeout, globalt stop og genstart. Ingen automatisk genoptagelse.
- Tale skal kunne bruge samme research/skills og levere tekstsvar med kilder/Maps.
  Efter research må modellen ikke selv ophæve den eksisterende mutationsspærre.
  Gør behovet for en ny konkret anmodning/session forståeligt; ingen sikkerhedsgenvej.
- Verificér lydkontrakter og versionsfastlås runtime. Mål svartid, requestantal,
  faktisk tilgængelig lydtid/tokens og ukendt forbrug hver for sig.

Accept: Rigtig forståelig dansk lyd i godkendt testkanal, tekstlige kilder, fungerende
stop og grænser samt ingen behandling af andre deltagere som autoriserede brugere.
Ubekræftet providerafslutning er unknown, ikke succes. Uden adgang færdiggøres
uafhængige tests; liveaccept forbliver blokeret. Produktion forbliver opt-in.

### P1 — M13: Modtag og forstå billeder via Discord

- Udvid eksisterende attachment-indtag, så ejerens billede med et spørgsmål kan
  analyseres som almindelig samtale: beskriv, læs tekst, forklar screenshot, undersøg
  et produkt eller foreslå en opskrift. Uden opgave: spørg hvad jeg ønsker undersøgt.
- Almindelige billeder må ikke automatisk blive opskrifter, hukommelse eller madplan.
  Gemning sker kun via Jarvis' normale validering, review og revisionskontrol.
- Kontroller afsender/guild/kanal før download eller modelkald. Accepter kun
  godkendte Discord-attachmentkilder; kontroller destination ved hvert redirect,
  signerede URL'er, MIME, magic bytes, filstørrelse og dekodede billeddimensioner.
  Ingen bearer-token til CDN eller vilkårlige URL'er; redigér signed URLs ud af logs.
- Start med JPEG/PNG/WebP, højst 2 billeder pr. besked, 10 MiB pr. fil og 20 megapixel
  dekodet. Andre formater får en brugbar fejl. Ændringer af disse appgrænser skal
  begrundes og testes; de er ikke påstande om Discords egne maksimumgrænser.
- Kør dekodning/normalisering begrænset og isoleret. Fjern metadata før ekstern
  behandling, hvor det ikke ødelægger opgaven. Midlertidige filer har privat adgang,
  defineret kort levetid og oprydning også ved timeout/stop/crash.
- Billedtekst, QR-koder og OCR er ubetroede data. De kan ikke ændre systemprompt,
  kalde værktøjer eller godkende handlinger. Adskil medieanalyse fra mutationer.

Accept: Screenshot, kvittering, opskrift og produktbillede kan analyseres med tydelig
usikkerhed ved ulæseligt indhold. Test mindst 10 kontrollerede cases, herunder forkert
MIME, beskadiget fil, for stor fil/dimension, credentialtekst, injection og dubletlevering.
En allerede journalført medieopgave må ikke udløse et ekstra modelkald ved
dubletlevering; ukendt kald-/betalingsudfald genforsøges ikke automatisk. Rigtig modeltest rapporteres særskilt fra fixtures.

### P2 — M14: Modtag og behandle korte videoer via Discord

Byg på M13 og samme ejerskab, journal, dataadgang, stop og oprydning:

- Første leverance: uploadet MP4/WebM, én video pr. besked, højst 30 MiB og 60 sekunder.
  Ingen automatisk download af vilkårlige videolinks eller livestreams.
- Valider container/codecs og faktisk varighed. Dekodning, frameudtræk og eventuel
  lydtransskription skal køre i en begrænset proces/container uden netværk, secrets,
  hostfiler eller brugerbestemte shellargumenter. Fastlås og gennemgå decoder/runtime.
- Udtræk højst 12 tidsmarkerede frames og en begrænset lydtransskription. Brug kun
  direkte videoinput, hvis den valgte udbyder har en dokumenteret, testet kontrakt.
- Giv kort opsummering, relevante tidsstempler, tydelig dækning og usikkerhed.
  Angiv præcist om svaret bygger på udvalgte frames, lyd eller faktisk videoinput.
  Påstå ikke at hele videoen er set, når kun stikprøver er analyseret.
- Vis modtaget, validerer, analyserer, færdig/delvis/stoppet/fejl. Stop skal også
  afslutte dekodning og forhindre næste providertrin. Ingen autoplay eller gemning
  til hukommelse. Bevar kun nødvendige metadata efter filoprydning.

Accept: Mindst fem kontrollerede videoopgaver, plus afvisninger af overskridelser,
malformed container, decoderhang, ingen lyd, utydeligt indhold, injection og dubletter.
Ingen ukontrollerede childprocesser eller resterende mediefiler. Dokumentér faktisk
modelkvalitet og forbrug; uden adgang må der ikke opfindes en succesrate.

## 4. Fælles sikkerhed og UX

- Samme ejer, værktøjspolitik og handlingsjournal på tværs af chat, Discord og stemme.
- Web-, skill-, OCR-, lyd- og videoindhold er data, aldrig rettigheder. Serveren styrer
  backend, værktøj, origin, datadeling, ressourcegrænser og godkendelser.
- Ukendte udfald må ikke automatisk genkøres. Stop overlever genstart; tidligere
  handlinger/sessioner genoptages ikke. Begræns loops, kølængde, samtidighed og forbrug.
- Skeln mellem requests, tokens, lyd-/videotid, estimater og ukendt forbrug. Kald ikke
  disse grænser en samlet økonomisk budgetgrænse. Log ikke credentials eller rå private medier.
- Nye capabilities er OFF som standard indtil særskilt test-/produktionsaccept.
- Genbrug eksisterende komponenter. Hold mobil-UI kompakt, og giv danske fejl med
  næste konkrete skridt. En lokal fejl må ikke udløse fallback til flere rettigheder.

## 5. Verifikation og aflevering

Vedligehold acceptregister med ID, kriterium, status, filer, commit, testresultat,
begrænsning og næste handling. Status: ikke startet, under implementering,
implementeret men ikke verificeret, verificeret eller blokeret.

Skriv meningsfulde regressionstests. Brug aktuelle officielle dokumenter for
Discord, OpenClaw og medie-/modeludbydere. Installer et tilgængeligt testmiljø før
du erklærer lokale prøver blokerede. Sænk ikke test- eller sikkerhedskrav for at få grønt.
Kør relevante browserprøver for Skills-menuen og bevar screenshots/CI-artefakter.
En hel milestone er ikke færdig på baggrund af én delrettelse.

Arbejd selvstændigt, giv korte opdateringer, og fortsæt til næste uafhængige opgave,
hvis en liveprøve mangler adgang. Stop først, når arbejdet er færdigt, eller alle
resterende opgaver har konkrete adgangs-/tekniske blokeringer eller kræver en ejerbeslutning.

Aflever samlet kandidat med:

1. Implementeret og verificeret adfærd, adskilt fra kun beskrevne funktioner.
2. Åbne M1–M14-kriterier og konkrete blokeringer, uden at nulstille historikken.
3. PR-link, præcis kandidat-SHA og nye test-/CI-resultater.
4. Kort ejerprøve for Skills-menu, kanaler, stemme, billeder og video.
5. Rollback, flags og anbefaling om hvad der kan aktiveres i test/produktion.
6. En præcis overdragelse. Påstå ikke at arbejde fortsætter i baggrunden uden en faktisk opgave.

Begynd med remote-status og acceptregisteret. Implementér derefter de højst
prioriterede åbne kriterier og M11–M13/M5; fortsæt med M14, når dens afhængigheder er klar.
