# Provisional launch cost model

Prepared October 23, 2026 from public official pricing and the local uncommitted checkout at baseline `a3de4a447d499fb7d416e1a1d167e281372903b2`. No provider/account APIs, billing records, deployments or purchases were used. Status: **PROVISIONAL — TARGET AND WORKLOAD REVIEW REQUIRED**.

The illustrative listed AWS services total about **$4.62–$8.43/month before allowances**, depending on the explicitly assumed five- or thirty-second average billed worker duration. This excludes transfer and the other unmeasured items below. The Railway example produces about **$15.22/month of resource usage**, before applying the actual workspace subscription and existing usage. These are scenario calculations, not observed bills, launch approval or spending limits.

An existing quantitative estimate was not found in the repository documentation. `docs/runbooks/AWS_DOCUMENT_WORKER.md` and the worker template specify a $5 account budget with forecast/actual email notifications. That amount is a review threshold, not evidence that this workload fits it. The thirty-second scenario exceeds $5 before free allowances. No budget, workload or infrastructure setting was changed for this model.

## Inputs and quantities

| Input | Assumption or local evidence |
| --- | --- |
| Region and currency | AWS US East (N. Virginia), `us-east-1`; USD, before taxes, support and negotiated discounts. |
| Environments | Two: staging and production. One web process per environment, stable for a thirty-day model month. Additional replicas/restarts add probe work. |
| Worker resources | The current `infra/aws/document-worker/template.yaml` sets x86_64, 512 MB memory, 30-second timeout, reserved concurrency 2 per function, and **1024 MB ephemeral storage**. The extra 512 MB ephemeral allocation is priced below. No provisioned concurrency is configured. |
| Business worker calls | An assumed 1,000 total calls/month across both environments. This is a call count, not a sales forecast or a claim that one order uses one invocation. Retries, extraction, rendering and operator probes must be measured separately. |
| Readiness calls | Continuous demand can trigger one shared probe per process every five minutes: `2 × 12 × 24 × 30 = 17,280` probes/month. Total modeled invocations `N = 18,280`. Inactive periods can reduce this; process recycling, identity changes and extra replicas can increase it. |
| Billed duration | Compare average billed durations `T = 5` and `T = 30` seconds. These are assumptions. The function timeout does not cap monthly spending; initialization and other billable runtime behavior must be included in measured billed duration. |
| Temporary objects | Allow four PUTs and four GET/HEADs per invocation, or 73,120 of each/month. Actual probe/extract operations can use fewer. Immediate and delayed deletion can issue up to eight DELETEs per invocation before retries. Assume 1 GB-month of aggregate S3 Standard storage as a planning allowance, not a retention guarantee. |
| Durable cleanup | Four ledger rows per invocation: 73,120 rows/month in this scenario. Completed receipts remain. Database storage/index/backup growth belongs in the Supabase capacity review and is not free because S3 objects were deleted. |
| Keys, images and logs | Allocate two symmetric customer-managed KMS keys and 100,000 cryptographic requests/month; six retained ECR images averaging 1 billed GB each; 1 GB log ingestion and 1 GB-month stored logs. All are assumptions pending target measurements. The worker template does not establish a log-retention bound. |
| Notifications | Allow 100 SNS requests and 200 email deliveries/month as an optional operational allowance. Current worker budget notifications are direct email; the template does not itself create an SNS topic. |

Reserved concurrency has no separate configuration fee, but limits concurrent execution rather than cumulative usage. The S3 gateway endpoint has no additional endpoint charge; the modeled worker architecture does not add a NAT gateway or interface endpoint. These statements do not price unrelated resources already present in the target account. [Lambda concurrency](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html), [S3 gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html).

## AWS calculation before free allowances

Rates were checked on the official public pages on the preparation date. Recheck them for the actual region and target before approval.

| Component | Formula and published rate | Thirty-second scenario |
| --- | --- | ---: |
| Lambda compute | `N × 0.5 GB × T × $0.0000166667/GB-second` | $4.5700 |
| Lambda requests | `N × $0.20/1,000,000` | $0.0037 |
| Extra ephemeral storage | `N × 0.5 GB × T × $0.0000000309/GB-second` | $0.0085 |
| KMS | `2 × $1/key-month + 100,000 × $0.03/10,000 requests` | $2.3000 |
| ECR private storage | `6 GB-month × $0.10/GB-month` | $0.6000 |
| S3 PUT/LIST class | `73,120 × $0.005/1,000` | $0.3656 |
| S3 GET/HEAD class | `73,120 × $0.0004/1,000` | $0.0292 |
| S3 Standard storage | `1 GB-month × $0.023/GB-month` | $0.0230 |
| CloudWatch Logs | `1 GB ingested × $0.50 + 1 GB-month stored × $0.03` | $0.5300 |
| Optional SNS allowance | `100 × $0.50/1,000,000 + 200 × $2/100,000 email deliveries` | $0.0041 |
| Listed subtotal | Excludes the unmeasured items below | **$8.4340** |

