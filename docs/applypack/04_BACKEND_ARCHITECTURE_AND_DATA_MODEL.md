# ApplyPack Backend Architecture and Data Model

Last updated: September 1, 2026

## Architecture rule

The executing agent must inspect the existing ApplyPack site and preserve its current framework, deployment model, routing, design system, package manager, and repository conventions unless a change is required for security, accessibility, or functional completion.

Do not rewrite a working frontend merely to use a preferred stack.

## Recommended default stack

Use this only when the existing site has no compatible backend and the user approves it in the consolidated preflight:

```text
Frontend and server endpoints:
Retain the site's current framework and hosting platform.

Database:
Supabase Postgres

Customer authentication:
Supabase Auth with email one-time code

Admin authentication:
Supabase Auth plus server-side admin-role authorization and MFA

Private files:
Supabase Storage with private buckets and row-level policies

Payments:
Stripe hosted Checkout Sessions and verified webhooks

Transactional email:
Resend using a verified sending subdomain

Inbound human email:
Existing mailbox or Cloudflare Email Routing, based on the user's preflight decision

DNS:
Current authoritative DNS provider, Cloudflare only when already used or explicitly authorized
```

If the existing site already uses a secure equivalent, integrate with it instead of adding a second database, identity system, or storage provider.

## Environment separation

At minimum, support:

```text
Local development
Production
```

Strongly preferred when the hosting and budget permit:

```text
Local development
Preview or staging
Production
```

Requirements:

- Use Stripe test mode outside production.
- Use separate webhook secrets per environment.
- Do not use production customer data in preview or local environments.
- Seed synthetic data only.
- Keep production secrets in provider secret stores.
- Keep `.env.local` and all real secrets out of version control.
- Provide `.env.example` with names and descriptions only.
- Fail closed when required production configuration is missing.

## Core system components

### Public site

Responsibilities:

- Marketing pages
- SEO metadata
- Public pricing and disclosures
- Get Started entry point
- Accessibility-compliant forms and navigation

### Customer identity and portal

Responsibilities:

- Verify email ownership
- Save intake progress
- Securely display the customer's orders and files
- Prevent one customer from reading another customer's records
- Allow job decisions and Apply Pack selection

### Admin workspace

Responsibilities:

- Search and Apply Pack queues
- Deadline visibility
- Customer and criteria review
- Job-match creation and validation
- Deliverable upload and quality checks
- Replacement review
- Correction review
- Payment and email status visibility
- Capacity settings
- Audit trail

### Payment service

Responsibilities:

- $20 Job Match Search checkout
- Dynamic $8-per-job Apply Pack checkout
- Capacity reservation
- Webhook verification
- Idempotent fulfillment
- Refund status synchronization
- No card data stored by ApplyPack

### Email service

Responsibilities:

- Authentication codes if not sent by the auth provider
- Search purchase confirmation
- Search-delivery notification
- Apply Pack purchase confirmation
- Apply Pack delivery notification
- Correction status
- Admin deadline and failure alerts

### Private object storage

Responsibilities:

- Source resume
- Optional source cover letter
- Job-description snapshots or operator attachments when needed
- Delivered resumes
- Delivered cover letters
- Short-lived authorized downloads
- Retention and deletion

### Deadline and capacity service

Responsibilities:

- Compute exact due times
- Reserve units during checkout
- Release expired reservations
- Pause sales when capacity is unavailable
- Generate approaching-due and overdue alerts
- Never silently move a contractual due time

## Time model

Store all timestamps in UTC.

Display deadlines in the confirmed public timezone, recommended:

```text
America/New_York
```

Optionally show the customer's browser-local timezone as a secondary value, but the contractual deadline must remain unambiguous.

Required timestamp fields include:

```text
created_at
updated_at
payment_confirmed_at
work_ready_at
due_at
delivered_at
completed_at
cancelled_at
refunded_at
```

Use an injectable clock or equivalent test abstraction so due-time logic can be tested deterministically.

## Identity model

