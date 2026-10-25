# Paid-launch cost review — October 23, 2026

Status: historical preparation inputs for the [rejected infrastructure quote](PAID_LAUNCH_INFRASTRUCTURE_QUOTE_2026-10-23.md). The owner rejected its $160.78/month forecast, $165 planning budget and up-to-$10 recovery-drill allowance as unaffordable. No paid resources have been created. Stay on Railway and distinguish launch necessities, first-paying-customer needs, and scaling additions in the replacement consolidated quote. Amendment 18's new-order retention policy bounds private-content growth but does not automatically reduce fixed service charges. The four-hour recovery and fifteen-minute reconciliation targets remain unchanged. Provider/drill evidence is separate from the cost forecast.

## Verified reuse and gaps

Railway project Apply Pack is already on Hobby. Its existing production web and stopped staging web/maintenance are retained. One separate production maintenance service is proposed. Existing domain and provider credentials are retained. Both Supabase projects belong to organization xpextbpofycakdyocbhu (DuoTap); the official read-only Management API verified its current plan is Free at 21:02 UTC. Production remains inactive. The proposed Pro organization plan is an incremental charge, not an existing paid allowance; production recovery arrangements and database access remain unresolved.

The initial local AWS-access gap is superseded by the 20:39 UTC browser login and verified STS identity for account 838445019912, IAM user applypack-staging-operator, profile applypack-staging. The 20:42 UTC read-only inventory verified the existing staging foundation: one sensitive-payload KMS key/alias, one isolated VPC, two private subnets and two local-only route tables. Retain these existing staging resources instead of quoting duplicate new resources; their existing charges remain part of the account baseline. Railway workload credentials are still unconfigured.

Within the inspected names/tags, no matching worker functions, temporary buckets, image repositories, roles, Roles Anywhere anchors/profiles or worker log groups were found. IAM ListPolicies returned AccessDenied once; policy existence is unknown. Unrelated resources, production provisioning permissions and actual account usage/credits remain unverified. Inventory has not provisioned anything or approved spending.

The separate production key/network foundation configuration is now [implemented](../runbooks/AWS_PRODUCTION_FOUNDATION.md), with production-target, immutable-source, exact provider-plan and approved-quote-digest controls. All 146 independent offline tests and AWS's read-only ValidateTemplate check passed. Existing production worker/Roles Anywhere templates are retained, and staging configuration remains unchanged. Production creation permissions and the exact incremental quote remain unresolved; no production foundation has been created.

The worker-image release gate also uncovered High/Critical operating-system findings in the existing Debian 12 worker and a Debian 13 candidate. A supported Ubuntu 26.04 LTS candidate with the official no-GUI Writer/core packages is undergoing build, render and scan validation. This is source/image remediation, not provisioning or a paid support subscription; its exact image and runtime resource assumptions must be finalized before quoting the worker. The earlier passing image CI covered the web image only.

## Proposed quote components

| Component | Proposed scope | Monthly forecast before existing allowances |
| --- | --- | ---: |
| Supabase production recovery | Pro organization, production Small compute, 7-day PITR | About $130 including one $10 compute credit |
| Supabase staging in same organization | One additional Micro project, no staging PITR | About $10 |
| AWS isolated processing/encryption | Two environment-specific workers, temporary buckets, images and restricted identities; retain the verified staging key/network and scope the separate production foundation | Prior model: $4.62–$8.43; revise for confirmed reuse and actual missing resources |
| Restored Railway staging web | 0.5 GB average RAM, 0.1 used vCPU, 10 GB egress assumption | About $7.50 resource usage |
| Both maintenance runners | 15-minute cadence, 30-second average run, 0.125 GB RAM/0.1 vCPU assumption | About $0.22 resource usage |
| Protected recovery copies | Durable private-object/version backup, separate recoverable key/configuration custody, encrypted database exports and restore drill | Must finish sizing and access/custody review |
| Existing production web, email and domains | Reuse; measure any changed resource use and included allowance | Incremental amount not yet verified |
| Paid CA and NAT gateway | Excluded from the default design | $0 proposed |

These are usage assumptions, not reserved capacity or a guaranteed invoice. Supabase PITR is a proposed way to meet the database RPO, not yet selected or activated by the owner. It requires at least Small compute. Seven-day PITR is billed at $0.137/hour (about $100 at 730 hours). One $10 compute credit is shared per organization. The two-project scenario is approximately $140 before unrelated usage. [Supabase PITR pricing](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery), [backup prerequisites](https://supabase.com/docs/guides/platform/backups), [Supabase pricing](https://supabase.com/pricing).

The AWS calculation is described, including all assumptions and exclusions, in the prior PROVISIONAL_COST_MODEL.md. Two $1 key-months plus metered calls are included; an existing suitable key removes only its incremental fixed charge. IAM Roles Anywhere does not require purchasing AWS Private CA. The authenticated staging-key inventory is now available. Reconcile the reused baseline, production key count, image/storage/log usage, permissions and transfer before converting the model into the quote. [AWS KMS pricing](https://aws.amazon.com/kms/pricing/), [prior model](../evidence/launch-execution-2026-10-22/PROVISIONAL_COST_MODEL.md).

Railway's existing subscription is not charged again per environment. New usage interacts with the workspace's shared included usage, so calculate the actual incremental invoice after reviewing existing consumption. [Railway plans](https://docs.railway.com/pricing/plans).

## Recovery arrangements to include in the final quote

Production database PITR alone does not back up private file objects or recover independent credentials. Pair it with encrypted private-object/version protection, recoverable application encryption keys, authentication configuration and separate secure recovery access. The measured drill must recover after loss of the original computer or operator credentials, with checkout/intake locked, real paid obligations reconciled, and both a successful owner download and rejected wrong-user download.

Require a measured recovery within 240 minutes and at most 15 minutes of application data needing recovery or reconciliation. Include the temporary restore resource, storage retention, export/restore transfer and alert costs in the same final quote. Do not substitute daily database backups for the 15-minute target. Protected backup custody and actual restore evidence are still unresolved.

Candidate `9995b90ee13feb41de55a1a65e6496fff1735578` passed the CI database job and isolated structural recovery checks. That evidence does not establish hosted recovery time, data-loss limits, off-machine custody or the cost of the protected recovery arrangement. The subsequent source fixes require fresh committed-candidate CI; readiness remains NOT READY.

The final approval request must identify actual reused/new resources, all recurring charges and variable assumptions, one-time drill allowances, retention/alerts and any exclusions together. Only then may the quote digest be bound to production provisioning.
