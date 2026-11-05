# JARVIS v5 requirement traceability

Each row maps a clause in the owner-supplied handover to a milestone, implementation and executed check. `Testet (syntetisk)` does **not** imply manual acceptance, production safety or the release gate. The common test command below is `cd jarvis-starter && npm test` (**240/240 passed** on the latest local candidate with HTTP static-route coverage). R01–R13 are *code findings*, not claims that the owner experienced an incident.

| ID | Priority | Milestone | Required behavior | Implementation / test evidence | Status or limitation |
|---|---|---|---|---|---|
| A1 | P0 | M1–M2 | Serialized atomic persistence, revision/rollback, honest errors | `state-schema.mjs`, `server.mjs`; `v5-stability`, `v5-migration` | Delvist testet: known failed manual organizer/memory/job/settings/preference saves now roll back; post-rename sync failure becomes unknown and blocks writes. Background/project and cross-file writes remain |
| A2 | P0 | M2 | Durable action outcomes independent of a model response | `server.mjs` action journal; `v5-stability` R05 | Testet (syntetisk); journal size/history bounded, full multi-step recovery remains partial |
| A3 | P0 | M2 | Bounded work and cancelling waiting jobs | `bounded-queue.mjs`; `v5-queue` | Delvist testet: chat queue yes, not every external/background operation |
| A4 | P0 | M2/M6 | Distinguish readiness, failures and recovery | `server.mjs` `/ready`, `system-health.mjs` write probe, `state-schema.mjs`; `v5-readiness`, `v5-migration` | Testet med rename- og post-rename sync-fejl; usikker lagerpublicering rapporteres separat, blokerer fremtidige gemninger. Ingen live outage drill |
| B1 | P1 | M3 | Proposals, confirmed facts, temporaries, actions and sources | `personal-claims.mjs`, `personal-knowledge.mjs`; `v5-intelligence` | Testet (syntetisk); legacy memory editor remains parallel |
| B2 | P1 | M3 | Preserve corrections/history and exclude unresolved conflicting facts | `personal-claims.mjs`, knowledge index; `v5-intelligence` | Testet (syntetisk) |
| B3 | P1 | M3 | Structured lookup + lexical and genuine semantic retrieval | `personal-knowledge.mjs`, `semantic-index.mjs`; 80/80 lexical correct-source@5 | **Blokeret**: no installed, measured genuine local Danish embedding model; lexical score not semantic proof |
| B4 | P1 | M3 | Shared context while preserving channel permissions | `server.mjs` instructions/tool allowlist; `v49-planning-tools`, `v5-stability` | Delvist testet: broader channel-specific quality review pending |
| B5 | P1 | M3 | Incremental revision-aware indexing and local fallback | `semantic-index.mjs`, `personal-knowledge.mjs`; `v5-intelligence` | Testet with synthetic embedding adapter; real model pending B3 |
| C1 | P1 | M3 | Distinct personal tasks, calendar events, automation jobs | `personal-tasks.mjs`, `task-engine.mjs`, `capacity-planner.mjs`; `v5-server` | Testet (syntetisk) |
| C2 | P1 | M3 | Task purpose, effort, dependencies, windows and locks | `personal-tasks.mjs`, `/api/personal-tasks`; `v5-personal-tasks` | Testet (syntetisk) |
| C3 | P1 | M3 | Capacity and hard constraints, unknown calendar not free time | `capacity-planner.mjs`, server read-only Google Calendar planning input; 30 scenarios, `v5-server` | Testet med syntetisk kalender; source read failure gives unknown capacity; live selection/freshness acceptance pending |
| C4 | P1 | M3 | Selective replan with locked choices | `capacity-planner.mjs`, `personal-tasks.mjs`; scenario tests | Delvist testet: general interactive selective replan UI not complete |
| C5 | P1 | M3 | Persistent source-based follow-up and stop conditions | `follow-up-cases.mjs`, `/api/follow-ups`, `public/v5-plan.js`; `v5-server` | Testet (syntetisk); live monitored follow-up not exercised |
| D1 | P1 | M4 | Household defaults, 1–4 week rhythm and date exceptions | `meal-planner.mjs`, `public/meals.js`; `v5-household` | Delvist testet: explicit guests/holiday forms incomplete |
| D2 | P1 | M4 | Adults, child age and editable portion factors | `meal-planner.mjs`, `public/meals.js`; `v5-household` | Testet (syntetisk); browser pending |
| D3 | P1 | M4 | Meal themes cannot override hard restrictions | `food-identity.mjs`, `meal-planner.mjs`; `v5-household` R08 | Testet (syntetisk) |
| D4 | P1 | M4/M5 | Calendar load separate from explicit household attendance | `calendar-planning.mjs`, `meal-planner.mjs`; `v49-calendar-planning` | Delvist testet; combined UI acceptance pending |
| E1 | P1 | M4 | Whole-week dinner draft with stock, time and variety | `meal-planner.mjs`; `v49-meals`, `v5-household` | Testet (syntetisk); missing price stays unknown |
| E2 | P1 | M4 | Move/swap, lock, custom/skip, preserve edits | `meal-planner.mjs`, `public/meals.js`; `v5-household` | Testet (syntetisk); visual browser pending |
| E3 | P1 | M4 | Source-bound suggestions and revisions | `meal-planner.mjs`, `personal-knowledge.mjs`; `v5-household` | Delvist testet: user explanation review pending |
| E4 | P1 | M4 | Meal → shopping draft → owner-reviewed transfer | `meal-planner.mjs`, `shopping-planner.mjs`, `nemlig-connector.mjs`; `v49-server`, `v5-server` | Delvist testet: no live integration or browser click gate yet |
| F1 | P1 | M4 | Durable recipe received/processing/review/usable/error | `recipe-memory.mjs`, Discord capture; `v49-server`, `v5-household` | Testet (syntetisk); external inaccessible content remains unresolved |
| F2 | P1 | M4 | Original source, quantities, instructions, portions, feedback | `recipe-memory.mjs`, `public/meals.js`; `v5-household` | Testet (syntetisk); visual pending |
| F3 | P1 | M4 | Search, revisions, favorites and exclusion | `recipe-memory.mjs`, `meal-planner.mjs`; `v5-household` | Testet (syntetisk) |
| F4 | P1 | M4 | Dedupe deliveries and reject source instructions | `recipe-memory.mjs`; `v49-memory-planning`, `v49-server` | Delvist testet; real Discord attachment delivery pending |
| G1 | P1 | M4 | Link needs, confirmed stock, packs, basket and additions | `shopping-planner.mjs`, `food-identity.mjs`; `v49-server`, `v5-household` | Delvist testet: real prices unknown/offline |
| G2 | P1 | M4 | Confirmed inventory, expiry and reservations | `meal-planner.mjs`, `/api/meals/inventory`; `v5-household`, `v5-server` | Testet (syntetisk); inventory never inferred from transfer |
| G3 | P0/P1 | M4 | Safe ingredient identities and units | `food-identity.mjs`, `meal-planner.mjs`; `v5-household` | Testet (syntetisk), no invented piece weights |
| G4 | P1 | M4 | Price refresh, unknown whole-basket costs, budget stale | `shopping-planner.mjs`; `v5-household` R07 20→99 DKK | Testet (syntetisk); real retailer pending |
| G5 | P0 | M1/M4 | Real owner click, exact revision, add-only/unknown safety | `nemlig-connector.mjs`, server one-use intent, `public/meals.js`; `v5-server`, `v49-nemlig-safety` | Testet (syntetisk); HTTP intent is not cryptographic physical presence, no atomic external transaction |
| H1 | P1 | M3 | Versioned bounded skills and permissions | `skills-registry.mjs`, `skills/*/SKILL.md`; `v5-intelligence` | Testet (syntetisk) |
| H2 | P1 | M3 | Recurring jobs bind version, schedule, retry and budget | `task-engine.mjs`; `v5-intelligence` | Delvist testet: missed-run delivery policies not fully exposed |
| H3 | P1 | M3 | Changed/unchanged/unknown structured observation | `monitor-observation.mjs`, `task-engine.mjs`, server; `v5-monitor` | Testet (syntetisk); real source verification pending |
| H4 | P1 | M3 | Quiet/dedupe, bounded retries, paused unknown outcomes | `task-engine.mjs`, `proactive-planner.mjs`; `v5-intelligence` R13 | Testet (syntetisk); no new real recurring jobs activated |
| I1 | P1 | M5 | Truthful integration status/timestamp | `integration-catalog.mjs`, `public/intelligence.js`; `v5-calendar`, `v5-discord` | Delvist testet: not all Home adapters expose freshness |
| I2 | P1 | M3–M5 | Read-only selected calendar, coverage and expired login | `google-calendar.mjs`, server, `public/meals.js`; `v5-calendar` | Testet (syntetisk) for selection/read-only/status; incremental sync/cache not implemented |
| I3 | P1 | M3 | Discord ACK watchdog, resume and durable dedupe | `discord-gateway.mjs`; `v5-discord` | Testet synthetic sockets; live Discord pending |
| I4 | P0/P1 | M1–M4 | Strict Nemlig allowlist and isolated write path | `nemlig-connector.mjs`; `v49-nemlig-safety`, `v5-server` | Testet (syntetisk); no real basket writes |
| I5 | P0 | M2/M6 | Secrets excluded and private data retention | `personal-claims.mjs`, knowledge index, Discord journal; `v5-intelligence`, `v5-discord` | Delvist testet: live privacy/export audit pending |
| J1 | P1 | M2/M5 | Bounded overview payload and domain endpoints | `server.mjs` `/api/overview`; `v5-perf`, `v5-server` | Testet (syntetisk): 117-byte overview vs ~72 KB full state |
| J2 | P1 | M3/M6 | Incremental lookup and bounded model context | `personal-knowledge.mjs`, `semantic-index.mjs`; `v5-intelligence`, `v5-perf` | Delvist testet; genuine local semantic model pending |
| J3 | P1 | M2 | Modular monolith, shared internals | `personal-tasks.mjs`, `state-schema.mjs`, `food-identity.mjs`, `bounded-queue.mjs` | Delvist implementeret: `server.mjs` remains a large route module |
| J4 | P1 | M2–M4 | Shared dates, ingredients, statuses, source rules | `food-identity.mjs`, `personal-knowledge.mjs`, `capacity-planner.mjs` | Delvist testet across domains |
| J5 | P1 | M5 | Gradual frontend modularisation and draft control | `public/app.js` session-bound reload drafts, `public/v5-plan.js`, `public/meals.js`, `public/v5.css` | Implementeret; browser evidence pending |
| J6 | P0/P1 | M1–M2 | Project changes/tests/install approval tied to revisions | `project-agent.mjs`, `update-manager.mjs`; `v5-stability` | Testet (syntetisk) |
| J7 | P1 | M0/M6 | Measured before/after API, retrieval, writes, memory | `scripts/v5-perf.mjs`; `verification.md` | Testet locally; queue/external waits and live model/tool costs unavailable |
| K1 | P1 | M5 | 7 desktop + 5 mobile Danish nav items/history | `public/index.html`, `public/app.js`, `public/v5.css`; CI `41944278403` | **Testet i alle fire browsermatrix-tilfælde** for navigation/historik; fysisk og keyboard/zoom pending |
| K2 | P1 | M5 | Compact I dag with visible chat/microphone | `public/index.html`, `public/v5.css`, `server.mjs` statisk allowlist, `v5-server`; CI `41944278403` | **Chatfelt på første skærm testet** 4/4; reel mikrofontest på fysiske enheder pending |
| K3 | P1 | M4/M5 | Structured meal, ingredient and household editors | `public/meals.js`, `public/meals.css` | Implementeret; browser workflow pending |
| K4 | P1 | M5 | Exact source navigation, unified memory/integrations | `public/intelligence.js`, `public/memory-v49.js`, `public/v5-plan.js` | Delvist implementeret: two knowledge editors still require consolidation; source browser test pending |
| K5 | P0/P1 | M1/M5 | Preserve dirty drafts, focus, revision conflicts | `public/app.js` baseline, sessionStorage recovery, `public/meals.js`; CI `41944278403` | **Testet 4/4** for polling/reload og faktisk syntetisk anden-fane-konflikt; fuld fokus/import/struktureret editor og fysisk kontrol pending |
| L1 | P0 | M6 | Regression, both engines and physical devices | CI `41944996605` Node 22 **240/240** + Chromium/WebKit **4/4**, screenshot artifact `13378367690` | Browser smoke **testet på præcis app-subtree `bf87ea86` inkl. dansk microcopy**; fysisk iPhone/desktop og udvidet keyboard/zoom/kontrast pending |
| L2 | P0 | M2/M6 | Independent schema and idempotent migration | `state-schema.mjs`; `v5-migration`, `v5-server` | Testet (syntetisk); schema 0→1 |
| L3 | P0 | M6 | Restore/rollback without replacing newer data | `state-schema.mjs`, `scripts/deploy-release.mjs`; `v5-migration`, `deploy-release` | Testet synthetic; admin recovery rehearsal pending |
| L4 | P0 | M6 | Tag/SHA/version/schema/runtime bound to candidate | `package.json` schema manifest, `update-manager.mjs`, `deploy-release.mjs`; `v5-stability`, `v5-migration`, `deploy-release` | Testet syntetisk i to led; newest remote candidate CI and M7 tag/install separate |
| R01 | P0 | M1 | Recover save queue while reporting original failed write | `server.mjs`, `state-schema.mjs`; `v5-stability`, `v5-migration` fault injection | Testet (syntetisk), 500 then 200 and saved state; deterministic startup-safe rename fixture; unknown *post*-rename fsync is explicitly distinct |
| R02 | P0 | M1 | Serialize full settings read-modify-write | `server.mjs` `persistPrivateSettings`; `v5-stability` | Testet (syntetisk), concurrent fields survive and failed rename is honest |
| R03 | P0 | M1/M5 | Polling/import/navigation preserve unsaved text and focus | `public/app.js` server-baseline + session drafts, `public/meals.js`; CI `41944278403` | **4/4 browser smoke** for refresh, reload og reelle konflikter; fokus ved import/strukturerede formularer endnu manuel/pending |
| R04 | P0 | M1/M6 | Tag, commit, tested SHA, package, running version, schema | `package.json` schema manifest, `update-manager.mjs`, `deploy-release.mjs`; `v5-stability`, `v5-migration`, `deploy-release` | Testet syntetisk; actual newest candidate PR CI/M7 verification pending |
| R05 | P0 | M1/M2 | Durable outcome even if model fails after tool mutation | `server.mjs` action journal; `v5-stability` | Testet (syntetisk), journal survives restart |
| R06 | P0 | M1 | Reject duplicate or different approved package sets/revisions | `project-agent.mjs`, `public/app.js`; `v5-stability` | Testet (syntetisk), unknown install cannot retry blindly |
| R07 | P1/P0 | M4 | Refresh price-only 20→99 DKK under 30 DKK budget | `shopping-planner.mjs`; `v5-household` | Testet (syntetisk): over budget and needsReview, zero writes |
| R08 | P0 | M1/M4 | Whole ingredient tokens and hard dietary constraints | `food-identity.mjs`, `meal-planner.mjs`; `v5-household` | Testet (syntetisk): “ris” != “frisk basilikum” |
| R09 | P1 | M3 | Exact household date with 300 far-future entries | `personal-knowledge.mjs`; `v5-intelligence` | Testet (syntetisk), direct structured lookup |
| R10 | P1 | M4 | No-op household writes, affected-date invalidation | `meal-planner.mjs`; `v5-household` | Testet (syntetisk) |
| R11 | P1 | M5 | Open exact source ID/date, back route and draft | `public/intelligence.js`, `organizer.js`, `v5-plan.js` | Implementeret, **afventer Chromium/WebKit** |
| R12 | P1 | M3 | Discord ACK loss, server heartbeat, reconnect/resume, durable replay dedupe | `discord-gateway.mjs`; `v5-discord` (8 focused checks) | Testet (syntetiske sockets), live Discord pending |
| R13 | P1 | M3 | Recover recurring jobs after temporary failure | `task-engine.mjs`, `monitor-observation.mjs`; `v5-intelligence`, `v5-monitor` | Testet (syntetisk), bounded retry/pause |

## Evidence conventions

No row may say **accepted** based solely on code presence or synthetic test setup. Exact candidate commit/content hash is recorded in `progress.md` after publication. A functional gap remains open even if its supporting unit tests pass. See `verification.md` for actual commands and metrics.