Recommended model:

```text
auth.users

profiles
- id, UUID, primary key and auth user ID
- email
- full_name
- city
- state
- timezone
- created_at
- updated_at
```

Admin access must not be a user-editable profile field.

```text
admin_users
- user_id, UUID, primary key
- role, enum: owner | admin | operator | reviewer | support
- active, boolean
- mfa_required, boolean
- created_by
- created_at
- revoked_at
```

Admin authorization must be checked server-side on every protected request. Do not trust a client-supplied role or local-storage value.

## Recommended enums

```text
search_order_status:
- draft
- payment_pending
- ready_for_research
- researching
- selecting_matches
- quality_review
- ready_to_deliver
- delivered
- replacement_requested
- completed
- cancelled
- refunded
```

```text
apply_pack_order_status:
- draft
- payment_pending
- ready_to_draft
- resume_drafting
- cover_letter_drafting
- quality_review
- ready_to_deliver
- delivered
- correction_requested
- completed
- cancelled
- refunded
```

```text
document_type:
- source_resume
- source_cover_letter
- delivered_resume
- delivered_cover_letter
- job_snapshot_attachment
```

```text
job_decision:
- undecided
- saved
- not_for_me
- apply_pack_selected
- apply_pack_purchased
- conflict_reported
```

```text
conflict_status:
- submitted
- under_review
- accepted
- rejected
- replacement_in_progress
- replacement_delivered
- closed
```

```text
correction_status:
- submitted
- under_review
- accepted
- rejected_out_of_scope
- corrected
- closed
```

```text
payment_status:
- pending
- paid
- failed
- expired
- refunded_partial
- refunded_full
- disputed
```

```text
email_status:
- queued
- sent
- delivered
- bounced
- complained
- failed
```

## Core tables

The final SQL may differ to match the current framework and database, but the functional model must remain.

### `profiles`

```text
id UUID primary key
email text unique not null
full_name text
city text
state text
timezone text
created_at timestamptz not null
updated_at timestamptz not null
```

### `customer_profiles`

```text
user_id UUID primary key references profiles(id)
linkedin_url text nullable
background_notes text nullable
tools_and_platforms text nullable
certifications_and_education text nullable
resume_format_preference text nullable
cover_letter_use_preference text nullable
work_authorization_country text nullable
needs_sponsorship boolean nullable
travel_preference text nullable
created_at timestamptz not null
updated_at timestamptz not null
```

### `intakes`

```text
id UUID primary key
customer_id UUID not null
status text not null, draft | complete | approved | superseded
current_step integer not null default 1
version integer not null default 1
completed_at timestamptz nullable
approved_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
```

### `intake_answers`

Use typed columns for fields needed for filtering and validation. Use JSONB only for bounded optional answers whose structure is versioned.

```text
id UUID primary key
intake_id UUID not null
background_categories text[]
background_detail text
resume_corrections text
target_roles text[]
excluded_roles text[]
career_direction text
career_distance text
preferred_industries text[]
excluded_industries text[]
schedule_notes text
eligibility_notes text
additional_constraints text
schema_version integer not null
created_at timestamptz not null
updated_at timestamptz not null
```

### `search_criteria_versions`

The customer's approved criteria must be immutable and versioned. A delivered match is compared against the exact approved version used for the order.

```text
id UUID primary key
customer_id UUID not null
intake_id UUID not null
version integer not null
required_work_settings text[]
preferred_work_settings text[]
allowed_remote_regions text[]
minimum_annual_salary numeric nullable
preferred_annual_salary numeric nullable
minimum_hourly_rate numeric nullable
preferred_hourly_rate numeric nullable
unknown_compensation_policy text
required_employment_types text[]
preferred_employment_types text[]
excluded_employment_types text[]
required_benefits text[]
preferred_benefits text[]
unknown_benefits_policy text
schedule_requirements text[]
schedule_preferences text[]
hard_exclusions text[]
soft_exclusions text[]
target_roles text[]
excluded_roles text[]
target_industries text[]
excluded_industries text[]
work_authorization_country text
needs_sponsorship boolean nullable
travel_max text nullable
commute_max_miles integer nullable
summary_for_customer text not null
approved_at timestamptz not null
created_at timestamptz not null
unique(customer_id, version)
```

