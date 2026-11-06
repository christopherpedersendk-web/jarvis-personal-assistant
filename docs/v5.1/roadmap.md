# JARVIS v5.1.0 — arbejdsgrundlag og releasekrav

Ejerbeslutning 6. november 2026 (Europe/Copenhagen): byt N4/N5, start v5.1.0,
medtag ALLE P0/P1 og hele N1/N2 som minimum. N3's P1-arbejde er dermed også
releaseomfang; N1/N2 er ikke en scope-reduktion. Smart Home afventer lokal agent.

Baseline: remote main `8a0db5789f5ecb2152f6d0eec49b70be30843de2` (v5.0.2),
app-træ `15d57514ae475a926d048ea9635d28856e52bafa`. Lokal app matcher dette træ;
lokal Git-historik og enkelte historiske dokumenter er forskellige og bevares.
Udviklingsgren: `feature/v5.1.0`. Ingen produktion, merge eller release er udført.
Pakken beholder 5.0.2 indtil en samlet 5.1.0-kandidat er klar til versionsløft.

Ny ejerprioritering 6. november 2026: fortsæt med browserarbejde og sikkerhed
først. Første N4-leverance er derfor taget ind sammen med N2. Den nye lokale
arbejdskopi er genskabt fra `dd147f78133edfc8738b949a8c42b6f1c3f704e2`;
alle blobs og rodtræ `e48405fca2c83fa33daf35abe9834bea9b1fad4c` er verificeret.

## Milestones

| ID | Leverance | Prioritet | Status |
|---|---|---|---|
| N1 | Dokumenteret stabil drift: providerprøve, diagnose, svartid, fuld restore og fysisk accept | P0 | I gang |
| N2 | Fælles værktøjspolitik, godkendelser, samlet forbrug, budget og stop | P0/P1 | I gang |
| N3 | Opgaver/opfølgning i alle kanaler, skills, hukommelseskvalitet og overskuelig mobiloplevelse | P1 | I gang |
| N4 | Kontrolleret webarbejde: læsning og lokale bookingkladder; senere browser med login | P1 for første læsefase | I gang sammen med N2; dynamisk browser og afsendelse er stadig åbne |
| N5 | Afgrænsede kalenderændringer | P2 | Udskudt |
| Home | Hue/Sonos/Nest/Home Assistant | P2 | Blokeret af manglende lokal agent; ingen udvidelse |

P0 blokerer relevant release/handleevne; P1 skal med i v5.1.0. Den nyeste
instruks prioriterer første N4-fase. N5 og Home udvides ikke.

## Acceptregister — ingen uafprøvet kontrol markeres afsluttet

