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

## Apply authorization guard

The authoring program evaluates `plan` and an omitted command without an authorization marker. It rejects an `apply` command with `APPLYPACK_RAILWAY_IAC_APPLY_NOT_AUTHORIZED` unless the local process contains this exact, nonsecret cutover marker:

```text
APPLYPACK_RAILWAY_IAC_STAGING_CUTOVER_AUTHORIZATION=apply:fb5a58c4-8ccb-4205-82f9-8b8738c84e56:6633e585-5bcd-4729-b167-2a99628daf86
```

This marker is an explicit-action interlock, not a credential. It does not replace the exact project and environment identity checks, supervisor approval, a zero-change plan, or the rollback receipt. Never add it to Railway variables, repository secrets, account settings, a permanent shell profile, logs, or evidence. An authorized operator may inject it only into the single approved staging cutover process and must remove it immediately afterward. Near matches, alternate casing, extra text, and generic values such as `true` fail closed.

## Cutover credential boundary

Complete source review, CI, dependency audits, the zero-change plan, and the rollback receipt before creating or loading any cutover credential. The cutover process must use a temporary Railway **project token scoped only to the `staging` environment** in project `Apply Pack`. Account-wide and workspace-wide tokens are prohibited.

Before any mutation, use the token only to run the metadata-only scope query from Railway's public API:

```text
railway api 'query { projectToken { projectId environmentId } }' --compact
```

Require project ID `fb5a58c4-8ccb-4205-82f9-8b8738c84e56` and environment ID `6633e585-5bcd-4729-b167-2a99628daf86`. Correlate those IDs with the plan's names `Apply Pack` and `staging`. The evidence receipt records only those names, IDs, `tokenScopeMatches: true`, and the query time. It must not contain the token, token prefix, headers, shell history, or environment output.

Load the token through the approved local secret-injection mechanism as `RAILWAY_TOKEN`; do not paste it into a command, store it in the repository, or use `RAILWAY_API_TOKEN`. Revoke the project token immediately after successful verification or rollback. Confirm revocation in the sanitized change-window receipt.

## Read-only plan gate

Use Railway CLI `5.49.6` or the currently approved successor. Install the isolated, exact `railway@3.12.0` authoring dependency without adding it to the web application graph:

```text
npm ci --prefix .railway
```

Authenticate normally, select the exact project and staging environment above, and run only:

```text
railway config plan --json --detailed-exit-code
```

The acceptable baseline result is all of the following:

- exit code `0`;
- exact project and environment identities shown above;
- an empty `changeSet.changes` array;
- `0 to add, 0 to change, 0 to destroy`;
- no diagnostics and no secret values in output.

Abort if the plan proposes any add, change, or destroy action. A zero-destroy plan is necessary but not sufficient: the baseline requires zero adds and zero changes too. Never make the plan pass by deleting a service from Railway, omitting an existing service or variable from this file, weakening the identity guard, or moving to production.

## Dependency-audit boundary

The isolated `.railway` package currently audits with zero vulnerabilities, and the root production graph audits with zero vulnerabilities. The root full development audit separately reports seven pre-existing high-severity package entries in lint/test tooling, not the application runtime or Railway SDK graph:

- `eslint-config-next` -> `@next/eslint-plugin-next` -> `fast-glob` -> `micromatch` -> `braces`: `GHSA-vfj7-8cjw-p6xm`.
- ESLint/TypeScript tooling -> `brace-expansion`: `GHSA-q2hr-2g5m-vwhr`, `GHSA-qhr7-859c-m2p7`, and `GHSA-6j4f-fj2g-mc7p`.
- `jsdom` -> `undici`: `GHSA-3wwx-pv8p-q78v`, `GHSA-pmjh-fq2x-6v4x`, `GHSA-r53p-7pc4-xj5r`, `GHSA-rfgv-xxqx-mfg5`, `GHSA-3xpg-4rpp-hhhm`, `GHSA-2jfj-6hjv-fm6j`, `GHSA-2gqq-gqf2-x968`, `GHSA-w293-vg96-wgc3`, `GHSA-8436-99hf-9mmv`, and `GHSA-rx4f-c7p8-82vq`.