Do not update an approved row. Create a new version.

### `source_documents`

```text
id UUID primary key
customer_id UUID not null
intake_id UUID not null
document_type document_type not null
storage_key text not null
original_display_name text not null
safe_display_name text not null
reported_mime_type text
verified_mime_type text
file_size_bytes bigint not null
sha256 text not null
scan_status text not null
scan_provider text nullable
scan_result_detail text nullable
uploaded_at timestamptz not null
retention_due_at timestamptz nullable
deleted_at timestamptz nullable
```

Never expose `storage_key` directly to the browser.

### `search_orders`

```text
id UUID primary key
customer_id UUID not null
criteria_version_id UUID not null
status search_order_status not null
price_cents integer not null default 2000
currency text not null default 'usd'
stripe_checkout_session_id text unique nullable
stripe_payment_intent_id text unique nullable
payment_confirmed_at timestamptz nullable
work_ready_at timestamptz nullable
due_at timestamptz nullable
delivered_at timestamptz nullable
completed_at timestamptz nullable
assigned_admin_id UUID nullable
quality_check_completed_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
```

Enforce price on the server. Never accept price cents from the client.

### `job_matches`

```text
id UUID primary key
search_order_id UUID not null
position integer nullable
status text not null, draft | approved | delivered | replaced | removed
job_title text not null
company_name text not null
direct_job_url text not null
job_url_normalized text not null
location_text text nullable
remote_status text nullable
remote_restrictions text nullable
salary_min numeric nullable
salary_max numeric nullable
salary_currency text nullable
salary_period text nullable
compensation_source_text text nullable
employment_type text nullable
date_posted date nullable
date_checked timestamptz not null
job_snapshot_text text nullable
job_snapshot_hash text nullable
job_snapshot_source text nullable
fit_summary text not null
matching_experience text[] not null
important_requirements text[] not null
concerns_and_gaps text[] not null
customer_visible_notes text nullable
internal_notes text nullable
approved_by UUID nullable
approved_at timestamptz nullable
delivered_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
unique(search_order_id, position)
```

Do not expose `internal_notes` or full private snapshots to the customer unless explicitly designed.

### `job_match_decisions`

```text
id UUID primary key
job_match_id UUID not null
customer_id UUID not null
decision job_decision not null
optional_reason text nullable
created_at timestamptz not null
updated_at timestamptz not null
unique(job_match_id, customer_id)
```

### `criteria_conflict_requests`

```text
id UUID primary key
job_match_id UUID not null
customer_id UUID not null
criteria_version_id UUID not null
reason_codes text[] not null
customer_explanation text nullable
status conflict_status not null
admin_decision text nullable
admin_notes text nullable
replacement_job_match_id UUID nullable
submitted_at timestamptz not null
reviewed_at timestamptz nullable
closed_at timestamptz nullable
```

### `capacity_settings`

```text
id UUID primary key
service_type text unique not null, job_search | apply_pack
max_units_per_rolling_24h integer not null
active boolean not null default true
updated_by UUID not null
updated_at timestamptz not null
```

### `capacity_reservations`

```text
id UUID primary key
customer_id UUID not null
service_type text not null
reference_type text not null, search_order | apply_pack_cart
reference_id UUID not null
unit_count integer not null
reserved_at timestamptz not null
expires_at timestamptz not null
converted_at timestamptz nullable
released_at timestamptz nullable
status text not null, active | converted | released | expired
```

Capacity checks and reservations must be atomic to prevent overselling.

### `apply_pack_carts`

```text
id UUID primary key
customer_id UUID not null
status text not null, open | checkout_pending | paid | expired | cancelled
unit_price_cents integer not null default 800
currency text not null default 'usd'
item_count integer not null
total_cents integer not null
capacity_reservation_id UUID nullable
stripe_checkout_session_id text unique nullable
expires_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
```

