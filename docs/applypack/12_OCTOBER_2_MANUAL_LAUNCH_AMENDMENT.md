# October 2, 2026 Manual Launch Amendment

Status: governing product amendment for the manual launch.

This amendment supersedes conflicting launch-price, subscription-board, checkout, timing, and activation provisions in earlier ApplyPack documents. The September 9 amendment remains preserved as historical authority and is not rewritten.

## Launch products

ApplyPack launches with exactly two one-time products:

1. Job Match Search: $18.99 for exactly ten distinct, current, human-reviewed job opportunities, delivered within 24 clock hours after successful payment and receipt of complete required inputs.
2. Apply Pack: $7.99 per selected delivered job for one truthful tailored resume and one truthful tailored cover letter, delivered within 24 clock hours after successful payment and receipt of complete required inputs.

There is no subscription, public paid job board, automatic application, ranking guarantee, or automated employer-source schedule in this launch.

## Search checkout

Search checkout is invitation-based. A customer first submits an intake. An authorized operator must verify that at least ten suitable, permitted, current opportunities can be supported, reserve one rolling-24-hour search unit atomically, and issue a short-lived single-use invitation. Payment cannot begin without that invitation.

The search deadline begins at the successful-payment timestamp. It does not begin when the intake is submitted, reviewed, or invited.

## Apply Pack checkout

The customer may purchase an Apply Pack only for a current eligible job from her immutable delivered exact-ten release. Capacity is reserved atomically. The deadline begins only after successful payment and all required job-specific inputs are complete.

## Capacity

At most one search order and two Apply Packs may be accepted in any rolling 24-hour window. Reservations, conversion, release, refund handling, and webhook replay must remain atomic and idempotent.

## Exact-ten release

Release requires exactly ten distinct opportunities and no padding. Duplicate identity is evaluated by reliable employer/source identifiers, the union of normalized listing and application URLs across both records, and only then fingerprint fallback when at least one record has no stronger identifier. All ten listings must be reverified immediately before human release approval.

If ten qualifying opportunities cannot be delivered within the contractual window, ApplyPack does not substitute quota filler. The full service-failure refund remedy applies.

## Historical records

Historical $20 search and $8 Apply Pack records remain immutable and valid for reconciliation and refunds under their original contract versions. They cannot be used to create new checkout sessions.

New checkout sessions use the pricing version manual-launch-pricing-2026-10-02-v2, terms version manual-launch-terms-2026-10-02-v2, search contract manual-launch-search-v2, and Apply Pack contract manual-launch-pack-v2.

## Launch lock

Checkout is locked by default. Deployment health and public order acceptance are separate states. Public checkout may be unlocked only after:

- the exact deployed SHA passes the active health gate;
- required database, payment, email, AWS KMS, isolated document processing, rendering, maintenance, alerting, backup, inventory, and accessibility evidence passes;
- four independent supervisor reports have no unresolved P0 or P1 findings;
- every accepted P2 has an owner, deadline, mitigation, and written approval;
- production canary charges and full refunds totaling $26.98 are reconciled;
- capacity is available; and
- a Florida CPA or written Florida Department of Revenue approval reference is stored.

Deployment alone never makes the service ready.

## Tax boundary

The working assumption is that the customized service and electronically delivered files do not require separately added Florida sales tax. That assumption is not a launch approval. If written advice requires tax collection or different disclosures, checkout configuration and public copy must be revised before activation.

## Rollback

Rollback disables new checkout and document intake first. Webhook processing, refunds, customer access, maintenance, and audit evidence remain available. Database correction is forward-only; published migrations are never destructively reversed.
