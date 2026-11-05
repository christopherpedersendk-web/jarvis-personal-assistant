# Verifikationslog

## Aktuel gate – 5. november 2026

**Nyeste publicerede checkpoint: `6892cf3dcbbd9dd3bf98a2286c7970017572bab9`**, lokal `badd3f96f188a0c13f34e7ffaee3075fc7121e7a`, app-træ `c1f9272923d57bc1083ea646e1c67f98b6a0d121`. [CI42015140734](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42015140734), mergecommit `878e65725553bfb9561efc00c8a49c69ac9a7a19`: **668/668 Node22.23.4**, 0 fejl/skip,23.808,732475 ms. Samme app lokalt:668/668 Node24.22.1,12.953,709123 ms.

**Samlet CI fejlede; M6 er ikke accepteret:**

- Browseren bestod historik/tastatur og nåede oprettelse af et claim, men tom valgfri kildereference blev sendt som `null` og korrekt afvist af servervalideringen. Det er en UI-kontraktfejl. Nye lokale regressioner reproducerede den før rettelsen; UI sender nu den eksplicitte tom-streng-kontrakt. Ny CI kræves. Kun Chromiumdesktop blev kørt frem til fejlen;5 PNG+1 accessibility-rapport i artifact13408947232, ZIP SHA256 `f0ec95690222f0f05d2d85851db52b3ce5043787f52bb54007293e219f758b44`, download verificeret. I dag/composer er visuelt inspiceret, ikke hele browsermatrixen eller fysiske enheder.
- Ægte modelkørsel terminerede native med exit134/Napi-fejl; ingen komplet ny retrievalrapport. Den gamle93,75 %-måling nedenfor gælder fortsat kun sin gamle revision. Separat modelproces/fallback er under ny verifikation; nativ udløser er ikke bevist.
- Dependencygate afviste to højt klassificerede pakker via sharps native billedafhængigheder. Fuld kandidatbundet rapport: `evidence/dependency-audit-6892cf3d.json`. Målrettet sharp0.35.5 override og præcis ny lock kræver ny faktisk audit; se `dependency-review.md`.
- Parret performancejob **bestod** på samme Node22-runner, samme benchmarkSHA `6f12ebae3b0d85648dc58c302711fc58c38aaeb540e4660e9ca2482af67f5b1a` og fixtureSHA `ed5f76624359bb2f2f6a0fcb2f31752ea1454b9cae7af26d404bad0f7c13962f`. Begge rå rapporter ligger i `evidence/performance-*-6892cf3d.json`. Artifact13408224242 ZIP SHA256 `eaedc976c0e519c2a4935514f7f0c7e4f104caa001be12cea4bc8ef573041f5b` verificeret.

| Samme syntetiske fixture | Verificeret v4.9.1 | Appc1f92729 |
|---|---:|---:|
| Fuld state |165.621 B / p95 16,110 ms|165.818 B / p95 16,995 ms|
| Normal afgrænset bootstrap |ikke tilgængelig|7.123 B / p95 1,751 ms|
| Lille overview |ikke tilgængelig|117 B / p95 0,867 ms|
| Lokal lexical retrieval,40 requests |p95 10,570 ms|p95 15,057 ms|
| Varige tekstwrites,30 requests |p95 4,044 ms|p95 10,667 ms|
| Lokale reads under tre simulerede modelsvar |fuld state p95 5,799 ms|bootstrap p95 4,619 ms|
| Samplet peak-RSS |93.954.048 B|109.125.632 B|

Kandidatens køventetider var1/220/456 ms og kørsler236/235/235 ms med200 ms simuleret ekstern ventetid (målt p95 201,150 ms). Ingen rigtige modelcalls, toolcalls, kurveskrivninger eller aktiverede recurringjobs. Bootstrap er ca.95,7 % mindre end baselinefuldstate; søgning og varige writes er langsommere i denne prøve. Dette dokumenterer en målbar durabilitets-/responsafvejning, ikke generel hastighedsgevinst eller produktions-SLA. Nyere ændringer kræver ny måling.

