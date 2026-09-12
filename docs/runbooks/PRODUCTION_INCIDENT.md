# Production incident

## Scope

Use for confidentiality, tenant-isolation, payment, source-permission, delivery, availability, and provider incidents. This runbook does not authorize production deployment.

## Immediate containment

1. Name incident commander, severity, start time, and affected environment.
2. For confidentiality or tenant-isolation risk, disable affected downloads and processing. For payment ambiguity, disable checkout. For fulfillment/source risk, close capacity and ingestion schedules.
3. Preserve logs and provider event IDs without copying customer documents, secrets, or PII into the incident record.
4. Rotate exposed credentials through the provider and environment store; never paste replacements into chat or Git.

## Investigation and communication

Correlate exact release SHA, migration versions, provider events, tenant IDs, source authorization, and first known failure. Use qualified legal/privacy guidance for customer or regulator notifications. State only confirmed facts.

## Recovery

Apply the smallest reviewed fix, test it in staging, reconcile affected payments/files/orders, and restore one control at a time. Verify health, tenant isolation, signed webhooks, source permissions, and one synthetic transaction before reopening capacity.

## Closure evidence

Record timeline, impact, root cause, containment, affected opaque IDs/counts, recovery SHA, tests, notifications, and follow-up owners/dates.

## Stop conditions

Do not reopen on an unexplained confidentiality/payment discrepancy, incomplete reconciliation, failed health gate, missing accountable owner, or unapproved production action.
