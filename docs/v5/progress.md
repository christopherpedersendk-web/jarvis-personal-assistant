# JARVIS v5 – aktuelt stoppunkt

Opdateret 5. november 2026. **Alle P0 og P1 skal være løst og verificeret før release.** Der er ingen rapporterede brugerhændelser; R01–R13 og nye adversarielle tests beskriver kodefund og acceptkrav.

## Identitet og arbejdsområde

- Baseline: `v4.9.1` / `6b2b0736a32e0968d5db233512672d197b4885f7`, verificeret mod tag og main. Oprindelig suite: 149/149. Historiske tags er urørte.
- Repository: `christopherpedersendk-web/jarvis-personal-assistant`.
- Aktivt isoleret worktree: `jarvis-v5-resume`, lokal branch `feature/v5-resume`. Det gamle `jarvis-v5-work` med brugerens eksisterende ændringer er bevaret urørt.
- Remote udviklingsbranch: `feature/v5-foundation`; [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7).
- Senest publicerede remote: **`b04bcb304602a8ed92246db7a580038143362353`**, lokal commit `66e888b0202c3ef3d1e3b6ebd1854362768fe3d2`, identisk tree `3e006589e9ec7d32c1245b7b7cc62cd20001ee8b` og app-subtree `3832f400fbdfbc37c9af528c2d0acfac19b39d9a`. Main er genkontrolleret og står stadig på baseline.
- Næste afgrænsede checkpoint er låst i Git-index til app-subtree **`c1f9272923d57bc1083ea646e1c67f98b6a0d121`**. Fuld test køres i separat checkout af committet, så igangværende næste slices ikke blandes ind i evidensen. Commit/remote/CI tilføjes efter faktisk publicering.
- Lokal Git-historik er rekonstrueret. Publicér kun gennem den godkendte Git Data-arbejdsgang med eksisterende remote-parent, identiske blob/tree-hashes og forventet ref-SHA; **aldrig force-push lokal historik**.

## Implementeret i denne iteration

- A1/R01/R02: én serialiseret lokal transaktionsgrænse med isolerede kladder, immutable læsesnapshots, eksplicit save, revision og rollback-only ved fejl i en deltransaktion. Diskfejl giver ikke fantomdata eller en permanent ødelagt kø.
- Private indstillinger og offentlig state har en privat, hashbundet write-ahead-journal. Afbrudte par kan genoptages; uventede nyere bytes må ikke overskrives. Dette er **gendannelige filpubliceringer, ikke en atomisk to-fil-transaktion**.
- A2/A3/R05/R13: durable action intents/outcomes, samtidighedssikker dedup, bounded chat/job/integrations-/opskriftskøer, annullering af ventende arbejde, bundne skillversioner/parametre/budgetter og konservativ restart. Ukendt ekstern effekt gentages ikke.
- J6/R06: projektoperationer, komplette kildehashes, testgrundlag, package approvals og rollback-manifester er bundet før handling. Beskadigede backups, ændrede manifester, ufuldstændige tests og fremmede mapper afvises.
- B3/B5: ægte lokal multilingual-E5-encoder, fast modelrevision/filhashes, isoleret CPU-worker, inkrementelt indeks, timeout/annullering og lexical fallback. Intet automatisk download eller eksternt persondataindeks. Første rigtige hybridmåling **fejlede: 62/80 (77,5 %)**; næste faktiske CI på uændret fixture målte **75/80 (93,75 %)**. Ny kode skal genmåles. Lexical token-cache ændrer ikke scoring eller aktiv-kilde-filtrering.
- C3/C4: selektiv genplanlægning med bevarede gyldige valg, låse, transitiv afhængighed, usikkerhed og buffere; 38 forskellige scenarier. Plan-editorens revisioner, DST-valg, lokal kapacitetsgennemgang og opfølgning har yderligere 22 eksekverbare UI-kontrakttests.
- D/E/K: eksplicitte gæster, ferie/fravær, voksen-/børnefaktorer og alderens kontroldato; revisioner, reelle no-ops, rå ufuldførte ingredienskladder og eksakt kilde/dato med returvej.
- F/I: varigt opskriftsmateriale før udtræk, eksplicit genoptagelse, atomisk lokal kildeinvalidering, filtrering af hemmeligheder og faktisk tidsstemplet Hue/Sonos-forbindelsesstatus.
- R12: Discord-journal med fsync/kopi-før-publicering, afgrænset indgang, generationssikker resume/dedup og eksplicit uafklaret leveringshul. 17 nye adversarielle tests; 39/39 fokuserede inklusive eksisterende regression.
- R03/J6/H2: nye projekt- og jobeditorer med varige kladder, præcise revisioner/pakkeversioner, pauset joboprettelse og sandfærdige ukendte udfald. 17 projekt-UI-tests samt 7 job-policy- og 9 job-UI-tests.
- J1/K2: afgrænset bootstrap, sidevis samtalehistorik og kompakt I dag med lukkede driftsdetaljer; kritiske lager-/leveringsfejl løftes frem. Dette checkpoint er ikke endnu browserverificeret.
- L2/L3: migrationsbackup synkroniseres før live-ændring, restore og journal-recovery genkontrollerer aktuelle bytes og skema. Kodebackup, rollback og projekters gennemgåede grundlag har nye fejlinjektioner.
- R02/R03/K5: feltvise, HMAC-bundne settings-grundlag kontrolleres inde i den serialiserede opdatering. Almindelige, Discord- og proaktive indstillinger deler kladde-/konfliktregler; hemmeligheder gemmes ikke i browserlageret. Chat, organizer, legacy noter og claim-editor bevarer tekst, fokus, revision og ukendte udfald.
- B1/B2: eksplicitte korrektionsforslag, gennemgået kilde/gyldighed, separat bekræftelse mod gammel og ny revision og bevaret claim-historik. Ugyldige fakta fjernes straks fra retrieval. Legacy-noters fulde versionshistorik er næste selvstændige slice, ikke erklæret færdig.
- D4/E1: lokal, tidsstemplet read-only kalendercache ved siden af eksplicit husstand; registrerede prisobservationer med udløb, ukendte beløb og prisændringsstale. Backend understøtter revisionsbundet planlagt restemad, aldrig forbrug, køb eller lager. Den nye restemadseditor afventer næste slice.
- I4/H2: friske installationer starter uden proaktive aktiviteter; nye implicit oprettede job er pauseret og skal aktiveres eksplicit. Eksisterende registrerede v4-indstillinger bevares under migration. Syntetiske childprocesser har fælles miljø-whitelist uden værtscredentials.

