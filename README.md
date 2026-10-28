# ApplyPack

Launch scope: $18.99 for exactly ten distinct, current, human-reviewed job matches and $7.99 per selected job for one tailored resume plus one tailored cover letter. These are fixed customer totals with no tax added at checkout. There is no launch subscription or public job board. Search checkout is operator-invited and remains locked until every non-tax launch gate passes.

ApplyPack is DuoTap LLC's job-search and application-document service at `applypack.work`. The approved goal is system research and complete drafting with owner review and approval before delivery; that connected workflow remains incomplete.

- Job Match Search: $18.99 for exactly 10 distinct, current, human-reviewed job matches, available only through a short-lived operator invitation.
- Apply Pack: $7.99 per selected job for one tailored resume and one tailored cover letter.
- Turnaround: search delivery within 24 clock hours after successful payment; Apply Pack delivery within 24 clock hours after payment and receipt of complete required inputs.
- Capacity defaults: one search and two Application Packs per rolling 24-hour window.
- New-order private access: 30 days after the service's latest approved delivery; starting an optional pack checkout and submitting a new covered match-conflict request close 30 days after the original search delivery. A valid checkout already started may finish before its original expiry. Historical orders retain their recorded terms. See `docs/applypack/18_OCTOBER_24_ONE_OFF_RETENTION_AMENDMENT.md`.

The application includes the public site, guided intake, passwordless customer portal, Stripe Checkout, transactional email, private file delivery, an MFA-protected operator console, corrections and conflict review, capacity controls, refund operations, retention maintenance, accessibility checks, and Railway deployment configuration.

## Current boundary

The codebase has implemented components and passing component checks, but the October25 audit found gaps in the connected intake, research, drafting, owner-review and repair workflows. Launch is **NOT READY**. Local code, Git publication and green CI do not establish a complete or deployed service.

The latest [product amendment](docs/applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md) requires low-friction intake for current/outdated/no resume and career changes, contextual plain-language skills, targeted clarification before final submission, and a complete section-editable review of the customer's information. New bound orders allow repair of ApplyPack-introduced errors only; customer mistakes, later-added experience and preference edits do not automatically entitle revised packs. Historical accepted terms remain intact. These are documented requirements, not yet implemented behavior.

Use the [end-to-end completion plan](docs/launch/END_TO_END_COMPLETION_PLAN_2026-10-25.md) and [intake/service-error protocol](docs/runbooks/INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md). Production Supabase, Stripe, Resend, Railway, DNS, mailbox-routing, structural file safety and isolation, recovery, human acceptance and every connected verification step in `docs/runbooks/SHIP_CHECKLIST.md` must also pass before launch.

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
2. Replay every migration in filename order only on a disposable local database. Hosted staging and production require an exact observed ledger, named target approval, quiesced writers, encrypted backup and isolated restore evidence before the separately bound migration runner may apply the approved forward change set. Never run a blind hosted replay.
3. Confirm the two Storage buckets are private.
4. Configure the site URL and allow `/auth/callback` for the exact test origin.
5. Create the initial operator through normal email authentication, set the trusted profile role to `admin` in the Supabase console, add the same email to `APP_ADMIN_EMAILS`, and enroll TOTP MFA.
6. Complete the RLS and cross-account tests in the ship checklist before repeating the migration in production.

## Stripe setup

Use test mode first. Configure the signed webhook endpoint at `/api/stripe/webhook` for:

- `checkout.session.completed`
- `checkout.session.expired`
- `charge.refunded`
- `refund.created`
- `refund.updated`
- `refund.failed`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.closed`

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
npm run test:integration
npm run test:database
npm run test:document-render
npm run test:rollback
npm run types:database:check
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
npm run validate:aws-document-worker
npm run test:aws-roles-anywhere
```

`npm run check` runs lint, typecheck, unit tests and build only. The remaining commands above are separate required gates. Database replay/reset/rollback jobs must run serially against the disposable local stack. Windows document rendering uses `scripts/test-document-render-windows.ps1` to bind the approved tools and all four font faces. Optional ClamAV integration is separate from the approved structural-validation launch contract and is never reported as a passed scan when absent.

