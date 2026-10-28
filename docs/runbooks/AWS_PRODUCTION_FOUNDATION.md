# Production AWS foundation

This is the production companion to `AWS_STAGING_FOUNDATION.md`. It does not modify the staging template, key, network, credentials, or evidence. Source preparation and AWS template validation are not deployment or payment readiness. Keep all production checkout, intake acceptance, canary checkout and live-payment switches locked through infrastructure preparation.

The approved target is AWS account `838445019912`, region `us-east-1`, environment `production`, stack `applypack-production-foundation`. The source template is `infra/aws/production-foundation/template.json`. The control entry point is `scripts/production-aws-foundation.mjs`; its pure validation module and independent negative tests are committed alongside it.

## Resources and dependency order

The foundation permits exactly nine new CloudFormation resources:

| Resource | Count | Purpose |
| --- | ---: | --- |
| Customer-managed symmetric KMS key | 1 | Production sensitive-payload encryption |
| KMS alias | 1 | `alias/applypack-production-sensitive-payloads` |
| VPC | 1 | `10.85.0.0/16` |
| Private subnet | 2 | `10.85.0.0/24` and `10.85.1.0/24`, no public IPv4 assignment |
| Route table | 2 | VPC-local routing only |
| Subnet/route-table association | 2 | Explicit private subnet associations |

There are no IAM resources, external routes, internet gateways, NAT gateways, Elastic IPs, interface endpoints, private certificate-authority services, or worker resources in this foundation. The production key uses `application=ApplyPack` and `deployment=production`, automatic rotation, and a 30-day pending-deletion window. It is retained on replacement/deletion after successful creation. Failed initial creation may remove an unused new key through `RetainExceptOnCreate`; it must never be treated as permission to remove a key containing paid customer data.

The key policy delegates administration and condition-bound cryptographic use to the existing account principal, so creation does not reference future worker or Roles Anywhere roles. It does not grant every IAM user cryptographic access: the later production identity policy must also authorize the exact key and production encryption context. Create the key/network first, then the existing production worker and Roles Anywhere resources with their least-privilege policies and permissions boundaries.

Before each plan creation and execution, the control reads all regional VPC IPv4 allocations and route tables. It checks every non-default IPv4 route against `10.85.0.0/16`, resolves every referenced managed prefix list to its actual CIDRs, and validates IPv6 route metadata. Missing permissions, malformed responses, unresolved prefix lists or an overlapping network stop the operation. A prefix-filtered inventory alone does not establish that this network is available.

## Approval and private inputs

The owner first approves the **one consolidated incremental-cost quote**, including both environments, worker resources, recovery arrangements and provider costs. This runbook does not create an extra human approval checkpoint. A document digest binds the exact reviewed bytes; it does not prove that a human approved them. Codex must retain the actual owner approval reference and must not fabricate an approval manifest or timestamp.

Create a private JSON manifest with exactly these fields:

| Field | Required value or source |
| --- | --- |
| `schemaVersion` | `applypack-production-foundation-approval-v1` |
| `environment` | `production` |
| `accountId` | `838445019912` |
| `region` | `us-east-1` |
| `profile` | Explicit locally configured temporary browser-login profile |
| `operatorArn` | Exact non-root IAM user ARN selected for this production operation and verified by STS |
| `stackName` | `applypack-production-foundation` |
| `releaseSha` | Full 40-character final committed source SHA, obtained from Git |
| `templateSha256` | Canonical object digest in `FOUNDATION.templateSha256` |
| `quoteSha256` | SHA-256 of the exact approved consolidated quote bytes |
| `quoteApproval.approvedBy` | Actual owner identity from the approval record |
| `quoteApproval.approvedAt` | Actual recorded approval time |
| `quoteApproval.approvalReference` | Durable reference to that approval |

Compute the manifest digest with the `canonicalSha256` export from `scripts/lib/production-aws-foundation.mjs`; compute the quote digest with its `sha256` export over the original bytes. Preserve both digests outside the source tree with the source and approval evidence. Do not substitute a raw JSON-file hash for the canonical manifest digest.

