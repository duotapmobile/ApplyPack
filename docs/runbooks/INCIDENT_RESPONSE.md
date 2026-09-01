# Incident response

## First actions

1. Pause affected purchases by disabling the relevant capacity row.
2. Preserve provider event IDs, order IDs, timestamps, and release SHA. Do not copy resume content into the incident record.
3. Determine whether the issue affects confidentiality, payment, deadline, delivery, or availability.
4. Notify the founder through the configured admin alert channel.

## Payment mismatch

Treat Stripe as payment authority. Reconcile the signed event with the local order and payment record. Never set paid status from a browser redirect. Refund only through Stripe and record the provider refund ID.

## Private-data exposure

Disable the affected route, rotate exposed keys, preserve access logs, identify affected object paths and accounts, and obtain legal guidance about notification duties. Do not delete evidence during containment.

## Missed deadline

Stop new capacity for that service, identify every committed deadline, contact affected customers, and record the remedy. Do not silently change a stored deadline.

## Failed email

The portal remains the delivery authority. Retry only after verifying the recipient and provider state. Never attach private documents to a fallback email.

## Recovery

Restore a known successful Railway release when code caused the issue. Validate database compatibility before rollback. Reopen capacity only after the original failure and monitoring gap are resolved.
