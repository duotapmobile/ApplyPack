# ApplyPack Implementation Decisions

Last updated: September 2, 2026

## Confirmed by the owner

- Legal operator: DuoTap LLC d/b/a ApplyPack.
- Domain ownership: applypack.work is owned by the user.
- Repository: https://github.com/duotapmobile/ApplyPack.git.
- Hosting direction: Railway.
- Apply Pack capacity: two units per rolling 24 hours.
- Implementation authority: approved for the complete build.
- The supplied DESIGN.md and ApplyPack handoff control implementation.
- The owner selected exactly three domain addresses: orders@applypack.work for outgoing order mail, help@applypack.work for customer replies and public privacy/accessibility requests, and admin@applypack.work for administrative alerts and access.

## Safe defaults applied

- Search capacity begins at one 10-job search per rolling 24 hours.
- Next.js 16, TypeScript, and the App Router provide the web and server runtime.
- Supabase is the planned Postgres, passwordless authentication, private-storage, and RLS provider.
- Stripe hosted Checkout Sessions provide payment collection.
- Resend provides transactional email after domain verification.
- Customer login uses an email one-time code; admin authorization is separate and requires MFA.
- Source documents are retained for 30 days after completion unless deleted earlier under policy.
- One factual-correction round is available for three calendar days.
- Transactional email open and click tracking remain disabled.
- The launch remains manual-first for job research and document writing.
- No live charge, paid provider upgrade, or public legal placeholder is authorized merely by local implementation.

## Open external activation items

- Namecheap forwards orders, help, and admin mail to the owner-controlled destination inbox.
- Resend domain verification is pending DNS propagation.
- The root applypack.work Railway domain is verified with valid TLS; www verification is pending DNS propagation.
- The residential address remains private. A provider-specific public support-address requirement requires a non-residential founder decision.
- Tax classification remains unresolved and blocks the first live customer charge until written revenue-department guidance or qualified professional advice is recorded.
- The limited one-$20 and one-$8 live smoke test is authorized only after every relevant gate, with both charges refunded.

## Architecture choice

The repository was empty. The implementation uses a single Next.js application on Railway with server-only provider adapters and Supabase-managed persistence. This minimizes providers and keeps marketing, customer, admin, webhook, and scheduled endpoints in one deployable service while private files remain in provider storage.

The community app-builder template suggested Prisma and subscription billing. Those defaults were not adopted because ApplyPack uses Supabase RLS and two one-time purchases rather than subscriptions.

## September 2, 2026 job-source expansion

The owner's direct instruction approved bounded source automation and therefore overrides the earlier manual-only source-discovery restriction. Human review, exactly 10 delivered matches, no auto-apply, and manual document preparation remain unchanged.

- Only verified public Lever Postings endpoints for VIPdesk Connect and Five Star Call Centers are automated.
- All other approved employers are official-link-only, except notifyMD, which remains pending because no current official career source was verified.
- Indeed and HiringCafe remain explicit third-party compatibility/import sources; no unsupported scraper was added.
- Liveops is hard-excluded in normalization, database triggers, API/checkout filters, and tests.
- Blue Cross Blue Shield and AAA remain directories, not generic employers.
- The additive migration is forward-only. Production rollback uses application rollback plus provider restore or a reviewed forward migration so audit history is not silently destroyed.

The detailed source, classification, deduplication, filter, and operating contract is in `docs/job-search/SOURCE_EXPANSION.md`.

## September 2, 2026 orchestration completion

The owner's latest instruction requires automatic search kickoff and automatic document drafting while preserving admin review before each customer-facing release. This overrides the earlier manual-first rule only for discovery kickoff and first-draft creation.

- Verified payment queues work; the success page never fulfills an order.
- Search candidates and document drafts remain private until an MFA-protected admin reviews and releases them.
- Document drafting is first-party and deterministic from structured customer-provided facts. It does not send résumé data to a new AI provider and does not invent claims.
- The admin may edit the generated DOCX files and must upload and confirm the reviewed versions before customer delivery.
- Stripe remains in test mode, checkout remains disabled, and live payments require a separate explicit switch.
- Hosted ClamAV infrastructure is cost-bearing and requires owner approval before a Railway service is created.

## September 2, 2026 superseding launch clarifications

- Customer authentication is a branded six-digit email code; the generic confirmation-link callback is removed.
- Public identities are help@applypack.work, orders@applypack.work, and admin@applypack.work, using the smallest practical number of aliases or mailboxes.
- The zero-cost launch baseline uses strict document identity, structure, container, expansion, macro, embedded-object, active-content, encryption, private-storage, authorization, and retention controls. It is not represented as malware scanning.
- Stripe prices, quantity, currency, product status, webhook signature, payment state, refunds, and delivery claims are server-controlled and idempotent.
- Every search, Apply Pack, correction, and accepted replacement remains human reviewed before customer delivery.
- Existing Supabase rows are production data unless positively proven synthetic; no migration may delete or relabel them merely because they look old or incomplete.
