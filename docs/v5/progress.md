# JARVIS v5 resumable progress

Last tested local candidate: 2026-11-04, package `5.0.0`, data schema `1`, **236/236 Node tests passed**. Update the remote commit/SHA and CI result after publication; no M7 action has been taken.

## Provenance

- Production and M7 were not accessed or performed.
- Remote development branch: `feature/v5-foundation`, initially at exact v4.9.1 SHA `6b2b0736a32e0968d5db233512672d197b4885f7`.
- Local isolated workspace: `jarvis-v5-work`; local snapshot root commit differs from GitHub history, but exact source tree matches.
- Initial 149/149 baseline tests passed before edits.
- Node `v24.22.1`, declared runtime `>=22.6.0`, CI setup `22` (tests required).
- The exact initial local Git tree matched remote `v4.9.1`, despite separate local root commit `ecc2944`.
- Current remote branch head at last verification: `6b2b0736a32e0968d5db233512672d197b4885f7` (no candidate commit published yet).

## Status

- **M0**: baseline SHA/tree and historical tests verified; representative before/after synthetic performance measured. Scope matrix complete.
- **M1**: R01/R02/R04/R05/R06/R07/R08 focused fault and approval tests green. R03 still requires browser draft/focus acceptance; legacy in-memory-before-save cases still need full sweep.
- **M2**: JSON schema 1, immutable backup, atomic/fsync publish, same-file mutation contract, action journal, queue and domain APIs implemented/tested synthetically. Not every legacy mutation or external wait uses the shared queue; **partial**.
- **M3**: personal claims/search, separate persistent tasks, deterministic capacity, follow-ups, skills versioning, Discord resilience and recurring retry/observation are integrated and Node-tested. **B3 genuine Danish semantic model missing**, independent 90% retrieval gate pending.
- **M4**: household rhythm, recipe review/feedback, inventory reservations, editable meals, shopping proposal and one-use Nemlig owner-click intention implemented/tested synthetically. Live credential-free browser and household acceptance pending.
- **M5**: seven desktop/five mobile navigation, deep-link source routing, Plan and knowledge forms, structured meal UI, statuses/drafts implemented. **Chromium unable to start locally** (OS socket) and WebKit binary missing; CI/browser/manual acceptance pending.
- **M6**: migration/restore/rollback unit evidence, candidate package/version, before/after measurements and release documents exist. **Not accepted** until candidate SHA CI, both browser engines, physical devices, semantic and recovery gaps are resolved.
- **M7**: separate owner approvals required.

## Executed tests / known limits

- `cd jarvis-starter && npm test`: **236/236** in 4.60 seconds, 0 failures.
- `node --test test/v5-intelligence.test.mjs`: 45 tests; 80/80 lexical correct-source@5, 30 planning cases; this is not genuine semantic evaluation.
- `node --test test/deploy-release.test.mjs test/v5-server.test.mjs`: 9 tests green, including restart, click-intent and version/rollback safety.
- `node scripts/v5-visual-smoke.mjs`: blocked before page load by sandbox Chromium `socket() Operation not permitted`; WebKit absent. `.github/workflows/v48-visual.yml` now prepares CI Chromium+WebKit at 1390×950 and 390×844.
- Synthetic perf: `/api/overview` 117 B/p95 2.50 ms vs baseline full-state 72,198 B/p95 8.64 ms. Details in `verification.md`.
- No live credentials, production data, external basket writes, real recurring activation, release tag, merge or deployment.

## Continuation

1. Inspect the local worktree and `git diff ecc2944`, preserve all edits. Run full `npm test`, syntax and `git diff --check` once more.
2. Publish exact changed/new files as descendant commit(s) of remote branch via authorised GitHub Git Data APIs; never push local synthetic history. Record remote SHA here.
3. Open a **draft** PR for review, trigger CI including Chromium+WebKit, and record checks/screenshot URLs bound to that SHA. Fix any CI regressions in the development branch.
4. Complete genuine local semantic provider and independent Danish retrieval gate, unify memory editing, survey legacy data transactions, and verify any pending acceptance rows.
5. Have owner/manual reviewers complete physical iPhone/desktop and administrator-safe recovery checks. M7 merge, stable `v5.0.0` tag/release and production install are separate authorisations.