Rollback verification requires `AP_ROLLBACK_TARGET_SHA` to name a reviewed, committed, schema-compatible alternative to the candidate. CI reads the explicit workflow input or repository variable; an absent target fails the gate. No such target has been established for the current forward schema. Until one is proven, recovery remains a checkout hold followed by a reviewed forward fix and protected data recovery. Restored private information must pass the current expiry/deletion checks before customer access opens.

The launch image workflow builds `Dockerfile.launch`, runs `npm run test:launch-image -- applypack-launch-web:<local-tag>` against the complete package without networking or provider credentials, and rejects high or critical image findings. Roles Anywhere contracts and isolated startup checks do not establish hosted AWS identity, credential revocation, or production readiness. The separate database-operation self-tests and restore drill are documented in `docs/runbooks/LAUNCH_DATABASE_OPERATIONS.md`.

## Operations

- Current intake, confirmed information and service-error policy: `docs/applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md`
- End-to-end work and completion scoring: `docs/launch/END_TO_END_COMPLETION_PLAN_2026-10-25.md`
- Intake review and contract-aware service-error procedures: `docs/runbooks/INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md`
- Customer and operator workflows: `docs/runbooks/OPERATIONS.md`
- Provider connection: `docs/runbooks/PROVIDER_SETUP.md`
- Canonical October 2 release, canary, and rollback: `docs/runbooks/MANUAL_LAUNCH_RELEASE.md`
- Current restricted staging rehearsal: `docs/runbooks/TEST_MODE_ORCHESTRATION.md`
- October 22 implementation and approval register: `docs/evidence/launch-execution-2026-10-22/EXECUTION_REGISTER.md`
- Current launch operations and historical-document boundaries: `docs/runbooks/LAUNCH_OPERATIONS_INDEX.md`
- Current Railway web/maintenance configuration: `docs/runbooks/RAILWAY_LAUNCH_PROFILE.md`
- Current workload identity and rotation: `docs/runbooks/AWS_ROLES_ANYWHERE_CALLER.md`
- Current database preparation and recovery: `docs/runbooks/LAUNCH_DATABASE_OPERATIONS.md`
- Historical Railway platform setup: `docs/runbooks/DEPLOYMENT.md` (preserved history; use the current launch runbooks for execution)
- Security, retention, backups, and key rotation: `docs/runbooks/SECURITY_AND_PRIVACY.md`
- Prospective one-off retention, historical access, and cleanup: `docs/runbooks/ONE_OFF_RETENTION.md`
- Incident response: `docs/runbooks/INCIDENT_RESPONSE.md`
- Evidence required to launch: `docs/runbooks/SHIP_CHECKLIST.md`
- Job-source registry, classification, and API contract: `docs/job-search/SOURCE_EXPANSION.md`
- Job-source health, synchronization, and rollback: `docs/runbooks/JOB_SOURCE_OPERATIONS.md`

The maintenance endpoint is:

```text
POST /api/cron/maintenance
Authorization: Bearer <CRON_SECRET>
```

It reconciles payment attempts and reservations and includes deadline/retention checks. Automatic private-object removal, content redaction and restored-content sanitization remain incomplete; new-policy readiness fails closed. Required cleanup must respect unfinished paid work, qualifying timely service-error cases, historical correction rights, replacements, disputes, holds and shared entitlements. The launch profile schedules maintenance every 15 minutes with a 45-minute maximum heartbeat age; the historical hourly configuration cannot prove that profile. Automated employer-source schedules remain disabled until the new research workflow and its separate source/provider checks pass.

## Health

`GET /api/live` proves process liveness. `GET /api/health` reports dependencies and exact deployed identity independently of permission to create live charges. `acceptingOrders` means public order acceptance only; `checkoutMode`, `restrictedCheckoutMode` and `sessionCreationConfigured` distinguish locked, rehearsal and canary modes. Read-only Stripe verification and reconciliation remain available while checkout is locked. Use `npm run staging:readiness` with the exact `APP_EXPECTED_RELEASE_SHA` and `APPLYPACK_READINESS_MODE`; supplement anonymous negative probes with authenticated authorization tests and provider receipts. A green health response alone is not launch approval.

## Repository

Canonical remote: `https://github.com/duotapmobile/ApplyPack.git`
