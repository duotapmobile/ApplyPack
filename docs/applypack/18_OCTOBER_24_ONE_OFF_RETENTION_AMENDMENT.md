# October 24 one-off service retention amendment

Date: 2026-10-24
Status: owner-authorized forward product and privacy amendment; implementation and Git publication authorized, hosted rollout and deletion remain separate

## Controlling decision

ApplyPack is a one-off paid service. Retain private working information only while it is needed to finish the service and provide a 30-day customer access window. This amendment controls retention and prospective access where earlier handoff documents differ. Preserve the product, price, delivery, invitation, capacity, correction, refund, payment-reconciliation, and launch requirements in amendments 17, 16, 14 and 12.

The owner authorized updating the relevant code and policy documents locally and in Git. No new resource spending, credential replacement, production migration, deployment, customer deletion, or irreversible pruning of the existing protected archive is authorized by this implementation step. Purchasing remains locked. Earlier paid orders keep the terms and access recorded with their transactions.

## Prospective contract

Use policy identifier `one_off_30d_v1`, Terms `manual-launch-terms-2026-10-24-v3`, and Privacy Policy `privacy-2026-10-24-v3`. Bind the new policy to the exact accepted legal-content receipt for a new search checkout and its subsequent verified payment. A calendar date, newly deployed application, customer login, or later re-consent alone must not change a prior order. Do not backfill the policy onto historical paid orders. Preserve earlier legal-content receipts and their hashes.

| Information or action | New-order rule |
| --- | --- |
| Search results | Customer access for 30 days after the latest approved search delivery |
| Optional Apply Pack purchases | Start the durable checkout within 30 days of the original search delivery, subject to existing eligibility and capacity; complete a valid checkout before its original stated expiry |
| New covered match-conflict requests | Submit within 30 days of the original search delivery |
| Timely match-conflict resolution | Complete the promised review/replacement after the request deadline if necessary; an approved replacement starts a fresh 30-day results-access window, without restarting optional purchases or new conflict requests |
| Each paid Apply Pack | Customer download access for 30 days after its latest approved delivery, including an approved factual-correction delivery |
| Factual-correction requests | Preserve the existing one-round, three-calendar-day request rule |
| Saved drafts and unpaid sources | Preserve the existing seven-day draft expiry and separate 30-day unpaid-source cleanup rules |
| Related private working content | Eligible for active-system minimization after the latest applicable access window and completion of all paid obligations, subject to the protections below |

Thirty days means 30 elapsed 24-hour periods from the recorded delivery timestamp. Keep timestamps in UTC and display a clear customer deadline in the contractual timezone. Signed links must expire no later than the applicable customer-access deadline. The database and server enforce expiry even if maintenance is delayed. A required hold protects retained information; it does not by itself reopen customer access or a purchase window.

The existing material checkout records a 35-minute deadline, with a 36-minute database ceiling. A checkout durably started before the action cutoff may finish or be recovered through the same idempotent request until that original expiry. Do not extend its deadline, create a fresh entitlement after cutoff, or drop a verified payment merely because its webhook arrives later. This preserves lost-response recovery and keeps pending checkout obligations visible to retention eligibility.

## Protect paid work and shared information

Do not remove information needed by an unfinished paid order, a timely open correction or replacement, a pending payment/refund reconciliation, an active dispute, or a required hold. Evaluate related packs and the entire shared-reference graph before cleanup. Any historical entitlement or another active order using the information vetoes its removal. A historical customer making a new purchase must not lose information still needed by the older order.

Use explicit, reviewable hold reasons and content-free audit records. A hold must have an accountable operator and be released when its purpose ends. Do not preserve full resumes or free-text customer histories merely to make a generic audit log more detailed. Unresolved or unknown retention state must block deletion, produce operational evidence, and remain visible for review.

## Minimize private information, preserve transaction evidence

Cover uploaded documents, extracted text, intake answers, work-history/profile content, customer-specific evaluation and matching details, document models, delivered files and previews, prior revisions, and redundant payload copies. Retain only non-content identifiers, timestamps, state, digests where justified, and the minimum facts needed to preserve financial integrity and the history of completed service. Where immutable relational records must remain, keep a content-free shell and append a narrowly scoped retention receipt. Never disable global immutability, erase a payment, or rewrite an accepted legal receipt to accomplish minimization.

Keep necessary account/contact details, accepted terms, order totals, Stripe/payment/refund references, and minimal delivery/support evidence separately. The 30-day private-content rule is not a statutory financial-record deadline. No fixed legal/accounting retention period has been established by this decision. Document the purpose and applicable requirements before imposing one; review and minimize remaining records instead of promising that all personal information disappears at day 30.

## Recovery and backups

An expired download is not proof that stored bytes have been deleted. Cover active objects, all relevant file versions, database content, and protected recovery copies in the retention inventory. Reapply the latest durable expiry/deletion records and sanitize restored private database content before enabling customer access. A stale backup must not restore a deleted resume or reopen an expired entitlement. A valid current hold may require a historical file for recovery, while ordinary customer access remains subject to its deadline.

Private encrypted recovery copies remain restricted to recovery and necessary investigation. Superseded application recovery versions follow the existing maximum seven-day cycle; record the database provider's actual backup window separately. Holds and provider backup windows may delay physical erasure. Do not describe delayed backup removal as immediate deletion. The prior protected-archive deletion-executor approval boundary remains in force; a read-only plan or restore exclusion does not establish archive erasure.

## Rollout and acceptance

Add forward migration `202610240087_one_off_service_retention.sql` after verifying that the identifier is available. Preserve migrations through 086 byte-for-byte. Align legal-content binding, generated types, checkout authorization, customer access, maintenance, recovery checks, migration tooling, and policy copy. A new candidate requires affected revalidation and new exact-source CI evidence.

Tests must cover prospective binding, historical access, exact expiry boundaries, direct unauthorized reads/downloads, signed-link lifetime, a late paid child, timely corrections and replacements, holds, disputes, shared references, concurrent checkout versus cleanup, storage deletion failure/retry, content minimization, preserved financial/consent records, and no resurrection after restore. Record any unimplemented deletion path or unknown provider window as an explicit launch gate. Local tests and Git publication do not prove deployed cleanup or hosted recovery.

Current operational instructions: [One-off retention](../runbooks/ONE_OFF_RETENTION.md). Launch remains **NOT READY** until the separately governed hosted, recovery, payment, human-acceptance, and final owner go-live gates pass.
