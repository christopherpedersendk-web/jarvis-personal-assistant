# OpenJarvis diagnostics and evaluation measurements

Base: 1249eba457ec866da00f3005e6a79b8d1aa8973f; package 5.4.0, schema 1/readableFrom 0. No version or tag changes. Historical PR #9 remains open against feature/v5-foundation and is outside scope.

## Delivered

OpenJarvis status now includes secret-free diagnostics with configured/invalid/unverified/verified states. A verified gateway contract expires from the readiness view after 60 seconds. Host acceptance is never inferred from loopback configuration or health. Existing connectionError rendering receives specific safe messages for credential rejection, version mismatch, timeout and stop. No automatic network probe was added.

Read-only local diagnostic command: `node scripts/openjarvis-diagnostics.mjs`. It inspects installed pinned runtime/plugin versions, metadata (not contents) of /etc/openjarvis-research.env, and effective systemd properties. No service mutation or feature activation occurs. Unavailable observations remain unverified. Runtime health uses the existing controlled inspection path; CLI does not contact the gateway.

The evaluator now records setupDurationMs and conversationDurationMs separately. Conversation duration is elapsed HTTP turn time, not pure model latency. Comparison retains per-scenario usage and null unknowns. Existing 30-task dataset, grading threshold and critical-task rules are unchanged. No model evaluation or savings claim is made.

## Completed verification

11 focused Node tests passed, zero failures/skips, including an actual disposable local HTTP server rejecting authentication, safe error mapping, stale readiness, source retention, unknown usage and incompatible-model comparison. CLI executed locally and returned unverified for unavailable host observations. Evidence and exact changed-source hashes: diagnostics-evidence.json. No full regression rerun. CI intentionally skipped to avoid automatic unrelated Docker/live workflows.

## Milestone impact

M3/M7: client configuration/runtime diagnostics implemented and locally verified; remote host isolation remains unverified. M6/M10: timing/reporting improved, comparison checks passed; real model scores remain null. M1/M2/M4/M5/M8/M9/M11–M18 retain their prior evidence and unresolved criteria in acceptance-register.md. No milestone is wholly closed.

## Scope boundary

Docker, target-server access, physical iPhone, live Discord/Nemlig, real model calls and merchant transactions are outside this PR's executable scope, not scheduled follow-up tasks. The previous next-package.md is historical context, not this PR's work plan. No owner action is required to review this code. Deployment/activation and any future live acceptance require a separate scope and access decision. Do not paste credentials into chat.

Rollback: revert this PR; no persisted state/schema change. Existing features and flags are untouched.
