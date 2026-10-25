# Current launch operations

Use this routing with repository `AGENTS.md` and [amendment 19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md), then amendments 18, 17, 16, 14 and 12 for their retained subjects. Amendment 19 requires confirmed low-friction intake, service-generated drafts followed by owner review, and service-error-only repairs for new explicitly bound orders. It is a prospective policy/plan update, not implemented runtime behavior. Amendment 18 adds prospective 30-day private-content access and retention; earlier paid orders keep their recorded terms and correction rights. The owner owns initial review/support and the final go-live decision. Current execution and provider evidence are in [Paid-launch execution](PAID_LAUNCH_EXECUTION_2026-10-23.md); the older October 22 records below are historical evidence. Launch status remains **NOT READY** until required implementation, hosted, recovery and human acceptance gates pass. A separate consolidated cost approval is required before new paid resources.

| Work | Current instructions |
| --- | --- |
| Complete service workflow, dependencies and acceptance sequence | [October 25 completion plan](../launch/END_TO_END_COMPLETION_PLAN_2026-10-25.md) |
| Confirmed intake, system drafts, owner review and qualifying service-error repairs | [Intake and correction operations](INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md) |
| Daily owner workflow and current release checklist | [Operations](OPERATIONS.md) and [Ship checklist](SHIP_CHECKLIST.md) |
| Execution status, owners and approval boundaries | [Execution register](../evidence/launch-execution-2026-10-22/EXECUTION_REGISTER.md) |
| Current paid-launch execution and sandbox proof import | [October 23 execution](PAID_LAUNCH_EXECUTION_2026-10-23.md) |
| Consolidated infrastructure cost review inputs | [Cost review](../launch/PAID_LAUNCH_COST_REVIEW_2026-10-23.md) |
| Completed and pending local proof | [Local validation](../evidence/launch-execution-2026-10-22/LOCAL_VALIDATION.md) |
| Railway image, exact configuration source, web and maintenance | [Railway launch profile](RAILWAY_LAUNCH_PROFILE.md) |
| AWS caller identity, pinned helper and certificate lifecycle | [Roles Anywhere caller](AWS_ROLES_ANYWHERE_CALLER.md) |
| Isolated document worker, policy and network controls | [AWS document worker](AWS_DOCUMENT_WORKER.md) |
| Database target, backup, forward migration and recovery | [Launch database operations](LAUNCH_DATABASE_OPERATIONS.md) |
| Durable temporary-file cleanup and capacity limits | [Launch maintenance cleanup](LAUNCH_MAINTENANCE_CLEANUP.md) |
| New-order private-content expiry, holds, cleanup and restore | [One-off retention](ONE_OFF_RETENTION.md) |
| Restricted test checkout and real staging acceptance | [Staging rehearsal](TEST_MODE_ORCHESTRATION.md) |

`DEPLOYMENT.md`, `LAUNCH_UNBLOCK_CLICKS.md`, and `MAINTENANCE_RUNNER.md` contain pre-existing user work and remain byte-preserved historical records. Their old deployment facts, static AWS credential instructions, Railpack setup, hourly configuration, old prices and release directions are not current execution instructions. A separate unapplied supersession patch is in `docs/evidence/launch-execution-2026-10-22/HISTORICAL_RUNBOOKS.proposed.patch`. The current launch uses the reviewed Docker image, exact selected launch JSON files, a 15-minute maintenance cadence, Roles Anywhere credentials, and fixed 1899/799-cent new sales under the governing amendments. Reverify all hosted identities and operational evidence before use.

The older October 2 release checklist remains useful only where compatible with the amendments and current completion plan. The [ship checklist](SHIP_CHECKLIST.md) now records the prospective amendment 19 requirements; it is a list of required proof, not a completed result. Current receipt, mode-transition and approval requirements control. A historical deployment, green local fixture suite or agent review does not approve a new candidate or establish current provider behavior.
