# v5.2 M1–M3 — implementation checkpoint

Baseline: v5.1.1, remote commit 7037a52b0fba117d01be1a0b258672b76257475d.
Owner confirms Discord text and report delivery work. No production changes in this branch.

## Implemented
- M1: exact release tag/package/schema verification script and tag-triggered CI. This detects invalid metadata; it does not prevent someone publishing a release before CI passes.
- M1: health test checks actual package metadata rather than hardcoded 5.0.2.
- M1: source highlight retained when the same recipe card is replaced; regression covers replacement and no transfer to another recipe. Original mobile smoke still needs reproduction and full browser verification.
- M2: Realtime session creation captures the stop generation before asynchronous preparation and uses the shared cancellation boundary through response-body reading. This does NOT terminate already established WebRTC calls or impose a monetary audio budget.
- M3: OpenClaw structured result URLs, including JSON text blocks, populate the shared source list. Reject credential-bearing/non-HTTP URLs, deduplicate, redact token-bearing links/titles. This is not proof of source trust or URL reachability.

## Remaining release requirements
- Full candidate browser CI and physical iPhone acceptance.
- Isolated full server backup/restore with service boot; no production access available here.
- Common authorization and exact-action approvals across legacy voice routes.
- Active Realtime session stop, audio and hosted-tool accounting, aggregate budgets.
- OpenClaw live contract tests, source quality and natural-language cross-channel evaluations.
- Isolated JavaScript browser runtime, egress controls and adversarial tests before enabling it.

All three milestones remain in progress; no release/tag/deployment is authorized by this checkpoint.
