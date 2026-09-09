# Rollback

## Scope

Covers recovery from a bad Railway release while preserving forward-only database safety. Never reverse a production migration ad hoc.

## Prerequisites

- Exact current and prior successful release SHAs/deployment IDs.
- Verified target project, environment, and service.
- Database compatibility assessment for the prior application SHA against the current schema.
- Incident and payment/confidentiality owners when relevant.

## Procedure

1. Disable checkout and close affected capacity when payment, confidentiality, or schema compatibility is uncertain.
2. Confirm the prior application SHA is compatible with every applied migration. Prefer a forward corrective migration when it is not.
3. Roll Railway back only to the identified prior successful deployment. Do not reset Git, mutate `main`, or delete migration history.
4. Reconcile webhooks, scheduled jobs, refunds, source runs, and in-flight file work before reopening.

## Verification

Verify deployed SHA, `/api/live`, strict `/api/health`, database migration history, tenant isolation, private downloads, signed webhook replay, source authorization, and one synthetic test-mode journey. Record expected versus actual results.

## Failure and recovery

If rollback cannot safely read the current schema, redeploy the current release, keep customer-impacting controls closed, and prepare a reviewed forward fix.

## Stop conditions

Stop on target mismatch, unknown prior SHA, incompatible schema, live payment without authorization, destructive database reversal, or incomplete customer-impact reconciliation.
