# ApplyPack consolidated infrastructure quote

Prepared October 23, 2026. **Rejected by the owner as unaffordable; retained as historical cost evidence. No paid resources provisioned.** This is not a current approval request or spending authority. The owner chose to stay on Railway and requested separate launch, first-paying-customer, and scale needs. Prepare a replacement consolidated incremental quote before provisioning anything new. Amendment 18 shortens prospective private-content retention; it does not itself prove lower fixed infrastructure charges or change the agreed recovery targets.

Current follow-up: [October 25 phased cost and recovery review](PAID_LAUNCH_PHASED_COST_REVIEW_2026-10-25.md). No replacement quote has been approved.

The rejected proposal requested a **$165/month planning budget**, plus **up to $10 once for the recovery drill**. Its itemized forecast was **$160.78/month additional to the existing production hosting/domain/email baseline**, before tax. The figures below preserve that proposal's assumptions; they are not an approved budget or current quote. Shared AWS/Railway credits and actual usage were not guaranteed.

The database recovery add-on accounts for $100.01 of the estimate. Daily database backups alone do not meet the agreed maximum of fifteen minutes of application data requiring recovery or reconciliation. The target remains restoration within four hours, with every paid transaction reconciled against Stripe.

## Exact additions and reuse

| Provider | Add or change | Reuse |
| --- | --- | --- |
| Supabase, DuoTap organization | Upgrade the currently Free organization to Pro; resume production project `spjaaxndiduhrcleazwb` on Small compute with seven-day point-in-time recovery; staging `fmugizadzdnqfckujqlw` on Micro; one temporary Small recovery project for at most 24 hours | Existing two projects, records, private storage, authentication and organization; one shared $10 compute credit |
| AWS, account `838445019912`, `us-east-1` | One production isolated network foundation; two environment-specific document workers, temporary buckets and image repositories; one new production application KMS key; one separately retained protected-recovery KMS key and private versioned bucket `applypack-production-protected-recovery-838445019912`; restricted deployment/web/writer/retention/recovery identities and operational logs | Verified staging VPC, two subnets, local route tables and staging application KMS key; no duplicate staging foundation |
| Railway, Apply Pack, existing Hobby workspace | Restore existing staging web/maintenance; add production maintenance every 15 minutes, protected-copy service every five minutes, and separately credentialed retention service every five minutes; one locked temporary recovery web service for at most 24 hours | Existing production web, stopped staging services, project, domain, subscription and frozen web image |
| Credentials and email | Reuse owner-controlled secure recovery custody and the existing email service; issue scoped workload certificates under a privately managed CA | Existing provider accounts; no paid CA, password manager, support plan or email-plan upgrade in this quote |

Production purchasing remains locked. The retention deletion implementation requires the separate explicit authorization described in the retention review; this cost approval does not substitute for it. AWS profiles remain disabled until their identities and configuration are verified. No new resource beyond this list is covered.

## Recurring forecast

USD. Supabase uses a 730-hour model month. Workload assumptions below use 30 days. Hourly charges vary with calendar/billing hours; the difference is not hidden in a fixed-price claim.

| Item | Quantity and rate | Monthly forecast |
| --- | --- | ---: |
| Supabase Pro | One organization | $25.00 |
| Production Small compute | 730 × $0.0206/hour | $15.04 |
| Staging Micro compute | 730 × $0.01344/hour | $9.81 |
| Production seven-day PITR | 730 × $0.137/hour | $100.01 |
| Organization compute credit | Applied once | −$10.00 |
| **Supabase subtotal** | | **$139.86** |
| New KMS keys and requests | Two new $1 key-months; 150,000 symmetric requests × $0.03/10,000 | $2.45 |
| Two document workers | 18,280 total invocations; 512 MB; assumed 30 seconds billed each; request and extra 512 MB temporary-disk charges included | $4.58 |
| ECR images | Six retained images, 6 GB billed storage × $0.10 | $0.60 |
| Temporary S3 storage/requests | 1 GB-month; 73,120 PUT/LIST and 73,120 GET/HEAD requests | $0.42 |
| Durable recovery S3 storage/requests | 10 GB-month; 200,000 PUT/LIST and 200,000 GET/HEAD requests | $1.31 |
| Operational logs | 1 GB ingestion plus 1 GB-month storage | $0.53 |
| AWS internet transfer allowance | 10 GB × $0.09; no shared free-transfer allowance deducted | $0.90 |
| Notification allowance | Existing email/budget channels; no new paid monitoring subscription | $0.01 |
| **AWS subtotal** | Calculated before free allowances | **$10.80** |
| Restored staging web | Average 0.5 GB RAM and 0.1 used vCPU; 10 GB egress | $7.50 |
| Staging and production maintenance | Two 15-minute schedules; 30 seconds/run; 0.125 GB RAM/0.1 vCPU | $0.22 |
| Protected copy service | Five-minute schedule; 30 seconds/run; 0.5 GB RAM/0.1 vCPU | $0.70 |
| Separate retention service | Same scheduling/resource assumption as copy service | $0.70 |
| Additional recovery traffic | 20 GB Railway egress including source responses and archive uploads | $1.00 |
| **Railway subtotal** | Existing subscription not charged again; unused shared credit not deducted | **$10.12** |
| **Total incremental forecast** | Totals calculated from unrounded values | **$160.78/month** |

