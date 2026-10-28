# October 23 sandbox validation and paid-launch amendment

Date: 2026-10-23
Status: governing forward amendment, directly approved by the owner

## Scope and retained product rules

The owner operates initial job and document review, customer support, and the final launch decision. Preserve $18.99 for exactly ten reviewed jobs, $7.99 per selected job for a tailored resume and cover letter, the existing 24-hour delivery rules, invitation-based purchasing, and capacity of one search and two Apply Packs per rolling 24 hours. No subscription is offered. Historical customer records and access remain intact.

## Payment proof and activation

Complete sandbox verification plus a genuine first-customer pilot replaces the mandatory live test-charge/refund gate. Stripe instructs integrations to test in a sandbox rather than use real payment details for live tests: https://docs.stripe.com/testing . No new production CANARY activation, checkout authorization, retry, or special test-refund operation is allowed. Existing historical payments, ordinary refunds, queued obligations and reconciliation remain supported. Staging test operations remain available with their existing isolation and capacity controls.

New PUBLIC activation requests require activationContractVersion `sandbox-proof-live-pilot-v1` and strict `evidence.sandboxValidation` with schemaVersion `applypack-sandbox-validation-v1`. Reject obsolete PUBLIC requests; never silently reinterpret old evidence as the new contract. Persist the receipt and a server-calculated digest immutably through the existing same-origin administrator flow with fresh MFA. This is administrator-reviewed evidence, not a cryptographic Stripe attestation.

The receipt binds the final full release SHA, staging project and origin, verified Apply Pack sandbox account, test mode, USD, verification timestamp, a private evidence-bundle SHA-256 digest, and exactly two completed purchase/delivery/full-refund records: one $18.99 search and one $7.99 Apply Pack. Each record identifies its application payment and delivered release, Stripe Checkout Session, PaymentIntent, completion event and succeeded full refund. Generate the receipt by read-only verification of Stripe, staging database records and the deployed revision. Refresh verification within 24 hours before production activation; this is an activation freshness requirement, not a daily expiration of approved public purchasing.

## Release and recovery

Preserve existing work and historical migrations. Use forward migration 202610230086 after verifying its identifier is free and validating all missing predecessor migrations. Capture and hold unchecked staging deployment triggers before publishing the hardening branch. Hold production automatic deployment before merging. Validate successful CI and image checks for the actual resulting main SHA, align staging to that exact SHA, then complete the hosted sandbox journey. Evidence collected after the freeze belongs outside the frozen tracked source. A subsequent code change creates a new candidate requiring affected revalidation.

Use locked forward recovery: stop new checkout and intake, preserve paid obligations, restore or repair forward, and reconcile every paid transaction against Stripe. Do not presume the old production application is compatible with the new database. Demonstrate recovery within 240 minutes, with no more than 15 minutes of recent application data needing recovery or reconciliation. Protect database records, private files and versions, encryption keys, authentication dependencies and configuration; demonstrate loss of the original machine and operator credentials. A local database restore alone is insufficient.

## Provider configuration and spending

Use the existing Docker, AWS encryption and isolated-document-worker design with separate production configuration and maintenance. Reuse suitable existing resources. Present one consolidated itemized incremental-cost quote, recurring forecast and recovery arrangements before provisioning new paid resources. Paid certificate-authority services and NAT gateways are excluded from the default design. Provider access is not spending approval.

Retain old sandbox credentials, webhook configuration and records. Inspect actual application obligations before changing staging credentials. If none remain, retain unmatched provider objects as historical evidence and proceed. Otherwise preserve account-specific processing before switching. Historical unmatched test objects alone do not block unrelated release preparation.

## Acceptance and launch

Require the complete sandbox customer and operator journey; payment integrity and retry/capacity/deadline tests; activation rejection tests; real encryption and isolated document processing; unauthorized-access rejection; exact deployed SHA and healthy dependencies; a manual maintenance run and two actual 15-minute cycles; delivered alerts and transactional/sign-in email; measured recovery; human document, keyboard, screen-reader and physical-phone acceptance; and four independent reviews. Resolve critical/high findings and explicitly record owner acceptance of remaining limitations.

Purchasing stays locked until the owner accepts the evidence and makes the final go-live decision. The first invitation is for a genuine customer receiving the real service under the normal refund policy; an Apply Pack is optional. Review that first delivery before expanding invitations, keeping daily capacity. This amendment does not itself unlock purchasing or claim readiness.
