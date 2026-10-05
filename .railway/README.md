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

The web service keeps `/api/live` as Railway's dependency-independent healthcheck. `/api/health` remains the application readiness truth and must stay HTTP 503 until all launch dependencies pass. Checkout remains locked independently of either process health or this migration.

## Current ownership boundary

No provider ownership migration has been performed. The tracked `railway.json`, `railway-maintenance.json`, and `railway.maintenance.json` files remain in place because the existing services still use legacy Config as Code. In particular, those files continue to own the web build/start command and the maintenance build/start/cron settings until the controlled ownership cutover.

Do not run any of these commands as part of an ordinary source change or plan review:

```text
railway config apply
railway config migrate --apply
railway config migrate --apply --delete-files
```

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

## Separately approved ownership migration

Provider ownership migration is a later, supervised change window. It is not authorized by this source commit. During that window:

1. Reconfirm the project and staging environment IDs, the two service IDs, the branch, the locked checkout flags, and the current sanitized provider inventory.
2. Pull/preview without variable values and compare the result with this reviewed whole-staging graph.
3. Preview `railway config migrate` for the repository's legacy files. Do not use an unscoped generated single-service file; both staging services must remain represented in the reviewed whole-project graph.
4. Review the translated legacy build/start settings, `/api/live` healthcheck, hourly `0 * * * *` maintenance cadence, restart policies, regions, private endpoints, source branch, and every `preserve()` variable before any provider mutation.
5. Obtain explicit approval for `railway config migrate --apply`. Do not use `--delete-files`; the legacy files are removed only in a later reviewed source commit after provider ownership is proven.
6. Immediately run a fresh staging plan. Require `0 to add, 0 to change, 0 to destroy`; any destroy or unexpected drift aborts the cutover.
7. Verify both staging services, `/api/live`, truthful `/api/health`, the maintenance heartbeat, exact deployed SHA, and both checkout gates still false.
8. Preserve a sanitized plan, ownership receipt, service/environment identity, deployment evidence, and rollback instructions. Production remains untouched.

The eventual provider cutover and later removal of the legacy JSON files are distinct approvals. This directory alone does not migrate ownership, deploy code, unlock checkout, or establish launch readiness.