Worker calls include 17,280 possible readiness probes across two environments and 1,000 business calls/retries. These are invocations, not an order forecast. The official Ubuntu worker passed the local real-render checks and complete OS/Python High/Critical scan; the next committed candidate still needs image CI and hosted worker proof.

Copies reuse verified unchanged archive objects; this forecast does not assume re-uploading the entire file set every five minutes. The complete graph is bounded. File count, manifest size, retry count, runtime and transferred bytes must be measured during the hosted proof. Using Railway's published monthly resource rates, each five-minute job is $0.70 and both maintenance jobs total $0.216667 before rounding. If both five-minute jobs average their full five-minute timeout instead of thirty seconds, their combined Railway scheduler line rises from $1.40 to $14/month. Sustained healthy completion is required before launch.

New KMS keys are retained and rotated. Each key's first two rotations adds $1/month, so these two keys can add $2/month after the first rotation and another $2/month after the second. Existing staging-key charges are baseline costs, not newly quoted fixed charges. Active delivered documents stay available while customer access remains valid; 10 GB is a sizing allowance, not an automatic deletion threshold.

## One-time recovery allowance

Authorize **up to $10 additional usage** for one drill: one temporary Small Supabase project and locked Railway recovery web service for at most 24 hours, up to 20 GB archive download and 20 GB Railway transfer, temporary duplicate storage, and test render/request usage. At the listed rates, these quantities model approximately $4 before allowances; the $10 allowance covers bounded startup/retry variation. No second paid subscription, new computer, paid vault, or paid CA is included. Provider-managed restoration/export features must be checked for any extra quoted fee before use; an unlisted fee is not approved by this document.

The operator must have an already available second machine or independent session and securely recoverable provider/MFA/configuration credentials. Provider access, authentication configuration, encryption-key access and secure custody must be proved independently of the original machine. A successful SQL reset or file-copy heartbeat alone is not recovery proof.

## Protection and operating limits

Production PITR protects database records, including authentication data covered by the verified provider restore. Private Storage bytes require the separate versioned archive. The initial protected copy precedes forward migration; continuous copy and retention then run independently. Archive manifests, verified object versions, deletion records, encryption keys and configuration/certificate custody are all part of the drill. Owner downloads and rejected wrong-user downloads must pass while the recovery target remains isolated.

New intake and checkout are held when archive or retention evidence is missing or twelve minutes old; the operator warning begins at ten minutes. These checks measure file/archive freshness. Provider PITR status/recovery point, independent custody and the full timed drill remain separate launch gates. Paid-order fulfillment, private access and ordinary refunds remain available under their existing authorization rules.

Billing alerts are notifications, not hard caps. Review forecast/actual usage against the $165 planning budget during the pilot. Do not stop backup, reconciliation or paid fulfillment automatically to enforce a spending number. Additional resources, plan upgrades or larger measured assumptions require a reviewed cost change before provisioning them.

The existing email credential returned unauthorized and must be repaired before sign-in, transactional mail or alert delivery can pass. No email-plan upgrade is authorized. Stripe transaction/refund/dispute fees, taxes, existing production-web/domain/email charges and human review/support time are separate operating costs; this infrastructure quote creates no subscription product or extra customer fee. Live Stripe account onboarding/fees remain unverified until the account is connected.

## Rate and inventory evidence

Provider inventory on October 23 verified Supabase Free, Railway Hobby and the reusable AWS staging foundation. AWS production foundation and recovery templates passed read-only provider template validation; those calls created no resources. Production and staging automatic deployment triggers are held.

- [Supabase PITR pricing and compute-credit example](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery), [compute hourly rates](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [backup coverage](https://supabase.com/docs/guides/platform/backups).
- [Railway resource pricing and shared included usage](https://docs.railway.com/pricing/plans).
- [AWS KMS key/rotation/request pricing](https://aws.amazon.com/kms/pricing/), [Lambda compute/request/disk pricing](https://aws.amazon.com/lambda/pricing/), [ECR image storage](https://aws.amazon.com/ecr/pricing/).
- [S3 pricing and free DELETE requests](https://aws.amazon.com/s3/pricing/), [AWS Standard storage/request comparison](https://aws.amazon.com/blogs/storage/run-spark-31-faster-and-optimize-compute-costs-with-amazon-s3-express-one-zone-on-amazon-emr/), [CloudWatch log pricing](https://aws.amazon.com/cloudwatch/pricing/).

This quote supersedes the draft component table in PAID_LAUNCH_COST_REVIEW_2026-10-23.md. Approval must be recorded against this document's digest before a paid provider action. Approval is not launch acceptance or authorization to delete backup versions.

## October 25 email finding correction

The historical assertion above that the email credential "must be repaired" is superseded by current evidence: the existing configured ApplyPack credential successfully sent three direct test messages through Resend. All three arrived through the existing aliases in the verified owner business Gmail account with SPF, aligned DKIM and DMARC passing; the admin test landed in Spam. The earlier domain-list HTTP 401 alone did not establish that replacement or broader permissions were required. See the [scoped email receipt evidence](../runbooks/PAID_LAUNCH_EXECUTION_2026-10-23.md#october-25-email-sending-and-alias-receipt-evidence). Actual application sign-in, transactional reliability, alerts and consistent inbox placement remain unverified. This correction does not approve the rejected quote, add resources or change any credential.
