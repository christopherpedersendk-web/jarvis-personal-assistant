# Overdragelse — Skills og multimodal Discord

Draft-PR: https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/18
Gren: `feature/v5.4-skills-discord`. Præcis kandidat er PR'ens aktuelle HEAD.
Sammenhold HEAD med CI og `evidence.json`; lokale rekonstruerede commit-ID'er er
ikke remote kandidat-ID'er. Pakken er stadig 5.3.0, schema 1/readableFrom 0.

## Leveret

- Skills er ét versionsbundet katalog under Indstillinger, med filtre, oprindelse,
  rettigheder, datadeling, blokeringer og redigerbare, uafsendte prøvekladder.
  OpenClaw-posterne er gennemgåede lokale metadata; ingen marketplace-installation.
- Samme Discord-bot kan liste/oprette/omdøbe/slette tekstkanaler og vælge en privat
  rapportkanal gennem bundne engangsreviews. Ukendte writes blokerer nye writes.
- Discord-stemme har webkontrol, varig stopgeneration og afbrydelse ved mute,
  anden deltager, afgang, decoderfejl og konfigurationsskift. Sen oprydning afventes
  med tidsgrænse. Lokal lukning beviser ikke providerafslutning.
- Separat, værktøjsfri billedanalyse og korte videoer med samme ejer, providerkontrol
  og journal. Isoleret JPEG/PNG/WebP-normalisering, MP4/WebM-frameudtræk og WAV.
  Videoresultater beskriver stikprøvedækningen; ingen automatisk hukommelse/madplan.

## Første ejerprøve

Brug separat testinstallation og godkendt Discord-testserver. Se de præcise flags,
limits, permissions og trin i [operations.md](operations.md).

1. Skills: filtrér Jarvis/OpenClaw; åbn detaljer; brug Tab/Enter på “Prøv skill”.
   Kontrollér uafsendt redigerbar kladde, bevaret eksisterende kladde og logout.
   Test fysisk iPhone, især navigation, inputfokus og bredde.
2. Kanaler: opret privat testkanal via review; omdøb; vælg som rapportkanal;
   prøv udløbet/dobbelt review. En separat disponibel kanal kan slettes efter
   konkret review. Beskyttede samtale-/rapportkanaler må afvises.
3. Stemme: start eksplicit med ejer alene; få dansk svar og researchkilder i tekst.
   Test stop under tilslutning og tale, mute, anden deltager, netværksbrud og restart.
   Ukendt providerafslutning skal forblive synlig.
4. Billeder: screenshot, kvittering, opskrift og produkt med et konkret spørgsmål.
   Test ulæselig/injectiontekst, ugyldig type og dublet. Intet må automatisk gemmes.
5. Video: korte MP4/WebM med/uden lyd; kontrollér tidsstempler, stikprøveforklaring,
   >60 sekunders afvisning, stop og ingen efterladte `jarvis-media-*`-containere.

## Åbne krav og aktivering

De konkrete kriterier står i [acceptregisteret](acceptance-register.md) og
[videreførte M1–M10](inherited-acceptance.md). Ingen hel milestone er lukket.

- Faktisk modelkvalitet: legitim modelcredential mangler. Baseline/hybrid 30-opgave-
  evalueringen er `not_run`, score=null; kræv 27/30 og alle kritiske sikkerhedsprøver.
  Brug den eksisterende vejledning i `docs/v5.3/operations.md`, samme dataset/model
  og isoleret state. Medier og rigtig lyd kræver særskilte kvalitetsprøver.
- Discord-live: godkendt testserver, botadgang, ejerens mikrofon og modeladgang mangler.
- Drift: faktisk backup/restore, fysisk iPhone, providerhangup, lokal systemd- og
  Docker-isolation på ejerhosten er ikke verificeret her.
- Afhængigheder: 34 moderate entries består i den fastlåste OpenClaw-runtime,
  0 high/critical. Følg upstreamrettelse af npm's bundtede glob/minimatch. Se review.

Skills-menuen kan testes uden nye eksterne rettigheder. Kanalstyring, stemme og
billeder/video aktiveres kun enkeltvis i test efter de relevante kontroller; de
forbliver OFF som standard. Der er ikke grundlag for at erklære nye capabilities
produktionsaccepteret. Ingen merge, release-tag eller deployment er udført.

## Tilbageførsel og næste udvikler

Deaktivér de nye flags, stop aktive opgaver og afklar ukendte udfald. Bevar journaler,
state og gamle skill-/jobrevisioner. Følg kendt v5.3.0-staging/rollback med verificeret
backup; versionsrollback genskaber ikke slettede Discord-kanaler eller beskeder.

Kontrollér PR-HEAD og alle seks workflows igen før næste ændring. Fortsæt de åbne
acceptprøver med legitimt konfigureret adgang. Ingen secrets i chat, ingen skjult
retry og ingen aktivering alene fordi syntetiske tests er grønne. Opdatér accept- og
evidensregister ved nye resultater. Først ved særskilt releaseinstruks synkroniseres
pakke-/lock-/tagversion og staginggrundlag, så tidligere versionsmismatch ikke gentages.
