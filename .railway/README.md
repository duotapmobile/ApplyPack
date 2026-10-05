# ApplyPack staging Railway Infrastructure as Code

This directory is the reviewed source half of the Railway Infrastructure as Code migration. It is intentionally limited to the existing `staging` environment in Railway project `Apply Pack`.

The authoring file fails closed unless Railway supplies all of these exact identities:

- Project: `Apply Pack` (`fb5a58c4-8ccb-4205-82f9-8b8738c84e56`)
- Environment: `staging` (`6633e585-5bcd-4729-b167-2a99628daf86`)

It declares only the existing staging services:

- `ApplyPack-staging`
- `ApplyPack-maintenance`

Production is a separate Railway environment and is not represented by this file. Planning or applying this file against production, a preview environment, another project, or an incomplete CLI context stops with `APPLYPACK_RAILWAY_IAC_STAGING_IDENTITY_MISMATCH` before a desired graph is returned.

## Secret safety

Every existing service variable is named in `railway.ts` and uses `preserve()`. The file contains no provider values. Do not run `railway config pull --include-variables` or `railway config plan --show-values`, and do not replace `preserve()` with literals.

Do not print, copy, or archive process environments, request headers, shell history, provider variable output, or authentication diagnostics. Evidence may contain variable names and booleans describing presence, but never values.

The web service keeps `/api/live` as Railway's dependency-independent healthcheck. `/api/health` remains the application readiness truth and must stay HTTP 503 until all launch dependencies pass. Checkout remains locked independently of either process health or this migration.

## Current ownership boundary

No provider ownership migration has been performed. The tracked `railway.json`, `railway-maintenance.json`, and `railway.maintenance.json` files remain in place as reviewed legacy source and rollback evidence until the controlled ownership cutover. Do not infer that a retained file currently owns a service setting: the 2026-10-05 read-only provider query reported both `railwayConfigFile` and resolved `configFile` as explicitly `null`, with empty resolved file manifests, for both staging services. The service-instance fields captured below are therefore the authoritative pre-migration rollback input unless a just-in-time query proves a different state.

Do not run any of these commands as part of an ordinary source change or plan review:

```text
railway config apply
railway config migrate --apply
railway config migrate --apply --delete-files
```

## Guarded cutover boundary

The only approved mutation entrypoint is:

```text
node scripts/railway-staging-iac-cutover.mjs --execute --receipt-dir C:\absolute\private\applypack-railway-cutover
```

Direct Railway CLI access cannot be blocked by an authoring callback. A credential holder can invoke the CLI outside this repository, and a pinned `config apply --plan` does not re-evaluate the authoring callback. The actual security boundary is no standing token, a temporary environment-scoped staging project token supplied only to the reviewed wrapper, and immediate revocation after verification or rollback.

The authoring callback and wrapper also require this exact nonsecret operator-intent marker:

```text
APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION=apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86
```

This marker is defense in depth, not a credential or a universal CLI control. Never add it to Railway variables, repository secrets, account settings, a permanent shell profile, logs, or evidence. Near matches, alternate casing, extra text, and generic values such as `true` fail closed.

## Cutover credential boundary

Complete source review, CI, and dependency audits before creating or loading any cutover credential. The cutover process must use a temporary Railway **project token scoped only to the `staging` environment** in project `Apply Pack`. Account-wide and workspace-wide tokens are prohibited. The wrapper reruns its isolated audit, typecheck, and tests with Railway credentials scrubbed from those child processes before the first provider call.

Before any mutation, use the token only to run the metadata-only scope query from Railway's public API:

```text
railway api 'query { projectToken { project { id name } environment { id name } } }' --compact
```

Require nested project `Apply Pack` / `fb5a58c4-8ccb-4205-82f9-8b8738c84e56` and nested environment `staging` / `6633e585-5bcd-4729-b167-2a99628daf86`. Direct `projectId`/`environmentId` fields alone are insufficient. The receipt records only those names, IDs, `tokenScopeMatches: true`, and the query time; never the token or token prefix.

