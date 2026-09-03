# ApplyPack Environment Variables Template

Last updated: September 1, 2026

## Rule

This is a naming and configuration checklist, not a file containing secrets.

The executing agent must adapt names to the existing framework and provider conventions, create a safe `.env.example`, and configure real values only in local untracked files and provider secret stores.

Never expose server-only secrets through a browser-public prefix such as `NEXT_PUBLIC_`, `PUBLIC_`, or `VITE_`.

## Core application

```text
APP_ENV=development|preview|production
APP_URL=https://applypack.work
APP_CANONICAL_HOST=applypack.work
APP_DISPLAY_TIMEZONE=America/New_York
APP_TURNAROUND_HOURS=24
APP_SOURCE_DOCUMENT_RETENTION_DAYS=30
APP_CORRECTION_WINDOW_DAYS=3
APP_CAPACITY_RESERVATION_MINUTES=20
APP_SUPPORT_EMAIL=support@applypack.work
APP_ACCESSIBILITY_EMAIL=accessibility@applypack.work
APP_PRIVACY_EMAIL=privacy@applypack.work
APP_ADMIN_ALERT_EMAIL=[CONFIRMED]
APP_LEGAL_ENTITY_NAME=[CONFIRMED]
APP_STATEMENT_DESCRIPTOR=[CONFIRMED]
```

Do not hardcode preflight-dependent values before confirmation.

## Public browser-safe configuration

Exact names depend on the frontend framework.

Potential examples:

```text
PUBLIC_APP_URL=https://applypack.work
PUBLIC_SUPABASE_URL=[PUBLIC PROJECT URL]
PUBLIC_SUPABASE_ANON_KEY=[PUBLIC ANON OR PUBLISHABLE KEY]
PUBLIC_STRIPE_PUBLISHABLE_KEY=[PUBLIC PUBLISHABLE KEY, only when the client needs it]
PUBLIC_ANALYTICS_ID=[OPTIONAL]
```

The Supabase anonymous or publishable key is designed for public client use only when RLS and authorization are correctly configured. The service-role key is never public.

## Database and Supabase

When Supabase is approved:

```text
SUPABASE_URL=[SERVER PROJECT URL]
SUPABASE_ANON_KEY=[PUBLIC OR SERVER ANON KEY]
SUPABASE_SERVICE_ROLE_KEY=[SERVER ONLY]
SUPABASE_JWT_SECRET=[ONLY IF REQUIRED BY THE APPROVED INTEGRATION]
DATABASE_URL=[SERVER ONLY, DIRECT OR POOLER AS REQUIRED]
DATABASE_MIGRATION_URL=[SERVER ONLY, WHEN SEPARATE]
```

Requirements:

- Separate values per environment.
- Never expose service-role or database credentials to the browser.
- Use provider-recommended connection pooling for serverless workloads.
- Use least-privilege database roles when the current stack supports them.

## Stripe

```text
STRIPE_SECRET_KEY=[SERVER ONLY]
STRIPE_PUBLISHABLE_KEY=[PUBLIC ONLY WHEN NEEDED]
STRIPE_WEBHOOK_SECRET=[SERVER ONLY, UNIQUE PER ENVIRONMENT]
STRIPE_JOB_SEARCH_PRICE_ID=[TEST OR LIVE PRICE ID]
STRIPE_APPLY_PACK_PRICE_ID=[TEST OR LIVE PRICE ID]
STRIPE_JOB_SEARCH_PRODUCT_ID=[OPTIONAL]
STRIPE_APPLY_PACK_PRODUCT_ID=[OPTIONAL]
STRIPE_ALLOWED_PAYMENT_METHODS=card
STRIPE_TAX_ENABLED=false|true
```

Requirements:

- Test and live IDs must never be mixed.
- Price IDs are verified during deployment.
- Server still validates expected unit amounts.
- Webhook secret is environment-specific.
- Do not store secret keys in repository files.

## Resend or transactional email

```text
RESEND_API_KEY=[SERVER ONLY]
EMAIL_FROM_NAME=ApplyPack
EMAIL_FROM_ADDRESS=orders@mail.applypack.work
EMAIL_REPLY_TO=support@applypack.work
EMAIL_OPEN_TRACKING=false
EMAIL_CLICK_TRACKING=false
```

If another provider is used, document equivalent variables and remove unused Resend configuration.

## Authentication

Provider-specific names vary.

Potential controls:

