# One-off customer information retention

Governing authority: [October 24 amendment](../applypack/18_OCTOBER_24_ONE_OFF_RETENTION_AMENDMENT.md) for retention and [October 25 amendment 19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md) for new confirmed-intake/service-error contracts. This runbook describes required release behavior. It does not establish that production has been migrated or that customer/archive deletion has run. Amendment 19 is a prospective plan, not an implemented contract or authorization to resume a blocked destructive mechanism.

## Customer promise

Orders explicitly bound to the retention contract use `one_off_30d_v1`. Customers save their search results and documents within 30 days of the relevant latest approved delivery. Starting an optional pack checkout and submitting a new covered match-conflict request close 30 days after the original search delivery. A valid checkout already started may finish or be recovered through the same idempotent request before its original stated expiry; the existing 35-minute deadline is never extended. Timely eligible open requests are completed; an approved replacement or qualifying correction delivery refreshes access to that service, without reopening optional search purchases.

For a new order explicitly bound to `service-error-only-v1`, the existing three-calendar-day report window covers one grouped request to repair an attributable ApplyPack error against the confirmed intake and delivered work. Customer-confirmed mistakes/omissions, later facts, changed preferences or a new target do not qualify and must not trigger regeneration. A failed repair remains the same open case. Earlier accepted contracts retain their recorded factual-correction rights; do not infer the new restriction from a deployment, login, date or later re-consent. Follow [intake/correction operations](INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md).

## Maintenance and operator review

Run the existing authenticated maintenance service every 15 minutes. Before removing a new-policy family's private content, the database must establish that all access windows have ended and all paid work, timely corrections/replacements, reconciliation, disputes, required holds, and shared historical/active references are resolved. Do not determine eligibility merely by an old upload timestamp. Old source-only cleanup must not bypass these protections.

Track due, held, claimed, failed, and completed cleanup separately. A failed object removal must not be reported as completed or clear its retry record. Retention errors need the same delivered failure/staleness alerts and operator ownership as other maintenance failures. Repeat a partial cleanup safely; do not erase the identifiers needed to retry an exact private object. Never use blanket bucket deletion or delete payment/order/authentication rows to clear a queue.

Proposed execution boundary: the authenticated maintenance job requests at most five eligible claims from the database, validates the complete returned object list against the four known private buckets and safe relative paths, and processes at most 20 objects per run. A separate database authorization is required immediately before each exact object removal. Only a verified successful or idempotent removal is finalized; ambiguous failures remain pending for retry. The durable intent blocks newly attached references from racing removal. Customer paths, browser-supplied eligibility, arbitrary bucket names, and an operator UI purge button are excluded.

Implementation approval status: automatic approval review rejected writing this local automated removal worker because exact authorization for the irreversible mechanism was not explicit enough. No rejected patch or provider removal ran. The owner has been asked for local implementation and tests only, covering eligible new-order object removal and private database-content redaction, with deployment and actual deletion separately excluded. Until answered, keep the executable removal/redaction path deferred and readiness closed. This question does not include the separate protected-archive pruning executor.

Only access deadlines control ordinary customer reads. A hold preserves necessary information for operations or recovery but does not grant open-ended customer browsing. Verify a signed link expires at or before the displayed deadline, including a request made seconds before expiry. The application must return an understandable expired state while preserving billing/support access.

Required holds use restricted operator access and a recorded reason. Review open holds during daily order review; remove them after the paid service, correction, dispute, or recordkeeping need ends. Keep reasons and routine logs free of resume text or personal histories. A customer deletion request goes through the same obligation and shared-reference checks; do not promise immediate deletion of required records.

The new correction workflow must retain the confirmed baseline, report, affected versions and evidence needed to decide and complete a timely eligible case while its obligation is unresolved. A denied customer-change request must not automatically extend access or retain the entire private family indefinitely; required disputes, holds and historical/shared obligations still take precedence. Preserve content-free decisions and necessary transaction evidence separately from private report text. This classification and its retention/restore integration remain to implement and test.

## Data remaining after minimization

Preserve minimal payment/refund identifiers, monetary totals, transaction states, accepted legal receipts, delivery timestamps, and content-free retention evidence. Necessary account/contact details remain for access, support, and bookkeeping. Do not retain a full resume or intake snapshot as ordinary proof of payment or delivery. No new fixed financial-record retention period is implied by the 30-day rule; establish applicable requirements and review purposes separately.

Inventory support mail, provider logs, temporary workers, and exports as well as the application's database and private buckets. Do not copy customer content into tickets, analytics, logs, or release evidence. Any external copy with a separate retention lifecycle must be documented before the privacy promise is activated.

## Backup and restore acceptance

Keep restore targets locked with outgoing mail, payment initiation, callbacks, and scheduled writers disabled. Apply the latest durable expiry/deletion ledger and the required database sanitization check before enabling access. Verify both a valid unexpired customer download and denial of an expired/wrong-owner download. An old snapshot or a missing deletion ledger is not permission to resurrect private content. Fail closed if current deletion/hold evidence is unavailable.

Record the actual database-provider backup window, private-file archive cycle, independent key/configuration custody, and every applicable hold. Superseded application recovery versions have the existing maximum seven-day cycle; provider database windows remain a separately verified deployment fact. The current read-only archive planner and restore exclusions do not erase old archive versions. The existing [protected-retention authorization boundary](PROTECTED_RECOVERY_RETENTION_APPROVAL.md) and real execution/verification remain launch gates. Do not publish the prospective privacy behavior as operational until those gates pass.

## Release checklist

1. Validate migration 087 on fresh and preserved historical fixtures, including accepted-receipt hashes and no retrospective policy assignment.
2. Verify runtime access, purchase, correction, replacement, hold, shared-reference, retry, and concurrent-cleanup tests.
3. Confirm all private-content copies in the finite graph are minimized while payment and immutable consent evidence remain valid.
4. Verify restore sanitization and expired-file exclusion, with current holds and a stale backup; keep access locked on incomplete evidence.
5. Collect independent review and exact committed-source CI/image checks. Preserve the frozen-candidate rule.
6. After separate deployment/resource approvals, migrate only the verified target with protected backup and writers controlled. Run one manual maintenance cycle and two actual 15-minute cycles, including a failed-delete alert and retry.
7. Record provider backup windows and tested archive erasure. Obtain human acceptance of the customer deadline/download behavior and the final go-live decision.

Before activating amendment 19, add forward contract/receipt and correction-state changes without rewriting published migration 087 or earlier receipts. Extend the authoritative retention overlay and restore protocol, where needed, to preserve unresolved qualifying service repairs and historical rights; reject missing or incompatible policy evidence. Cover failed repair/redelivery, denied new-fact requests, expired access, current holds, shared references and stale restores in route/database/protocol tests. No test may substitute a dummy cleanup/sanitizer or claim archive erasure from a restore exclusion.

Publication of this code and runbook is not step 6 or 7. Purchasing remains locked and launch status remains **NOT READY**.