### `apply_pack_cart_items`

```text
id UUID primary key
cart_id UUID not null
job_match_id UUID not null
emphasis_notes text nullable
do_not_mention_notes text nullable
customer_update_notes text nullable
unit_price_cents integer not null default 800
created_at timestamptz not null
unique(cart_id, job_match_id)
```

### `apply_pack_orders`

Create one order per selected job after verified payment.

```text
id UUID primary key
customer_id UUID not null
job_match_id UUID not null
source_cart_id UUID not null
status apply_pack_order_status not null
price_cents integer not null default 800
currency text not null default 'usd'
stripe_payment_intent_id text nullable
payment_confirmed_at timestamptz not null
work_ready_at timestamptz not null
due_at timestamptz not null
delivered_at timestamptz nullable
completed_at timestamptz nullable
assigned_admin_id UUID nullable
emphasis_notes text nullable
do_not_mention_notes text nullable
customer_update_notes text nullable
quality_check_completed_at timestamptz nullable
created_at timestamptz not null
updated_at timestamptz not null
unique(customer_id, job_match_id)
```

The uniqueness rule may allow a replacement order only through an explicit administrative flow, not accidental duplicate checkout.

### `deliverables`

```text
id UUID primary key
apply_pack_order_id UUID not null
document_type document_type not null
storage_key text not null
display_filename text not null
verified_mime_type text not null
file_size_bytes bigint not null
sha256 text not null
version integer not null default 1
uploaded_by UUID not null
uploaded_at timestamptz not null
delivered_at timestamptz nullable
retention_due_at timestamptz nullable
deleted_at timestamptz nullable
unique(apply_pack_order_id, document_type, version)
```

### `quality_checks`

```text
id UUID primary key
entity_type text not null, search_order | apply_pack_order
entity_id UUID not null
checklist_version integer not null
check_key text not null
passed boolean not null
checked_by UUID not null
checked_at timestamptz not null
notes text nullable
unique(entity_type, entity_id, checklist_version, check_key)
```

### `correction_requests`

```text
id UUID primary key
apply_pack_order_id UUID not null
customer_id UUID not null
document_types text[] not null
incorrect_information text not null
correct_information text not null
location_in_document text nullable
status correction_status not null
submitted_at timestamptz not null
reviewed_at timestamptz nullable
resolved_at timestamptz nullable
admin_notes text nullable
```

Enforce one included correction request per Apply Pack unless an admin creates an explicit exception.

### `payments`

```text
id UUID primary key
customer_id UUID not null
order_type text not null, search_order | apply_pack_cart
order_id UUID not null
provider text not null default 'stripe'
checkout_session_id text unique
payment_intent_id text unique nullable
amount_cents integer not null
currency text not null
status payment_status not null
paid_at timestamptz nullable
refunded_amount_cents integer not null default 0
created_at timestamptz not null
updated_at timestamptz not null
```

### `refunds`

```text
id UUID primary key
payment_id UUID not null
provider_refund_id text unique nullable
amount_cents integer not null
reason_code text not null
customer_visible_reason text nullable
status text not null
initiated_by UUID not null
created_at timestamptz not null
completed_at timestamptz nullable
```

### `provider_webhook_events`

```text
id UUID primary key
provider text not null
event_id text not null
provider_event_type text not null
received_at timestamptz not null
processed_at timestamptz nullable
processing_status text not null
attempt_count integer not null default 0
last_error_code text nullable
payload_hash text not null
unique(provider, event_id)
```

Do not store complete webhook payloads indefinitely when they include unnecessary personal data. Store the minimum needed or use a short retention period.

### `email_messages`

```text
id UUID primary key
customer_id UUID nullable
related_entity_type text nullable
related_entity_id UUID nullable
template_key text not null
to_address text not null
provider_message_id text unique nullable
status email_status not null
idempotency_key text unique not null
queued_at timestamptz not null
sent_at timestamptz nullable
delivered_at timestamptz nullable
failed_at timestamptz nullable
last_error_code text nullable
```

