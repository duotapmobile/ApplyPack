# ApplyPack merge and deployment record

User authorization: "ok do depoly and merge and fix the remaining blockers."

Canonical repository: C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2.
Origin: https://github.com/duotapmobile/ApplyPack.git.
Candidate: 10709637cd81f5b7c83338c5b22691f86b408693.
Pull request: https://github.com/duotapmobile/ApplyPack/pull/3.
CI: https://github.com/duotapmobile/ApplyPack/actions/runs/35547502984.

## Changes and recovery

- Preserved the preceding source, matching, security and document hardening.
- Added migration 041: manual direct verification binds immutable source observation, canonical job snapshot, parsed requirement evidence and current customer inventory. Current source authority, customer criteria and listing lifecycle must all remain valid. Replays are safe; a concurrently closed reference cannot be reactivated.
- Added migration 043: source health uses current authorized rotation and recent complete enumerations, excluding unverified inventory and future verification times.
- Added canonical draft preparation from verified candidate facts, requirement nodes and human match evidence. Cover-letter factual segments preserve exact claim bindings.
- Restored the existing paused production Supabase project on its existing FREE plan. No new resource or paid plan was created.
- Applied the tested 46-migration baseline and final migrations 041/043 to both hosted databases. Both now have 48 ledger entries; production orders and payments remain zero.
- Copied the existing restricted Stripe test credential to staging using stdin/in-memory handling. Added existing verified board price IDs to production. No Stripe objects, charges or subscriptions created; webhook secrets unchanged.
- Both environments keep payment mode disabled and all checkout, live-payment, source-sync and source-projection activation flags false.

## Validation

Local npm run check passed: lint, TypeScript, 66 files / 479 unit tests, production build.
Native PostgreSQL final candidate passed 48 migrations / seven fixture suites. Input hashes matched the checkout after the final concurrency correction.
Sanitized evidence: evidence/local/verified-source-bridge-2026-09-20/.
Final candidate GitHub CI passed all three jobs: 479 unit tests, production build, 106 browser tests (six explicitly skipped), PostgreSQL 17 fresh and preserved-data migrations, all 48 migrations and seven contract fixture suites. Actual scanner tests require a scanner and are not claimed as passed.

## Current source counts (live aggregate query before final migrations)

| Environment | Sources | Distinct employers | Active source flags | Enabled schedules | Real runs | Active real jobs | Orders | Payments |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Staging | 80 | 76 | 79 | 0 | 0 | 0 | 0 | 0 |
| Production | 79 | 75 | 78 | 0 | 0 | 0 | 0 | 0 |

Active source flags are registry metadata, not authorization or production readiness.

## External blockers

1. Namecheap currently delegates applypack.work to failed-whois-verification.namecheap.com and verify-contact-details.namecheap.com. The user must verify the domain registrant contact through Namecheap; a question is pending. Then recheck restored DNS, HTTPS and email. Railway expected apex target gpwlnk3a.up.railway.app; www target rezs6jme.up.railway.app. Do not replace held DNS blindly.
2. Staging SSH verified LibreOffice 25.2.3.2 and Poppler 25.03.0 executable availability and hashes. Arial is absent and resolves to Liberation Sans. A complete licensed font installation and approved runtime pins remain required. Prepared mappings are in evidence/runtime-renderer-2026-09-20/staging.json, marked incomplete. Neither environment has scanner or KMS configuration. Connect a real ClamAV service and approved HTTPS KMS wrap/unwrap provider, configure identities and credentials securely, then run real file-safety/envelope/render/delivery checks. Production SSH inspection stalled; its installed runtime is not claimed verified. No new paid service was provisioned.
3. Stripe prices and test credential are checked, but a real signed test webhook and complete paid fulfillment/download scenario remain unverified. Live checkout stays disabled.
4. No currently authorized source schedule or real source inventory exists. Actual permitted collection, direct review and full customer fulfillment remain to be demonstrated. No new production sourcing activated.
5. Maintenance remains paused: the previous crash is maintenance_http_503 from explicit FILE_SAFETY_NOT_READY and PAYMENT_INTEGRITY_NOT_READY gates. Fix dependencies and run a controlled proof before re-enabling its schedule.

