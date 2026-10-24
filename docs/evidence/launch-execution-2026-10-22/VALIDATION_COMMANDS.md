# Local validation prerequisites and commands

Observed on Windows on October 23, 2026: Node 22.16.0, npm 10.9.2, Docker 29.7.2, Supabase CLI 2.116.0, Vitest 4.1.11 and Playwright 1.62.1. The full Linux application image uses its separately pinned Node 22 base and records its own tool identity. A local tool version is not evidence of a hosted environment or clean CI run.

Work only in `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`. Verify its root, origin, branch and working tree first. Preserve the 22 pre-existing files in `preexisting-work.json`. Native runner tests require PowerShell 7, Windows DPAPI and the existing local Docker Desktop Linux engine; real SQL tests require the isolated local Supabase stack. Hosted database credentials are neither needed nor permitted for these synthetic checks. Never run database reset commands against a linked/hosted database.

PowerShell resolves bare `npm` to `npm.ps1` here. The failed current-suite invocation lost its forwarded flags. Use direct Node CLIs for these runs, or `npm.cmd` when forwarding arguments to an npm script. The existing renderer harness already uses `npm.cmd`; both Windows CI receipt-producing test commands now do too.

Run heavy database, image, native-test and browser jobs sequentially. Concurrent image/database work previously caused native child-process deadlines to expire. Preserve failed receipts and rerun unchanged assertions/deadlines exclusively. Do not stop unrelated applications or services to obtain a pass.

```powershell
$unitAttempt = 'evidence/launch-unit/fresh-attempt'
New-Item -ItemType Directory -Path $unitAttempt -ErrorAction Stop
$unitJson = Join-Path (Resolve-Path $unitAttempt).Path 'results.json'
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism --reporter=default --reporter=json --outputFile="$unitJson"
$unitExit = $LASTEXITCODE
node scripts/assert-required-test-results.mjs $unitJson
$unitValidatorExit = $LASTEXITCODE

$browserAttempt = 'evidence/launch-browser/fresh-attempt'
New-Item -ItemType Directory -Path $browserAttempt -ErrorAction Stop
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path (Resolve-Path $browserAttempt).Path 'results.json'
node node_modules/@playwright/test/cli.js test --workers=1 --retries=0 --forbid-only --max-failures=1 --reporter=list,json --output="$browserAttempt/artifacts" *> "$browserAttempt/browser.log"
$browserExit = $LASTEXITCODE
node scripts/assert-required-test-results.mjs $env:PLAYWRIGHT_JSON_OUTPUT_NAME
```

Use a fresh nonexistent receipt/output directory for each attempt; do not overwrite failed evidence. Verify with git check-ignore that every live browser output is excluded, including stdout, JSON, screenshots and traces. Tailwind scans nonignored project text, so live output under docs/evidence can trigger development rebuilds. Keep source/documentation writes stopped during browser execution. After verified browser/server teardown, copy finalized sanitized receipts into the versioned evidence bundle with hashes and original paths. Preserve the browser process exit code separately from the result validator exit code.

Confirm the requested options appear in execution and that framework JSON exists. Stop-on-first-failure preserves the failed attempt and normally lets the reporter finalize; its remaining unexecuted cases do not count as passing. The result validator rejects failed, skipped, empty or flaky required-test receipts. The commands above are future-run examples using fresh output locations. The historical accepted unit run completed with 801 passes and zero skips; preserve its `unit-results-current-serial.json` and `unit-current-serial-validation.json` unchanged. The first full browser attempt was interrupted with failures and no framework JSON; the ignored-output nine-case diagnostic passed. A later full attempt exhausted a combined denial test's development-compilation budget and remains failed. The independent nine-case split raises the complete matrix to 351. Actual attempt04 completed 351/351 with zero failed/skipped/flaky/global errors, runner/validator exit 0, one worker, zero retries and forbid-only. Its complete result and source/teardown bindings are in browser-attempt-04-final.json. Commands alone do not establish a passing result.

Real rendering uses checksum-verified, separately extracted LibreOffice 26.2.6.3 and Poppler 26.9.0 plus all four pinned Liberation Sans 2.1.5 faces. `pinned-render-final-attempt.json` records the exact binaries and successful seven-artifact/eight-page run. Existing installed renderers were preserved. Browser binaries are installed, but five-project emulation cannot replace physical-device, screen-reader or human document review.

The explicit rollback check also requires a distinct reviewed full committed schema-compatible SHA. No such schema-085 alternative is currently proven. The documented `LOCKED_FORWARD_RECOVERY` strategy still needs its own reviewed protected recovery procedure; neither an omitted rollback target nor using the candidate itself can pass that gate.

Cleanup bounds and remaining hosted capacity checks are in `docs/runbooks/LAUNCH_MAINTENANCE_CLEANUP.md`. Local database-operation prerequisites and protected/off-machine recovery limits are in `docs/runbooks/LAUNCH_DATABASE_OPERATIONS.md`. No command in this local evidence bundle grants provider or deployment authorization.