The database should not store rendered resume content inside email bodies. Email links to the private portal.

### `audit_log`

```text
id UUID primary key
actor_type text not null, customer | admin | system | provider
actor_id UUID nullable
action text not null
entity_type text not null
entity_id UUID not null
safe_metadata jsonb nullable
request_id text nullable
created_at timestamptz not null
```

Never place resume text, cover-letter text, secret tokens, payment card data, or full customer narratives in audit metadata.

## State transition rules

Implement explicit state transition functions. Reject invalid transitions.

### Search order

```text
draft
→ payment_pending
→ ready_for_research
→ researching
→ selecting_matches
→ quality_review
→ ready_to_deliver
→ delivered
→ completed
```

Alternate paths:

```text
payment_pending → cancelled
ready_for_research → cancelled or refunded, admin only
any paid unfinished state → refunded, policy-controlled

delivered → replacement_requested
replacement_requested → delivered or completed
```

### Apply Pack order

```text
ready_to_draft
→ resume_drafting
→ cover_letter_drafting
→ quality_review
→ ready_to_deliver
→ delivered
→ completed
```

The resume and cover-letter drafting states may proceed in a different internal order, but customer-facing status should remain simple.

Alternate paths:

```text
delivered → correction_requested
correction_requested → delivered with new version or completed
paid unfinished → cancelled or refunded, policy-controlled
```

## API surface

Adapt paths to the existing framework, but preserve server-side authorization and behavior.

### Authentication

```text
POST /api/auth/request-code
POST /api/auth/verify-code
POST /api/auth/sign-out
GET  /api/auth/session
```

If Supabase client auth is used directly, still protect privileged resources server-side.

### Intake

```text
POST  /api/intakes
GET   /api/intakes/current
PATCH /api/intakes/current/step/:step
POST  /api/intakes/current/complete
POST  /api/intakes/current/approve
```

### Uploads

```text
POST   /api/uploads/source/initiate
POST   /api/uploads/source/complete
DELETE /api/uploads/source/:id
GET    /api/uploads/source/:id/download
```

Use server-created signed upload or controlled server upload. Verify the completed object before marking it accepted.

### Search payment

```text
POST /api/checkout/search
POST /api/webhooks/stripe
GET  /api/orders/search/:id
```

### Customer portal

```text
GET  /api/customer/dashboard
GET  /api/customer/search-criteria
GET  /api/customer/job-matches
POST /api/customer/job-matches/:id/decision
POST /api/customer/job-matches/:id/conflict
```

### Apply Pack cart and checkout

```text
POST   /api/apply-pack-cart
GET    /api/apply-pack-cart/current
POST   /api/apply-pack-cart/items
PATCH  /api/apply-pack-cart/items/:id
DELETE /api/apply-pack-cart/items/:id
POST   /api/checkout/apply-packs
GET    /api/customer/apply-packs
```

### Deliverables and corrections

```text
GET  /api/customer/apply-packs/:id
POST /api/customer/apply-packs/:id/download/:documentType
POST /api/customer/apply-packs/:id/corrections
```

Return a short-lived signed URL or stream the authorized file. Do not return a permanent storage URL.

### Admin

```text
GET    /api/admin/dashboard
GET    /api/admin/search-orders
GET    /api/admin/search-orders/:id
PATCH  /api/admin/search-orders/:id/status
POST   /api/admin/search-orders/:id/job-matches
PATCH  /api/admin/job-matches/:id
DELETE /api/admin/job-matches/:id
POST   /api/admin/search-orders/:id/validate
POST   /api/admin/search-orders/:id/deliver

GET    /api/admin/apply-pack-orders
GET    /api/admin/apply-pack-orders/:id
PATCH  /api/admin/apply-pack-orders/:id/status
POST   /api/admin/apply-pack-orders/:id/deliverables
POST   /api/admin/apply-pack-orders/:id/quality-check
POST   /api/admin/apply-pack-orders/:id/deliver

GET    /api/admin/conflicts
POST   /api/admin/conflicts/:id/accept
POST   /api/admin/conflicts/:id/reject
POST   /api/admin/conflicts/:id/replace

GET    /api/admin/corrections
POST   /api/admin/corrections/:id/resolve

GET    /api/admin/capacity
PATCH  /api/admin/capacity/:serviceType

POST   /api/admin/refunds
```

