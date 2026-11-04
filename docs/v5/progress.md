# JARVIS v5 resumable progress

Latest tested local candidate: 2026-11-04, package `5.0.0`, data schema `1`, **239/239 Node tests passed**. First published commit `5a95afa7` passed **236/236** independently in GitHub Actions on Node 22. This follow-up code and documentation must be published and rechecked at the new head. **CI browser checks are still pending.** No M7 action has been taken.

## Provenance

- Production and M7 were not accessed or performed.
- Remote development branch: `feature/v5-foundation`, initially at exact v4.9.1 SHA `6b2b0736a32e0968d5db233512672d197b4885f7`.
- Local isolated workspace: `jarvis-v5-work`; local snapshot root commit differs from GitHub history, but exact source tree matches.
- Initial 149/149 baseline tests passed before edits.
- Node `v24.22.1`, declared runtime `>=22.6.0`, CI setup `22` (tests required).
- The exact initial local Git tree matched remote `v4.9.1`, despite separate local root commit `ecc2944`.
- Published tested code commit: `5a95afa7dcb5ff6d919ee6de84c8b32bb6bc44f1` (parent is exact baseline `6b2b0736a32e0968d5db233512672d197b4885f7`).
- Exact matching local/GitHub tree SHA: `9c92c5e7ca4f1fde5a4775a1140e50e22252c184` (61 modified/new paths, all blob hashes compared; no forced update).
- Latest locally tested **application subtree content hash** (`jarvis-starter`): `faea6a8a95f5f5cdfb733afc21c29c2d06a38ae2` (includes the follow-up 239-test patch; compare this same hash with the GitHub tree after publication).
- [Draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) targets `main` but is **not merge-authorised**. GitHub Actions run `41935634711` passed all 236 Node tests, but browser installation was still in progress at last check.
- Follow-up local changes (pending publication): session-scoped draft recovery; fail-closed calendar coverage and persisted OAuth token rotations; independent `/ready` storage write-probe; and schema compatibility checks from release manifest through staging/deployment. All 239 Node tests green.

## Status

- **M0**: baseline SHA/tree and historical tests verified; representative before/after synthetic performance measured. Scope matrix complete.
- **M1**: R01/R02/R04/R05/R06/R07/R08 focused fault and approval tests green; release schema compatibility is now bound to manifest/staging approval. R03 still requires browser draft/focus acceptance; legacy in-memory-before-save cases still need full sweep.
- **M2**: JSON schema 1, immutable backup, atomic/fsync publish, readiness write-probe, same-file mutation contract, action journal, queue and domain APIs implemented/tested synthetically. Not every legacy mutation or external wait uses the shared queue; **partial**.
- **M3**: personal claims/search, separate persistent tasks, deterministic capacity with fail-closed actual read-only calendar coverage, follow-ups, skills versioning, Discord resilience and recurring retry/observation are integrated and Node-tested. **B3 genuine Danish semantic model missing**, independent 90% retrieval gate pending.
- **M4**: household rhythm, recipe review/feedback, inventory reservations, editable meals, shopping proposal and one-use Nemlig owner-click intention implemented/tested synthetically. Live credential-free browser and household acceptance pending.
- **M5**: seven desktop/five mobile navigation, deep-link source routing, Plan and knowledge forms, structured meal UI, statuses/drafts implemented. **Chromium unable to start locally** (OS socket) and WebKit binary missing; CI/browser/manual acceptance pending.
- **M6**: migration/restore/rollback unit evidence, candidate package/version, before/after measurements and release documents exist. **Not accepted** until candidate SHA CI, both browser engines, physical devices, semantic and recovery gaps are resolved.
- **M7**: separate owner approvals required.

## Executed tests / known limits

- `cd jarvis-starter && npm test`: **239/239** in 4.69 seconds, 0 failures (latest local amendment); first published commit CI **236/236**.
- `node --test test/v5-intelligence.test.mjs`: 45 tests; 80/80 lexical correct-source@5, 30 planning cases; this is not genuine semantic evaluation.
- `node --test test/deploy-release.test.mjs test/v5-server.test.mjs`: 9 tests green, including restart, click-intent and version/rollback safety.
- `node scripts/v5-visual-smoke.mjs`: blocked before page load by sandbox Chromium `socket() Operation not permitted`; WebKit absent. `.github/workflows/v48-visual.yml` now prepares CI Chromium+WebKit at 1390×950 and 390×844.
- Synthetic perf: `/api/overview` 117 B/p95 2.50 ms vs baseline full-state 72,198 B/p95 8.64 ms. Details in `verification.md`.
- No live credentials, production data, external basket writes, real recurring activation, release tag, merge or deployment.

## Continuation

1. Publish the follow-up verified local patch as a descendant of `5a95afa...` using the GitHub Git Data API, without pushing the synthetic local history. Verify the exact new tree against the local commit.
2. Review [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) and initial CI run `41935634711`; record final browser verdict and any reproducible failure, then check the new-head CI result.
3. Capture the last commit SHA and working-tree status, update review comments if a further patch is required. Never treat this as M7 approval.
4. Complete genuine local semantic provider and independent Danish retrieval gate, unify memory editing, survey legacy data transactions, and verify any pending acceptance rows.
5. Have owner/manual reviewers complete physical iPhone/desktop and administrator-safe recovery checks. M7 merge, stable `v5.0.0` tag/release and production install are separate authorisations.
