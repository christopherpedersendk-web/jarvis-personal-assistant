# Verifikation af v5.1.0-arbejdet

## Fortsættelse: stop under journalføring

`controlled-tool.mjs` fastholder anmodningens stopgeneration og kontrollerer
den igen umiddelbart før handleren, efter den asynkrone journalføring. Stop og
efterfølgende genoptagelse kan dermed ikke genautorisere et gammelt kald.
Seks nye prøver bruger den faktiske DurableState, ActionJournal og ProviderControl
på tværs af tekst, Discord og stemme. Blokerede kald registreres som ingen
handling udført og genafspilles ikke. Dette lukker ét konkret hul i N2.4;
ældre direkte stemmeruter og aktive Realtime-sessioner er fortsat åbne krav.

Fuld lokal regression: 1.101/1.101 tests bestået. Remote CI for denne nye
ændring skal vurderes særskilt fra de tidligere grønne commits nedenfor.

## Baseline og afgrænsning

6. november 2026, Node 24.22.1. Baseline: 1.018/1.018 Node-tests bestået.
Kørsler er isolerede med syntetiske data. Ingen produktionscredentials indlæst,
ingen køb, kalenderændring eller ekstern besked udført. Miljøet har ingen
OPENAI_API_KEY eller OPENAI_TEXT_MODEL; ingen live modelprøve er udført.

## Reproducerbare kommandoer

Fra `jarvis-starter`:

```sh
node --test
node scripts/v51-control-smoke.mjs
```

Browserprøven kræver installeret Playwright/Chromium. Den registrerer sin faktiske
version; lokal 1.62.1 erstatter ikke projektets eksisterende 1.64.1-CI-gate.

Offline formatmanifest (ingen modelanmodning):

```sh
OPENAI_TEXT_MODEL=den-konfigurerede-model node scripts/provider-contract-probe.mjs
```

Live formatprøve skal køres i et godkendt testmiljø med den faktisk konfigurerede
model/API-nøgle i miljøet, aldrig med en nøgle i argumenter eller chat:

```sh
node --env-file=.env scripts/provider-contract-probe.mjs --live
```

Prøven sender ét syntetisk Responses-kald med værktøjer slået fra, intet privat
indhold og højst 128 outputtokens. Den tester schemaaccept, ikke opgaveløsning,
fuld svartid, Realtime eller godkendelsespolitikken. Automatisk retry findes ikke.

Sammenlign et konsistent backupgrundlag med separat gendannede data:

```sh
node scripts/verify-restored-data.mjs /isoleret/backup/data /isoleret/restore/data
```

Ingen filer ændres. Kontrollér derudover servicekonfiguration, afkryptering,
projektmapper uden for datamappen og faktisk isoleret serviceboot. Kør ikke
sammenligningen mod en aktiv datamappe og kald det konsistent backupbevis.

## Åbne gates

Se roadmap.md. Alle P0/P1 forbliver i scope. Især er fuld Realtime-budgettering,
serverkontrolleret godkendelse af risikofyldte handlinger, fælles ældre stemme-
dispatch, modelbaseret N3-evaluering, fysisk iPhone og produktionsnær restore
fortsat åbne. Denne arbejdsgren må ikke markeres som en færdig release.

## Udført i første implementeringspakke

- 1.065/1.065 Node-tests bestået fra `jarvis-starter` på Node 24.22.1.
  47 nye tests dækker reservation, stop/genstart, kanalværktøjer og releaseprober.
- Den nye smoke gennemførte autentifikation, faktisk HTTP-dedupe, stop gennem
  genstart samt afslutning/ugeoverblik mod en rigtig isoleret server.
- Browserdelen kunne ikke starte lokalt: først manglede den forventede
  Playwright-browserbinær; den installerede system-Chromium kunne heller ikke
  starte i dette runtime. Ingen screenshot/mobilaccept påstås.
- Smoke er tilføjet den eksisterende browser-CI med projektets pinned runtime.
- En fejlkørsel fra repo-roden havde én startupfejl, fordi den historiske
  `server.test.mjs` forventer app-mappen som cwd. Den korrekte kommando ovenfor
  køres fra `jarvis-starter`; ingen assertion er fjernet.
- Live API, fysisk iPhone, fuld serverrestore og faktisk driftsmåling er ukørte.

## Anden implementeringspakke: webarbejde og sikkerhed

- Afsluttende fuld kørsel: **1.095/1.095 Node-tests bestået**, ingen skipped eller
  cancelled, Node 24.22.1, fra `jarvis-starter`. Dette omfatter den ekstra
  restart/ukendt-udfald-prøve og den monotone HTML-scanner.
- Baseline genskabt bytepræcist fra remote `dd147f7`; rodtræet matcher
  `e48405fca2c83fa33daf35abe9834bea9b1fad4c`. Andre lokale arbejdsgrene er bevaret.
- 29 nye adfærdstests i tre testfiler: 23 domæne-/transporttests, én faktisk
  HTTP-test med isoleret server og fem DOM-tests. Desuden en delt netværksfixture.
- Tidlig annullering gemmes også før transportcontrolleren findes. Et hurtigt
  stopklik må ikke miste sin virkning eller efterlade en genbrugelig tilladelse.
- Første fulde kørsel fandt kun den hårdkodede optælling af server-testfixtures
  (nu syv frem for seks). Optællingen er opdateret; alle assertions om isoleret
  miljø og udelukkelse af nedarvede secrets er bevaret.
- Den udvidede smoke passerer fortsat sine eksisterende HTTP-prøver, men stopper
  før visuel kontrol: lokal Playwright 1.62.1 mangler sin Chromium-binær. Ingen
  nye screenshots eller visuel accept påstås. Den samme smoke i eksisterende CI
  omfatter nu også review → læsning → opret/ret/slet kladde ved 390 og 1280 px.
- Browser-HTTP og visuel smoke bruger en eksplicit syntetisk HTTPS-transport i en
  separat proces. Ingen virkelige websites, login, formularafsendelser eller køb
  er udført. Ingen API-model er brugt til webarbejdet.
- Se `browser-security.md` for arkitekturgrænser og krav før dynamisk browser,
  login eller afsendelse kan aktiveres. N4 er delvist implementeret, ikke afsluttet.

## Remote CI for den første webpakke

Commit `3200d4c012da42ef5346d8b8c8967e0d0bb1a263`, PR #13:
[GUI exact-candidate](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42181071647)
og [v5 regression](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42181071648)
bestod begge. Den præcise commit blev kontrolleret i GUI-jobbet: 1.094 Node-tests,
36/36 GUI-cases i Chromium/WebKit, dybe v5-flows og det nye webflow ved 390/1280 px.
Playwright 1.64.1. Semantik-, dependency- og performancegates bestod også; de
eksisterende semantikkrav er ikke det nye udvidede N3-holdout-mål.

Efter denne kørsel er kildeuddragets mørke tema rettet, central stoptekst
præciseret og smoke udvidet med målt tekstkontrast ≥4,5:1. Den efterfølgende
commits egne checks skal kontrolleres i PR'en; ovenstående SHA er ikke bevis for
en nyere commit. Fysisk iPhone og faktiske offentlige kildeprøver er stadig åbne.