## Tidligere gate – b04bcb30

Seneste publicerede app er **`b04bcb304602a8ed92246db7a580038143362353`**, app-subtree **`3832f400fbdfbc37c9af528c2d0acfac19b39d9a`**, lokal indholdsidentisk commit `66e888b0202c3ef3d1e3b6ebd1854362768fe3d2`. Lokal `npm test`: **501/501**, 0 fejl/skip, Node24.22.1, 12.251,999757 ms. [CI42007968167](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42007968167) anvendte mergecommit `810a353d49454151f03f0db6b35bb9acf929293d` med identisk app-subtree: **501/501 Node22.23.4**, 15.666,190921 ms.

- Faktisk multilingual-E5: **hybrid75/80 =93,75 % PASS**, vector75/80, lexical43/80. DatasætSHA `2ba997172ac18f3fe3e0633f4c820b0f5c268ce1c611cfe12c5030d59ced7895` er uændret. Ingen ugyldige kildeudslip; korrektion, glemning og 16 sikkerhedsspørgsmål bestået. Fem fejl er bevaret (Q04/Q34/Q65/Q66/Q68). `evidence/semantic-b04bcb30.json` er den faktisk udlæste konsolrapport med opsummering/fejl, ikke det komplette artifact med alle96 spørgsmål.
- Kold timeout gav nyttig lexical fallback ved1.546,04 ms; senere warm-kald gav hybrid. Kold modelindlæsning2.520,92 ms, første indeks759,13 ms, varm retrievalp95 38,73 ms, event-loop-p95 21,00 ms, peakRSS653.434.880 B. 122 lokale encoderrequests/253 tekster,121 fuldført/1 annulleret. Ingen eksterne persondata.
- Browserjobbet **fejlede** i Chromium desktop, fordi en scrollbar historikregion modtog fokus før composer. Næste test accepterer kun dette reelle, kontrollerede mellemstop og kræver derefter composer. De øvrige tre forløb kørte ikke. En tidligere grøn matrix er ikke evidens for denne kode.
- Npm-installationen rapporterede **to høje sårbarheder**, endnu uden advisory-afklaring. Ny præcis audit/inventory/lockfile-gate er implementeret; resultatet er **afventer**, ikke accepteret. Den valgte runtime må ikke releasegodkendes på baggrund af retrievalresultatet alene.

Næste låste app-subtree **`c1f9272923d57bc1083ea646e1c67f98b6a0d121`** omfatter settings/organizer/chat/notekladder, eksplicitte claim-korrektioner og historik, lokal kalendercache, dokumenterede priser, planlagt restemadsbackend, token-cache samt isolerede fixtures. Fokuserede faktiske kørsler:104/104 UI/kilde/kalenderkontrakter;146/146 settings/skills/job-kontrakter;38/38 childserver-isolation/regression;77/77 retrieval/cache;82/82 household/meal/shopping/Nemlig;24/24 HTTP+restemad. Disse overlapper og må **ikke summeres**. Fuld suite, fire rigtige browserforløb, ny model-/auditmåling og parret performance afventer dette konkrete commit.

**M6 er ikke accepteret.** Fysisk iPhone/desktop, faktisk zoom/mikrofon og administratorens isolerede restore-check er åbne i `manual-acceptance.md`. Alle historiske resultater nedenfor gælder kun deres angivne revisioner.

## Historisk gate – 0acdca9d (bevaret fejlresultat)

Seneste publicerede app er `0acdca9df4ea5fa7b28fab88ee9e2bd51db0cbed`, app-subtree `4b1e8f05b5dd289236deaa587b17ae2ac01c8935`. Lokal fuld suite: **383/383**, 0 fejl/skip, Node24.22.1, 11,976 s. [CI 42002595243](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42002595243) testede mergecommit `9e322c71e595c6762f9af925a648f7816d7d38f3` med identisk app-subtree: **383/383 Node22.23.4** på 13,871 s.

