# ApplyPack

Manual launch scope: $18.99 for exactly ten distinct, current, human-reviewed job matches and $7.99 per selected job for one tailored resume plus one tailored cover letter. There is no launch subscription or public job board. Search checkout is operator-invited and remains locked until every launch gate passes.

ApplyPack is DuoTap LLC's manual-first job-search and application-document service at `applypack.work`.

- Job Match Search: $18.99 for exactly 10 distinct, current, human-reviewed job matches, available only through a short-lived operator invitation.
- Apply Pack: $7.99 per selected job for one tailored resume and one tailored cover letter.
- Turnaround: search delivery within 24 clock hours after successful payment; Apply Pack delivery within 24 clock hours after payment and receipt of complete required inputs.
- Capacity defaults: one search and two Application Packs per rolling 24-hour window.

The application includes the public site, guided intake, passwordless customer portal, Stripe Checkout, transactional email, private file delivery, an MFA-protected operator console, corrections and conflict review, capacity controls, refund operations, retention maintenance, accessibility checks, and Railway deployment configuration.

## Current boundary

The codebase is locally implemented. It is not a live service until the production Supabase, Stripe, Resend, Railway, DNS, mailbox-routing, malware-scanning, backup, and end-to-end verification steps in `docs/runbooks/SHIP_CHECKLIST.md` pass.

Do not use production language based on a local build alone.

## Stack

- Next.js 16, React 19, and TypeScript
- Supabase Auth, Postgres, Row Level Security, and private Storage
- Stripe hosted Checkout Sessions and signed webhooks
- Resend transactional email
- Railway hosting and scheduled maintenance
- Vitest, Playwright, and axe

## Local setup

Requirements: Node.js 22 and npm.

```bash
npm ci
copy .env.example .env.local
npm run dev
```

For local browser work, change `NEXT_PUBLIC_APP_URL` in `.env.local` to `http://localhost:3000`. Keep real secrets only in `.env.local` and provider/Railway secret stores.

The provider-backed flows intentionally return configuration errors until valid test credentials are supplied.

## Database setup

1. Create separate Supabase test and production projects.
2. Apply every migration in `supabase/migrations/` to the test project in filename order; do not skip the explicit-grants or job-source expansion migrations.
3. Confirm the two Storage buckets are private.
4. Configure the site URL and allow `/auth/callback` for the exact test origin.
5. Create the initial operator through normal email authentication, set the trusted profile role to `admin` in the Supabase console, add the same email to `APP_ADMIN_EMAILS`, and enroll TOTP MFA.
6. Complete the RLS and cross-account tests in the ship checklist before repeating the migration in production.

## Stripe setup

Use test mode first. Configure the signed webhook endpoint at `/api/stripe/webhook` for:

- `checkout.session.completed`
- `checkout.session.expired`
- `charge.refunded`
- `charge.dispute.created`

The server fixes new manual-launch prices at 1,899 cents for a search and 799 cents per Apply Pack. Historical 2,000/800-cent records remain valid only for reconciliation and refunds under their original contract versions. Payment status changes only from verified provider events.

## Email and inbound mail

Verify `applypack.work` with the email provider, then use:

- From: `orders@applypack.work`
- Reply-to: `help@applypack.work`
- Inbound: `orders@`, `help@`, and `admin@`

An actual destination inbox must be selected before launch. Disable click/open tracking for transactional mail and verify SPF, DKIM, and DMARC alignment externally.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`npm run check` runs every local code gate except Playwright.

## Operations

- Customer and operator workflows: `docs/runbooks/OPERATIONS.md`
- Provider connection: `docs/runbooks/PROVIDER_SETUP.md`
- Canonical October 2 release, canary, and rollback: `docs/runbooks/MANUAL_LAUNCH_RELEASE.md`
- Historical Railway platform setup: `docs/runbooks/DEPLOYMENT.md` (its Release/Rollback sections are superseded)
- Security, retention, backups, and key rotation: `docs/runbooks/SECURITY_AND_PRIVACY.md`
- Incident response: `docs/runbooks/INCIDENT_RESPONSE.md`
- Evidence required to launch: `docs/runbooks/SHIP_CHECKLIST.md`
- Job-source registry, classification, and API contract: `docs/job-search/SOURCE_EXPANSION.md`
- Job-source health, synchronization, and rollback: `docs/runbooks/JOB_SOURCE_OPERATIONS.md`

The hourly maintenance endpoint is:

```text
POST /api/cron/maintenance
Authorization: Bearer <CRON_SECRET>
```

It expires abandoned reservations, deletes source documents whose retention date has passed, marks stale job records inactive, and alerts the operator about approaching or missed deadlines.

## Health

`GET /api/live` is Railway's dependency-independent process healthcheck. `GET /api/health` returns HTTP 200 only when the production origin, provider variables, cron secret, document processing, and live database capacity rows are ready. Monitor readiness separately and keep checkout locked whenever it returns HTTP 503.

## Repository

Canonical remote: `https://github.com/duotapmobile/ApplyPack.git`