Lambda compute, request and ephemeral rates: [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/). Key and symmetric request rates: [AWS KMS pricing](https://aws.amazon.com/kms/pricing/). Image storage: [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/). S3 request/DELETE rules and GET rate: [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/); Standard storage and request-rate comparison: [AWS Storage Blog pricing comparison](https://aws.amazon.com/blogs/storage/run-spark-31-faster-and-optimize-compute-costs-with-amazon-s3-express-one-zone-on-amazon-emr/). Log ingestion/archive rates: [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/). Notification rates: [Amazon SNS pricing FAQ](https://aws.amazon.com/sns/faqs/).

At `T = 5`, the same quantities produce about $0.7617 compute and $0.0014 extra ephemeral storage, bringing the listed subtotal to **$4.6186**. A change in probe count or actual business operations must also change the request/object counts; do not vary duration alone when modeling a different workload.

S3 DELETE requests are free at the published request rate, but deletion still consumes application time, database writes and retry capacity. SSE-S3 temporary-object encryption is not modeled as a KMS request for every object. The KMS allowance covers application encryption/decryption separately. The two allocated key-months may already be existing costs; only newly added keys and extra request usage are incremental. Confirm any key-rotation/version, replica or additional-key charges in the target.

## Roles Anywhere and certificate authority

IAM Roles Anywhere itself has no additional service charge. The model assumes an existing reviewed external CA and two environment-specific leaf identities. External CA operation, issuance, rotation, revocation/CRL hosting and labor remain unknown costs. The current templates do not create a Private CA. [AWS Roles Anywhere availability and pricing statement](https://aws.amazon.com/about-aws/whats-new/2022/07/aws-identity-access-management-iam-roles-anywhere-workloads-outside-aws/).

AWS Private CA must not silently enter the zero-dollar identity assumption: published operation charges are $400 per CA-month for general-purpose mode or $50 for short-lived mode, plus issuance and applicable revocation services. Selecting a CA service would require a separate target and cost decision. No CA was created or selected by this estimate. [AWS Private CA pricing](https://aws.amazon.com/private-ca/pricing/).

## Railway scenario and existing subscription

For ordinary container services, public rates are $10/GB-month RAM, $20/vCPU-month CPU, $0.05/GB network egress and $0.15/GB-month volume storage. Hobby is $5/month with $5 included usage; Pro is $20 with $20 included usage. The actual workspace plan, other projects and remaining included usage were not inspected. [Railway plans and resource pricing](https://docs.railway.com/pricing/plans).

Assume two continuously running web containers average 0.5 GB RAM and 0.1 used vCPU each, with 20 GB combined egress and no volume. Resource usage is `1 × $10 + 0.2 × $20 + 20 × $0.05 = $15/month`. The configured maintenance runner starts every fifteen minutes and calls the web maintenance endpoint. At 5,760 total monthly runs across two environments, thirty seconds/run, 0.125 GB RAM and 0.1 used vCPU, the published per-minute rates add about **$0.2165**. This yields **$15.22** of modeled resource usage. Actual runner startup/duration and web memory must be measured; using the 120-second runner deadline for every run would make the same maintenance allowance about $0.87.

For one otherwise unused workspace, this example would be approximately $15.22 on Hobby or $20 on Pro, before other charges. It is not a plan recommendation. Compute the actual invoice as `subscription + max(0, existing usage + new usage − included usage)`, subject to actual plan terms. The incremental cost is the difference from the existing invoice; do not charge a new subscription per environment or subtract shared credits twice. The AWS worker runs remotely, so its Lambda cost is additional to Railway usage.

## Unmeasured items and review gate

- Internet egress from AWS to Railway, Railway uploads to AWS, image pulls outside the AWS region, cross-region traffic, and backup/restore transfers need measured byte counts and the applicable transfer rates. They are **excluded from the AWS subtotal**, not assumed free. S3-to-worker traffic over the same-region gateway differs from external application traffic.
- ECR enhanced scanning/Inspector, CloudWatch alarms/custom metrics/queries, CloudTrail, support, tax, domains/DNS, Supabase compute/storage/PITR/private files, email delivery, Stripe fees/refunds/disputes and human fulfillment are outside this infrastructure subtotal. The whole service cost cannot be inferred from this document.
- Free allowances, promotional credits and existing commitments are not deducted. The published Lambda allowance includes one million requests and 400,000 GB-seconds/month, but availability is shared with eligible account usage and cannot be confirmed here. KMS and log allowances likewise require account-specific reconciliation. [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [KMS pricing](https://aws.amazon.com/kms/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/).
- The current $5 AWS budget sends notifications; it does not stop the modeled services. AWS documents billing/notification delay and possible spending above an alert threshold. No automated shutdown or hard dollar cap is demonstrated by this template. [AWS Budgets behavior](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html).

Before approving a target, record actual existing/incremental resources, key count and CA choice, billed worker duration including initialization, probe/replica/restart counts, document operations, compressed image sizes, log retention, egress, Railway resource usage and plan, available allowances and other account spending. Reconcile the resulting forecast with the approved budget and test alert delivery. Preserve the current purchasing hold and external-action approval boundaries until those independent launch gates are satisfied.

Independent local check: the `operations_tooling` agent checked the worker/maintenance resource assumptions against repository files and recalculated $8.43403592, $4.61863432 and the rounded-rate $0.2165 maintenance allowance. It found no arithmetic or local-resource correction. That check did not independently revalidate every public rate, inspect account billing or approve the target.
