# Protected backup retention: proposed authorization

Status: **NOT AUTHORIZED TO DELETE. Read-only planning is implemented.**

Automatic approval review rejected adding an automated deletion executor because the launch instruction did not explicitly authorize irreversible deletion of protected S3 object versions or its separate retention identity. No archive data was changed. The rejected executor and scheduled command were not written.

## Concrete proposed scope

Authorize implementation and operation of a separate retention job, scheduled every five minutes, limited to:

- AWS account `838445019912`, region `us-east-1`, bucket `applypack-production-protected-recovery-838445019912`.
- A dedicated role `arn:aws:iam::838445019912:role/applypack/production/applypack-production-recovery-retention`, with its own short-lived Roles Anywhere leaf and profile. It cannot reuse the web or backup writer identity.
- Listing exact object versions only under `objects/` and `manifests/`. No private document reads, document writes, database credential, or changes to the primary source storage.
- Removing an exact archived object version only when two fresh, complete, matching source inventories and verified historical manifest references establish its identity and an applicable expiry or explicit deletion basis, with no active paid obligation or legal hold requiring it. Absence from the current inventory alone is insufficient. Any malformed, stale, incomplete, conflicting, or changed inventory stops the run.
- Preserving versions uploaded after the first inventory began, protecting uploads that are still being registered or backed up.
- Removing exact manifest versions more than seven days old only after verifying a usable replacement checkpoint and its required object references remain. Current private-file versions remain subject to their source retention policy, rather than a seven-day file-deletion rule.
- Verifying the selected versions are absent after removal and recording a separate retention heartbeat. A failed or unverified operation must not refresh that heartbeat. Failure and staleness alerts remain required.

Deletion of an archived S3 object version is irreversible through this archive. The current proposal does not authorize deleting primary customer files, modifying payment/history records, or deleting currently retained backup versions.

## What is reviewable now

`scripts/plan-protected-recovery-retention.mjs` performs read-only source inventory and scoped S3 version listing. Its output explicitly says `READ_ONLY_NOT_AUTHORIZED_TO_DELETE` and `providerMutationPerformed: false`; it records retained versions, source release/digest, target bucket, and report digest. Every private object and manifest version is preserved, and `proposedRemovals` is empty. Objects without a current retained match are listed as unresolved and require historical manifest and retention mapping before any object deletion can be proposed. Manifests older than seven days are informational candidates only and require a verified usable replacement checkpoint. Those mappings remain implementation work after authorization. The planner contains no deletion command, write command, or completion-heartbeat submission.

The planner rejects unexpected delete markers, duplicate versions, pagination loops, invalid keys, wrong accounts, stale source inventories, and unbounded reads. It accepts only the dedicated retention capability, which cannot download source documents or submit a backup completion.

Local offline tests cover preserving current, expired, revoked, missing, superseded, and held file versions; seven-day manifests; in-progress uploads; authorization separation; complete pagination; failures; and hard deadlines. These tests use synthetic provider responses. They do not demonstrate hosted deletion, provider access, a paid-resource approval, or recovery readiness.

## Approval wording

“I authorize implementing and running the separate five-minute backup retention job described here, including irreversible removal of only the exact obsolete or expired archive versions it verifies in the specified bucket. Keep primary files, currently retained backup versions, and payment records unchanged.”

This authorization would permit finishing and testing the deletion executor. Provisioning paid resources still requires the consolidated cost approval, and production launch still requires hosted verification, human acceptance, and the final go-live decision.
