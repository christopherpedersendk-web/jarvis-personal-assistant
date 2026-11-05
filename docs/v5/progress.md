# JARVIS v5 – aktuelt stoppunkt

Opdateret 5. november 2026. **Alle P0 og P1 skal være løst og verificeret før release.** Der er ingen rapporterede brugerhændelser; R01–R13 og nye adversarielle tests beskriver kodefund og acceptkrav.

## Identitet og arbejdsområde

- Baseline: `v4.9.1` / `6b2b0736a32e0968d5db233512672d197b4885f7`, verificeret mod tag og main. Oprindelig suite: 149/149. Historiske tags er urørte.
- Repository: `christopherpedersendk-web/jarvis-personal-assistant`.
- Aktivt isoleret worktree: `jarvis-v5-resume`, lokal branch `feature/v5-resume`. Det gamle `jarvis-v5-work` med brugerens eksisterende ændringer er bevaret urørt.
- Remote udviklingsbranch: `feature/v5-foundation`; [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7).
- Denne kodeiteration er låst til app-subtree **`4b1e8f05b5dd289236deaa587b17ae2ac01c8935`**. Lokal/GitHub-commit og ny CI registreres efter publicering. Udgangspunktets remote-head var `95ff41f9b1f1039a7847f97d2a87aa4b2a26f93f`, uden nyere remoteændringer ved kontrollen.
- Lokal Git-historik er rekonstrueret. Publicér kun gennem den godkendte Git Data-arbejdsgang med eksisterende remote-parent, identiske blob/tree-hashes og forventet ref-SHA; **aldrig force-push lokal historik**.

## Implementeret i denne iteration

- A1/R01/R02: én serialiseret lokal transaktionsgrænse med isolerede kladder, immutable læsesnapshots, eksplicit save, revision og rollback-only ved fejl i en deltransaktion. Diskfejl giver ikke fantomdata eller en permanent ødelagt kø.
- Private indstillinger og offentlig state har en privat, hashbundet write-ahead-journal. Afbrudte par kan genoptages; uventede nyere bytes må ikke overskrives. Dette er **gendannelige filpubliceringer, ikke en atomisk to-fil-transaktion**.
- A2/A3/R05/R13: durable action intents/outcomes, samtidighedssikker dedup, bounded chat/job/integrations-/opskriftskøer, annullering af ventende arbejde, bundne skillversioner/parametre/budgetter og konservativ restart. Ukendt ekstern effekt gentages ikke.
- J6/R06: projektoperationer, komplette kildehashes, testgrundlag, package approvals og rollback-manifester er bundet før handling. Beskadigede backups, ændrede manifester, ufuldstændige tests og fremmede mapper afvises.
- B3/B5: ægte lokal multilingual-E5-encoder, fast modelrevision/filhashes, isoleret CPU-worker, inkrementelt indeks, timeout/annullering og lexical fallback. Intet automatisk download eller eksternt persondataindeks. **Den faktiske 90 %-måling afventer CI.**
- C3/C4: selektiv genplanlægning med bevarede gyldige valg, låse, transitiv afhængighed, usikkerhed og buffere; 38 forskellige scenarier. Den fulde interaktive Plan-editor følger i næste kodeiteration.
- D/E/K: eksplicitte gæster, ferie/fravær, voksen-/børnefaktorer og alderens kontroldato; revisioner, reelle no-ops, rå ufuldførte ingredienskladder og eksakt kilde/dato med returvej.
- F/I: varigt opskriftsmateriale før udtræk, eksplicit genoptagelse, atomisk lokal kildeinvalidering, filtrering af hemmeligheder og faktisk tidsstemplet Hue/Sonos-forbindelsesstatus.

## Faktisk evidens og åbne gates

- `cd jarvis-starter && npm test`: **383/383 bestået**, 0 fejl/skip, lokal Node **24.22.1**, 8,28 sekunder før den sidste snævre CSS-reflowrettelse; genkørsel på den ovenstående frosne app følger i samme checkpoint.
- `git diff --check` og syntakskontrol af de ændrede browserfiler bestået.
- Ny browsermatrix omfatter fortsat Chromium og WebKit, 1390×950 og 390×844, plus husstand/opskrift/import/fokus/konflikt/kildelinks. **Ikke kørt på denne iteration endnu**. Lokal browserstart er blokeret af OS-socketbegrænsning; brug eksisterende CI, ingen privilegieomgåelse.
- Sidst fuldt browserverificerede ældre app: `fa4d0e952ccc29e19937211b530b60d89f756755`, subtree `42d30beb971929aad964609f46ebc7f1e47e8061`; [CI 41986430567](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567), 243 Node 22-tests og 4/4 browserflows. **Dette er ikke bevis for den nye kode.**
- Fysisk iPhone/desktop, faktisk mikrofon, manuel tilgængelighed og administratorkontrolleret restore er **afventer manuel verifikation**. Ingen af disse er erstattet med emulering.
- Ny kandidatbundet performance, fuld Plan-UI, Discord fsync/bounded ingress og endelig tværgående privacy-/gendannelsesgennemgang er fortsat åbne.
- M0 er etableret; M1–M5 har væsentlig implementering/test men åbne acceptpunkter. **M6 er ikke accepteret; M7 er ikke godkendt.**

## Næste konkrete handling

1. Publicér den hashkontrollerede udviklingskandidat uden merge/tag, og kør dens Node 22-, browser- og genuine semantic-job. Bevar fejlresultater; ret årsagerne uden at svække assertions eller den faste spørgefixture.
2. Land de uafhængige resterende P0/P1-slices: Discord robusthed, Plan-editor og tilgængelighed; genkør hele kandidaten.
3. Opdatér kravmatrix, verificering, migration/recovery, performance og releaseforslag til den faktiske endelige revision.
4. Indhent kun manglende fysiske/administrative kontroller, når uafhængigt implementeringsarbejde er afsluttet. Merge, stabilt `v5.0.0`-tag/release og installation er tre særskilte M7-beslutninger.

Ingen produktion, persondata, virkelige kurveskrivninger, nye reelle gentagne job eller udvidede kontorettigheder er brugt.