**CI er samlet fejlet, ikke releasegodkendt:**

- Faktisk E5-model: vector-only75/80 (93,75 %), lexical41/80 (51,25 %), produktets hybrid62/80 (77,5 %) mod krav90 %. Fast datasetSHA `2ba997172ac18f3fe3e0633f4c820b0f5c268ce1c611cfe12c5030d59ced7895`. Rå rapport inkl. alle18 fejl i `evidence/semantic-0acdca9d.json`; [artifact13403675087](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42002595243/artifacts/13403675087), SHA256 `f0df7304fbefafedec313318e821176ddf2578deaa9a18ed2ad703025c18e827`.
- Model performance i CI: kold load2137,95 ms, første indeks514,20 ms, varm retrievalp95 41,28 ms, event-loop-p95 19,01 ms, peakRSS698007552 B. 110 lokale encoderrequests/176 tekster; ingen ekstern behandling af persondata. Dette er syntetisk CPU-måling, ikke produktions-SLA.
- Chromium-desktop nåede husstandsforløbet, men kildesøgningen forventede en ubekræftet opskrift, som med rette var udelukket. Tre øvrige browsertilfælde blev ikke udført. Fire diagnostiske screenshots i [artifact13404000014](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/42002595243/artifacts/13404000014), SHA256 `431de28b50393de201cd5e432d41b321feecf0beb8bb272b3a0706076681e24c`; downloadhash verificeret og I dag/husstand visuelt inspiceret.
- Næste checkpoint retter generisk hybridrangering og recipe-fixturens eksplicitte gennemgang; **ingen spørgsmål, kravgrænser eller produktoplysninger er ændret for at få grønt**. Nyt CI-resultat på den ændrede kode er påkrævet.

Alle tabeller nedenfor er historiske målinger på deres angivne revisioner. De er ikke bevis for senere kode. Fysiske enheder, faktisk zoom/mikrofon og administrativ restore er fortsat afventer manuel verifikation.

All times and results below describe **isolated synthetic development**, never production.

