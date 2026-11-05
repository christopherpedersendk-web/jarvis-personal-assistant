# Verification record

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

## Required evidence still pending

- R01–R13 focused Node tests and complete suite are green **locally and in Node 22 CI `41986430567`** on the exact published app subtree. Findings are code findings, not reports of user incidents.
- Previous CI browser failures (static asset 404s, draft baseline conflicts and missing WebKit libraries) were resolved in tested commit `f19c85d`; CI `41944996605` passed all four browser combinations. Further keyboard/zoom/source-route coverage remains outstanding.
- The 80 Danish lexical questions are synthetic and overlap on key terms. **Genuine semantic** retrieval and independent paraphrase quality ≥90% top-five remain pending; do not cite 100% lexical as semantic success.
- 30 deterministic scheduling scenarios, DST, impossible schedules and locks passed locally; integrated live-calendar freshness and selective replan review remain pending.
- Chromium and WebKit desktop (1390×950) and mobile (390×844) passed on published code `fa4d0e95`; exact claim source URL, back navigation, recovered creation drafts and active-input focus **pass browser CI 4/4**. Broader keyboard traversal, zoom, contrast and manual physical-device checks remain pending.
- Physical iPhone and desktop manual checks: **pending owner/device availability**.
- Synthetic migration, interruption/retry, newer-schema refusal, backup restore and rollback-block test passed; **real disaster-recovery exercise pending**.
- Before/after payload, p95 API/search/writes and resident memory measured. Queue/external wait, external costs and loaded performance still unmeasured.
- M7 production health/version verification remains outside this development authorization.