Load the token through the approved local secret-injection mechanism as `RAILWAY_TOKEN` only for the wrapper process. Do not paste it into a command, store it in the repository, or use `RAILWAY_API_TOKEN`. Revoke the project token immediately after successful verification or rollback and record the revocation in the sanitized change-window receipt.

## Read-only plan gate

Use exactly Railway CLI `5.49.6`. The wrapper checks `railway --version` before any provider query and rejects any other version. It also requires the generated plan's `cliVersion` to be exactly `5.49.6`; changing the CLI version requires a new reviewed source change. Install the isolated, exact `railway@3.12.0` authoring dependency without adding it to the web application graph:

```text
npm ci --prefix .railway
```

The approved read-only entrypoint is:

```text
node scripts/railway-staging-iac-cutover.mjs --dry-run --receipt-dir C:\absolute\private\applypack-railway-cutover
```

The acceptable baseline result is all of the following:

- exit code `0`;
- exact project and environment identities shown above;
- an empty `changeSet.changes` array;
- `0 to add, 0 to change, 0 to destroy`;
- no diagnostics and no secret values in output.

Abort if the plan proposes any add, change, or destroy action. A zero-destroy plan is necessary but not sufficient: the baseline requires zero adds and zero changes too. The wrapper creates a pinned plan with an exact Git source tree, validates the configuration etag and change-set hash against a second plan, and applies only that reviewed artifact with `railway config apply --json --yes --plan PATH`. It never supplies `--confirm-destructive`.

The wrapper never invokes `railway config migrate`. Railway migration can infer or overwrite one service, while this cutover must claim the reviewed whole graph containing both services. `config migrate --apply`, `--service`, `--force`, and `--delete-files` are prohibited for this topology.

## Committed-input gate

Before loading or validating a provider credential, the wrapper requires every cutover input to exist at `HEAD`, be clean, and byte-equivalent to its committed Git blob after the single permitted cross-platform transformation: CRLF and lone CR line endings are normalized to LF. Invalid UTF-8 replacement characters and NUL bytes fail closed. The binding covers the wrapper, its direct test, the CI workflow, this runbook, the isolated Railway package and tests, all three legacy Railway JSON files, and the application source that defines readiness, checkout mode, and operations truth.

The pre-cutover receipt records the exact Git blob object ID and canonical SHA-256 for every bound input, including the sanitized Railway 5.49.6 provider-contract fixture, plus one fingerprint over the complete path/OID/content-hash map. The plan receipt repeats those hashes and the aggregate fingerprint. This allows a Windows CRLF checkout to match the reviewed LF Git object without weakening the content check. A dirty bound path, missing committed object, content mismatch, or legacy-hash mismatch stops before provider identity validation, planning, or apply. After the two pinned zero-change plans and the final provider/hosted preflight, the wrapper reruns this complete committed-input verification and requires the same OIDs, hashes, and fingerprint immediately before its sole apply call. Local HEAD or working-copy drift during the cutover therefore stops without a provider write.

## Dependency-audit boundary

The isolated `.railway` package currently audits with zero vulnerabilities, and the root production graph audits with zero vulnerabilities. The root full development audit separately reports seven pre-existing high-severity package entries in lint/test tooling, not the application runtime or Railway SDK graph:

