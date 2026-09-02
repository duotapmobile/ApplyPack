# ApplyPack Implementation Decisions

Last updated: September 2, 2026

## Confirmed by the owner

- Legal operator: DuoTap LLC.
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
- Legal address, tax treatment, final policy review, and live-payment authorization remain owner-controlled launch gates.

## Architecture choice

The repository was empty. The implementation uses a single Next.js application on Railway with server-only provider adapters and Supabase-managed persistence. This minimizes providers and keeps marketing, customer, admin, webhook, and scheduled endpoints in one deployable service while private files remain in provider storage.

The community app-builder template suggested Prisma and subscription billing. Those defaults were not adopted because ApplyPack uses Supabase RLS and two one-time purchases rather than subscriptions.