| Date | Candidate / scope | Command or check | Observed result |
|---|---|---|---|
| 2026-11-04 | Unmodified v4.9.1 source | GitHub v4.9.1 and main refs | Both `6b2b0736a32e0968d5db233512672d197b4885f7` |
| 2026-11-04 | Unmodified v4.9.1 source | Compare 99 Git blobs and local `git write-tree` | 99/99 identical; tree `3de6cd0accb7f5c637835b55ca0049276b5ab08b` |
| 2026-11-04 | Unmodified v4.9.1 source | `node --version` | `v24.22.1` |
| 2026-11-04 | Unmodified v4.9.1 source | `cd jarvis-starter && npm test` | 149 passed, 0 failed; Node reports 1.53s |
| 2026-11-04 | Initial published v5 commit `5a95afa7` | GitHub Actions Node.js 22 run `41935634711`, step 4 | **236 passed, 0 failed**; exact remote candidate tree `9c92c5e7` |
| 2026-11-04 | Follow-up local v5 candidate (not yet published) | `cd jarvis-starter && npm test` | **239 passed, 0 failed**, Node 4.69 s; adds calendar persistence failure, storage-readiness and schema-manifest coverage |
| 2026-11-04 | Local v5 candidate | `node --test test/v5-intelligence.test.mjs` | 45 passed including 30 planning subcases; 80/80 (100%) synthetic **lexical** correct-source@5 |
| 2026-11-04 | Local v5 candidate | `node --test test/deploy-release.test.mjs test/v5-server.test.mjs` | Initial 9 passed; newer full-suite run additionally covers real calendar coverage and manifest compatibility |
| 2026-11-04 | Local v5 candidate | `git diff --check` and `node --check` of edited JS | No whitespace or syntax errors in last checks; rerun after commit |
| 2026-11-04 | Local v5 candidate | `node scripts/v5-visual-smoke.mjs` | **BLOCKED before opening browser**: Chromium OS socket `Operation not permitted`; WebKit binary unavailable. Must run on CI runner |
| 2026-11-04 | Published follow-up `ceeb038da64d83a765723bcf01d23964f25d0444` | GitHub Actions `41937431111` | Node 22 **239/239 passed**, Chromium and WebKit installed. Browser smoke **failed** on desktop 1390×950: message composer bottom 994.58 px, beyond 950 px viewport. Real product defect, not an environment skip. |
| 2026-11-04 | Pending new iteration | `public/v5.css` constrained chat history scroll; `scripts/v5-visual-smoke.mjs` now captures initial-home evidence and asserts draft retention through a reload | **Not yet browser-verified**. New commit + CI required before closing K2/R03/M5. |
| 2026-11-05 | Published `f85f475e` | GitHub Actions `41938011226`, Node 22 + Chromium smoke | **239/239 Node passed; browser failed identically (994.58px)**. Screenshot artifact `13373919053` proved the browser was rendering the *old* unstyled hero. Root cause: server static-file allowlist did not serve `v5.css` or `v5-plan.js` (HTTP 404), so neither layout nor Plan handlers loaded. |
| 2026-11-05 | Next local iteration | `node --test test/v5-server.test.mjs`; `npm test` | **4/4 focused and 240/240 full suite passed**, Node ~4.90 s; new test fetches **every** `index.html` linked stylesheet/script over HTTP, verifies MIME types, and explicitly checks `/v5.css` and `/v5-plan.js`. Browser rerun required. |
| 2026-11-05 | Published `9ce2760c` | GitHub Actions `41938734839` | **240/240 Node 22 passed**. Chromium got through first-screen layout, navigation and forms, but browser smoke failed because a normal refresh flagged an unchanged server preference as a concurrent edit: `/Ikke gemt/` expected, actual `Ændret et andet sted...`. This is a *real false conflict* in `updateDraft`, not a typo in the acceptance test. |
| 2026-11-05 | Local follow-up (pending CI) | `public/app.js`, `scripts/v5-visual-smoke.mjs`; `npm test` | **240/240** Node + syntax passed (~5.23 s). Dirty drafts now compare fetched server text with the **previous server baseline** (preserved across reload) rather than comparing against the user's unsaved text. Browser also tests real synthetic concurrent remote save; not yet verified on CI. |
| 2026-11-05 | Published `36ac8a7f` | GitHub Actions `41939504752` | **240/240 Node 22 passed**, initial desktop, nav, normal refresh and draft reload passed; browser then failed because first recorded server baseline was missing for a draft created before initial fetch, so synthetic concurrent change did not display conflict. |
| 2026-11-05 | Latest local amendment (pending CI) | `public/app.js` missing-baseline initialisation; `scripts/v5-visual-smoke.mjs` explicit refresh before remote synthetic edit; `npm test` | **240/240 passed**, Node ~4.76 s. Browser check of actual concurrent modification still required. |
| 2026-11-05 | Published `9e2d909a` | GitHub Actions `41940193356` | Node 22 **240/240 passed**; first-screen/nav/draft/reload passed in Chromium, but an actual synthetic concurrent change still did not produce a conflict message. Further instrumenting test to distinguish server persist vs browser server baseline before changing logic again; not accepted. |
| 2026-11-05 | Published `6c41e2a8` | GitHub Actions `41940701409` | Node 22 **240/240 passed**; browser smoke **not run**. Job was cancelled at its 18-minute limit while `npx playwright install --with-deps` downloaded dozens of Ubuntu libraries from a slow Azure mirror (still retrieving package 68). Missing result is an infrastructure blocker, not a UI pass/fail. |
| 2026-11-05 | CI bootstrap published in `2710b82e` | `.github/workflows/v48-visual.yml` | Downloads Chromium and WebKit without the 100+ apt dependencies; both browser launches and all 4 viewport/device runs remain mandatory. Any launch failure must be reported, not skipped. |
| 2026-11-05 | Published `2710b82e` | GitHub Actions `41943432245` | **240/240 Node 22 passed**. Direct browser binary install completed rapidly, Chromium desktop completed all flow checks including true concurrent draft conflict. Mobile failed at the *test fixture*: it reused desktop's identical synthetic server edit, so the second request made no change and JARVIS correctly did not flag a conflict. Make each device's synthetic edit unique, then rerun both engines/sizes. |
| 2026-11-05 | Published `dc6b34b2` | GitHub Actions `41943827918` | **240/240 Node 22 passed**; unique per-device conflict fixtures allowed **both Chromium sizes** through the full synthetic browser workflow. WebKit launch then **failed due missing OS libs** on the host runner (GTK4, Graphene, GStreamer, Flite, libavif, libmanette and others); not a JARVIS UI failure or a pass. |
| 2026-11-05 | Local CI-only iteration (awaits verification) | `.github/workflows/v48-visual.yml` | Official Playwright `v1.64.1-noble` container with matching `playwright@1.64.1`, user UID 1001, no `--privileged`; preserves Chromium/WebKit launch as hard gate. Check actual runner and both WebKit workflows before acceptance. |
| 2026-11-05 | Published `4a6edfe4e99381c93d1ec7c2f34aed4dc7cab6e4` | GitHub Actions [run 41944278403](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944278403), Node 22 + pinned non-root browser container | **SUCCESS**: 240/240 Node tests plus Chromium desktop/mobile and WebKit desktop/mobile browser workflows. All four reported navigation, history, dirty drafts, true synthetic remote-conflict handling, and first-screen composer passed. Zero runtime page errors. 16 synthetic screenshot files in [artifact 13378221166](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944278403/artifacts/13378221166). Browser emulation is not physical iPhone testing. |
| 2026-11-05 | Local Danish microcopy patch (not yet CI-verified) | `public/index.html`, `system-health.js`, `smart-home.js`, browser regression script | Adjusts greeting spacing and visible Danish labels for system/Smart Home. New CI run required because browser-visible code changed after the green run. |
| 2026-11-05 | Final tested application `f19c85d695b87cc7f7c93f609afa3cc756de3df2` / subtree `bf87ea8604223ed4ec401ddbd781d55c945203ea` | [GitHub Actions `41944996605`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944996605) | **SUCCESS**: **240/240 Node tests** (Node 22); **all 4 Chromium/WebKit desktop 1390×950 and mobile 390×844 flows passed**, including new Danish microcopy assertions, task/case/claim creation, navigation/history, reload-preserved drafts, actual synthetic concurrent edit, and first-screen composer. **16** [synthetic screenshots](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944996605/artifacts/13378367690), artifact SHA-256 `aaf2ca9dd4b2e93a857dabc7c89bdd64be443349873218022a9d4333e6f0a231`. CI is browser emulation, **not physical iPhone or desktop acceptance**. |
| 2026-11-05 | Reconstructed exact remote head `e07dba1c` / `133/133` Git blob hashes | `cd jarvis-v5-resume/jarvis-starter && npm test` | Initial **239/240** locally: R01 fault-injection test tried to make a directory over the state file already created by startup; previous remote Node 22/CI run was 240/240. Test setup corrected without reducing assertions. Original dirty checkout preserved. |
| 2026-11-05 | Resumed M1 local iteration, **not yet remote CI-tested** | `cd jarvis-v5-resume/jarvis-starter && node --test test/v5-stability.test.mjs`; `npm test` | **7/7 focused** and **243/243 full** passed, Node 24.22.1, 7.12 seconds. Added rollback tests for manual organizer, memory and task edits under a real rename fault; post-rename fsync failure is tagged unknown, never treated as pre-publication failure; ordinary rename failure preserves prior bytes. Remote code/tree binding and browser run still required. |
| 2026-11-05 | Published M1 `7161a873137c5c0f3933d875eb33f78b12bd3209`, app subtree `78ce80b4bde0853e15490baf43f17cc92f13fa51` | [Actions `41983867576`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41983867576) | **SUCCESS**: **243/243** Node 22, 0 failed; `desktop`, `mobile`, `webkit-desktop`, `webkit-mobile` all passed unchanged synthetic browser workflow, with screenshots. Exact published remote Git tree `cbb6e412decd451ba9f980396d4edb8b29c8e5b9` matched local tree; original dirty development checkout was not altered. |
| 2026-11-05 | Next local M5 iteration, **not yet published** | `cd jarvis-v5-resume/jarvis-starter && npm test` + JS syntax check | **243/243** Node tests, 0 failed. Combined legacy and structured claim creation in a single visible editor mode, removed duplicate settings editor, added session-scoped draft restoration and expanded browser checks for actual claim source IDs, back navigation, focus and unsaved note reload. Actual Chromium/WebKit verdict **pending** on new code. |
| 2026-11-05 | Published M5 `66acb7f0a00b1d8427ce69c3a7450d1b34ccd933` | [Actions `41984714363`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41984714363) | **243/243 Node 22 passed; browser FAILED** on Chromium desktop: the test looked for a highlighted **claim** after opening the first lexical search result, but no claim highlight appeared. Root cause was **not proven**: either a different document ranked first or asynchronous rerender removed the highlight. Saved six diagnostic screenshots (artifact `13395088698`); other browser cases did not execute. |
| 2026-11-05 | Published R11 iteration `4582edae79f4f06d7a3619be1891cb9872bebada` | [Actions `41985321179`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41985321179) | **243/243 Node 22 passed; browser FAILED identically** on Chromium desktop: still no highlighted claim; this means the async-refresh explanation alone is insufficient. New diagnostic fixture will select by the actual claim subject, assert URL source type/ID and report rendered card/status before evaluating the target. |
| 2026-11-05 | Published diagnostic fixture `e6b958e21fb4a9ebd5af77db33d44bee6848191a` | [Actions `41985893298`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41985893298) | **243/243 Node 22 passed; browser FAILED on the second Chromium device**. Precise diagnostic from desktop proved exact `claim:<uuid>` URL, matching `[data-claim-id]`, `source-target=true`, visible card and no JS errors. On mobile, no result for `syntetisk_emne` remained because the fixture reused the **same synthetic claim across devices**: duplicate create returned an existing confirmed claim and the first button was now “Arkivér”, not “Bekræft”. This is a test-fixture bug, not proof of a product source-route fault. Earlier R11 timing suspicion remains unconfirmed; asynchronous refresh is nevertheless now awaited. New fixture will use unique claim subject/value per browser and wait for explicit confirmed status. |
| 2026-11-05 | Published code `fa4d0e952ccc29e19937211b530b60d89f756755`, app subtree `42d30beb971929aad964609f46ebc7f1e47e8061` | [Actions `41986430567`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567) | **SUCCESS:** **243/243** Node 22, **Chromium desktop/mobile and WebKit desktop/mobile 4/4**. All four source diagnostics prove matching exact claim UUID, `source-target=true`, visible record, empty error status and no JS errors. Browser also asserts memory creation draft recovery on reload, one visible editor, history/back path and input focus after polling. 16 [synthetic screenshots](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567/artifacts/13396151555), artifact SHA-256 `fef3174fe8410069960a0e30700d77e68341b8e271f38c3da39c4e0fa172d33a`. Physical devices were not used. |

