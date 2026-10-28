# Recovery CI continuation handoff

**NOT READY.** Local implementation remains uncommitted; human assignments remain deferred. No candidate, remote CI run, recovery approval, hosted/provider change, payment or public activation is claimed.

The continuation closed a concrete gap: CI previously required a rollback SHA even when the launch plan allowed reviewed forward recovery. It now accepts either the strict compatible-commit path or a reviewed forward plan bound to the exact clean candidate, schema and migration bytes. Mandatory local structural SQL recovery remains in both paths. Controlled GitHub configuration carries human statements; the parser does not authenticate people or prove the linked reviews or hosted recovery.

Passed: 61 recovery-gate Node tests, 19 affected existing unit tests, lint/typecheck, unchanged strict/SQL extraction checks, and actual disposable-database rollback/reset with both required markers. The database returned to schema 085, 90 migrations, the exact nine-ID readiness contract and LOCKED state, with empty operational data and no invalid indexes.

The updated image sha256:8c2931e9502c23feedbcc5512f4f2a1b8b4e31eebf5886f9cc8161cb08607280 passed isolated nonroot/read-only startup and the exact-archive offline scan with zero HIGH/CRITICAL findings. All 379 image inputs and 739 source inputs stayed fixed through validation. The scan uses the separately recorded pinned scanner/database; this is a public-placeholder local build, not a deployed release. The first offline build failed because pinned public source retrieval had no network; it is preserved. The passing build used normal dependency retrieval; runtime and scanner checks used network none.

Only seven implementation files changed from the earlier local snapshot; all 22 protected user files remain byte-identical. Earlier 801-test/43-replay, 351-browser, integration, schema and rendering evidence remains dated proof under the explicit dependency assessment in source-delta.json. The 19 tests are overlapping replays, not additional unique application tests. The original provisional manifest and handoff remain preserved snapshots; use this continuation manifest for the newer tooling and image.

Release still requires a committed reviewed candidate, exact-candidate CI, actual recovery-strategy approval and protected object/key/auth/off-machine recovery, named people, scoped provider approvals, hosted journeys, human document/accessibility/device acceptance, and separate production/canary/public authorization. Local structural recovery supplies none of those approvals.

Current operating instructions: docs/runbooks/LAUNCH_DATABASE_OPERATIONS.md and docs/runbooks/LAUNCH_OPERATIONS_INDEX.md.
