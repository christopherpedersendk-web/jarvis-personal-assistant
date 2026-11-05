# JARVIS v5 – aktuelt stoppunkt

Opdateret 5. november 2026. **Alle P0 og P1 skal være løst og verificeret før release.** Der er ingen rapporterede brugerhændelser; R01–R13 og nye adversarielle tests beskriver kodefund og acceptkrav.

## Identitet og arbejdsområde

- Baseline: `v4.9.1` / `6b2b0736a32e0968d5db233512672d197b4885f7`, verificeret mod tag og main. Oprindelig suite: 149/149. Historiske tags er urørte.
- Repository: `christopherpedersendk-web/jarvis-personal-assistant`.
- Aktivt isoleret worktree: `jarvis-v5-resume`, lokal branch `feature/v5-resume`. Det gamle `jarvis-v5-work` med brugerens eksisterende ændringer er bevaret urørt.
- Remote udviklingsbranch: `feature/v5-foundation`; [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7).
- Senest publicerede remote: **`0acdca9df4ea5fa7b28fab88ee9e2bd51db0cbed`**, lokal commit `0793fa6828fcb098074f645eddfc1c2b7bd9190a`, identisk tree `1c6d8005c6f8e53629bd2cff288f28ee55da7524` og app-subtree `4b1e8f05b5dd289236deaa587b17ae2ac01c8935`.
- Næste afgrænsede checkpoint er låst i Git-index til app-subtree **`3832f400fbdfbc37c9af528c2d0acfac19b39d9a`**. Fuld test køres i separat checkout af dette commit, så igangværende næste slices ikke blandes ind i evidensen. Commit/remote/CI tilføjes efter faktisk publicering.
- Lokal Git-historik er rekonstrueret. Publicér kun gennem den godkendte Git Data-arbejdsgang med eksisterende remote-parent, identiske blob/tree-hashes og forventet ref-SHA; **aldrig force-push lokal historik**.

## Implementeret i denne iteration

- A1/R01/R02: én serialiseret lokal transaktionsgrænse med isolerede kladder, immutable læsesnapshots, eksplicit save, revision og rollback-only ved fejl i en deltransaktion. Diskfejl giver ikke fantomdata eller en permanent ødelagt kø.
- Private indstillinger og offentlig state har en privat, hashbundet write-ahead-journal. Afbrudte par kan genoptages; uventede nyere bytes må ikke overskrives. Dette er **gendannelige filpubliceringer, ikke en atomisk to-fil-transaktion**.
- A2/A3/R05/R13: durable action intents/outcomes, samtidighedssikker dedup, bounded chat/job/integrations-/opskriftskøer, annullering af ventende arbejde, bundne skillversioner/parametre/budgetter og konservativ restart. Ukendt ekstern effekt gentages ikke.
- J6/R06: projektoperationer, komplette kildehashes, testgrundlag, package approvals og rollback-manifester er bundet før handling. Beskadigede backups, ændrede manifester, ufuldstændige tests og fremmede mapper afvises.
- B3/B5: ægte lokal multilingual-E5-encoder, fast modelrevision/filhashes, isoleret CPU-worker, inkrementelt indeks, timeout/annullering og lexical fallback. Intet automatisk download eller eksternt persondataindeks. Første rigtige hybridmåling **fejlede: 62/80 (77,5 %)**. Generisk semantikprioriteret sammenvejning er rettet og lokalt regressionstestet; fast fixture og mål på 90 % er uændrede. Nyt faktisk CI-resultat mangler.
- C3/C4: selektiv genplanlægning med bevarede gyldige valg, låse, transitiv afhængighed, usikkerhed og buffere; 38 forskellige scenarier. Plan-editorens revisioner, DST-valg, lokal kapacitetsgennemgang og opfølgning har yderligere 22 eksekverbare UI-kontrakttests.
- D/E/K: eksplicitte gæster, ferie/fravær, voksen-/børnefaktorer og alderens kontroldato; revisioner, reelle no-ops, rå ufuldførte ingredienskladder og eksakt kilde/dato med returvej.
- F/I: varigt opskriftsmateriale før udtræk, eksplicit genoptagelse, atomisk lokal kildeinvalidering, filtrering af hemmeligheder og faktisk tidsstemplet Hue/Sonos-forbindelsesstatus.
- R12: Discord-journal med fsync/kopi-før-publicering, afgrænset indgang, generationssikker resume/dedup og eksplicit uafklaret leveringshul. 17 nye adversarielle tests; 39/39 fokuserede inklusive eksisterende regression.
- R03/J6/H2: nye projekt- og jobeditorer med varige kladder, præcise revisioner/pakkeversioner, pauset joboprettelse og sandfærdige ukendte udfald. 17 projekt-UI-tests samt 7 job-policy- og 9 job-UI-tests.
- J1/K2: afgrænset bootstrap, sidevis samtalehistorik og kompakt I dag med lukkede driftsdetaljer; kritiske lager-/leveringsfejl løftes frem. Dette checkpoint er ikke endnu browserverificeret.
- L2/L3: migrationsbackup synkroniseres før live-ændring, restore og journal-recovery genkontrollerer aktuelle bytes og skema. Kodebackup, rollback og projekters gennemgåede grundlag har nye fejlinjektioner.