```text
AUTH_CODE_EXPIRY_MINUTES=[CONFIRMED]
AUTH_CODE_MAX_ATTEMPTS=[CONFIRMED]
AUTH_REQUEST_RATE_LIMIT=[CONFIRMED]
AUTH_SESSION_DURATION_HOURS=[CONFIRMED]
AUTH_ALLOWED_REDIRECT_ORIGINS=https://applypack.work
AUTH_ADMIN_MFA_REQUIRED=true
```

Do not use a redirect wildcard in production unless the provider requires a tightly controlled pattern and it is documented.

## Storage and upload

```text
STORAGE_SOURCE_BUCKET=source-documents
STORAGE_DELIVERABLE_BUCKET=apply-pack-deliverables
STORAGE_JOB_SNAPSHOT_BUCKET=job-snapshot-attachments
UPLOAD_MAX_BYTES=10485760
UPLOAD_ALLOWED_EXTENSIONS=.docx,.pdf
SIGNED_DOWNLOAD_EXPIRY_SECONDS=300
MALWARE_SCAN_PROVIDER=[CONFIRMED OR NONE]
MALWARE_SCAN_API_KEY=[SERVER ONLY, IF USED]
```

Do not log signed URLs or scan secrets.

## Capacity

Prefer database-managed settings, but environment defaults may be needed for initial migration:

```text
DEFAULT_SEARCH_CAPACITY_PER_ROLLING_24H=[CONFIRMED]
DEFAULT_APPLY_PACK_CAPACITY_PER_ROLLING_24H=[CONFIRMED]
```

Production admin settings should control live capacity after initialization.

## Monitoring

Only when approved:

```text
ERROR_MONITORING_DSN=[SERVER OR PUBLIC VERSION AS REQUIRED]
ERROR_MONITORING_ENVIRONMENT=production
ERROR_MONITORING_RELEASE=[COMMIT SHA]
ERROR_MONITORING_SEND_PII=false
```

Configure route and request-body scrubbing for all private paths.

## Analytics

Only when approved:

```text
ANALYTICS_PROVIDER=[CONFIRMED]
ANALYTICS_SITE_ID=[CONFIRMED]
ANALYTICS_SESSION_REPLAY=false
ANALYTICS_HEATMAPS=false
```

Never include customer identifiers, resume data, job narratives, or signed links in analytics.

## Scheduled jobs

Provider-specific secrets may include:

```text
CRON_SECRET=[SERVER ONLY]
QUEUE_SIGNING_SECRET=[SERVER ONLY]
```

Scheduled endpoints must validate caller identity.

## DNS and provider verification

Do not place DNS record values in environment files unless the provider integration genuinely requires them.

Track provider verification references in a private operator runbook, not source code.

## `.env.example` rules

The executing agent must create an example file similar to:

```text
APP_URL=
APP_DISPLAY_TIMEZONE=America/New_York
APP_TURNAROUND_HOURS=24

SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_JOB_SEARCH_PRICE_ID=
STRIPE_APPLY_PACK_PRICE_ID=

RESEND_API_KEY=
EMAIL_FROM_ADDRESS=orders@mail.applypack.work
EMAIL_REPLY_TO=support@applypack.work

APP_ADMIN_ALERT_EMAIL=
```

Add comments explaining which values are public and which are server-only.

## Deployment verification

Before deploying each environment, verify:

- Every required variable exists.
- No test key is in production.
- No live key is in preview or committed locally.
- URLs use the correct canonical host.
- Stripe price IDs match the environment.
- Webhook secret matches the deployed endpoint.
- Email sender domain is verified.
- Admin alert email is monitored.
- Storage bucket names match migrations.
- Capacity defaults are confirmed.
- Retention and correction values match public copy and Terms.

## Job-source settings

```dotenv
# Server-side operational controls; these are not credentials.
APP_JOB_FRESHNESS_HOURS=24
APP_JOB_STALE_AFTER_HOURS=72
APP_JOB_SOURCE_SYNC_ENABLED=false
APP_JOB_SOURCE_TIMEOUT_MS=10000
APP_JOB_SOURCE_MIN_INTERVAL_MS=1500
APP_JOB_SOURCE_MAX_POSTINGS=250
APP_JOB_SOURCE_USER_AGENT=ApplyPackSourceMonitor/1.0 (+https://applypack.work/contact)
```

Keep synchronization disabled until the job-source migration is deployed and the operator explicitly enables source runs. Public Lever adapters do not require source credentials.
