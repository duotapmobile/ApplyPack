# Phased launch costs and recovery review

Reviewed October 25, 2026. Status: preparation only; **not a replacement spending quote or launch approval**. Stay on Railway, retain existing credentials and resources, and preserve the recovery requirements in [amendment 17](../applypack/17_OCTOBER_23_SANDBOX_VALIDATION_LAUNCH_AMENDMENT.md). The [October 23 quote](PAID_LAUNCH_INFRASTRUCTURE_QUOTE_2026-10-23.md) was rejected. Its assumptions and evidence remain historical.

## What is needed when

| Stage | Required scope | Cost treatment |
| --- | --- | --- |
| Prepare the locked launch | Finish authorized source work, exact-source checks, provider inventory, resource sizing and the replacement quote | Reuse existing accounts and tools; no new paid resources have been approved. Hosted tests and temporary recovery resources must be itemized before provisioning. |
| Before the first paying customer | Working database/authentication, private intake and delivery, encryption, isolated document processing, sign-in and transactional email, maintenance and alerts, payment verification, protected recovery and retention implementation | These are paid-launch prerequisites, even for one customer. Include production services, acceptance staging, temporary drill resources and variable transaction/usage costs in one consolidated quote. |
| After paying customers arrive | Operate the established one-search/two-pack rolling daily capacity, monitor actual processing/storage/transfer and complete the genuine first-customer pilot | Adjust the forecast using measured usage. The first payment does not permit deferring required recovery or customer-data protection. |
| Scale when justified | More compute, always-running staging, higher email allowances or additional operators; reconsider managed PITR if exports become impractical | Add only for measured demand and a separately approved change. Capacity increases require a product decision. |