## Synthetic before/after performance

Executed independently against the exact reconstructed v4.9.1 source tree and the local v5 candidate using the same `scripts/v5-perf.mjs` with 400 synthetic organizer records, 200 confirmed memory notes, no real integrations, and Node **v24.22.1**. 30 requests for local API/search and 12 writes. These measurements are illustrative, not production SLAs.

| Measurement | v4.9.1 source | v5 candidate | Interpretation |
|---|---:|---:|---|
| Full `/api/state` payload | 72,198 B | 72,368 B | v5 adds schema metadata, full refresh still large |
| Polling payload | 72,198 B (full state) | **117 B** (`/api/overview`) | Approx. 99.84% lower per overview poll in fixture |
| Full state HTTP p95 | 8.64 ms | 5.58 ms | Local, workload-sensitive |
| Overview HTTP p95 | not available | 2.50 ms | New narrow endpoint |
| Knowledge search HTTP p95 | 9.47 ms | 7.99 ms | Local lexical, no real embedding |
| Preferences write HTTP p95 | 9.17 ms | 7.72 ms | JSON/fsync, local fixture |
| Process resident memory | 66.2 MiB | 66.8 MiB | One idle synthetic process |
| Live retailer/Discord/Google wait | not measured | not measured | Connectors intentionally disabled |
| Model and tool usage | 0 in fixture | 0 in fixture | No paid calls; actual cost baseline unavailable |
| Queue wait and resource pressure | not measured | synthetic queue behavior tested | No representative load/large model wait tested |

