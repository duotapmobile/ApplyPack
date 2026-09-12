# Refunds

## Scope

Covers required and discretionary refunds for Top 10, materials, subscriptions, duplicate charges, capacity failures, disputes, and delivery exceptions.

## Prerequisites

- Provider payment and current invoice/order binding verified.
- Approved refund reason, amount, scope, and accountable operator.
- Idempotency key and customer-visible status path.

## Procedure

1. Determine whether the refund applies to the current subscription period, an older invoice, a full Top 10 order, or one $8 material line.
2. Queue the exact provider amount once. Preserve access to already purchased, approved documents unless the affected order itself requires revocation.
3. Show “refund processing” until Stripe confirms success. Do not claim completion from request acceptance.
4. Reconcile failed, canceled, duplicate, replayed, partial, full, and disputed outcomes. A historical-invoice refund must not revoke a newer paid board period.

## Verification

Record local operation ID, Stripe refund/event IDs, payment/invoice binding, amount, provider status, resulting entitlement/order state, notification ID, and timestamp.

## Failure and recovery

Keep the operation retryable and visible to staff, alert on permanent failure, and reconcile the provider object before another attempt. Escalate inconsistent totals or customer access immediately.

## Stop conditions

Stop for amount mismatch, unknown invoice/payment ownership, over-refund risk, live-mode use without production approval, or a request to mark an unconfirmed refund complete.
