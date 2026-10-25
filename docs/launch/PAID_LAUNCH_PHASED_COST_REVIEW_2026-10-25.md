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