The current mechanical guard accepts an approval timestamp within the prior 24 hours and rejects a future timestamp. This is a limitation of this release control, not an expiration of the user's authorization. If an unchanged approved quote later exceeds that interval, preserve the existing approval and report the exact guard failure for resolution with its authorization evidence. Do not invent a new approval date, silently bypass the guard, or ask the owner to approve the same unchanged quote again merely because time passed.

The chosen profile must use temporary AWS browser-login credentials for the exact manifest user. Inherited static credentials, credential-process/source-role/profile alternatives, web identity, custom credential/config files, container credentials, endpoint overrides and custom CA configuration are rejected. The staging operator's successful login establishes identity only; it does not by itself approve production spending or prove production provisioning permissions. `iam:ListPolicies` being denied establishes an inventory limitation, not denial of `CreateChangeSet` or `ExecuteChangeSet`.

Use absolute ordinary local paths for the private manifest, original quote and evidence outputs. Evidence output must be in an existing private directory outside the canonical checkout, with new filenames; the tool never overwrites a receipt. No secrets, private signing keys, tokens, customer documents or customer identifiers belong in these files. Account and infrastructure identifiers remain in private operator evidence, not public launch evidence.

## Prepare and create the unexecuted plan

The checkout must be clean, have the canonical remote and match the exact manifest release SHA. Every control, test and runbook file must already be committed in that SHA. A source change creates a new candidate and a new request binding.

Populate these PowerShell variables from the actual private approval record: `$apManifestPath`, `$apManifestDigest`, `$apQuotePath`, `$apQuoteDigest`, and `$apEvidenceDirectory`. They are required inputs, not defaults. From the canonical checkout:

```powershell
$apFoundationArguments = @('--manifest', $apManifestPath, '--manifest-sha256', $apManifestDigest,
  '--quote', $apQuotePath, '--quote-sha256', $apQuoteDigest)
node scripts/production-aws-foundation.mjs --mode prepare @apFoundationArguments --output (Join-Path $apEvidenceDirectory 'foundation-prepared.json')
if ($LASTEXITCODE -ne 0) { throw 'Production foundation preparation failed.' }
```

`prepare` performs provider reads only and writes the exact bounded request. Review that request against the consolidated quote. The entire template object is pinned; parameter injection, extra resources, IAM permissions, a staging context, a public subnet or a new route cannot be introduced through a caller argument.

Only after the existing cost approval covers these additions:

```powershell
node scripts/production-aws-foundation.mjs --mode create-plan @apFoundationArguments --output (Join-Path $apEvidenceDirectory 'foundation-created-plan.json')
if ($LASTEXITCODE -ne 0) { throw 'Production foundation plan creation did not return verified success.' }
```

This requests one `CREATE` change set with no capabilities, parameters, imports, nested stacks or service role. It creates an empty `REVIEW_IN_PROGRESS` stack, not the nine resources. Its intent receipt is written before the provider call. A failure or lost response is not permission to retry, delete or recreate anything: inspect the exact deterministic request name and client token from that receipt and reconcile the outcome first.

## Protect, inspect and execute that exact plan

Preserve the returned full stack and change-set ARNs in private evidence. Before enabling termination protection, Codex must verify the source, approval and current STS identity again, then read the exact returned stack, its resources and its change sets. Require:

1. Both ARNs contain account `838445019912`, region `us-east-1`, the exact expected production names and a nonempty provider UUID suffix.
2. Exactly that stack is `REVIEW_IN_PROGRESS`; it has zero stack resources and exactly one change set matching the returned ARN.
3. The change set is `CREATE_COMPLETE` / `AVAILABLE`, contains exactly the nine `Add` resources above, and its original template, tags and description match the prepared request.

Enable termination protection only on that exact empty production stack, using the same explicitly named profile and region. The bounded protection call is `cloudformation update-termination-protection --enable-termination-protection --stack-name <verified full production stack ARN>`. Do not use a stack name copied from staging, disable protection, delete an existing stack, or execute a change set as part of this step. Re-read the stack and require `EnableTerminationProtection=true`. If any required read or protection call is denied, record that exact operation as unverified/denied and stop; do not expand IAM permissions implicitly.

