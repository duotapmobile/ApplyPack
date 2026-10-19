# AWS document-worker environment correction evidence

Date: 2026-10-19
Base commit: `ac5342c56f53e547a6d2667dc898c3b5c4124230`
Scope: source-only; no AWS, Railway, Supabase, Stripe, email, DNS, or production application mutation

## Problem and disposition

The prior template defaulted to a production-named Lambda and hard-coded the production KMS encryption-context condition. That made a staging-only readiness configuration unsafe: a staging application could not use the policy with its truthful `APP_DEPLOYMENT_ENV=staging`, while pointing staging at production resources would erase the environment boundary.

The correction introduces an explicit `DeploymentEnvironment` limited to `staging|production`, defaults it to `production`, and uses it consistently for the Lambda name, Lambda runtime attestation, dedicated runtime policy identity/path, and KMS encryption-context condition. The application now requires `APP_DEPLOYMENT_ENV`, `APP_DOCUMENT_WORKER_DEPLOYMENT_ENV`, the immutable Lambda version name, and the worker response attestation to identify the same environment.

## Preserved controls

- `us-east-1` is enforced by a CloudFormation rule and immutable KMS/image ARN patterns.
- The worker has no NAT or internet gateway; its sole egress is TCP 443 to the regional S3 prefix list through a gateway endpoint.
- Private S3 public-access blocks, AES-256 server-side encryption, one-day lifecycle, exact `ephemeral/*` IAM scope, and cleanup behavior remain.
- Lambda remains 512 MB, 30 seconds, reserved concurrency 2, numbered immutable version invocation only.
- KMS remains bound to the exact key ARN, `application=ApplyPack`, chosen environment, and key version.
- The image remains digest-pinned with byte-pinned Liberation Sans 2.1.5 regular, bold, italic, and bold-italic faces. ECR retains at most three images per environment repository.
- The stable account-wide AWS budget remains USD 5 monthly. Exactly one stack creates it.
- Checkout and production activation remain outside this change and locked.

## Validation contract

`npm run validate:aws-document-worker` parses the template offline and fails on loss of environment binding, region restriction, digest pins, font pins, private networking, S3 scoping, KMS context, IAM resource binding, concurrency, lifecycle, or budget controls. Focused unit tests cover valid staging/production bindings and rejection of cross-environment, unnamed, preview, missing, and wrong-region workers.

Provider deployment, image digest, Lambda version, KMS round trip, rendered output, network isolation, budget subscription, and staging readiness remain unproved until the commands in `docs/runbooks/AWS_DOCUMENT_WORKER.md` are executed with scoped MFA-authenticated AWS access. This source correction is not a readiness approval.

## Supervisor-remediation revision

The follow-up source revision closes the two review gaps without making provider changes:

- An exact complete staging worker configuration now selects the remote worker for extraction, synthetic isolation probes, renderer readiness, checkout guards, and admin generation. A partial or cross-environment hosted configuration is unavailable rather than a local fallback. Production remains remote-only.
- Readiness now requires both a provider preflight receipt digest and a synthetic probe receipt digest. Worker responses are bound to the exact environment, numbered function version, image digest, worker identity, and network result.
- The main template accepts only an image digest and constructs the exact current-account `applypack-${DeploymentEnvironment}-document-worker` ECR URI. Environment-specific bucket, execution role, runtime policy, and permissions boundary identities prevent cross-environment policy reuse.
- `scripts/aws-document-worker-preflight.mjs` performs read-only AWS identity, subnet-route, AWS-owned S3 prefix-list, repository-policy, immutable-tag, digest, scan-on-push, and image-scan checks and emits canonical sanitized JSON plus its file SHA-256.
- `scripts/aws-document-worker-synthetic-probe.mjs` uses generated synthetic content only, checks upload/extraction/render/font/network/KMS isolation, deletes every temporary object, and emits a canonical sanitized receipt only after cleanup succeeds.
- `infra/aws/document-worker/deployment-role-template.yaml` defines separate environment CloudFormation service roles and permissions boundaries. PassRole is limited to the exact worker execution role and Lambda service.
- Offline validation now checks the exact endpoint, worker-role, runtime-policy, trust, version-only invoke, public-access-block, deployment-boundary, and PassRole contracts. Negative mutation fixtures cover permissive S3, IAM, trust, route, subnet, ECR, and scan changes.

The canonical receipts have not been produced in this source-only task. AWS CLI identity, CloudFormation provider validation, deployment, scan, render, extraction, network, KMS, and cleanup evidence remain outstanding and cannot be inferred from passing local tests.
