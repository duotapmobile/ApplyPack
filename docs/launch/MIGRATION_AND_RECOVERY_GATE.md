# Migration, RLS, and recovery gate

No production migration is authorized merely because it exists in this branch. Migrations 003 through 020 are untrusted until this gate is recorded against staging.

## Preflight

1. Export the production schema, migration history, row counts, constraints, indexes, RLS policies, storage bucket configuration, and a timestamped backup reference without copying secrets or document contents into Git.
2. Treat every existing row as production data unless a record is positively proven synthetic.
3. Create or select an isolated staging database on the existing account without adding paid capacity.
4. Restore a scrubbed structural fixture plus representative historical row shapes, including incomplete and older records.
5. Apply all migrations in order to a fresh local database and to the staged preserved-data fixture.

## Required assertions

- Existing customer, intake, order, payment, job, match, delivery, conflict, correction, email, webhook, and audit rows remain present.
- Migration 003 never replaces historical employer, title, URL, or evidence with the Liveops fixture.
- Migration 005 does not enqueue existing paid production orders.
- New constraints and enum values accept every legitimate historical state.
- RLS denies cross-customer rows and private objects; admin access requires role plus AAL2.
- Customer history can display delivered inactive or closed jobs while excluded, rejected, hard-exclusion, and Liveops records stay hidden.
- Checkout, payment conversion, refund, delivery, replacement, capacity, and scan claims are concurrency-safe and idempotent.
- Indexes support the queue and customer paths used by the application.

## Rollback and recovery

Migrations are forward-only. Before applying to production, record the exact backup identifier and prove restoration into a non-production target. A code rollback uses Railway's prior successful deployment; a data rollback uses the verified backup or a reviewed forward repair, never an ad hoc destructive reverse migration.

If payment integrity, authorization, confidentiality, or delivery correctness is in doubt:

1. disable both capacity rows;
2. keep webhook receipt enabled so events are not silently lost;
3. preserve identifiers, timestamps, provider event IDs, and release SHA without copying customer content;
4. restore or repair in staging;
5. rerun RLS, payment replay, and customer-isolation tests;
6. reopen capacity only after the evidence is reviewed.

Production migration evidence must record operator, UTC timestamp, source and target migration versions, row-count comparison, backup/restore proof, test commands, and any accepted residual risk.
