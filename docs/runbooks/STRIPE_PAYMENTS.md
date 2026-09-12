# Stripe payments

## Scope

Covers the three recurring board plans, standalone $20 Top 10, $8 materials package, billing portal, and signed webhook lifecycle.

## Prerequisites

- DuoTap Stripe sandbox account confirmed.
- Test-mode restricted secret and webhook signing secret stored only in the environment.
- Exact prices: $6.99/week, $19.99/month, $44.99/three calendar months, $20 Top 10, $8 materials; no trial.
- Current tax, subscription, cancellation, refund, Terms, and Privacy approvals.

## Procedure

1. Verify every product/price is `livemode=false`, correct currency/amount/interval, and active.
2. Configure the signed webhook for the governed event allowlist. Keep return pages informational; entitlement comes only from verified provider events.
3. Run separate synthetic accounts through all five purchases. Attempt price tampering, duplicate submission, replay, out-of-order events, and simultaneous checkout.
4. Exercise renewal, cancel-at-period-end, cancellation reversal, failed payment, recovery, expiration, refund, dispute, and billing portal invoices/payment-method management.
5. Reconcile provider objects against local subscription/order/payment records.

## Verification

Record test account, checkout session, subscription/payment intent, invoice, event IDs, local record IDs, expected/actual amount and state, and access result. Redact customer data and never record secrets.

## Failure and recovery

Disable checkout flags, keep capacity closed, preserve signed event evidence, and reconcile from Stripe before retry. Never grant access from a success URL or unverified client data.

## Stop conditions

Stop for live keys/events/charges, wrong account, wrong price, missing legal approval, unsigned webhook, inconsistent provider state, or ambiguous refund/dispute correlation.