### New paired rerun on 2026-11-05 – exact current app content `ac48d6a4`

Re-executed the same benchmark commands, same fixture and local Node `v24.22.1` after publishing the diagnostic candidate `6c41e2a8`. Results differ from the earlier short local run: they are **not stable performance guarantees**. In this paired sample, new full-state/search/write paths are somewhat *slower*; the substantial win is the narrow overview response.

| Measurement | Exact v4.9.1 tree | Current v5 app subtree `ac48d6a4` |
|---|---:|---:|
| Full state payload | 72,198 B | 72,368 B |
| Full state p95 (30 HTTP requests) | 3.29 ms | 5.89 ms |
| Overview HTTP (30 requests) | not available | **117 B; p95 0.91 ms** |
| Knowledge retrieval p95 (30 requests) | 3.87 ms | 6.57 ms |
| Preferences write p95 (12 requests) | 3.32 ms | 5.19 ms |
| Idle process RSS | 66.3 MiB | 66.8 MiB |

No live model calls, integration wait, real queue pressure or representative external service latency were measured in this rerun. The retrieval benchmark uses local lexical text only. Improvements cannot be inferred from one short pair of p95 samples.

Commands:

```
node scripts/v5-perf.mjs --app /tmp/jarvis-v491-baseline/jarvis-starter --label v4.9.1
node scripts/v5-perf.mjs --app /workspace/scratch/0a910068d923/jarvis-v5-work/jarvis-starter --label v5.0.0
```