| ID | Krav og verifikation | Foreløbig implementering / resterende arbejde |
|---|---|---|
| N1.1 P0 | Faktisk valgt model accepterer hele kataloget uden eksterne writes | `scripts/provider-contract-probe.mjs`; offline og syntetiske fejlprøver. Live afventer API-adgang; Realtime er særskilt. |
| N1.2 P0 | Forklarlige fejl, sporbar reference, nul replay ved ukendt udfald | HTTP-reference, Responses-journal og eksisterende handlingsjournal; regressionsprøver. |
| N1.3 P1 | Faktiske svartider og forbrug frem for simuleret modelsvar | Responses-varighed og rapporteret input/output logges uden indhold; produktionsbaseline/p50/p95 mangler. |
| N1.4 P0 | Fuld isoleret gendannelse af data, private settings, Discordjournal, medier/projekter og service | Read-only hash/permissions-sammenligning implementeret. Faktisk konsistent backup, eksterne projektmapper og serviceboot mangler. |
| N1.5 P1 | Fysisk iPhone/Safari, tastatur, stemme, én madplan og kladder | Eksisterende browserregression + ny kontrolsmoke. Fysisk accept mangler. |
| N2.1 P0 | Ét kontrolleret katalog og servervalidering på alle modelkanaler | Fælles basisskema og nye sekretærværktøjer. Ældre stemmespecifikke værktøjer/direct routes skal samles og policytestes. |
| N2.2 P0 | Risikofyldte handlinger kræver engangsgodkendelse bundet til bruger, parametre, revision og udløb | Eksisterende Nemlig-politik bevares. Generel capability-/godkendelsespolitik er fortsat åben; journalføring alene er ikke autorisation. |
| N2.3 P1 | Alle betalte kald måles og begrænses, også samtidige | Responses-reservation før send, kald-/output-/inputgrænser, varig journal. Realtime-lyd, hosted-tool-udgifter og økonomisk total er IKKE dækket endnu. |
| N2.4 P0 | Stop spærrer næste handling og overlever restart; genoptagelse genstarter ikke gammelt arbejde | Responses abort + generationskontrol for chat, nye sekretærværktøjer og research. Realtime-sideband/ældre direkte stemmeruter og allerede startede udbyderjobs mangler fuld dækning. |
| N2.5 P0 | Ingen secrets i svar/log/artefakter; mindst mulige rettigheder | Eksisterende maskering/CSP/isolation bevares; nye journaler gemmer metadata. Driftens filrettigheder, tokenrotation og backupbeskyttelse skal accepteres. |
| N2.6 P0 | Dependency-review og eksakt kandidat-CI uden relevante uafklarede kritiske fund | Eksisterende CI bevares. Ny kandidat skal gennem alle gates; lokal test er ikke remote CI. |
| N3.1 P1 | Opret → ret → følg op → afslut med fælles gemt tilstand i web/Discord/stemme | Otte sekretærværktøjer, revisionskontrol, journal/dedupe, kildekanal og lokalt ugeoverblik. |
| N3.2 P1 | ≥27/30 repræsentative brugeropgaver lykkes; alle kritiske sikkerhedsprøver består | 30 deterministiske kanalscenarier + katalogprøve tilføjet. Disse er IKKE 30 evalueringer af naturligt sprog mod modellen. Model-/tale-evaluering mangler. |
| N3.3 P1 | Mere præcist skillvalg og direkte valg af eksisterende fire skills | Eksisterende versionsbinding bevares; routingforbedring og evaluering mangler. |
| N3.4 P1 | Udvidet hukommelsesprøve ≥95 % kilde@5; rettelser, udløb og ukendt svar testes særskilt | Eksisterende baseline 75/80 bevares. Nye holdout-spørgsmål og ægte lokal semantik-evaluering mangler. |
| N3.5 P1 | Fokus i I dag, ingen gentagne afsluttede påmindelser, brugbart ugeoverblik | Read-only ugeoverblik og kanalafgrænset historik implementeret. Samlet påmindelses-/I dag-accept og brugerprøve mangler. |
| N4.1 P0 | Læsning kun efter ejerens præcise domænevalg og engangsreview; ingen intern netværksadgang | `browser-workspace.mjs`: HTTPS, DNS-pinning pr. redirect, samme origin, ingen login/cookies/parametre, to samtidige og 50 læsninger/dag. Negative transport- og HTTP-tests består. |
| N4.2 P0 | Websites kan ikke udvide værktøjsrettigheder eller forgifte hukommelsen | Webuddrag holdes uden for alle modelkataloger, personlig vidensindeksering og generel state-response. Kun tekstnoder i UI. Skadelige sider testes som data, ikke som pålidelige instruktioner. |
| N4.3 P0 | Stop/tilbagetrækning af tilladelse afbryder læsning; ingen replay efter ukendt udfald | Varigt engangsforbrug før netværk, binding til ejer, URL, konfigurationsrevision, proces, generation og to minutters udløb. Restart/stop/race/ukendt udfald er testet. |
| N4.4 P1 | En læst kilde kan bruges til en redigerbar lokal bookingkladde med versionskontrol | Planlægning → Webarbejde: review, kildeuddrag, opret/ret/slet kladde. Kildehash og læsetid gemmes; ingen kladde sendes. HTTP- og DOM-tests består; Chromium/iPhone-accept afventer. |
| N4.5 Senere | Isoleret dynamisk browser, login-overdragelse og konkrete formularforslag | Ikke implementeret. Ingen formularafsendelse, betaling, booking eller automatisk modelnavigation kan aktiveres på baggrund af læsetilladelsen. Krav i `browser-security.md`. |

## Arkitektur og driftsgrænser

- Modulær monolit og eksisterende durable JSON-transaktioner bevares.
- `assistant-tools.mjs` er fælles schemaeksport. Lokal opskriftsvalidering er fortsat
  stærkere end providerens regex-understøttelse; Unicode-kontrollen er ikke fjernet.
- `provider-control.mjs` reserverer Responses-output før netværk. Ukendt usage
  beholder reservationen; genstart og midnat må ikke frigive uafklaret forbrug.
  Kald, inputbytes og outputtokens er ressourcegrænser, IKKE en DKK-fakturagrænse.
- Stop er varigt. Gamle generations-ID'er forbliver ugyldige efter genoptagelse.
  Afbrydelse af HTTP betyder ikke rollback eller stop hos en ekstern udbyder.
- Nye sekretærværktøjer ændrer kun lokale opgaver/sager. Ingen kalenderwrite,
  besked til andre, køb, installation eller Home-udvidelse indføres.
- Lokal skriveadgang fra en model kræver fortsat generelt policy-review (N2.2).
  Nye værktøjer må ikke fremstilles som en fuld løsning på prompt injection.
- Nye udviklingsændringer er ikke releaseklare, før ALLE ovenstående P0/P1 er
  implementeret OG accepteret. Ekstern evidens er en åben gate, ikke en undtagelse.

## Næste implementeringsrækkefølge

1. Verificér N4's første læsefase i pinned browser-CI og med offentlige testkilder
   samt fysisk iPhone. Færdiggør derefter N2: fælles dispatcher for ældre stemmeværktøjer, konkret approval-
   binding, Realtime-kontrol/forbrug og stop af relevante udbyderjobs.
2. Færdiggør N3: skillvalg, holdout-evaluering, I dag/opfølgninger og 30 faktiske
   danske brugeropgaver, inklusive stemme. Ingen kvalitetsmål sænkes for grønt.
3. N1: kør live kontraktprøver og fuld isoleret serverrestore, mål drift og udfør
   fysisk iPhone-accept. Bind rapporter til kandidatens SHA, løft versionen til
   5.1.0 og gennemfør hele CI før releasevurdering.
