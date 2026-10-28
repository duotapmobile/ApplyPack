# Proposed database archive retention extension

Status: reviewable local implementation proposal. It does not authorize implementation of database-version deletion, hosted execution, wider permissions, provisioning or spending. The existing [approved file-archive scope](../runbooks/PROTECTED_RECOVERY_RETENTION_APPROVAL.md) explicitly excludes `database/`. Earlier source and receipts remain unchanged.

## Problem and intended result

The separate database exporter writes an encrypted dump, role metadata and a manifest every completed cycle. Forward098 correctly keeps every retained database manifest's exact companion file manifest and object versions. Since no database-archive pruning mechanism is authorized, those retained histories continue growing and can keep old private-file copies indefinitely. A seven-day storage steady state is therefore not currently implemented or suitable for the launch quote.

The proposed extension applies the existing seven-day superseded-recovery-version policy to database recovery versions, with a verified replacement, exact version accounting and holds. It does not shorten customer access, erase payment records, delete primary data or change the recovery targets. A version that is still required for a retained recovery point or unresolved obligation remains protected.

## Exact proposed local scope

- Keep AWS account `838445019912`, region `us-east-1` and bucket `applypack-production-protected-recovery-838445019912`.
- Extend the existing separate retention process with a distinct, disabled-by-default database-retention capability. Its reviewed IAM proposal would add `s3:ListBucketVersions` on the exact bucket with a condition limiting `s3:prefix` to the three database prefixes, and `s3:DeleteObjectVersion` on only their object ARNs. It would not grant source database credentials, document reads, archive writes or unversioned deletion. Actual IAM modification remains a later hosted approval.
- Accept only canonical `database/manifests/<sha256>.json`, `database/dumps/<sha256>.dump` and `database/roles/<sha256>.json` keys with exact non-null VersionIds, verified identity and complete provenance. Neither key age nor absence from the current source is sufficient deletion authority.
- Use the existing independent read-only verifier and durable098 writer/fence protocol. Every retained database and file manifest must be authenticated, and every referenced object version accounted for. Unknown schema, orphaned/uncertain writes, incomplete pages, unexpected delete markers, missing references, changed source state or a pending provider event prevents planning or dispatch.
- Make only superseded database manifest versions older than seven elapsed days candidates. Age starts at the later of the authenticated manifest creation time and the exact provider version's upload time; it does not restart when a newer checkpoint supersedes it. Preserve the latest independently verified usable database/file checkpoint regardless of age, every in-window recovery point, any explicitly held point and all dependencies. Until hold scope can be proved complete, a relevant unresolved hold or case blocks database pruning. A stale or unusable replacement never permits deletion.
- Delete the approved obsolete manifest version first. Remove a dump or role-metadata version only after all manifests referencing that exact version are confirmed absent and no retained point, writer or hold requires it. Shared keys with different VersionIds are distinct. Then release only the removed database point's file dependencies; the existing file-retention rules decide whether those versions are separately eligible.
- Record the immutable plan and a durable intent before each single exact-version dispatch. Limit a run to at most100 planned versions and the existing five-minute deadline; keep the remaining work for a later run without claiming a complete sweep. The limit is an execution bound, not permission to ignore unknown history.
- A lost response remains uncertain. Reconciliation only observes the exact version; it cannot redispatch or clear a fence from a timeout. Record verified absence and completion without deleting audit receipts or refreshing an old source watermark. Incomplete required sweeping must remain visible and cannot claim that seven-day physical expiry has been achieved.

## Required acceptance before hosted enablement

Local tests must cover full seven-day boundary behavior, a fresh verified replacement, a stale replacement, a held point, a changed hold during dispatch, a retained database-to-file pin, shared dump/role versions, unknown/orphaned versions, a partially completed manifest-first run, lost responses, replay, new concurrent writers, changed schema/ownership helpers and interrupted verification. Original payments, accepted legal receipts and current source data must remain unchanged. Successful recovery from the retained replacement must be demonstrated separately from proof of deletion.

Independent review must examine the irreversible operation, IAM scope, exact dependency graph, source/hold races, retained recovery coverage and inaccurate completion claims. The current backup failure boundary also needs proof that non-replayable paid-work changes cannot exceed the agreed recovery window during an extended outage; a stopped new checkout alone does not prove that requirement.

Hosted enablement still requires the single consolidated resource quote, approved exact IAM/configuration changes, measured off-machine recovery, delivered alerts, real exact-version deletion/absence tests using synthetic archives and explicit hosted deletion authorization. Retained holds and incomplete reconciliation can increase storage beyond a seven-day forecast. The existing application recovery and final go-live checkpoints remain in force.

## Owner decision to collect after review

Independent review found no remaining high-priority issue in this proposal after clarifying the bucket-level listing permission and exact seven-day age basis. This is a design review, not executable or hosted acceptance.

Authorize local implementation, fictional-data tests and GitHub publication of this exact extension, keeping hosted execution disabled; or retain the current database archives while revisiting the cost and backup-retention promise. The latter is not a claim that the planned seven-day lifecycle or launch acceptance is complete. No action is inferred from silence.
