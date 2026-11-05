# JARVIS v5 resumable progress

Latest locally tested candidate: 2026-11-05, package `5.0.0`, data schema `1`, **240/240 Node tests passed**. Published `2710b82e` passed Node 22 CI and installed browser binaries rapidly. Chromium desktop completed the full synthetic workflow, including a real concurrent draft conflict. Mobile exposed a **test fixture issue**: repeated identical external edit from desktop, so no new conflict should have occurred. Device-scoped synthetic values are now required before full browser acceptance. No M7 action has been taken.

## Provenance

- Production and M7 were not accessed or performed.
- Remote development branch: `feature/v5-foundation`, initially at exact v4.9.1 SHA `6b2b0736a32e0968d5db233512672d197b4885f7`.
- Local isolated workspace: `jarvis-v5-work`; local snapshot root commit differs from GitHub history, but exact source tree matches.
- Initial 149/149 baseline tests passed before edits.
- Node `v24.22.1`, declared runtime `>=22.6.0`, CI setup `22` (tests required).
- The exact initial local Git tree matched remote `v4.9.1`, despite separate local root commit `ecc2944`.
- Published tested code commit: `5a95afa7dcb5ff6d919ee6de84c8b32bb6bc44f1` (parent is exact baseline `6b2b0736a32e0968d5db233512672d197b4885f7`).
- Exact matching local/GitHub tree SHA: `9c92c5e7ca4f1fde5a4775a1140e50e22252c184` (61 modified/new paths, all blob hashes compared; no forced update).
- Published `ceeb038` **application subtree content hash** (`jarvis-starter`): `faea6a8a95f5f5cdfb733afc21c29c2d06a38ae2` (locally and remotely equal). New layout iteration will have a different subtree hash, to be recorded before publication.
- Current locally tested layout iteration **application subtree hash**: `43032f4584414cfdb15d72dbb228336f6a62efe4` (to compare with the remotely published Git tree).
- Current locally tested **static-route fix application subtree hash**: `2768d78f1ee08fcf8fb4b0d7fd79fcdffe9cf7c2` (240/240 tests; verify identical remote subtree after publication).
- Current locally tested **dirty-draft baseline fix application subtree hash**: `7a9fefa79ca929302826483c7cdc76f8f035c06c` (240/240 tests; verify remote tree after publication).
- Current locally tested **first-fetched-baseline fix application subtree hash**: `3dbe5d5b3c40626bd93e0094ccbee68d37ef7005` (240/240 tests; compare new remote tree after publication).
- Current locally tested **CI diagnostic iteration application subtree hash**: `ac48d6a431daa86382d0abc1a41bec7d52adba54` (240/240 tests; browser before/after evidence pending).
- Current locally tested **per-device UI regression fixture subtree hash**: `92de68a25037935eeef6e98cdac030915e7301ce` (240/240 tests; only synthetic browser script changed since `ac48d6a4`).
- [Draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) targets `main` but is **not merge-authorised**. Actions `41943432245` verified 240 Node tests and completed Chromium desktop; next mobile test detected the repeated-value fixture error. Unique per-device edit and browser rerun pending.
- Published `ceeb038` includes session-scoped draft recovery; fail-closed calendar coverage and persisted OAuth token rotations; independent `/ready` storage write-probe; and schema compatibility checks from release manifest through staging/deployment. A separate layout correction now awaits CI.

## Status

- **M0**: baseline SHA/tree and historical tests verified; representative before/after synthetic performance measured. Scope matrix complete.
- **M1**: R01/R02/R04/R05/R06/R07/R08 focused fault and approval tests green; release schema compatibility is now bound to manifest/staging approval. R03 still requires browser draft/focus acceptance; legacy in-memory-before-save cases still need full sweep.
- **M2**: JSON schema 1, immutable backup, atomic/fsync publish, readiness write-probe, same-file mutation contract, action journal, queue and domain APIs implemented/tested synthetically. Not every legacy mutation or external wait uses the shared queue; **partial**.
- **M3**: personal claims/search, separate persistent tasks, deterministic capacity with fail-closed actual read-only calendar coverage, follow-ups, skills versioning, Discord resilience and recurring retry/observation are integrated and Node-tested. **B3 genuine Danish semantic model missing**, independent 90% retrieval gate pending.
- **M4**: household rhythm, recipe review/feedback, inventory reservations, editable meals, shopping proposal and one-use Nemlig owner-click intention implemented/tested synthetically. Live credential-free browser and household acceptance pending.
- **M5**: seven desktop/five mobile navigation, deep-link source routing, Plan and knowledge forms, structured meal UI, statuses/drafts implemented. Static routes and first-screen check are fixed; normal draft polling/reload passed. **Actual concurrent edit warning still needed a first-server-baseline fix**, which awaits CI. Browser/manual acceptance open.
- **M6**: migration/restore/rollback unit evidence, candidate package/version, before/after measurements and release documents exist. **Not accepted** until candidate SHA CI, both browser engines, physical devices, semantic and recovery gaps are resolved.
- **M7**: separate owner approvals required.

## Executed tests / known limits

- `cd jarvis-starter && npm test`: **239/239** in 4.69 seconds, 0 failures (latest local amendment); first published commit CI **236/236**.
- `node --test test/v5-intelligence.test.mjs`: 45 tests; 80/80 lexical correct-source@5, 30 planning cases; this is not genuine semantic evaluation.
- `node --test test/deploy-release.test.mjs test/v5-server.test.mjs`: 9 tests green, including restart, click-intent and version/rollback safety.
- `node scripts/v5-visual-smoke.mjs`: local Chromium blocked by sandbox `socket() Operation not permitted`; CI installed Chromium+WebKit and revealed the missing static routes through screenshot. Server allowlist corrected locally, new CI pending.
- Synthetic perf rerun 2026-11-05 (current application subtree `ac48d6a4`): `/api/overview` **117 B, p95 0.91 ms** vs baseline full-state 72,198 B, p95 3.29 ms. v5 full state/search/write p95 were *slower* in this second short paired sample. Both measurements and caveats in `verification.md`.
- No live credentials, production data, external basket writes, real recurring activation, release tag, merge or deployment.

## Continuation

1. Publish the per-device browser fixture correction (Node 240/240) as a descendant of `2710b82e` via GitHub Git Data API, compare exact tree, and rerun hard-gated Chromium/WebKit on both sizes.
2. Review [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) and new CI: first-screen composer must fit 1390×950 and 390×844 on both Chromium/WebKit, with saved screenshots and reload-persistence checks.
3. Capture the last commit SHA and working-tree status, update review comments if a further patch is required. Never treat this as M7 approval.
4. Complete genuine local semantic provider and independent Danish retrieval gate, unify memory editing, survey legacy data transactions, and verify any pending acceptance rows.
5. Have owner/manual reviewers complete physical iPhone/desktop and administrator-safe recovery checks. M7 merge, stable `v5.0.0` tag/release and production install are separate authorisations.
