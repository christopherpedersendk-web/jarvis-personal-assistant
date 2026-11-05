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

Commands:

```
node scripts/v5-perf.mjs --app /tmp/jarvis-v491-baseline/jarvis-starter --label v4.9.1
node scripts/v5-perf.mjs --app /workspace/scratch/0a910068d923/jarvis-v5-work/jarvis-starter --label v5.0.0
```

The first path was populated from local Git snapshot `ecc2944`, whose tree was verified byte-for-byte against remote `v4.9.1` SHA `6b2b073...`. To reproduce later, unpack the exact `v4.9.1` tree and pass its `jarvis-starter` directory as `--app`.

## Required evidence still pending

- R01–R13 focused Node tests and complete suite are green **locally**, but must be bound to the remote candidate SHA and CI.
- The first remote v5 commit passed 236 Node tests in CI; `ceeb038` and `f85f475e` passed 239 Node tests each but **failed browser smoke**. The latter's saved screenshot identified a server allowlist defect hiding new CSS/JS; this is now locally fixed with explicit asset smoke coverage. Must be verified on both browsers and sizes at a newer candidate SHA.
- The 80 Danish lexical questions are synthetic and overlap on key terms. **Genuine semantic** retrieval and independent paraphrase quality ≥90% top-five remain pending; do not cite 100% lexical as semantic success.
- 30 deterministic scheduling scenarios, DST, impossible schedules and locks passed locally; integrated live-calendar freshness and selective replan review remain pending.
- Chromium and WebKit desktop (1390×950) and mobile (390×844) in CI; keyboard, zoom, focus, contrast, source URL and draft-preservation manual/browser checks pending.
- Physical iPhone and desktop manual checks: **pending owner/device availability**.
- Synthetic migration, interruption/retry, newer-schema refusal, backup restore and rollback-block test passed; **real disaster-recovery exercise pending**.
- Before/after payload, p95 API/search/writes and resident memory measured. Queue/external wait, external costs and loaded performance still unmeasured.
- M7 production health/version verification remains outside this development authorization.