Every admin endpoint requires server-side role authorization and audit logging.

## Row-level security or equivalent authorization

When using Supabase, enable RLS on every customer, order, payment, match, and file-metadata table.

Required policy outcomes:

### Customers can

- Read their own profile.
- Update bounded profile and intake fields before approval.
- Read their own approved criteria.
- Read delivered job matches from their own paid search order.
- Create their own job decision and conflict request through validated operations.
- Create and modify their own open Apply Pack cart through validated operations.
- Read their own paid Apply Pack orders.
- Request signed downloads for their own delivered files.
- Submit one correction request for their own delivered Apply Pack within the allowed period.

### Customers cannot

- Read another customer's data.
- Read internal notes.
- Read provider webhook records.
- Read other customers' payments.
- Set prices, payment status, order status, due times, or delivery times.
- Grant themselves admin access.
- Upload a deliverable as though it came from ApplyPack.
- Alter approved criteria in place.
- create an Apply Pack order without verified payment.

### Admins can

- Access only through authenticated server-side admin routes.
- Perform role-appropriate actions.
- Never rely on the browser service-role key.

### Service role can

- Process verified provider webhooks.
- Create paid orders.
- Send transactional messages.
- Generate signed file access.
- Run scheduled deadline and cleanup jobs.

## Storage design

Recommended private buckets:

```text
source-documents
apply-pack-deliverables
job-snapshot-attachments
```

Object-key patterns:

```text
source-documents/{customer_uuid}/{intake_uuid}/{document_uuid}

apply-pack-deliverables/{customer_uuid}/{apply_pack_order_uuid}/{document_uuid}
```

Never use customer names or email addresses in object keys.

Download behavior:

- Validate the customer or admin server-side.
- Generate a short-lived signed URL, recommended five minutes or less.
- Set a safe descriptive download filename through response headers.
- Log the safe download event without file contents.

## File validation

At minimum:

- Allow only DOCX and text-based PDF at launch.
- Reject macro-enabled Word files.
- Validate extension, MIME type, magic bytes, and parser result.
- Limit to the confirmed file size, recommended 10 MB.
- Normalize or generate internal names.
- Hash files.
- Quarantine until validation and malware-scan decision is complete.
- Never execute macros, embedded scripts, or attachments.
- Reject encrypted or password-protected files unless a secure supported flow is added.
- Do not render uploaded office files directly in an unsafe browser context.

The final malware-scanning implementation depends on the hosting environment and must be resolved in the initial preflight.

## Capacity algorithm

The capacity service must count committed units whose deadlines fall in the relevant rolling window, plus active reservations.

Server-side pseudo-flow:

```text
begin transaction

lock capacity settings for service type

expire stale reservations

committed_units = count paid unfinished units in rolling 24-hour workload window
reserved_units = sum active unexpired reservation units
available_units = configured_max - committed_units - reserved_units

if requested_units > available_units:
  reject with current availability

create reservation with short expiration

commit
```

Recommended reservation lifetime:

```text
15 to 30 minutes, confirm in implementation
```

On verified successful payment:

- Convert the reservation atomically.
- Create paid order records.
- Compute due times from payment confirmation.

On checkout expiration or failure:

- Release the reservation.
- Do not create paid orders.

## Payment idempotency

Requirements:

