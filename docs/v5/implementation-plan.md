# JARVIS v5.0.0 implementation

Source of requirements: `JARVIS_v5_0_0_Plan_og_teknisk_overdragelse.docx` (owner-provided, 4 November 2026). The document's A–L clauses, R01–R13 register and M0–M7 gates are authoritative for desired behavior. This directory records observed implementation evidence and unresolved gaps.

## Authorised scope

M0–M6: isolated development, synthetic tests, reviewable candidate. M7 (merge, tag/release publication, production installation) remains a separately approved action. No live Nemlig basket changes, real scheduled jobs, new integration permissions, external indexing of personal information, calendar writes, orders or payments.

## Source baseline

- Private repository: `christopherpedersendk-web/jarvis-personal-assistant`.
- Reviewed tag `v4.9.1` and `main`: `6b2b0736a32e0968d5db233512672d197b4885f7`, verified through the authorised GitHub connector on 2026-11-04.
- Verified source tree: `3de6cd0accb7f5c637835b55ca0049276b5ab08b`. All 99 retrieved text-file Git blob hashes matched; local `git write-tree` also matched.
- Remote branch `feature/v5-foundation` was created from the above commit. The isolated local Git repository contains a reconstructed source snapshot whose initial *tree* matches the baseline, but whose local root commit has different history because CLI Git authentication is unavailable. Publish subsequent changes against the remote baseline using the connector's Git Data API, never by force-pushing this reconstructed local history.
- Node runtime checked: `v24.22.1` (documented minimum `>=22.6.0`).
- Initial `npm test` from unchanged source: **149 passed, 0 failed**, elapsed 1.53 seconds per Node test summary.

## Milestone gates

| Milestone | Goal | Evidence needed |
|---|---|---|
| M0 | Confirm baseline, scope, R register, measured behavior | SHA/tree, tests, traceability and baseline performance |
| M1 | Stabilise critical storage, settings, draft and approvals | R01–R06 and hard safety regressions under fault injection |
| M2 | Shared revisions, sources, journal, queue and API contracts | Deterministic persistence/restart tests and truthful status |
| M3 | Memory, general planning, follow-up and skills/jobs | 80 Danish memory questions, 30 planning cases, recurrent job failure tests |
| M4 | Household, recipe, weekly meals and Nemlig review | Reviewable end-to-end workflow without live writes |
| M5 | Danish navigation, editors and context-preserving UI | Desktop/mobile Chromium and WebKit, drafts and source links |
| M6 | Candidate, migration, restore, rollback and performance | Candidate-bound tests, measured results and manual-test register |

## Boundaries with special risk

1. The actual owner click on **Overfør til Nemlig** authorises only the reviewed proposal/revision. All earlier steps are reads or local drafts; preserve unrelated basket contents. No order, payment or checkout routes.
2. Unknown external write results are never blindly retried. No local version guarantee can make Nemlig's external basket read/write sequence atomic.
3. Google Calendar is read-only and its events are not evidence of household attendance.
4. Imported content cannot confer permissions or become a confirmed personal preference without review.
5. Migration/rollback must preserve newer user data; an old app must reject unknown newer schema versions.
6. P2 Home OAuth/Nest battery integration, calendar write/Google Tasks and general browser booking are outside the v5 release gate.

## Working notes

Keep individual requirements and R fixes in `requirements-matrix.md`; update `verification.md` after actual test commands; record architecture choices in `decisions.md`; keep `progress.md` resumable. No test runs with real credentials, external calendar writes or a genuine Nemlig basket.
