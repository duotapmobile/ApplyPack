# October 19 Tax Activation Amendment

Date: 2026-10-19
Status: governing forward amendment

## Decision

A separate Florida CPA opinion, Florida Department of Revenue response, tax-approval flag, or tax-approval reference is not a launch gate. This amendment supersedes only those requirements in the October 2 manual-launch amendment, older launch decisions, checklists, runbooks, evidence templates, and runtime activation contracts.

This is a product and activation decision, not a conclusion about tax law. ApplyPack may still obtain professional advice, monitor its obligations, and change future configuration deliberately when required.

## Fixed-total checkout contract

New manual-launch checkout remains limited to:

- $18.99 total for one Job Match Search;
- $7.99 total per selected Apply Pack;
- USD, one-time Stripe prices;
- `TAX_INCLUSIVE_NO_ADDED_AMOUNT` with `tax_inclusive=true`; and
- Stripe automatic tax explicitly disabled.

The customer-visible total, server-calculated total, Stripe line items, payment record, and receipt must agree. Checkout may not silently add tax, fees, shipping, a subscription, or a different quantity. A future requirement to collect or separately display tax requires a new versioned product decision, matching public copy, provider configuration, database contract, and tests before activation.

## Persisted evidence

Historical `tax_configuration_approved` and `tax_approval_reference` fields and prior records remain available for reconciliation. They do not authorize or block a new activation. Current activation evidence records every other required exact-SHA, provider, supervisor, canary, capacity, document-safety, and operations gate.

## Launch effect

This amendment does not unlock checkout. Every non-tax launch gate remains fail-closed, including exact deployed SHA, production database readiness, fixed prices, payment and email controls, AWS KMS and isolated rendering, maintenance, backups, inventory, accessibility, four supervisor reviews, accepted P2 dispositions, canary delivery and full refund reconciliation, and available capacity.
