# JARVIS v5 resumable progress

Latest fully browser-tested **application**: 2026-11-05, package `5.0.0`, data schema `1`, published code commit **`fa4d0e952ccc29e19937211b530b60d89f756755`**, Git tree **`009c2faf67167e2fd840823e645d24fe09c8ae19`**, application subtree **`42d30beb971929aad964609f46ebc7f1e47e8061`**. GitHub Actions [run `41986430567`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567): **243/243 Node 22 tests passed and all four Chromium/WebKit workflows passed** at 1390 × 950 and 390 × 844, including revised source-ID, draft reload, focus and history checks. **16 synthetic screenshots**, [artifact `13396151555`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567/artifacts/13396151555), SHA-256 `fef3174fe8410069960a0e30700d77e68341b8e271f38c3da39c4e0fa172d33a`. M7 remains unauthorised and untouched.

**Resumption provenance (2026-11-05):** A second, separate worktree `jarvis-v5-resume` was reconstructed against **133/133** remote blobs at prior head `e07dba1c`, tree `d836025a409985c514af95617ed602f602c52318`. The original `jarvis-v5-work` with its pre-existing uncommitted edits remains untouched. On the first local run the remote snapshot had **239/240** passing tests due to timing in an R01 test setup (startup had already created `state.json`); the deterministic fault fixture and new M1 test cases later passed **243/243** locally and in CI. No historical tag was changed.

**M1 published and verified:** commit `7161a873137c5c0f3933d875eb33f78b12bd3209`, exact tree `cbb6e412decd451ba9f980396d4edb8b29c8e5b9`, app subtree `78ce80b4bde0853e15490baf43f17cc92f13fa51`: [Actions run `41983867576`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41983867576) **243/243 Node 22 tests and Chromium/WebKit 4/4 succeeded**. A **new M5 UI iteration** is now local-only: the memory editor becomes a single visible entry point with a mode selector and session-scoped draft recovery, and source-route/focus assertions are added to browser smoke. Its browser evidence must be obtained from its own new commit; do not reuse `41983867576` for M5 acceptance.

**M5 browser evidence remains open:** published commit `66acb7f0a00b1d8427ce69c3a7450d1b34ccd933`, app subtree `45758ad42f14fcc5edfa6df514b8abb60c258ae9`, [CI `41984714363`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41984714363) **243 Node 22 tests passed; Chromium desktop browser FAILED** looking for a claim source highlight after selecting the first lexical result. The event now awaits asynchronous refresh in published `4582edae` but [CI `41985321179`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41985321179) **failed the same browser assertion**. Root cause remains under investigation; the next fixture binds selection to the exact claim subject, validates the URL source ID, and logs DOM status. **No browser acceptance until corrected CI is green.**

**R11 investigation outcome:** [CI `41985893298`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41985893298) proved that the exact source highlight works on Chromium desktop (matching route UUID, rendered card and no page errors). The later mobile case failed because it reused the same synthetic claim: the duplicate was already confirmed, and the test clicked its “Arkivér” button. The next candidate uses distinct subject/value per device and awaits an explicit confirmation before retrieval. No product source-route defect has been demonstrated by this sequence; the async refresh fix remains a safe improvement.

**M5 latest result:** published `fa4d0e95` and [CI `41986430567`](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/actions/runs/41986430567) passed **all 243 Node 22 tests and four Chromium/WebKit devices** with distinct fixture records. Exact source URL, matching highlighted revisioned record, history return, retained memory creation draft and active input focus passed, without page errors. The one-visible-form memory editor is implemented and browser-tested, while the old and new **backend record models remain separate**; full physical accessibility and content review remain pending.

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
- **M5**: seven desktop/five mobile navigation, source routing, Plan/knowledge editors, structured meal UI and statuses implemented. One visible memory-creation mode at a time, session drafts and source ID/history/focus checks **tested 4/4 in CI** on `fa4d0e95`. Common memory backend model, full keyboard/zoom/contrast, meal workflow and physical acceptance still pending.
- **M6**: migration/restore/rollback unit evidence, candidate package/version, before/after measurements and release documents exist. **243 Node and four-browser CI green on exact tested application `fa4d0e95`**. M6 **not accepted** until physical devices, genuine semantic retrieval, full recovery/manual and remaining P0/P1 gaps are resolved.
- **M7**: separate owner approvals required.

The concrete staged M7 decision path, candidate binding and blockers are in `release-proposal.md`. Nothing there authorizes a merge, tag or installation.

## Executed tests / known limits

- `cd jarvis-starter && npm test`: **239/239** in 4.69 seconds, 0 failures (latest local amendment); first published commit CI **236/236**.
- Resume snapshot command `cd /workspace/scratch/0a910068d923/jarvis-v5-resume/jarvis-starter && npm test`: **243/243** locally; latest **matching code** passed **243/243 on Node 22 in CI `41986430567`**, browser 4/4.
- `node --test test/v5-intelligence.test.mjs`: 45 tests; 80/80 lexical correct-source@5, 30 planning cases; this is not genuine semantic evaluation.
- `node --test test/deploy-release.test.mjs test/v5-server.test.mjs`: 9 tests green, including restart, click-intent and version/rollback safety.
- `node scripts/v5-visual-smoke.mjs`: local Chromium remains blocked by sandbox `socket() Operation not permitted`, but CI `41944996605` ran all four browser cases successfully and saved 16 synthetic screenshots from the exact final application hash.
- Synthetic perf rerun 2026-11-05 (current application subtree `ac48d6a4`): `/api/overview` **117 B, p95 0.91 ms** vs baseline full-state 72,198 B, p95 3.29 ms. v5 full state/search/write p95 were *slower* in this second short paired sample. Both measurements and caveats in `verification.md`.
- No live credentials, production data, external basket writes, real recurring activation, release tag, merge or deployment.

## Continuation

1. Review [draft PR #7](https://github.com/christopherpedersendk-web/jarvis-personal-assistant/pull/7), latest code SHA `fa4d0e95`, CI `41986430567`, the 16 screenshot artifacts, and outstanding requirements. A subsequent documentation-only commit does not change the tested application subtree; verify it before future release decisions.
2. Complete remaining background/project/multi-file transaction safety, genuine local multilingual semantic embeddings and independent ≥90% source@5 evaluation. The historical/structured memory backend consolidation needs a migration design; never silently rewrite existing personal information.
3. Arrange physical iPhone/desktop usability checks and an administrator-controlled restore/recovery rehearsal. M7 merge, stable tag, release and installation remain **separately approved**.