The first path was populated from local Git snapshot `ecc2944`, whose tree was verified byte-for-byte against remote `v4.9.1` SHA `6b2b073...`. To reproduce later, unpack the exact `v4.9.1` tree and pass its `jarvis-starter` directory as `--app`.

## Resterende evidens

- Fuld Node22-regression, ægte model, dependency-audit og den udvidede browsermatrix skal gentages på den nye kode, ikke genbruges fra501-test-kandidaten.
- Mindst90 % faktisk hybrid top5 blev målt påb04bcb30, men fem relevante spørgsmål fejlede. Ingen fixtureændring eller påstand om perfekt hukommelse. Ny worker-runtime/token-cache kræver ny kørsel.
- Planlægningens38 forskellige scenarier og lokale kalenderkontrakter er syntetiske. Reelle konti og persondata er ikke testet.
- Fysisk iPhone/desktop, rigtig200 % zoom, mikrofonvalg og isoleret administrativ restore afventer personer/enheder. Emulering er ikke erstatning.
- Syntetiske migrationer, afbrydelser, genoptagelse, nyere-skema-afvisning og hashbundet restore er testet; det konkrete endelige kandidatcommit skal bindes til disse tests.
- Parret performance skal gentages på den nye kandidat. Syntetisk modelventetid er ikke liveintegrationers svartid, og tegn-/requesttal er ikke fakturerede tokens eller priser.
- Alle P0/P1 skal lukkes før release. M7 merge, stabilt tag/release og produktion er fortsat tre særskilte godkendelser.
