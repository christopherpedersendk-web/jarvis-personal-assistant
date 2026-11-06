# Verifikation af v5.1.0-arbejdet

## Rapportkanal, madplanparitet og webnavigation

Lokal fuld regression: 1.124/1.124 bestået fra app-mappen. Efter tilføjelse
af navigationens DOM-regression bestod alle seks browser-UI-tests. Den første
fulde genkørsel fra repo-roden havde én cwd-afhængig serveropstartfejl; den
korrekte app-kørsel ovenfor er grundlaget. Ny kandidat-CI afventer.

Discord-indstillinger har nu et særskilt reportChannelId med samme
feltbaserede revisionskontrol som øvrige indstillinger. Planlagte rapporter
og proaktive dags-/ugeoverblik bruger kanalen, mens almindelige påmindelser
beholder DM. Uden kanal bevares DM-adfærd. Før levering kontrolleres kanaltype
og server-ID. Længere rapporter opdeles via den eksisterende kontrollerede
levering uden mentions, højst 12.000 tegn; yderligere tekst findes i JARVIS.
En manglende Discord-levering tæller ikke længere stiltiende som bekræftet.

En særskilt ejerknap kan oprette #jarvis-rapporter på den gemte server og
aktivere rapportlevering. Kanalen oprettes med deny VIEW_CHANNEL til @everyone
og allow til ejer/bot; administratorer kan stadig se den. Oprettelsen bruger
varig ActionJournal med stabil reference pr. server/ejer, så uafklaret POST
ikke gentages. Eksisterende navnematch kræver manuel gennemgang af kanal-ID.
Ingen modelværktøjer må oprette kanaler eller ændre leveringsindstillinger.
Ingen kanal er oprettet i produktion herfra; serveradgang mangler.

Madplanens reelle handler er nu testet gennem tekst, Discord og stemme med
samme plan, revision, redigering og særskilt indkøbsliste. Browseruddrag viser
op til 20 samme-origin undersider; valg henter intet og kræver nyt review.
Ingen dynamisk browser, login eller formularafsendelse er tilføjet.

CI på forrige head 7a85d8d: unit/browser/performance og v5 regression bestod,
men local-semantic-acceptance fejlede på den normale 1.500 ms deadline med
local-lexical fallback. Dette er en åben releasegate; den er ikke fjernet,
og tidligere grøn CI må ikke bruges som evidens for denne kandidat.


## Samtaler: offentlig research, links og rapportstart

Chat og Discord-tekst manglede webresearch og start af eksisterende rapportjobs.
Det fælles værktøjssæt har nu search_web, get_maps_link, list_report_jobs og
run_report_job. Webstemme bruger samme validerede handler via assistant/tool.
Webresearch bruger en separat Responses-anmodning uden privat hukommelse eller
handlingsværktøjer: højst to indbyggede værktøjskald og 2.000 outputtokens pr.
søgning. Eksisterende Responses-stop og forbrugskontrol gælder. Kildeannoteringer
returneres særskilt; manglende kilder markeres som ikke verificeret. Maps-links
er URL-kodede søgninger, ikke verificerede virksomhedsprofiler.

Forsidens historik viser HTTP(S)-links som klikbare, sikre DOM-ankre, uden at
fortolke model-HTML. Discord får korte resuméer og almindelige kilde-URL'er.
Rapportstart kræver aktuelt ID/revision og et aktivt eller gennemført læsejob;
pausede, fejlramte og uafklarede jobs skal fortsat gennemgås. ActionJournal
forhindrer genafspilning af samme kald. Et accepteret startkald er ikke en
færdig rapport. Der gives ikke adgang til godkendelser, betalinger eller køb.

Samlet lokal regression: 1.115/1.115 bestået (parallelitet 2). En tidligere
kørsel fik timeout i projektagentens syntakstest; den bestod isoleret og i
den samlede genkørsel. Efter sidste ændring, der sikrer links i slutsvaret,
bestod alle ni chat-dispatchtests igen. Remote CI for pakken afventer.

Tolv nye regressioner dækker tre kanalers handlers, faktisk TaskEngine og
ActionJournal, tekst/Discord-dispatch, kildeudtræk, Maps-kodning og sikker
linkvisning. Ingen live model-, mikrofon- eller Discord-lydprøve er udført.
Discord-stemmekanal er brugerens valgte næste integration, men lydtransport er
ikke implementeret i denne pakke. Der er ingen automatisk lytning.

API-grundlag gennemgået 6. november 2026:
https://developers.openai.com/api/docs/guides/tools-web-search
https://developers.openai.com/api/reference/python/resources/responses/methods/create
https://github.com/discord/discord-api-docs/blob/main/developers/topics/voice-connections.mdx


## Dagsrapporter: lange instruktioner og lokal fejlstatus

Den automatiske hukommelsessøgning bruger nu højst 240 tegn af instruktionen;
hele rapportprompten bevares til modellen. Den eksplicitte søgevalidering er
uændret. Lokal forberedelse ligger før provider-POST, så lokale fejl markeres
som ingen handling udført frem for ukendt providerudfald.

To regressionstests bruger serverens faktiske funktioner og PersonalKnowledge:
lang prompt accepteres til automatisk kontekst, og lokal fejl giver nul
providerkald. Fuld lokal regression: 1.103/1.103 tests bestået, 6. november 2026.
Remote CI og produktion er ikke verificeret for denne ændring.

Afvisning af jobkategori/rettigheder omgås ikke. Fejlbeskeden forklarer nu,
hvordan et pauset job gennemgås, gemmes og aktiveres med en ny revision.
Screenshot dokumenterer afvisningen, men viser ikke de underliggende gemte
felter. Produktionsjobbet er ikke ændret, og der er ikke givet nye rettigheder.

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