Set `$apChangeSetArn` to the verified full returned change-set ARN, then run:

```powershell
node scripts/production-aws-foundation.mjs --mode inspect-plan @apFoundationArguments --change-set $apChangeSetArn --output (Join-Path $apEvidenceDirectory 'foundation-reviewed-plan.json')
if ($LASTEXITCODE -ne 0) { throw 'Production foundation plan inspection failed.' }
$apPlanReceipt = Get-Content -Raw -LiteralPath (Join-Path $apEvidenceDirectory 'foundation-reviewed-plan.json') | ConvertFrom-Json
$apPlanBinding = $apPlanReceipt.bindingSha256
```

The inspection repeats identity, inventory, original-template and provider-state reads. It requires termination protection, the empty stack, the single exact change set, and only nine additive resources. It rejects replacements, imports, nested changes and unsafe deployment modes. Review this concrete plan against the already approved quote. The resulting binding covers the release, manifest, quote, template, request, provider ARNs and exact additions.

```powershell
node scripts/production-aws-foundation.mjs --mode execute-plan @apFoundationArguments --change-set $apChangeSetArn --plan-binding-sha256 $apPlanBinding --output (Join-Path $apEvidenceDirectory 'foundation-execution.json')
if ($LASTEXITCODE -ne 0) { throw 'Production foundation execution did not return verified success.' }
```

Execution re-reads the provider plan and requires the same binding, revalidates the actual approved input bytes and clean source, and verifies STS before requesting execution. The receipt says only `EXECUTION_REQUESTED_NOT_PROVEN_COMPLETE`. A timeout or missing receipt requires read-only reconciliation of that exact stack and change set. There is no automatic retry, rollback, deletion, cleanup or production unlock.

## Prove completion and map existing worker configuration

After AWS reports `CREATE_COMPLETE`, independently read the exact stack, original template, resource inventory and outputs. Require the same template digest, exactly the nine expected resource types, termination protection, exact production tags, enabled symmetric key, automatic key rotation and the production encryption-context policy. Verify both subnet associations, no public IPv4 assignment, and VPC-local-only effective routes. Preserve sanitized evidence; provider creation permission and usable runtime encryption are separate checks.

Map the verified foundation outputs into the existing [document-worker runbook](AWS_DOCUMENT_WORKER.md), selecting its production flow:

| Foundation output | Worker input |
| --- | --- |
| `VpcId` | `$apVpcId` |
| `PrivateSubnetAId`, `PrivateSubnetBId` | `$apPrivateSubnetA`, `$apPrivateSubnetB` |
| `PrivateRouteTableAId`, `PrivateRouteTableBId` | `$apPrivateRouteTableA`, `$apPrivateRouteTableB` |
| `KmsKeyArn` | `$apKmsKeyArn` |
| `DeploymentEnvironment` | Must equal `production` |

The application encryption key-version label is an explicit reviewed application configuration value; it is not an invented AWS key version or an automatic reuse of staging configuration. Follow the existing production worker order: separate production repository/deployment-role bootstrap, exact-source worker image and scan, provider network/image preflight, main worker stack, bucket preflight, synthetic worker/KMS probe, then matching application configuration. Keep the production key, role, repository, bucket, function version and every receipt separate from staging.

Use the existing [Roles Anywhere caller runbook](AWS_ROLES_ANYWHERE_CALLER.md) and `scripts/prepare-aws-roles-anywhere.mjs` with the verified production worker version, key, temporary bucket and a reviewed public CA certificate. Its trust/profile remain disabled until their own verification. Use the existing self-managed certificate design; an AWS Private CA service is not a default dependency. Never substitute a staging runtime policy or copy private certificate material into Git/evidence.

One account-wide budget may be created only if its ownership is verified absent and the consolidated quote covers it. Existing budget notifications are alerts, not a hard spending cap. Provider usage, backup custody, database recovery, email and human acceptance remain separately required. The foundation's retained KMS key supports recovery but does not itself prove the four-hour recovery target or fifteen-minute reconciliation window.

This runbook stops at verified infrastructure preparation. It never authorizes live checkout, signs sandbox evidence, replaces the recovery drill, or claims launch readiness.
