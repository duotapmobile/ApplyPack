# Orchestration implementation evidence — September 2, 2026

## Owner-approved change

The owner's direct instruction approved automatic search kickoff after verified payment and automatic document drafting, while retaining two mandatory human review gates. This supersedes the earlier manual-only rule only for starting source discovery and document drafting. It does not authorize auto-apply, unreviewed customer delivery, live payments, a third-party AI provider, or disclosure of customer documents to a scanning vendor.

## Current implementation

- Stripe mode is fail-closed and defaults to disabled.
- Checkout uses fixed Stripe price IDs and validates the paid amount again in database conversion.
- A test environment rejects live webhook events; live payments require a second explicit switch.
- Test-mode transactional email is limited to an exact allowlist.
- Source documents have per-file hashes and scan verdicts.
- ClamAV is supported through its private TCP `INSTREAM` protocol; the health route sends a real PING.
- Search checkout is blocked until every uploaded source document is clean.
- Verified paid work is queued idempotently in `workflow_tasks`.
- Search discovery populates `search_candidates`; the MFA-protected operator screen exposes the pulled candidates for review.
- Customer search and document delivery remain impossible before the existing human approval actions.
- Stripe webhook work has an exclusive database claim and retry state.
- Expired capacity reservations are excluded atomically during new reservations.
- Search and Apply Pack checkout preparation is serialized in PostgreSQL before Stripe is contacted; retries use the database-owned order or cart ID as the stable Stripe idempotency key.
- Stripe metadata excludes customer, intake, search-order, and job-match identifiers.
- ApplyPack now generates first-party DOCX drafts from structured customer-provided facts, scans them, and stores them in a separate private operator-only bucket.
- Admin delivery uses a compare-and-set claim, scans final and corrected DOCX files, and recovers abandoned claims after 15 minutes.

## Verified locally

- All migrations apply from an empty local database.
- Supabase database lint reports no schema errors.
- Rolled-back synthetic SQL produced exactly one `search_discovery` task and one `document_draft` task.
- A webhook claim returned true, then false for a concurrent duplicate, then true after an explicit failed state.
- The official local ClamAV container reported healthy.
- A real scanner integration test accepted harmless content and detected the standard antivirus test signature.
- Generated resume and cover-letter DOCX packages both passed the real scanner.
- Rollback-only database assertions proved repeated search and Apply Pack preparation returns one order/cart and one reservation.
- A test-labeled Resend message was accepted for the existing allowlisted admin alert address.
- Railway is explicitly set to test mode with checkout and live payments disabled; the save used `--skip-deploys`.

## Open gates

- Stripe test price creation is blocked because the current restricted test key lacks Prices Read/Write and Products Read/Write.
- Railway has only a production-named environment; a separate staging environment has not been created.
- Railway has no private ClamAV service configured.
- A real Stripe Checkout and provider-delivered webhook rehearsal has not run because the fixed test prices cannot be created with the current restricted key.
- A separate Railway scanner service would consume hosted resources and has not been created without owner approval for that cost-bearing infrastructure action.
- No migration, code, or scanner service in this change has been deployed to Railway or pushed to GitHub.

Ship status: **NOT READY**.
