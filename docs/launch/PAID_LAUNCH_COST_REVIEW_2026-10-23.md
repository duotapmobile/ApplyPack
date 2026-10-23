# Paid-launch cost review — October 23, 2026

Status: draft inputs for the single consolidated quote; NOT a provisioning approval. No paid resources have been created. AWS inventory and existing plan/usage credits still need authenticated verification, so an exact incremental total cannot yet be represented honestly.

## Verified reuse and gaps

Railway project Apply Pack is already on Hobby. Its existing production web and stopped staging web/maintenance are retained. One separate production maintenance service is proposed. Existing domain and provider credentials are retained. Both Supabase projects belong to organization xpextbpofycakdyocbhu; production is inactive. AWS access is unavailable locally and in Railway; actual reusable AWS resources are unknown.

## Proposed quote components

| Component | Proposed scope | Monthly forecast before existing allowances |
| --- | --- | ---: |
| Supabase production recovery | Pro organization, production Small compute, 7-day PITR | About $130 including one $10 compute credit |
| Supabase staging in same organization | One additional Micro project, no staging PITR | About $10 |
| AWS isolated processing/encryption | Two environment-specific worker functions, temporary buckets, keys, images and restricted identities; reuse any suitable existing resources | Existing local model: $4.62–$8.43 at its stated workload |
| Restored Railway staging web | 0.5 GB average RAM, 0.1 used vCPU, 10 GB egress assumption | About $7.50 resource usage |
| Both maintenance runners | 15-minute cadence, 30-second average run, 0.125 GB RAM/0.1 vCPU assumption | About $0.22 resource usage |
| Protected recovery copies | Durable private-object/version backup, separate recoverable key/configuration custody, encrypted database exports and restore drill | Must finish sizing and access/custody review |
| Existing production web, email and domains | Reuse; measure any changed resource use and included allowance | Incremental amount not yet verified |
| Paid CA and NAT gateway | Excluded from the default design | $0 proposed |

These are usage assumptions, not reserved capacity or a guaranteed invoice. Supabase PITR is a proposed way to meet the database RPO, not yet selected or activated by the owner. It requires at least Small compute. Seven-day PITR is billed at $0.137/hour (about $100 at 730 hours). One $10 compute credit is shared per organization. The two-project scenario is approximately $140 before unrelated usage. [Supabase PITR pricing](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery), [backup prerequisites](https://supabase.com/docs/guides/platform/backups), [Supabase pricing](https://supabase.com/pricing).

The AWS calculation is described, including all assumptions and exclusions, in the prior PROVISIONAL_COST_MODEL.md. Two $1 key-months plus metered calls are included; an existing suitable key removes only its incremental fixed charge. IAM Roles Anywhere does not require purchasing AWS Private CA. Recheck the actual account, region, key count, image/storage/log usage and transfer before converting the model into the quote. [AWS KMS pricing](https://aws.amazon.com/kms/pricing/), [prior model](../evidence/launch-execution-2026-10-22/PROVISIONAL_COST_MODEL.md).

Railway's existing subscription is not charged again per environment. New usage interacts with the workspace's shared included usage, so calculate the actual incremental invoice after reviewing existing consumption. [Railway plans](https://docs.railway.com/pricing/plans).

## Recovery arrangements to include in the final quote

Production database PITR alone does not back up private file objects or recover independent credentials. Pair it with encrypted private-object/version protection, recoverable application encryption keys, authentication configuration and separate secure recovery access. The measured drill must recover after loss of the original computer or operator credentials, with checkout/intake locked, real paid obligations reconciled, and both a successful owner download and rejected wrong-user download.

Require a measured recovery within 240 minutes and at most 15 minutes of application data needing recovery or reconciliation. Include the temporary restore resource, storage retention, export/restore transfer and alert costs in the same final quote. Do not substitute daily database backups for the 15-minute target. Protected backup custody and actual restore evidence are still unresolved.

The final approval request must identify actual reused/new resources, all recurring charges and variable assumptions, one-time drill allowances, retention/alerts and any exclusions together. Only then may the quote digest be bound to production provisioning.
