# Deadline and capacity

## Scope

Controls Top 10 and document-review workload, customer deadlines, adjustment/refund paths, and race-safe reservations.

## Prerequisites

- Named trained reviewers and on-call owner.
- Founder-approved rolling capacity values for the target environment.
- Current source inventory, payment state, and immutable customer criteria snapshot.

## Procedure

1. Reserve capacity atomically before checkout; revalidate it after verified payment.
2. Start the Top 10 24-hour deadline only after intake, verified payment, and capacity are all valid. Deliver exactly 10 active, permitted, evidence-supported jobs; never pad.
3. Recheck listing activity, source permission, criteria version, and policy immediately before release.
4. When 10 valid jobs cannot be delivered, present the governed precise adjustment or full-refund choice. Never silently broaden criteria.
5. Reserve document generation/review capacity per $8 line and prevent release until the current résumé and cover letter both pass required approvals.

## Verification

Record capacity version, reservation/allocation IDs, paid timestamp, active due time, reviewer, queue state, release count, last listing recheck, and any adjustment/refund decision.

## Failure and recovery

Close affected capacity, preserve queue ownership and deadlines, reclaim expired leases, notify customers through the approved template, and initiate required refunds idempotently.

## Stop conditions

Stop for unnamed staffing, stale/unauthorized inventory, capacity race, missing reviewer, fewer than 10 eligible jobs, or pressure to hide a missed deadline.
