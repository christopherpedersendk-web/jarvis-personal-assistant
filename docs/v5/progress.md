# JARVIS v5 resumable progress

Latest fully browser-tested **application**: 2026-11-05, package `5.0.0`, schema `1`, published commit **`f19c85d695b87cc7f7c93f609afa3cc756de3df2`**, source tree `aa19a74523a5e57ea2322bba6f30f000d8d25020` and **application subtree `bf87ea8604223ed4ec401ddbd781d55c945203ea`**. GitHub Actions `41944996605`: **240/240 Node 22 tests and Chromium + WebKit at 1390×950 and 390×844 passed**; all 16 synthetic screenshots saved as artifact `13378367690`. A subsequent documentation-only update preserves this exact application subtree. No M7 action has been taken.

**Resume iteration (2026-11-05; awaiting publication/CI):** A second, separate worktree `jarvis-v5-resume` was reconstructed against all **133/133** blobs at remote head `e07dba1c187e5e4fff66ba98912f04d36887168e`, tree `d836025a409985c514af95617ed602f602c52318`. The original `jarvis-v5-work` worktree, with its pre-existing uncommitted changes, remains untouched. The unmodified remote snapshot initially ran **239/240** Node tests locally because the R01 test assumed startup had not already created `state.json`; after making that fault-injection setup deterministic and guarding additional legacy local writes, the revised local suite passes **243/243** (Node 24.22.1). This *new code* has not yet passed remote Node 22 or browser CI; do not attribute the previous green run to it.

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
- Current locally tested **Danish UI microcopy subtree hash**: `bf87ea8604223ed4ec401ddbd781d55c945203ea` (240/240 tests, pending new browser CI, no M7).
- [Draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7) targets `main` but is **not merge-authorised**. [GitHub Actions `41944996605`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944996605) were **green** for Node and all four browsers against actual microcopy code commit `f19c85d`. [Screenshot artifact `13378367690`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41944996605/artifacts/13378367690) is synthetic and expires after 14 days.
- Published `ceeb038` includes session-scoped draft recovery; fail-closed calendar coverage and persisted OAuth token rotations; independent `/ready` storage write-probe; and schema compatibility checks from release manifest through staging/deployment. A separate layout correction now awaits CI.

## Status

- **M0**: baseline SHA/tree and historical tests verified; representative before/after synthetic performance measured. Scope matrix complete.
- **M1**: R01/R02/R04/R05/R06/R07/R08 focused fault and approval tests green; release schema compatibility is now bound to manifest/staging approval. R03 still requires browser draft/focus acceptance; legacy in-memory-before-save cases still need full sweep.
- **M1 continuation**: Organizer, legacy memory, inbox/approvals, personal playbook, manual job create/update/archive, proactive settings and preferences now use serialized in-memory rollback on known failed publication. New tests inject rename/disk failures and ensure no ghost state, then verify recovery. Post-rename directory fsync failures are explicitly **unknown** (memory retained, subsequent writes fail closed); not treated as an unapplied mutation. Background-job, project-file and multi-file settings transactions remain open.
- **M2**: JSON schema 1, immutable backup, atomic/fsync publish, readiness write-probe, same-file mutation contract, action journal, queue and domain APIs implemented/tested synthetically. Not every legacy mutation or external wait uses the shared queue; **partial**.
- **M3**: personal claims/search, separate persistent tasks, deterministic capacity with fail-closed actual read-only calendar coverage, follow-ups, skills versioning, Discord resilience and recurring retry/observation are integrated and Node-tested. **B3 genuine Danish semantic model missing**, independent 90% retrieval gate pending.
- **M4**: household rhythm, recipe review/feedback, inventory reservations, editable meals, shopping proposal and one-use Nemlig owner-click intention implemented/tested synthetically. Live credential-free browser and household acceptance pending.
- **M5**: seven desktop/five mobile navigation, deep-link source routing, Plan and knowledge forms, structured meal UI, statuses/drafts implemented. **Chromium and WebKit desktop/mobile smoke passed on final application hash `bf87ea86`**, including Danish overblik labels, first-screen composer, navigation/history, create task/case/claim, reload draft and real synthetic concurrent conflict. Keyboard/zoom/source-specific and physical acceptance remains pending.
- **M6**: migration/restore/rollback unit evidence, candidate package/version, before/after measurements and release documents exist. **Node and four-browser CI green on final tested application `f19c85d`**. M6 **not accepted** until physical devices, semantic retrieval, full recovery/manual and outstanding P0/P1 gaps are resolved.
- **M7**: separate owner approvals required.

The concrete staged M7 decision path, candidate binding and blockers are in `release-proposal.md`. Nothing there authorizes a merge, tag or installation.

## Executed tests / known limits

- `cd jarvis-starter && npm test`: **239/239** in 4.69 seconds, 0 failures (latest local amendment); first published commit CI **236/236**.
- Resume snapshot command `cd /workspace/scratch/0a910068d923/jarvis-v5-resume/jarvis-starter && npm test`: **243/243** in 7.12 seconds, 0 failures (after local R01 fault fixture correction and three added regression cases). This run is **not yet remote CI evidence**.
- `node --test test/v5-intelligence.test.mjs`: 45 tests; 80/80 lexical correct-source@5, 30 planning cases; this is not genuine semantic evaluation.
- `node --test test/deploy-release.test.mjs test/v5-server.test.mjs`: 9 tests green, including restart, click-intent and version/rollback safety.
- `node scripts/v5-visual-smoke.mjs`: local Chromium remains blocked by sandbox `socket() Operation not permitted`, but CI `41944996605` ran all four browser cases successfully and saved 16 synthetic screenshots from the exact final application hash.
- Synthetic perf rerun 2026-11-05 (current application subtree `ac48d6a4`): `/api/overview` **117 B, p95 0.91 ms** vs baseline full-state 72,198 B, p95 3.29 ms. v5 full state/search/write p95 were *slower* in this second short paired sample. Both measurements and caveats in `verification.md`.
- No live credentials, production data, external basket writes, real recurring activation, release tag, merge or deployment.

## Continuation

1. Publish the resumed M1 code as a **fast-forward child of `e07dba1c`**, compare all blob hashes/tree, and run Node 22 plus the four mandatory browser CI workflows against the exact new code. Update this record with the remote SHA and CI outcome.
2. Complete the remaining legacy/multi-file write sweep, a genuine local Danish semantic provider and **independent** ≥90% source@5 evaluation, then consolidate the duplicate memory editors and expand keyboard/zoom/source-route browser tests.
3. Arrange actual physical iPhone/desktop acceptance and an administrator-controlled recovery rehearsal. M7 merge, stable tag, release and installation remain **separate authorisations**.
