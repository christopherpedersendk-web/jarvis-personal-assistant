# v5 technical decisions

| ID | Decision | Reason and verification still needed |
|---|---|---|
| D-001 | Develop on `feature/v5-foundation` based on exact v4.9.1 SHA | Both main and v4.9.1 matched; preserves published v4.9.0 tag |
| D-002 | Keep the existing modular JavaScript/Node application and modernise incrementally | Existing 149 tests pass; avoid a speculative framework or service split |
| D-003 | Keep local JSON for the isolated candidate; schema 1, atomic/fsync publication, hash-bound backups, serialized local mutation guards and explicit uncertain-durability state | Synthetic p95 write 7.72 ms; 72 KB full state (400 organizer + 200 memory records). SQLite not justified by this workload. Manual organizer/memory/job edits now roll back on known failure; **background, project/filesystem and cross-file settings transactions remain limitations**. A post-rename sync error is unknown, blocks writes, and must never be rolled back as if rename failed. |
| D-004 | Semantic search must be local by default, with a useful lexical fallback | Pluggable incremental vector index and lexical retrieval delivered; **no actual embedding provider installed**. External processing remains opt-in and B3 remains blocked |
| D-005 | App navigation uses query-string views and browser history | Deep links work through the existing static-server root without changing deployment paths; test keyboard/back/forward |
| D-006 | Preserve confirmed attendance separate from Google calendar events | Hard user requirement from v4.9 and v5 handover |
| D-007 | Preserve Nemlig add-only, click-bound write model; consume one-use in-memory click-intention token tied to proposal revision/additions | A web request cannot cryptographically prove physical presence, and an external read/write has a real race; no blind retries of unknown outcomes |
| D-008 | Distinguish personal tasks, automated jobs, follow-ups and calendar events | `personal-tasks.mjs`, `task-engine.mjs`, `follow-up-cases.mjs`, `capacity-planner.mjs` use separate contracts; prevents falsely treating a planned task as an external action |
| D-009 | Decline automatic v4 code rollback after schema 1 migration | Older code could silently drop newer fields. The deployer records `rollback-blocked` for administrator review; no production change authorised |
| D-010 | Keep Google Calendar read-only with explicit selection and source coverage | Local selected calendar ID and last successful read, no event creation or household attendance inference |
| D-011 | Show one memory creation entry point with a mode switch for legacy notes versus structured claims, while retaining both data stores | Prevent duplicate settings editors without a risky implicit rewrite of historic records. Exact sources, revisions and confirmation rules remain intact. A future unified *backend* record model needs migration and is still pending; the two forms are never simultaneously visible. |
| D-012 | Pin official Playwright `v1.64.1-noble` test container and exact npm version, non-root UID 1001 | Ubuntu's apt mirror timed out under `--with-deps`; without apt the hosted runner lacked GTK4/GStreamer/WebKit libraries. The [official Playwright CI guidance](https://playwright.dev/docs/ci) supplies this container pattern. This changes only synthetic CI, not production Docker privileges. **Actual Chromium and WebKit launches remain required** |

All decisions are reviewable against the tests in `verification.md`. Remote GitHub branch creation and draft PR do not authorise merge, release publication or installation.
