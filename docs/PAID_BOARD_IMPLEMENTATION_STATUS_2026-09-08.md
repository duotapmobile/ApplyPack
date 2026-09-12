# Paid filtered job board - integration status

Status date: September 9, 2026

This file supersedes its September 8 implementation snapshot. The controlling product authority is `docs/applypack/11_SEPTEMBER_9_FINAL_PRODUCT_AMENDMENT.md`.

## Integrated and locally verified

- Exact server-owned plans: $6.99 weekly, $19.99 monthly, and $44.99 every three calendar months, with no trial.
- A guarded Stripe test setup creates or reuses all three recurring prices plus the $20 Top 10 and $8 tailored resume-and-cover-letter prices.
- Checkout, billing portal, signed webhooks, replay control, out-of-order rejection, renewal, cancellation-at-period-end, cancellation reversal, failed payment, recovery, expiration, refunds, and disputes fail closed around provider-verified state.
- List, count, detail, and application-link access are server-entitlement protected with private, no-store responses.
- The board is inclusion-filtered and neutrally sorted. It stores no score, tier, best-match label, or personalized order.
- Immutable shared-profile claims and durable idempotent recomputation cover profile, job, source, expiry, and policy changes.
- The $20 human-reviewed Top 10 remains independent of subscription access.
- An eligible owned board job or delivered Top 10 job can start the same $8 human-reviewed document pipeline. Paid documents remain independent of later board expiration.
- Pagination, dedicated details, attribution, warning, empty, unavailable, and expired states are implemented.
- The final database chain, including restored historical staging migrations, passes clean reset, SQL fixtures, legacy backfill, rollback/restore, and generated-type drift checks.

## Staging evidence and remaining gates

- The non-production Supabase project is migrated through `202609090033_final_integration_board_runtime.sql`; all 39 local and hosted migration versions match.
- A clearly labeled synthetic staging source has two successful idempotent runs and 12 fictional jobs. It is interface evidence only.
- There are zero authorized scheduled sources, zero real source runs, and zero real active jobs. Real-source readiness is therefore `NOT READY`.
- Stripe test credentials, five provider price IDs, and the staging webhook secret are not configured in Railway, so provider-backed purchase and lifecycle journeys remain blocked.
- The approved renderer identity, licensed Arial file/hash, malware scanner identity, parser/KMS controls, legal versions, tax treatment, staffing/capacity, manual assistive-technology exercise, and allowlisted end-to-end email exercise remain open gates.

Do not enable real-source schedules, checkout, live payments, or production purchasing until the exact gate evidence is recorded. Never treat the synthetic dataset as source authorization.
