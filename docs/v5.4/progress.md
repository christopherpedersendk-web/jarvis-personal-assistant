# Skills og multimodal Discord — udviklingskandidat

Grundlag kontrolleret 2026-11-06: PR #17 er merged; main, tag og release v5.3.0
peger på `ebbb316e5617705a7e9f323881b937858565b2af`. Træet er
`72baf31d43e270b0c108bc3955bd387d599c200e`, pakken 5.3.0, schema 1/readableFrom 0.
Denne gren er `feature/v5.4-skills-discord`; pakken er endnu ikke en ny release.
PR #9 og den eksisterende drift er ikke ændret. Tidligere testtal er historiske.

Implementeret: ét Skills-katalog med særskilt menu, søgning/filtre, gennemgåede
OpenClaw-metadata og redigerbare, uafsendte prøvekladder. Eksisterende jobversioner
og hashes bevares. Modelinstruktionen har et fælles dansk formålskatalog og kræver
afklaring ved afgørende tvetydighed; det er ikke dokumenteret modelkvalitet.

Discord-kanaler har liste, private oprettelser, omdøbning, rapportkanalvalg og
sletning med engangsreview. Konfigurationens revision indgår i reviewbindingen.
Discord-stemme har webbetjening, kanalvalidering, mute-/decoderstop og eksplicit
ukendt providerafslutning. Stop/status kan passere en optaget beskedkø.

Generel billedanalyse og korte videoer følger et separat, værktøjsfrit forløb.
De bruger samme ejer, bot, DurableState og providerkontrol, men ingen samtalehistorik
eller hukommelse. CDN, filtype, størrelse og decoderresultat kontrolleres. En
kortlivet container uden netværk normaliserer billeder og udtrækker tidsmarkerede
videoframes/lyd. Nye funktioner er OFF som standard.

Se acceptregister, operations.md og security-review.md. Den fulde suite og CI skal
være grøn på den præcise kandidat. Lokale syntetiske tests, rigtig decoder i CI,
modelkvalitet og prøver på ejerens installation er forskellige evidenstyper.

Åbne M1–M10-kriterier videreføres i inherited-acceptance.md med originale IDs.
Ingen hel milestone er afsluttet. Manglende modeladgang, Discord-testserver/-lyd,
faktisk backup, fysisk iPhone og målhostens systemd-isolation er konkrete blokeringer.
Ingen merge, tag, deployment eller produktionsaktivering er udført.

CI på første kandidat 5cfb3637d71b3b248ef12467e5df2f322dc94baa:
OpenClaw research bestod med fem kilder, forkert credential 401 og fem forbudte
tools 404. Browserisolation, stemmeruntime og eksisterende GUI-forløb bestod.
Nye medie-/Skills-tests fandt manglende billeddemuxere og en forkert testtekst;
rettelserne får en ny kandidat. Yderligere review rettede stop under forsinket
Discord-webtilslutning, med varig generation og UI-regression.

Anden kodekandidat 42fde6da33ce713f2896d1d0b7b1d6baa6136759 bestod den rigtige
Docker-medieprøve: JPEG/PNG/WebP, fem korte MP4/WebM-forløb, WAV, malformed/for lang
video, isolation, afbrydelse og ingen efterladte containere. OpenClaw gav igen fem
kilder. En efterfølgende regression sikrer, at asynkron oprydningsfejl fra en
forsinket stemmetilslutning afventes og ikke bliver en ubehandlet procesfejl.
Den samlede lokale suite efter denne rettelse: 1.248 bestået, 0 fejl, 0 sprunget over.

Anden Skills-browserprøve bestod filtre og kladdebeskyttelse på Chromium 320 px,
men testens logout-trin manglede navigation til “Denne enhed”. Det er rettet uden
at springe logoutkontrollen over. Historiske versioner kan nu filtreres og kaldes
ikke fejlagtigt klar til en ny kladde. Hashdetaljer er bevaret i fold-ud-visningen.
En særskilt CI-prøve venter på en bekræftet startet, syntetisk fastlåst worker før
stop; den må ikke forveksles med timingbaseret afbrydelse under Docker-opstart.

Den nye historikfilterprøve fangede en API-fejl: resolve() returnerede rå procedure
uden katalogets current-flag. HTTP-regression reproducerede 0 historiske statusser
i stedet for 4; serveren videresender nu current fra samme katalog. Den fulde lokale
suite består fortsat med 1.248 tests. Browserprøven gentages på rettelsens kandidat.