## Faktisk evidens og åbne gates

- På **`0acdca9d`**: lokal fuld suite **383/383**, 0 fejl/skip, Node **24.22.1**, 11,98 s. [CI 42002595243](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42002595243) bekræftede **383/383 på Node 22.23.4** (13,87 s). Merge-checkoutens app-subtree var præcis `4b1e8f05`.
- Samme CI: den faktiske model gav vector-only **75/80 (93,75 %)**, men produktets hybrid **62/80 (77,5 %), FAIL**. Lexical 41/80; 0 ugyldige kildeudslip; korrektion/glemning/fallback bestået. Rå kandidatbundet rapport: `evidence/semantic-0acdca9d.json`.
- Samme CI: Chromium desktop stoppede i opskriftskilde-fixturen, fordi den søgte en endnu ubekræftet opskrift. Produktet udelukkede den korrekt. Testen udfører nu faktisk UI-gennemgang, bekræfter udelukkelse før godkendelse og bevarer en separat ugemt kladde. Ingen produktfilter svækket. De andre tre browsertilfælde **kørte ikke** i den fejlede run.
- Næste browsermatrix kræver fortsat Chromium/WebKit 1390×950 og 390×844, nu også Plan, pauserede jobs, projektkladder, historik, husstand/opskrift og udvalgt beregnet kontrast/tastatur/reflow. CSS-reflow er **ikke fysisk zoom**. Lokale kontrakttests/syntaks er ikke en browseraccept.
- Sidst fuldt browserverificerede ældre app: `fa4d0e952ccc29e19937211b530b60d89f756755`, subtree `42d30beb971929aad964609f46ebc7f1e47e8061`; [CI 41986430567](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567), 243 Node 22-tests og 4/4 browserflows. **Dette er ikke bevis for den nye kode.**
- Fysisk iPhone/desktop, faktisk mikrofon, manuel tilgængelighed og administratorkontrolleret restore er **afventer manuel verifikation**. Ingen af disse er erstattet med emulering.
- Næste arbejdsiteration (ikke del af dette låste checkpoint): organiserkladder/revisionsbinding, indstillingskladder med feltvis konfliktkontrol, ugevis kalender sammen med eksplicit husstand, brug af tilgængelige dokumenterede priser/råvaregenbrug samt kandidatbundet performance.
- M0 er etableret; M1–M5 har væsentlig implementering/test men åbne acceptpunkter. **M6 er ikke accepteret; M7 er ikke godkendt.**

## Næste konkrete handling

1. Commit det låste Git-index; test hele committet i separat worktree. Publicér kun den hashkontrollerede udviklingskandidat uden merge/tag og genkør Node 22, begge browsermotorer og genuine semantic-job. Bevar fejlresultater; ret årsager uden at svække assertions eller spørgefixture.
2. Fortsæt uafhængige resterende P0/P1-slices ovenfor. Igangværende ikke-committede ændringer tilhører næste iteration og er ikke dækket af den publicerede kandidats tests.
3. Opdatér kravmatrix, verificering, migration/recovery, performance og releaseforslag til den faktiske endelige revision.
4. Indhent kun manglende fysiske/administrative kontroller, når uafhængigt implementeringsarbejde er afsluttet. Merge, stabilt `v5.0.0`-tag/release og installation er tre særskilte M7-beslutninger.

Ingen produktion, persondata, virkelige kurveskrivninger, nye reelle gentagne job eller udvidede kontorettigheder er brugt.