Existing production hosting, domain and unchanged email bills belong to the baseline. Do not charge a second Railway subscription per service: Railway bills plan and resource usage at workspace level. Shared credits and allowances must be verified before subtracting them from an incremental invoice forecast. [Railway pricing](https://docs.railway.com/pricing/plans).

The 30-day prospective retention policy reduces unnecessary long-term private-content growth. It does not eliminate the need for secure storage while delivering the service, or automatically reduce fixed provider fees. Preserve historical entitlements and all paid-work, dispute, reconciliation and hold protections in [amendment 18](../applypack/18_OCTOBER_24_ONE_OFF_RETENTION_AMENDMENT.md).

## Current reuse evidence

The [October 25 provider refresh](../runbooks/PAID_LAUNCH_EXECUTION_2026-10-23.md#october-25-read-only-refresh) confirms the existing Railway Hobby project, held deployment triggers and idle staging services. Production Supabase is inactive; staging is healthy. Current Supabase plan, compute and recovery allowances remain unverified. The production database credential entry is present, but no value, connection or target binding was tested.

The historical staging AWS key/network remain reuse candidates. Current AWS authentication was unavailable, so do not treat the October 23 inventory as fresh proof of resource presence or absence. Configured templates and service definitions do not establish deployed resources. The existing five-minute recovery-copy design covers private files and references, not database exports.

## Lower-cost recovery candidate

The rejected quote allocated $100.01/month to seven-day Supabase point-in-time recovery, using 730 hours at $0.137/hour. The official add-on rate remains $0.137/hour. Removing that line alone leaves $60.77 of the rejected scenario **before adding replacement backup costs or revising other assumptions**. Neither figure is a new quote. [Supabase PITR pricing](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).

The governing requirement is recovery within 240 minutes and at most 15 minutes of recent application data needing recovery or reconciliation, with every paid transaction reconciled. It does not mandate a particular vendor add-on. A candidate alternative is a separate five-minute consistent database export, protected independently of the original machine and credentials, bound to an immutable private-file checkpoint. This alternative is unimplemented and unproved.

Specify the following design requirements and bounded usage assumptions in the quote, then verify the required measurements and hosted behavior after approval and before paid launch. The quote must include the resources needed to obtain that evidence:

- A separately scoped database exporter and recovery manifest. Do not give database credentials to the existing file-copy service or describe its file manifest as a database backup.
- Complete application, authentication, schema, roles and migration-history coverage; compatible private-file versions; encryption-key and configuration custody independent of the original operator machine. The existing operator-run Windows-bound backup envelope alone does not prove independent recovery.
- Bounded export duration and publication age, with evidence of the source snapshot time. A five-minute timer alone does not prove a fifteen-minute recovery point.
- Safe handling of paid/support writes during a backup failure. Closing new checkout/intake alone does not protect subsequent fulfillment, refund or support changes; those writes need a proven recovery/replay arrangement or a controlled safe boundary.
- Actual source-network export volume, compressed archive size, retention, restore transfer and runtime, alerts, export permissions and tested restore duration. At five-minute intervals there are 8,640 scheduled exports in a 30-day month; repeated full exports can dominate transfer costs. Compressed archive size is not a measurement of source-network egress.
- Current deletion/hold records and restore sanitization, preserving historical entitlements. The pending cleanup/redaction and separate protected-archive pruning permissions remain independent of this design review.

Daily database backups alone do not meet the agreed fifteen-minute requirement. Database backups also do not include private Storage object bytes. A complete recovery design must cover both and demonstrate off-machine recovery before accepting the first payment. [Supabase backups](https://supabase.com/docs/guides/platform/backups).

## Replacement quote gate

Present one consolidated quote naming reused resources, exact additions, recurring assumptions, variable payment/processing/transfer charges and a bounded one-time acceptance/recovery allowance. Verify any claimed credits, plan changes and resource reuse; otherwise state conservative gross rates and exclusions. No paid CA or NAT gateway is part of the default design.

Approve the concrete resources needed to test the selected design before provisioning them; complete the measured recovery proof before paid launch. Do not require successful hosted proof before authorizing its explicitly quoted temporary test resources. If the cheaper design cannot meet the unchanged recovery targets, revise the design and quote rather than silently lowering those targets.

No resource was provisioned, resumed, deleted or replaced for this review. Cleanup implementation, hosted recovery, live-account and email verification, the complete sandbox journey, human acceptance and final owner go-live approval remain outstanding. Status: **NOT READY**.

## Later October 25 implementation update

The earlier implementation and permission statements above describe this review's initial state. The subsequent consolidated preflight approved local implementation, fictional tests and Git publication for active private-data cleanup, database recovery, and scoped file-archive pruning. Cleanup/redaction/restore filtering and the database checkpoint worker now have local implementations and recorded validation in the [implementation ledger](IMPLEMENTATION_PROGRESS_2026-10-25.md). Their hosted execution and complete independent recovery proof remain outstanding; file-archive pruning and the database archive lifecycle are still incomplete. Successful mailbox tests establish delivery for the three authorized messages, not the application's complete sign-in and transactional path. These updates do not approve the rejected quote, create a replacement quote, or authorize new spending. Drafting-provider privacy and bounded usage costs must also be included in the consolidated replacement quote before real customer data or paid calls are enabled.

## Later October 25 provider inventory

At 20:11–20:15 UTC the existing AWS profile again authenticated to the intended ApplyPack account. Read-only checks verified that the staging foundation, enabled staging encryption key and two private subnets can be reused. There is no NAT gateway or endpoint in that VPC. Both named document-worker stacks/functions/repositories/temporary buckets and the named production foundation/recovery resources are absent. Successful ApplyPack-scoped workload identity listings were empty; several exact IAM policy/role reads were denied and remain unverified, not absent. The ignored `evidence/provider-inventory-2026-10-25/REPORT.md` and hashed provider responses preserve the scope and results. This refresh supersedes the earlier unavailable-AWS-authentication finding, without proving encryption, rendering or restoration.

Railway's authenticated usage response for October 23–November 23 showed $0.624887 in current workspace resource usage and a $4.271009 resource-usage forecast. ApplyPack accounted for $0.282269 of current usage, all on its existing production service; staging web and maintenance remain stopped. These are observed usage figures, not a verified total invoice or incremental launch quote. Current plan charges, shared credits and allowances were not established by that response and must not be silently subtracted. No new service was provisioned or resumed.

The replacement quote must use these verified reuse findings and separate existing baseline costs from additions. Include production database capacity, both temporary acceptance and normal operation, the separate checkpoint workers and recovery storage/transfer, minimal worker resources, alerts, and bounded synthetic drafting evaluation. Existing API billing balances and actual drafting-account privacy settings remain unverified. No new spending is approved by this update.

## Implemented observer quantities for the replacement quote

The local [independent monitoring implementation](../runbooks/INDEPENDENT_OPERATIONS_MONITOR.md) now specifies two128MiB Arm Lambdas, immutable code versions, one one-minute application schedule and one five-minute bucket-control schedule, six custom metric series, eight standard alarms, two existing-key Standard SecureString parameters, one SNS topic/subscription and two seven-day log groups. Two alarms use existing AWS/Lambda error metrics and add no custom series. No resource is provisioned. Template SHA256 `4147c2a55a1354bfc9a0f7f83ec60e418429a660cf33963d62e717067c3bf860` passed read-only AWS validation; effective permissions and alert delivery remain unproved. These concrete quantities replace the earlier monitoring reserve once.

For thirty days, the schedules create43,200 application and8,640 bucket-observer invocations:51,840 total. Application observations read two parameters; each observer publishes one metric batch. This gives86,400 SSM/KMS reads,51,840 metric API calls and34,560 bucket-control reads before duplicate/manual runs. Zero configured EventBridge/Lambda retries and one-attempt SDK calls bound routine retry behavior; they are not an account spending cap. Gross calculation inputs, without shared free-tier deductions, are:

| Observer component | Quantity/rate assumption | Monthly gross |
| --- | --- | ---: |
| Custom metrics and alarms | Six ×$0.30 and eight ×$0.10 | $2.60 |
| Metric API |51,840 ×$0.01/1,000; regional catalog verified below | $0.5184 |
| Parameter decryption |86,400 ×$0.03/10,000; existing key charge counted elsewhere | $0.2592 |
| Standard parameters/API | Standard throughput only; current account setting unverified | $0.00 conditional |
| Lambda requests |51,840 ×$0.20/million | $0.010368 |
| Lambda duration, both functions |128MiB ×invocations ×billed seconds ×$0.0000133334/GB-second | $0.172801 at2s each; $0.864004 at10s each; $3.672018 at45s/30s |
| Content-free logs | Illustrative0.1GiB aggregate across both functions; uniform seven-day storage | $0.0507 |
| Alert traffic | Illustrative500 publishes and1,000 email deliveries | $0.02025 |

These listed components, including illustrative logs/alerts, total approximately **$3.63/month at two billed seconds per function, $4.32 at ten seconds, or $7.13 at45seconds for the application observer and30seconds for the bucket observer**. The latter uses configured handler timeouts; chargeable initialization and duplicate/manual invocations can add billed duration. These are component sensitivity calculations, not the consolidated launch quote, measured runtime or a spending ceiling. Higher Parameter Store throughput would add$0.432 at this request count.

The independent audit found conflicting CloudWatch page wording. A subsequent credential-free read of the [official US East regional catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudWatch/current/us-east-1/index.json) resolved the request rate: SKU `UTXVGKBT732UDP5N`, usage `CW:Requests`, effective2026-10-01, is$0.000010 per request, or$0.01 per1,000. The table's$0.5184 is retained. The exact catalog and receipt are preserved at `evidence/provider-inventory-2026-10-25/cloudwatch-public-catalog.json` and `cloudwatch-public-catalog-receipt.json`; catalog SHA256 is `56cc88ec0074530e7a14c232c17e3bda0807468f1724c6a746e19f0f0330f5f5`. This confirms the gross rate, not the account's allowance or invoice.

The34,560 `GetBucketPolicy`/`GetBucketVersioning` requests still require their billing classification; ordinary GET rates would imply$0.013824, but that mapping is unverified and excluded. The two schedules are legacy `AWS::Events::Rule` resources; do not substitute EventBridge Scheduler pricing or allowances. These unresolved items are not assumed free.

The final quote must reconcile those charges, transfer, code-version storage, initialization, actual log/alert volume and allowances once. The earlier external model already reserves$2.60 metrics/alarms,$0.5184 metric API and$0.02025 SNS: replace those$3.13865 of matching lines, and allocate its generic KMS/log/transfer reserves before adding monitor usage. Database plan/source-export traffic and recovery storage require separate verified assumptions; database archive deletion has no approval here and a seven-day steady-state storage forecast remains conditional. Exact template/input hashes and decimal arithmetic are preserved outside tracked source in `evidence/provider-inventory-2026-10-25/monitoring-cost-audit.json` and its companion audit Markdown.

Rates were refreshed from [Lambda pricing](https://aws.amazon.com/lambda/pricing/), [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), [Parameter Store pricing](https://aws.amazon.com/systems-manager/pricing/), [KMS pricing](https://aws.amazon.com/kms/pricing/) and the earlier recorded [SNS rates](https://aws.amazon.com/sns/faqs/). Source bytes, runtime and account throughput are not measured by template validation. No resources, payments, subscriptions or provider settings were changed for this calculation.

## October 26 database plan and compute verification

Authenticated read-only management responses at02:27–02:30 UTC verified the DuoTap organization is still on **Free**, contains exactly the two ApplyPack projects and contains no other projects. Staging is `ACTIVE_HEALTHY`; production is `INACTIVE`. Both projects returned an empty selected-addons list and an available Micro compute price of **$0.01344/hour**. Empty selections do not measure their actual instance capacity. The exact account-scoped receipts are outside tracked source in `evidence/provider-inventory-2026-10-25/supabase-plan-20261026T022725Z.json` and `supabase-cost-metadata-20261026T023004Z.json`. No project was resumed, upgraded, transferred or queried for customer data.

The proposed Pro upgrade is therefore a new expense. The published plan is$25/month with$10 of organization-level compute credit. If both existing projects remain in that organization and run for720 hours at the Micro/Nano paid rate, the modeled plan-plus-compute amount is **$34.3536 for30 days**; at730 hours it is **$34.6224**. This applies the one$10 credit once, not once per project. A24-hour isolated Micro recovery project adds$0.32256 compute before any disk/transfer charges and after existing compute has consumed the shared credit. These are explicit quote assumptions, not an approved upgrade or assurance that Micro is sufficient. [Compute rates and credits](https://supabase.com/docs/guides/platform/manage-your-usage/compute), [billing rules](https://supabase.com/docs/guides/platform/billing-faq).

Paid projects cannot simply be paused after the acceptance week. Keeping staging in the upgraded organization therefore requires recurring compute in the quote; temporary Railway staging shutdown does not stop Supabase compute. Moving staging to a separate Free organization is a possible later cost decision, not an implemented or assumed saving. Preserve its existing records and obligations. [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).

Pro includes250GB of uncached egress shared across the organization's services and projects. A future model must allocate that allowance once across export, file, API and acceptance traffic. It must not add the earlier gross$26.10 source-egress illustration without accounting for the allowance, nor assume the cached allowance covers database exports. As a unit-consistent example,290 billableGB of uncached total usage would mean40GB overage, or$3.60; the earlier scenario usesGiB and must be reconciled to provider billing units before comparison. Real source-network bytes and remaining allowance are still unmeasured. [Egress billing](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Archive coordination through098 and external observation now have published local implementations; this supersedes the earlier incomplete-implementation description for those components. Database archive deletion remains outside the approved scope, and retained histories continue growing and pinning file versions. The final quote must show that growth rather than assume a seven-day storage steady state. The consolidated quote, hosted resource approval, source measurements and recovery acceptance remain open.
