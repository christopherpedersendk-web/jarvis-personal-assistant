# v5 technical decisions

| ID | Decision | Reason and verification still needed |
|---|---|---|
| D-001 | Develop on `feature/v5-foundation` based on exact v4.9.1 SHA | Both main and v4.9.1 matched; preserves published v4.9.0 tag |
| D-002 | Keep the existing modular JavaScript/Node application and modernise incrementally | Existing 149 tests pass; avoid a speculative framework or service split |
| D-003 | Keep local JSON for the isolated candidate; introduce independent schema 1, atomic/fsync publication, hash-bound backups and serialized settings | Synthetic p95 write 7.72 ms; 72 KB full state (400 organizer + 200 memory records). SQLite not justified by this synthetic workload; **legacy in-memory-before-save domains remain a known limitation** |
| D-004 | Semantic search must be local by default, with a useful lexical fallback | Pluggable incremental vector index and lexical retrieval delivered; **no actual embedding provider installed**. External processing remains opt-in and B3 remains blocked |
| D-005 | App navigation uses query-string views and browser history | Deep links work through the existing static-server root without changing deployment paths; test keyboard/back/forward |
| D-006 | Preserve confirmed attendance separate from Google calendar events | Hard user requirement from v4.9 and v5 handover |
| D-007 | Preserve Nemlig add-only, click-bound write model; consume one-use in-memory click-intention token tied to proposal revision/additions | A web request cannot cryptographically prove physical presence, and an external read/write has a real race; no blind retries of unknown outcomes |
| D-008 | Distinguish personal tasks, automated jobs, follow-ups and calendar events | `personal-tasks.mjs`, `task-engine.mjs`, `follow-up-cases.mjs`, `capacity-planner.mjs` use separate contracts; prevents falsely treating a planned task as an external action |
| D-009 | Decline automatic v4 code rollback after schema 1 migration | Older code could silently drop newer fields. The deployer records `rollback-blocked` for administrator review; no production change authorised |
| D-010 | Keep Google Calendar read-only with explicit selection and source coverage | Local selected calendar ID and last successful read, no event creation or household attendance inference |
| D-011 | Preserve current legacy editors while introducing typed claims/tasks | Avoid discarding existing manual content. This leaves K4 one-memory-editor consolidation outstanding rather than silently migrating records |

All decisions are reviewable against the tests in `verification.md`. Remote GitHub branch creation and draft PR do not authorise merge, release publication or installation.