- Create a new Stripe Checkout Session for each payment attempt.
- Use a stable internal idempotency key for server-side create operations.
- Store provider event IDs.
- Process each webhook event once.
- Replaying `checkout.session.completed` must not create duplicate orders, duplicate deadlines, duplicate emails, or duplicate capacity consumption.
- The success page does not fulfill orders.
- Verify the Stripe signature against the raw request body.
- Return a successful webhook response only after safely recording or queueing the event.

## Email outbox and idempotency

Use a database-backed message record or equivalent durable queue.

Every transactional message needs an idempotency key such as:

```text
search-purchase-confirmation/{search_order_id}
search-delivered/{search_order_id}
apply-pack-purchase-confirmation/{apply_pack_cart_id}
apply-pack-delivered/{apply_pack_order_id}/{deliverable_version}
correction-submitted/{correction_request_id}
```

Retry transient failures with bounded exponential backoff. Record permanent bounce or complaint states. Alert the admin when a critical delivery email fails.

## Scheduled jobs

Required scheduled tasks:

```text
Expire capacity reservations
Send approaching-deadline admin alerts
Mark and alert overdue orders
Delete source files whose retention date passed
Delete expired signed-access artifacts if any are stored
Retry queued transactional email
Reconcile paid Stripe sessions that missed webhook processing
Recheck provider health and failed jobs
```

Scheduled jobs must be idempotent and safe to rerun.

## Audit events

At minimum, audit:

```text
intake_created
intake_completed
criteria_approved
source_document_uploaded
source_document_deleted
search_checkout_created
search_payment_confirmed
search_status_changed
job_match_created
job_match_updated
search_delivered
job_decision_changed
criteria_conflict_submitted
criteria_conflict_resolved
apply_pack_cart_created
apply_pack_payment_confirmed
apply_pack_status_changed
deliverable_uploaded
apply_pack_delivered
correction_requested
correction_resolved
refund_initiated
refund_completed
capacity_changed
admin_role_changed
```

Audit metadata must contain identifiers and safe status information, not resume text or sensitive narratives.

## Observability

Implement:

- Structured logs with request IDs.
- Safe error codes shown to customers.
- Private server logs without resume content.
- Health checks for database, storage, payment, and email dependencies.
- Alerting for failed webhooks, failed emails, overdue orders, unauthorized-access attempts, and cleanup failures.
- Redaction of authorization headers, cookies, tokens, signed URLs, and PII.

## Data deletion

The system must support:

- Customer request to delete source documents.
- Scheduled source-document deletion after the confirmed retention period.
- Legal and financial retention exceptions for payment records.
- Clear handling of delivered files and order history.
- Audit proof that deletion was attempted and completed without logging file content.

Do not promise hard deletion dates until backups and provider behavior are understood and documented.

## Data migration and rollback

Requirements:

- All schema changes through version-controlled migrations.
- No manual production-only schema changes without a migration record.
- Migrations must be reversible where practical.
- Create a backup or provider restore point before destructive changes.
- Test migrations on a nonproduction database first.
- Document rollback steps for each deployment that changes data shape.

## No automated writing in the first release

Unless the user expressly authorizes a separate AI generation integration, the production workflow is manual-first:

- Admin downloads or views source documents securely.
- Admin prepares the tailored files using the approved process.
- Admin uploads completed DOCX files.
- Admin completes the quality checklist.
- Backend delivers the files.

Do not add an OpenAI or other model API merely because the public copy mentions AI-assisted tools.

## Implemented job-source extension

Migration `202609020003_job_source_expansion.sql` additively extends the legacy `jobs` and `job_matches` contracts and adds canonical employers, redirect aliases, source definitions, affiliate directories, exclusions, source runs, source references, and reviewable fuzzy-match candidates. Exact deduplication uses canonical employer plus external ID, normalized URL, then normalized title/location/content hash. Every source reference is preserved while a verified official direct record remains preferred.

The protected endpoints are `GET /api/admin/jobs` for filtering and explainable ranking and `GET|POST /api/admin/job-sources` for registry, health, and explicitly enabled synchronization. Full field, enum, filter, and compatibility details are in `docs/job-search/SOURCE_EXPANSION.md`.