## Faktisk evidens og åbne gates

- På **`b04bcb30`**: lokal fuld suite **501/501**, 0 fejl/skip, Node **24.22.1**, 12,252 s. [CI 42007968167](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42007968167) bekræftede **501/501 på Node 22.23.4** (15,666 s), mergecommit `810a353d49454151f03f0db6b35bb9acf929293d` med identisk app-subtree `3832f400`.
- Samme CI: vector-only og faktisk hybrid **75/80 (93,75 %), PASS** mod uændret 90 %-mål; lexical43/80. 16 sikkerhedsspørgsmål, ingen ugyldige kildeudslip, korrektion/glemning/fallback bestået. Kandidatbundet konsolrapport: `evidence/semantic-b04bcb30.json` (opsummering og fem fejl, ikke det fulde 96-spørgsmålsartifact). Den tidligere fejlede måling er bevaret separat.
- Samme CI: Chromium desktop stoppede ved tastaturforløbet i historikken. Browserens reelt scrollbare historikregion var et ekstra fokusstop før composer. Testen kontrollerer nu både det gyldige mellemstop og efterfølgende composer; fokusassertions er bevaret. Andre tre browsertilfælde **kørte ikke**. Samlet CI er ikke grøn.
- Installationen rapporterede to højt klassificerede dependency-advarsler. Næste checkpoint har en hård audit-gate, præcis dependency-inventarliste og artifact af genereret lockfile. Advisory-ID'er skal afklares, lockfilen reviewes/committes og installationen skiftes til `npm ci` før RC. Ingen blind opgradering eller ignorering.
- Næste browsermatrix kræver fortsat Chromium/WebKit 1390×950 og 390×844, nu også Plan, pauserede jobs, projektkladder, historik, husstand/opskrift og udvalgt beregnet kontrast/tastatur/reflow. CSS-reflow er **ikke fysisk zoom**. Lokale kontrakttests/syntaks er ikke en browseraccept.
- Sidst fuldt browserverificerede ældre app: `fa4d0e952ccc29e19937211b530b60d89f756755`, subtree `42d30beb971929aad964609f46ebc7f1e47e8061`; [CI 41986430567](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567), 243 Node 22-tests og 4/4 browserflows. **Dette er ikke bevis for den nye kode.**
- Fysisk iPhone/desktop, faktisk mikrofon, manuel tilgængelighed og administratorkontrolleret restore er **afventer manuel verifikation**. Ingen af disse er erstattet med emulering.
- Parret lokal performance på baseline og **b04bcb30** er udført med identisk syntetisk fixture: bootstrap7.123 B mod fuld state165.621 B; nyere varige writes og lexical retrieval var langsommere. Dette er før den nye token-cache. Næste CI måler begge revisioner med samme benchmark og adskiller kø, syntetisk ekstern ventetid, lokal p95 og RSS. Ingen livepriser eller modelomkostninger påstås målt.
- Næste arbejdsiteration (ikke del af dette låste checkpoint): E1 restemads-/priskildeeditor, H1 komplette versionerede procedurer, legacy notehistorik, præcise meal-/shoppingkilder og afhængighedsafklaring. Filer under arbejde må ikke tilskrives det låste checkpoints evidens.
- M0 er etableret; M1–M5 har væsentlig implementering/test men åbne acceptpunkter. **M6 er ikke accepteret; M7 er ikke godkendt.**

## Næste konkrete handling

1. Commit det låste Git-index; test hele committet i separat worktree. Publicér kun den hashkontrollerede udviklingskandidat uden merge/tag og genkør Node 22, begge browsermotorer og genuine semantic-job. Bevar fejlresultater; ret årsager uden at svække assertions eller spørgefixture.
2. Fortsæt uafhængige resterende P0/P1-slices ovenfor. Igangværende ikke-committede ændringer tilhører næste iteration og er ikke dækket af den publicerede kandidats tests.
3. Opdatér kravmatrix, verificering, migration/recovery, performance og releaseforslag til den faktiske endelige revision.
4. Indhent kun manglende fysiske/administrative kontroller, når uafhængigt implementeringsarbejde er afsluttet. Merge, stabilt `v5.0.0`-tag/release og installation er tre særskilte M7-beslutninger.

Ingen produktion, persondata, virkelige kurveskrivninger, nye reelle gentagne job eller udvidede kontorettigheder er brugt.