## Data and rollback

Only schema migrations and aggregate metadata checks were used. An automatic review rejected a broad customer-table export; no export occurred or was retried. Provider backup metadata lists no visible backups and PITR disabled on these FREE projects.
Migrations 041 and 043 are additive and transactional. Roll back application deployment to its previous exact code if needed; retain forward schema/provenance rather than dropping tables. Do not activate the old weaker material paths.
Private documentation/evidence remain local and excluded from public Git publication.

## Final deployment evidence

- PR #3 merged at 2026-09-21T00:30:24Z.
- Main merge commit: 7e6cd09e63cfdd73b7db5c68bb53ad0363f32842.
- Candidate and merge commit have identical Git trees. Local application/test/migration files have no uncommitted changes; private documentation/evidence remain separate.
- Staging deployment df4ff388-d186-4daf-b08e-681000762041: SUCCESS, uploaded clean git archive of 10709637cd81f5b7c83338c5b22691f86b408693. Image sha256:56ecad2fc392ec3b71a154369c46537635ca97165be7e5076f6b594ae4cf1739.
- Production deployment abee5b9f-9db3-4154-b5ef-f2ddb4002e68: SUCCESS, Railway GitHub autodeploy of main merge commit. Image sha256:305aa09ffc5e91b400132b6e0cd05dcce4d222aa01adb4d6ca1358d857366161.
- Staging https://applypack-staging-staging.up.railway.app/ and production https://applypack-production.up.railway.app/ return HTTP 200. /api/live returns 200 on both. Railway's own startup healthchecks pass.
- /api/health returns 503 not_ready on both, correctly distinguishing service liveness from product readiness. Production checks: database/Supabase/public-origin configuration true; payments/email/fileSafety/maintenance/authorized sourcing false. This is not a process crash.
- New staff routes are deployed and unauthorized access is denied. Production board checkout returns 503 while disabled.
- Production storage metadata: four buckets, zero public.
- Supabase production auth site_url was corrected from http://localhost:3000 to https://applypack.work. Both environments now allow exact /auth/callback, /auth/callback?next=/get-started and /auth/callback?next=/my-applypack on their respective origins; staging's prior bare-origin entry was preserved. No broad wildcard added. Readback evidence is under evidence/auth-url-repair-2026-09-20/. Email delivery is not claimed tested.
- Domain NS recheck still shows Namecheap verification hold.
- Main-branch CI: https://github.com/duotapmobile/ApplyPack/actions/runs/35547913984 (final status appended below).

## Launch verdict by subsystem

| Subsystem | Verdict | Remaining proof or blocker |
| --- | --- | --- |
| Sourcing | PARTIAL | 0 authorized schedules, 0 real runs/jobs; permission and permitted real collection/direct review required |
| Matching | PARTIAL | Fixture-backed gates/evidence and verified bridge exist; real coverage plan, review/evaluation and complete customer scenario unverified |
| Documents | BLOCKED | Arial/runtime configuration, real scanner and KMS absent; hosted complete rendering/approval/private download unverified |
| Payments/Entitlements | BLOCKED | Existing test configuration repaired; signed event and complete fulfillment proof missing; live activation disabled |
| Admin Review | PARTIAL | Routes/guards deployed and fixture-validated; full real operator workflow remains unverified |
| Security | PARTIAL | RLS/authorization CI and private-bucket metadata verified; scanner/KMS/provider file delivery still missing |
| Deployment | PARTIAL | Exact web release and migrations deployed successfully; custom domain/email and operational readiness remain blocked |

Overall: NOT READY for paying customers. Merge and web deployment are complete; customer launch is a separate unmet gate.


Final main CI 35547913984: SUCCESS in all three jobs (database, verify, browser). Verified after production deployment. Raw CI log preserved locally in evidence/ci-main-7e6cd09.log.
