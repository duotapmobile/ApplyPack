# Independent security, privacy, and payment review — October 23, 2026

Status: **NOT READY for hosted launch.** This is source review and local test evidence, not a production activation receipt or an acceptance waiver.

Reviewer: the release-tooling agent, independently reviewing the database and activation/runtime implementations authored by other agents. The reviewer subsequently implemented operator UI remediation; those UI changes received separate review from the database and runtime agents. The reviewed work was in the canonical repository on `codex/manual-launch-hardening-2026-10-02`, based on `a3de4a447d499fb7d416e1a1d167e281372903b2`, with uncommitted launch changes. The release owner must bind the final checks to the eventual committed candidate SHA.

## Scope and result

Read amendment 17, migration `202610230086_sandbox_validation_launch_activation.sql`, `src/lib/operations/sandbox-validation.ts`, administrator activation/CANARY/refund routes, checkout authorization, readiness checks, and `scripts/verify-sandbox-launch-evidence.mjs`. Reviewed wrong account/release/mode, freshness, object linkage, server actor identity, evidence mutation, production CANARY retirement, and historical refund behavior.

No confirmed critical, high, or medium defect remained in this reviewed scope at the end of this pass. This is bounded evidence, not a guarantee that the system has no vulnerabilities.

- PUBLIC activation requires the current contract and exact sandbox receipt shape. TypeScript and SQL validate the expected account, staging project/origin, full release SHA, test mode, currency, two fixed-price purchase/delivery/full-refund records, and freshness at activation. A successful existing activation does not become a daily checkout outage merely because its receipt subsequently ages.
- The administrator route derives the actor from verified administrator authentication and fresh MFA, rather than trusting a caller-supplied actor. Receipt storage and its digest are computed and preserved by the server/database. Service-role access remains a trusted administrative boundary.
- The verifier reads the deployed revision, application rows, and Stripe objects. It checks the Session, PaymentIntent, completion event, charge/refund, application payment, and delivered release relationships. Its evidence design is explicitly reviewed administrator evidence, not a cryptographically signed Stripe attestation.
- New production CANARY operations and special production test refunds are retired. Staging rehearsal remains isolated. Historical payments, ordinary refunds, reconciliation, and queued historical refund settlement retain their paths.
- Follow-up review of historical downloads found authenticated owner checks, reviewed-revision and storage-path constraints, private storage, document validation, and bounded signed download lifetime. Invitation approval state was found capable of surviving a changed assessment in an earlier UI version; the author repaired the component identity to include draft, snapshot, and assessment and added a reset regression test.

## Local evidence and follow-up checks

- The independent verifier test run passed **57/57** checks. Private local output is retained outside the tracked source under the launch evidence directory; it contains no hosted payment proof.
- The independently reviewed maintenance runner passed **11/11** checks. It verifies the expected environment, canonical origin, and full release SHA before sending its credential, and checks the identity in the same maintenance response. The server checks expected identity headers before database access. Intentional dormant behavior is restricted to the two retired board actions.
- The author of the maintenance server changes reported **31** route security checks passing; this review inspected that implementation rather than claiming an independent hosted execution.
- Operator release tests require exactly ten current selections, five fresh human checks, and a meaningful review note. Separate reviewers checked these controls and the guided research forms. The guided forms preserve existing server validation and do not supply scores, forge review actors, or auto-approve missing evidence.

## Unresolved launch evidence and ownership

The release agent still owns actual committed-SHA CI/image checks, final-main alignment, the deployed sandbox journey, refreshed receipt generation/import, and production dependency verification. The owner still must perform document judgment, keyboard/screen-reader/physical-phone acceptance, approve the completed incremental-cost quote, and make the final go-live decision. Provider login/credential access is required where unavailable.

The measured off-machine recovery drill and ongoing 15-minute recovery/reconciliation coverage remain unproven by this review. No production purchasing unlock, cost approval, recovery acceptance, or limitation acceptance is implied. Any code change after source freeze requires the affected validation to be repeated against the new candidate.