Do not suppress or relabel these advisories. Keep the SDK isolated, require zero production and isolated-SDK critical/high findings for cutover, and retain the development-tool advisories as an explicit dependency-maintenance item until compatible upstream upgrades are available and verified.

## Mandatory pre-migration rollback receipt

Create and independently review a sanitized rollback receipt **immediately before** `railway config migrate --apply`. The receipt must be outside the repository and must contain no variable values. A reference query on 2026-10-05 UTC found the following staging state; because deployments can advance on every branch push, these deployment IDs and SHAs are reference evidence only and must be queried again in the change window.

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
| `numReplicas` | `null` | `1` |
| `region` | `null` | `null` |
| `ipv6EgressEnabled` | `false` | `false` |
| `sleepApplication` | `false` | `false` |
| `tracingEnabled` | `false` | `false` |
| `autoInstrumentationEnabled` | `false` | `false` |
| `watchPatterns` | `[]` | `[]` |

The reference deployments were web `3a39e1f2-6843-4fd3-aaf1-7e453843d18a` and maintenance `7ff4d797-9e62-4b12-88fa-d72b1c996e48`, both successful at commit `14c908ef1a7365f8d234e72d2d9524313b3a1812`. The reference plan also reported `ams: 1` for both services. The retained legacy-file hashes are:

```text
railway.json             7A31888BADA01725F4C27037BE591CE0BA00A1A964E5187D31A3D361DD2C4451
railway-maintenance.json EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106
railway.maintenance.json EEDFA7D896A451A8BFE6CD53FAF4859243D547777A0544F03E6AA3ED1CC8B106
```

Immediately before migration, rerun a targeted `serviceInstance` query for the two exact service IDs and capture every field in the table, `resolvedFileConfig.configFile`, the latest deployment IDs/status/commit SHA, and `multiRegionConfig` from the no-value plan. Recompute the three file hashes. Abort before mutation if:

- token scope, project, environment, service count, service IDs, or service names differ;
- either config-file field is unavailable rather than explicitly `null`, or any captured field is incomplete;
- any file hash differs without a separately reviewed source change;
- either latest deployment is not successful at the reviewed exact SHA;
- the plan is not `0 to add, 0 to change, 0 to destroy` or contains diagnostics;
- `/api/live` is not HTTP 200, `/api/health` is not truthfully locked as expected, the hourly maintenance heartbeat is stale, or either checkout gate is enabled.

### Executable restoration sequence

The receipt must include a private JSON variables object with the two pre-migration `ServiceInstanceUpdateInput` objects reconstructed from the targeted query and no provider variables. If migration must be rolled back, use the temporary staging project token and the live Railway public API operation below. Never substitute production IDs.

The verified reference shape below is directly consumable by the command that follows, but it is not the change-window receipt. Rebuild it from the immediate pre-migration query and store it outside the repository as `private-sanitized-rollback-variables.json`.

```json
{
  "environmentId": "6633e585-5bcd-4729-b167-2a99628daf86",
  "webId": "3d379eca-87ac-48ba-9f95-9d69c806a5db",
  "maintenanceId": "866e36fd-2fec-45fd-ba01-7150a789e419",
  "web": {
    "autoInstrumentationEnabled": false,
    "buildCommand": null,
    "builder": "RAILPACK",
    "cronSchedule": null,
    "dockerfilePath": null,
    "drainingSeconds": null,
    "healthcheckPath": "/api/live",
    "healthcheckTimeout": 120,
    "ipv6EgressEnabled": false,
    "multiRegionConfig": { "ams": { "numReplicas": 1 } },
    "numReplicas": null,
    "overlapSeconds": null,
    "preDeployCommand": null,
    "preDeployTimeoutSeconds": null,
    "railwayConfigFile": null,
    "region": null,
    "restartPolicyMaxRetries": 3,
    "restartPolicyType": "ON_FAILURE",
    "rootDirectory": null,
    "sleepApplication": false,
    "startCommand": null,
    "tracingEnabled": false,
    "watchPatterns": []
  },
  "maintenance": {
    "autoInstrumentationEnabled": false,
    "buildCommand": "node --check scripts/run-maintenance-once.mjs",
    "builder": "RAILPACK",
    "cronSchedule": "0 * * * *",
    "dockerfilePath": null,
    "drainingSeconds": null,
    "healthcheckPath": null,
    "healthcheckTimeout": null,
    "ipv6EgressEnabled": false,
    "multiRegionConfig": { "ams": { "numReplicas": 1 } },
    "numReplicas": 1,
    "overlapSeconds": null,
    "preDeployCommand": null,
    "preDeployTimeoutSeconds": null,
    "railwayConfigFile": null,
    "region": null,
    "restartPolicyMaxRetries": 10,
    "restartPolicyType": "NEVER",
    "rootDirectory": "/",
    "sleepApplication": false,
    "startCommand": "node scripts/run-maintenance-once.mjs",
    "tracingEnabled": false,
    "watchPatterns": []
  }
}
```