- `eslint-config-next` -> `@next/eslint-plugin-next` -> `fast-glob` -> `micromatch` -> `braces`: `GHSA-vfj7-8cjw-p6xm`.
- ESLint/TypeScript tooling -> `brace-expansion`: `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, and `GHSA-6j4f-fj2g-mc7p`.
- `jsdom` -> `undici`: `GHSA-3wwx-pv8p-q78v`, `GHSA-pmjh-fq2x-6v4x`, `GHSA-r53p-7pc4-xj5r`, `GHSA-rfgv-xxqx-mfg5`, `GHSA-3xpg-4rpp-hhhm`, `GHSA-2jfj-6hjv-fm6j`, `GHSA-2gqq-gqf2-x968`, `GHSA-w293-vg96-wgc3`, `GHSA-8436-99hf-9mmv`, and `GHSA-rx4f-c7p8-82vq`.

Do not suppress or relabel these advisories. Keep the SDK isolated, require zero production and isolated-SDK critical/high findings for cutover, and retain the development-tool advisories as an explicit dependency-maintenance item until compatible upstream upgrades are available and verified.

## Mandatory pre-cutover rollback receipt

Create and independently review the wrapper's sanitized rollback receipt **immediately before** the pinned `railway config apply --plan` operation. The receipt must be outside the repository and must contain no variable values. A reference query on 2026-10-05 UTC found the following staging state; because deployments can advance on every branch push, these deployment IDs and SHAs are reference evidence only and must be queried again in the change window.

Identity and service instances:

- Project: `Apply Pack` / `fb5a58c4-8ccb-4205-82f9-8b8738c84e56`.
- Environment: `staging` / `6633e585-5bcd-4729-b167-2a99628daf86`.
- Web service: `ApplyPack-staging` / `3d379eca-87ac-48ba-9f95-9d69c806a5db`; current instance `29cd1c79-a42b-4499-aaa9-d036ddacc4d1`.
- Maintenance service: `ApplyPack-maintenance` / `866e36fd-2fec-45fd-ba01-7150a789e419`; current instance `2207d73b-ff81-4538-812d-22d368e573de`.

Current provider fields returned by the read-only `serviceInstance` query:

| Field | `ApplyPack-staging` | `ApplyPack-maintenance` |
| --- | --- | --- |
| `railwayConfigFile` | `null` | `null` |
| resolved `configFile` | `null` | `null` |
| `builder` | `RAILPACK` | `RAILPACK` |
| `rootDirectory` | `null` | `/` |
| `buildCommand` | `null` | `node --check scripts/run-maintenance-once.mjs` |
| `startCommand` | `null` | `node scripts/run-maintenance-once.mjs` |
| `cronSchedule` | `null` | `0 * * * *` |
| `healthcheckPath` | `/api/live` | `null` |
| `healthcheckTimeout` | `120` | `null` |
| `restartPolicyType` | `ON_FAILURE` | `NEVER` |
| `restartPolicyMaxRetries` | `3` | `10` |
| `autoInstrumentationEnabled` | `false` | `false` |
| `dockerfilePath` | `null` | `null` |
| `drainingSeconds` | `null` | `null` |
| `numReplicas` | `null` | `1` |
| `multiRegionConfig` | `ams: 1`, from the latest deployment manifest | `ams: 1`, from the latest deployment manifest |
| `nixpacksPlan` | `null` | `null` |
| `overlapSeconds` | `null` | `null` |
| `preDeployCommand` | `null` | `null` |
| `preDeployTimeoutSeconds` | `null` | `null` |
| `region` | `null` | `null` |
| `ipv6EgressEnabled` | `false` | `false` |
| `sleepApplication` | `false` | `false` |
| `source` | GitHub `duotapmobile/ApplyPack`; image `null` | GitHub `duotapmobile/ApplyPack`; image `null` |
| `tracingEnabled` | `false` | `false` |
| `watchPatterns` | `[]` | `[]` |

The sanitized Railway 5.49.6 provider-contract fixture observed web deployment `8fefc2dd-0521-4f22-9de8-fdc8b4519c9c` and maintenance deployment `ebf7570e-890c-4799-a62e-5f68a197e7f1`, both successful at commit `d0aea15f0dfab0cf10154e4f6d80cd96185468e7`. Their deployment manifests reported `ams: 1` for both services. These IDs and the SHA are historical fixture evidence only; the wrapper requires a fresh exact-SHA deployment at execution time. The retained legacy-file hashes are:

```text
railway.json             8C18D356C0EE16F939A40E69311B81F554D3A7F5DFFBD7B7C14973B72DCF3A58
railway-maintenance.json EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106
railway.maintenance.json EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106
```

These are SHA-256 values over the committed UTF-8 content with line endings canonically normalized to LF. They are intentionally stable across clean LF and Windows CRLF checkouts. The receipt also records the exact Git blob object ID, so normalization does not permit arbitrary content changes.

Railway 5.49.6 does not expose `multiRegionConfig` on `ServiceInstance`; requesting it there is an invalid GraphQL query. It does expose the field on `ServiceInstanceUpdateInput`, and the current value is present at `latestDeployment.meta.serviceManifest.deploy.multiRegionConfig`. The wrapper therefore reads all directly exposed fields from the exact service instance and reads only `multiRegionConfig` from that instance's latest deployment manifest. The deployment must exist, be successful at the reviewed SHA, have valid creation/update timestamps, be no older than the service-instance update, and contain a strictly shaped region-to-positive-replica mapping. It SHA-256 hashes the exact canonical `serviceManifest.deploy` object and binds that hash with the service/instance identity, deployment ID/status/exact SHA, and instance/deployment timestamps into one topology fingerprint. Missing, stale, malformed, unbound, or changed deployment evidence fails closed.

Immediately before cutover, the wrapper also introspects live `ServiceInstance`, `ServiceInstanceUpdateInput`, and the `serviceInstanceUpdate` mutation through the pinned Railway 5.49.6 CLI. It recursively canonicalizes every named kind, list wrapper, nullability wrapper, field argument/default, input default, mutation argument, and mutation return type. Those full signatures must exactly equal the reviewed, sanitized live-contract fixture: no missing field, unreviewed addition, same-name type drift, or mutation-signature drift is accepted. The receipt records the full signatures, a SHA-256 contract fingerprint, the 25-field rollback mutation allowlist, and the sole excluded write-only field, `registryCredentials`. The wrapper repeats this introspection immediately before apply and requires the same fingerprint. It then captures every restorable field listed above, `resolvedFileConfig.configFile`, the latest deployment identity/timestamps/status/commit SHA, the exact deploy-object hash, and manifest-derived `multiRegionConfig`. Recompute the three canonical file hashes and bind every cutover input to its committed object. Abort before mutation if:

- token scope, project, environment, service count, service IDs, or service names differ;
- either config-file field is unavailable rather than explicitly JSON `null`, is the empty string, or any captured field is incomplete;
- any file hash differs without a separately reviewed source change;
- either latest deployment is not successful at the reviewed exact SHA;
- the plan is not `0 to add, 0 to change, 0 to destroy` or contains diagnostics;
- `/api/live` is not HTTP 200;
- `/api/health` is not HTTP 503 with `status: not_ready`, `acceptingOrders: false`, the exact reviewed release SHA, and `checks.maintenance: true`;
- any of `APP_CHECKOUT_ENABLED`, `APP_LIVE_PAYMENTS_ENABLED`, or `APP_JOB_BOARD_CHECKOUT_ENABLED` is absent or not exactly `false`.

The wrapper repeats project scope, the complete live provider-schema fingerprint, service topology, deployment/manifest fingerprint, all three lock variables, liveness, locked readiness, exact release SHA, the fresh maintenance-heartbeat check, and finally every committed local input immediately before the pinned apply. After those checks it rehashes and reparses the exact pinned plan artifact, revalidates its source tree/zero-change contract, and invokes the sole apply with no intervening operation. It repeats the topology, lock variables, liveness, readiness, release SHA, and maintenance check after apply. Each `/api/live` and `/api/health` request has an independent 10-second `AbortController` deadline; timeout, aborted response, invalid JSON, or transport failure fails closed. Any pre-apply failure produces no provider mutation. Any post-apply failure leaves checkout locked and requires the sequential restoration procedure below.

Railway does not expose an immutable service-instance generation counter. The wrapper does not claim one: `updatedAt` is only a staleness signal. Safety comes from binding all observable identities/timestamps and the exact deploy-object hash in the first receipt, then requiring an identical topology fingerprint from a fresh query immediately before apply. A provider-side change invisible to all exposed fields and manifest bytes cannot be detected by this interface and requires Railway audit evidence during the supervised window.

### Executable sequential restoration

The GraphQL schema defines `railwayConfigFile` as a nullable string. JSON `null` and `""` are distinct states; the live baseline returned exact `null` for both services. Read-only inspection cannot prove write-time equivalence, so none is claimed. The wrapper rejects empty string, and rollback restores exact JSON `null`.

Railway `serviceInstanceUpdate` calls are not transactional. Never combine the web and maintenance updates behind aliases or claim atomic rollback. Use the wrapper's live schema fingerprint and exact 25-field allowlist, then create one private variables file per service from the immediate receipt. The wrapper records every live-accepted and observed restorable field: `autoInstrumentationEnabled`, `buildCommand`, `builder`, `cronSchedule`, `dockerfilePath`, `drainingSeconds`, `healthcheckPath`, `healthcheckTimeout`, `ipv6EgressEnabled`, manifest-derived `multiRegionConfig`, `nixpacksPlan`, `numReplicas`, `overlapSeconds`, `preDeployCommand`, `preDeployTimeoutSeconds`, `railwayConfigFile`, `region`, `restartPolicyMaxRetries`, `restartPolicyType`, `rootDirectory`, `sleepApplication`, `source`, `startCommand`, `tracingEnabled`, and `watchPatterns`. Preserve exact JSON `null`, boolean, number, array, and object semantics. Do not invent or capture the write-only `registryCredentials` field.

Each private file contains `environmentId`, one exact `serviceId`, and one `input` object. The reference web input restores `railwayConfigFile: null`, `builder: RAILPACK`, null build/root/start/cron fields, `/api/live`, timeout `120`, `ams: 1`, and `ON_FAILURE` with three retries. The maintenance input restores `railwayConfigFile: null`, `builder: RAILPACK`, root `/`, the exact build/start commands, hourly `0 * * * *`, `ams: 1`, and `NEVER` with ten retries. Never use deployment IDs as mutation targets.

Restore maintenance first, verify it against its receipt, then restore web and verify it:

```text
railway api 'mutation RestoreOne($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }' --variables @private-sanitized-maintenance-rollback-variables.json
railway api 'mutation RestoreOne($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }' --variables @private-sanitized-web-rollback-variables.json
```

After each call, query and compare only that service. If mutation or verification fails, stop; keep checkout locked; reapply the same captured input to the affected service as a compensating repair; and verify it again before any further operation. If the second service fails, leave the already verified first service restored and escalate. Do not retry both services as one operation.

After both restores, retain all three legacy files and `.railway/railway.ts`, run a fresh no-value plan and targeted query, and require zero add/change/destroy, exact receipt equality, `/api/live` HTTP 200, `/api/health` fail-closed with checkout locked, hourly maintenance configuration, exact reviewed SHA, and exact `railwayConfigFile: null` on both services. Preserve sanitized receipts and revoke the temporary token.

## Separately approved ownership cutover

Provider ownership cutover is a later supervised change window. It is not authorized by this source commit.

1. Require exact-SHA green CI, independent approval, locked checkout flags, and explicit user authorization for the staging provider mutation.
2. Run all source review and audits before creating the temporary environment-scoped project token.
3. Supply the token and exact marker only to the wrapper's dry run. Independently review the sanitized pre-cutover receipt and pinned zero-change plan.
4. Run the same wrapper with `--execute`. It applies only the pinned whole-graph plan; it never invokes migration defaults or service inference.
5. Verify exact service topology, hourly maintenance cadence, `/api/live` 200, truthful `/api/health` 503 with `acceptingOrders: false`, and exact deployed SHA.
6. Revoke the temporary token immediately and record revocation. If any verification fails, keep checkout locked and use the sequential restoration procedure.

The eventual provider cutover and later removal of legacy JSON files are distinct approvals. Production remains untouched.
