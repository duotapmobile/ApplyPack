# Tax Activation Decision Evidence

Date: 2026-10-19
Decision authority: direct owner instruction and `docs/applypack/16_OCTOBER_19_TAX_ACTIVATION_AMENDMENT.md`

## Removed gate

Launch activation no longer requires a separate CPA opinion, Department of Revenue response, `tax_configuration_approved=true`, `tax_approval_reference`, or `taxApprovalReference` evidence input.

Historical database columns and records remain intact. Migration `202610190082_tax_activation_decision.sql` changes the active contract forward-only and does not rewrite a published migration.

## Retained payment controls

- Job Match Search is exactly 1,899 cents USD.
- Each Apply Pack is exactly 799 cents USD.
- Both are one-time Stripe prices verified server-side.
- Database activation requires `TAX_INCLUSIVE_NO_ADDED_AMOUNT` and `tax_inclusive=true`.
- Every Stripe Checkout Session explicitly sets `automatic_tax.enabled=false`.
- No client supplies a price, added tax, fee, or quantity.
- A future tax change requires a new versioned decision and synchronized copy, provider, database, and test changes.

## Unchanged launch locks

All other release, provider, infrastructure, document, accessibility, supervisor, canary, refund, and capacity gates remain required. This source change performs no provider mutation and does not claim production activation.