```text
railway api 'mutation RestoreStaging($environmentId: String!, $webId: String!, $maintenanceId: String!, $web: ServiceInstanceUpdateInput!, $maintenance: ServiceInstanceUpdateInput!) { web: serviceInstanceUpdate(serviceId: $webId, environmentId: $environmentId, input: $web) maintenance: serviceInstanceUpdate(serviceId: $maintenanceId, environmentId: $environmentId, input: $maintenance) }' --variables '@<private-sanitized-rollback-variables.json>'
```

The captured variables object must use the exact IDs above and the just-captured field values. For the verified reference state, the web input restores `railwayConfigFile: null`, `builder: RAILPACK`, null build/root/start/cron fields, `/api/live`, timeout `120`, `ams: 1`, `ON_FAILURE` with `3` retries, and the remaining false/null/empty fields in the table. The maintenance input restores `railwayConfigFile: null`, `builder: RAILPACK`, root `/`, the exact build/start commands, hourly `0 * * * *`, `ams: 1`, `NEVER` with `10` retries, and its remaining false/null/empty fields. Never use the reference deployment IDs as mutation targets; target only the exact service and environment IDs.

After the update, restore the captured legacy ownership/config-file setting explicitly (`railwayConfigFile: null` in the verified reference state), retain all three legacy files, and do not delete `.railway/railway.ts`. Run a fresh no-value plan and targeted query. Require the two service configurations to equal the receipt, no proposed add/change/destroy, `/api/live` HTTP 200, `/api/health` still fail-closed with checkout locked, a current successful maintenance heartbeat at hourly cadence, and both services at the intended reviewed SHA. Record sanitized mutation and verification receipts, then revoke the project token. If any verification fails, keep checkout locked, stop further provider changes, preserve webhook/refund/customer access paths, and escalate for a separately reviewed forward repair.

## Separately approved ownership migration

Provider ownership migration is a later, supervised change window. It is not authorized by this source commit. During that window:

1. Reconfirm the project and staging environment IDs, the two service IDs, the branch, the locked checkout flags, and the current sanitized provider inventory.
2. Complete and approve the mandatory rollback receipt above before loading a credential.
3. Create a temporary environment-scoped staging project token, verify its metadata-only scope, and load it without logging its value.
4. Pull/preview without variable values and compare the result with this reviewed whole-staging graph.
5. Preview `railway config migrate` for the repository's legacy files. Do not use an unscoped generated single-service file; both staging services must remain represented in the reviewed whole-project graph.
6. Review the translated legacy build/start settings, `/api/live` healthcheck, hourly `0 * * * *` maintenance cadence, restart policies, regions, private endpoints, source branch, and every `preserve()` variable before any provider mutation.
7. Obtain explicit approval for `railway config migrate --apply`, inject the exact one-process authorization marker, and apply. Do not use `--delete-files`; the legacy files are removed only in a later reviewed source commit after provider ownership is proven.
8. Immediately remove the marker and run a fresh staging plan. Require `0 to add, 0 to change, 0 to destroy`; any destroy or unexpected drift invokes the restoration sequence.
9. Verify both staging services, `/api/live`, truthful `/api/health`, the maintenance heartbeat, exact deployed SHA, and both checkout gates still false.
10. Preserve a sanitized plan, ownership receipt, service/environment identity, deployment evidence, and rollback result if used. Revoke the temporary token. Production remains untouched.

The eventual provider cutover and later removal of the legacy JSON files are distinct approvals. This directory alone does not migrate ownership, deploy code, unlock checkout, or establish launch readiness.
