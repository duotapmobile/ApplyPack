import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPLY_PACK_CONTRACT_VERSION,
  APPLY_PACK_PRICE_CENTS,
  LEGACY_APPLY_PACK_CONTRACT_VERSION,
  LEGACY_SEARCH_CONTRACT_VERSION,
  SEARCH_CONTRACT_VERSION,
  SEARCH_PRICE_CENTS,
} from "@/lib/domain/applypack";
import { currentLegalContentBinding } from "@/lib/legal/content-hash";
import { LAUNCH_LEGAL_BINDING } from "../../scripts/launch-legal-contract.mjs";
import { hasDatabaseErrorCode } from "@/lib/matching/persistence-error";
import {
  launchSchemaReadinessIsCurrent,
  REQUIRED_LAUNCH_MIGRATIONS,
  REQUIRED_LAUNCH_SCHEMA_VERSION,
} from "@/lib/operations/launch-schema";
import {
  APPROVED_ROLLBACK_LEGAL_CONTRACT,
  verifyRollbackLegalSource,
} from "../../scripts/rollback-legal-contract.mjs";
import {
  environmentWithoutPreflightSecrets,
  PREFLIGHT_DEPLOYMENT_PROJECT_REFS,
  validateAndCanonicalizePreflightConnection,
} from "../../scripts/inventory-preflight-connection.mjs";
import { runInventoryIdentityPreflight } from "../../scripts/check-inventory-identity-conflicts.mjs";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("October 2 manual-launch hardening", () => {
  it("binds legal acceptance to the exact displayed Terms, Privacy Policy, and acknowledgement copy", () => {
    expect(currentLegalContentBinding()).toEqual({
      termsVersion: "manual-launch-terms-2026-10-24-v3",
      privacyVersion: "privacy-2026-10-24-v3",
      termsContentSha256: "bac56f51e78cd099c8676efcfca5616d2fbdaeb9fc40c8aa0d5053ff968a3428",
      privacyContentSha256: "2d7a8f194c8246775f1bb9803378596bf8bf60fb2a72cb34bf3c009adaa6e311",
      acceptanceCopyVersion: "applypack-legal-acceptance-copy-2026-10-04-v1",
      acceptanceCopySha256: "0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283",
      contentCanonicalizationVersion: "applypack-c14n-v1",
      receiptSchemaVersion: "applypack-legal-content-receipt-v1",
    });
  });

  it("keeps later legal revisions append-only and rejects a rollback with altered legal text", () => {
    const binding = currentLegalContentBinding();
    expect(LAUNCH_LEGAL_BINDING).toEqual(binding);
    expect(APPROVED_ROLLBACK_LEGAL_CONTRACT.privacyVersion).toBe("privacy-v1");
    expect(APPROVED_ROLLBACK_LEGAL_CONTRACT.privacyContentSha256).not.toBe(binding.privacyContentSha256);
    const forward = source("supabase/migrations/202610240087_one_off_service_retention.sql");
    expect(forward).toContain(`privacy_version='${binding.privacyVersion}'`);
    expect(forward).toContain(`privacy_content_sha256='${binding.privacyContentSha256}'`);
    const legalPages = source("src/content/public-pages.ts");
    const wizard = source("src/app/get-started/wizard-v3.tsx");
    const presentation = source("src/lib/legal/presentation.ts");
    // The historical rollback pins the entire wizard source. The later focus
    // repair must remain incompatible with that pin even though its legal copy is unchanged.
    expect(verifyRollbackLegalSource({
      publicPagesSource: legalPages,
      wizardSource: wizard,
      presentationSource: presentation,
    })).toEqual({ ok: false, failures: ["legal_pages_source_mismatch", "legal_acceptance_copy_mismatch"] });
    expect(verifyRollbackLegalSource({
      publicPagesSource: legalPages.replace("Effective October 2, 2026", "Effective October 3, 2026"),
      wizardSource: wizard,
      presentationSource: presentation,
    })).toEqual({ ok: false, failures: ["legal_pages_source_mismatch", "legal_acceptance_copy_mismatch"] });
    const spoofedPresentation = presentation
      .replace('prefix: "I agree to the "', 'prefix: "Different disclosure: "')
      .concat('\n// prefix: "I agree to the "\n');
    expect(verifyRollbackLegalSource({
      publicPagesSource: legalPages,
      wizardSource: wizard,
      presentationSource: spoofedPresentation,
    })).toEqual({ ok: false, failures: ["legal_pages_source_mismatch", "legal_acceptance_copy_mismatch"] });
    expect(APPROVED_ROLLBACK_LEGAL_CONTRACT.presentationSourceSha256).toHaveLength(64);
    expect(APPROVED_ROLLBACK_LEGAL_CONTRACT.wizardSourceSha256).toHaveLength(64);
    expect(APPROVED_ROLLBACK_LEGAL_CONTRACT.legacyWizardSourceSha256).toHaveLength(64);

    const migration = source("supabase/migrations/202610040075_append_only_legal_acceptance_episodes.sql");
    const reconciliation = source("supabase/migrations/202610040076_reconcile_legacy_legal_acceptance_episodes.sql");
    const atomicInventoryIdentity = source("supabase/migrations/202610040077_atomic_inventory_identity_enforcement.sql");
    const feasibilityRecovery = source("supabase/migrations/202610040078_requeue_identity_policy_feasibility.sql");
    expect(migration).toContain("drop constraint ap_snapshot_legal_acceptances_snapshot_id_key");
    expect(migration).toContain("drop constraint ap_snapshot_legal_content_receipts_snapshot_id_key");
    expect(migration).toContain("unique(snapshot_id,acceptance_sha256)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("acceptance.acceptance_sha256=p_acceptance_sha256");
    expect(migration).toContain("anchor_count<>2");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("to service_role");
    expect(reconciliation).toContain("public.ap_legal_receipt_acceptance_reconciliations");
    expect(reconciliation).toContain("MIGRATION_074_CONTENT_HASH_LINK");
    expect(reconciliation).toContain("on conflict(snapshot_id,acceptance_sha256) do nothing");
    expect(reconciliation).toContain("ap_legal_receipt_acceptance_reconciliations_immutable");
    expect(atomicInventoryIdentity).toContain("ap_persist_parsed_inventory_job");
    expect(atomicInventoryIdentity).toContain("ap_admit_verified_inventory_snapshot");
    expect(atomicInventoryIdentity).toContain("pg_advisory_xact_lock");
    expect(atomicInventoryIdentity).toContain("array_remove(array[existing.canonical_employer_listing_url,existing.canonical_application_url],null)");
    expect(atomicInventoryIdentity).toContain("array_remove(array[other.canonical_employer_listing_url,other.canonical_application_url],null)");
    expect(atomicInventoryIdentity).toContain("selected_inventory_identity_conflict_requires_successor_inventory");
    expect(feasibilityRecovery).toContain("set revoked_at=policy_at");
    expect(feasibilityRecovery).toContain("set state='PENDING'");
    expect(feasibilityRecovery).toContain("completed_assessment_id=null");
    expect(feasibilityRecovery).toContain("REQUEUE_IDENTITY_POLICY_FEASIBILITY");
    expect(source("scripts/run-supabase-legal-upgrade-test.mjs"))
      .toContain('"--version", "202610040074"');
    expect(source("tests/integration/legal-receipt-076-verify.sql"))
      .toContain("LEGAL_ACCEPTANCE_FORWARD_UPGRADE_OK");
    expect(source("package.json")).toContain("run-supabase-legal-upgrade-test.mjs");

    const rollback = source("scripts/run-supabase-rollback-test.mjs") + source("scripts/lib/supabase-structural-recovery.mjs");
    expect(rollback).toContain("verifyRollbackLegalSource");
    expect(rollback).toContain("LAUNCH_LEGAL_BINDING.termsContentSha256");
    expect(rollback).toContain("LAUNCH_LEGAL_BINDING.privacyContentSha256");
    expect(rollback).toContain("LAUNCH_LEGAL_BINDING.acceptanceCopySha256");
  });

  it("maps an atomic duplicate race to an operator conflict without exposing other database errors", () => {
    expect(hasDatabaseErrorCode({ message: "duplicate_inventory_job" }, "duplicate_inventory_job")).toBe(true);
    expect(hasDatabaseErrorCode(new Error("duplicate_inventory_job"), "duplicate_inventory_job")).toBe(true);
    expect(hasDatabaseErrorCode({ message: "connection failed" }, "duplicate_inventory_job")).toBe(false);
    const route = source("src/app/api/admin/jobs/route.ts");
    expect(route).toContain('hasDatabaseErrorCode(error, "duplicate_inventory_job")');
    expect(route).toContain("{ status: 409 }");
  });

  it("uses new immutable price contracts while naming the historical contracts", () => {
    expect({ SEARCH_PRICE_CENTS, APPLY_PACK_PRICE_CENTS }).toEqual({ SEARCH_PRICE_CENTS: 1_899, APPLY_PACK_PRICE_CENTS: 799 });
    expect({ SEARCH_CONTRACT_VERSION, APPLY_PACK_CONTRACT_VERSION }).toEqual({
      SEARCH_CONTRACT_VERSION: "manual-launch-search-v2",
      APPLY_PACK_CONTRACT_VERSION: "manual-launch-pack-v2",
    });
    expect({ LEGACY_SEARCH_CONTRACT_VERSION, LEGACY_APPLY_PACK_CONTRACT_VERSION }).toEqual({
      LEGACY_SEARCH_CONTRACT_VERSION: "chunk4-v1",
      LEGACY_APPLY_PACK_CONTRACT_VERSION: "chunk5-v1",
    });
    expect(source("docs/runbooks/PROVIDER_SETUP.md")).toContain(
      "Tailored Resume + Cover Letter at 799 cents",
    );
    expect(source("docs/launch/PROVIDER_EVIDENCE_CHECKLIST.md")).toContain(
      "Product Tailored Resume + Cover Letter, one-time USD price 799 cents",
    );
  });

  it("keeps every new subscription-board checkout path hard disabled and unadvertised", () => {
    const boardCheckout = source("src/app/api/checkout/job-board/route.ts");
    const boardMaterials = source("src/app/api/checkout/board-materials/[id]/route.ts");
    const boardPage = source("src/app/job-board/page.tsx");
    const customerBoardPage = source("src/app/my-applypack/job-board/page.tsx");
    const customerBoardDetailPage = source("src/app/my-applypack/job-board/[id]/page.tsx");
    const retiredCustomerApis = [
      source("src/app/api/customer/job-board/route.ts"),
      source("src/app/api/customer/job-board/[id]/route.ts"),
      source("src/app/api/customer/job-board/[id]/apply-link/route.ts"),
    ];
    const legacyBilling = source("src/app/api/customer/billing/portal/route.ts");
    const site = source("src/config/site.ts");
    const sitemap = source("src/app/sitemap.ts");
    const header = source("src/components/layout/site-header.tsx");
    const footer = source("src/components/layout/site-footer.tsx");
    const health = source("src/app/api/health/route.ts");
    const readiness = source("src/lib/operations/launch-readiness.ts");
    expect(boardCheckout).toContain("status: 410");
    expect(boardCheckout).not.toContain("createStripe");
    expect(boardMaterials).toContain("boardOriginCheckoutIsDisabled");
    expect(boardMaterials).toContain("status: 410");
    expect(boardPage).toContain("notFound()");
    expect(boardPage).toContain("index: false");
    for (const privatePage of [customerBoardPage, customerBoardDetailPage]) {
      expect(privatePage).toContain("notFound();");
      expect(privatePage).toContain("requireLegacyBoardArchiveAccess");
      expect(privatePage).toContain("ap_legacy_board_archive_entries");
      expect(privatePage).not.toMatch(/ap_board_admissions|ApplyLinkButton|source_job_url|process\.env/);
    }
    for (const route of retiredCustomerApis) {
      expect(route).toContain("status: 410");
      expect(route).toContain('"cache-control": "no-store, max-age=0"');
      expect(route).not.toMatch(/requireBoardAccess|createSupabase|createStripe|ap_board_subscriptions|process\.env/);
    }
    expect(legacyBilling).toContain("requireLegacyBoardArchiveAccess");
    expect(legacyBilling).toContain("createStripeOperationalClient");
    expect(legacyBilling).toContain("status: 410");
    expect(legacyBilling).not.toMatch(/checkout\.sessions|subscriptions\.create/);
    for (const publicSurface of [site, sitemap, header, footer]) {
      expect(publicSurface).not.toContain("/job-board");
    }
    expect(health).not.toMatch(/STRIPE_JOB_BOARD|ap_board_subscriptions|boardSubscriptions/);
    expect(readiness).not.toMatch(/STRIPE_JOB_BOARD|ap_board_subscriptions|boardSubscriptions/);
    expect(readiness).toContain("legacy_subscription_retirement_reference");
  });

  it("binds search checkout to a short-lived operator invitation", () => {
    const search = source("src/app/api/checkout/search/route.ts");
    const issue = source("src/app/api/admin/search-checkout-invitations/route.ts");
    expect(search).toContain("invitationId: z.uuid()");
    expect(search).toContain("invitationSecret");
    expect(search).toContain('rpc("ap_begin_authorized_search_checkout"');
    expect(search).toContain("contract_version: SEARCH_CONTRACT_VERSION");
    expect(issue).toContain('rpc("ap_issue_search_checkout_invitation"');
    expect(issue).toContain(".max(30)");
    expect(issue).toContain("expiresInMinutes * 60_000");
    expect(issue).toContain("url.hash");
    expect(issue).not.toContain("url.searchParams.set");
    const wizard = source("src/app/get-started/wizard-v3.tsx");
    expect(wizard).toContain("window.location.hash");
    expect(wizard).toContain("window.history.replaceState");
  });

  it("carries the exact paid file version into an authenticated download", () => {
    const portal = source("src/lib/materials/portal.ts");
    const deliveries = source("src/components/portal/material-deliveries.tsx");
    const download = source("src/app/api/customer/artifacts/[id]/download/route.ts");
    expect(portal).toContain("fileVersionId: current.id");
    expect(deliveries).toContain("fileVersionId=${encodeURIComponent(artifact.fileVersionId)}");
    expect(download).toContain("p_file_version_id: fileVersionId.data");
    expect(download).toContain('rpc("ap_authorize_material_download"');
    expect(download).toContain("isSupportedDocumentGeneratorVersion");
    expect(portal).toContain("isSupportedDocumentGeneratorVersion");
    expect(source("src/lib/materials/admin.ts")).toContain("isSupportedDocumentGeneratorVersion");
    expect(source("src/lib/materials/admin.ts")).toContain("currentStandard: isCurrentDocumentGeneratorVersion");
    expect(source("src/components/admin/chunk5-material-staff-queue.tsx")).toContain("Historical document: access only.");
    expect(source("src/components/admin/chunk5-material-staff-queue.tsx")).toContain("!file.currentStandard");
    expect(source("src/components/admin/chunk5-material-staff-queue.tsx")).toContain('file.referenceRegenerationId === line.regeneration!.id');
    expect(source("src/components/admin/chunk5-material-staff-queue.tsx")).toContain('!currentRegenerationFilesOnly || line.regeneration.state !== "HUMAN_REVIEW"');
    expect(source("src/app/api/admin/material-files/[id]/render-preview/route.ts")).toContain("supportedDocumentFontFamily");
    const releaseActions = source("src/app/api/admin/material-lines/[id]/route.ts");
    expect(releaseActions).toContain("isCurrentDocumentGeneratorVersion");
    expect(releaseActions).not.toContain("isSupportedDocumentGeneratorVersion");
  });

  it("separates healthy infrastructure from accepting orders and excludes dormant board commerce", () => {
    const health = source("src/app/api/health/route.ts");
    const readiness = source("src/lib/operations/launch-readiness.ts");
    const rendererReadiness = source("src/lib/operations/renderer-readiness.ts");
    const railway = JSON.parse(source("railway.json")) as { deploy?: { healthcheckPath?: string } };
    expect(health).toContain("commerceConfigured: infrastructure.commerceConfigured");
    expect(health).toContain("manualLaunchCheckoutGate(admin, infrastructure)");
    expect(health).not.toContain("STRIPE_JOB_BOARD");
    expect(health).not.toContain("boardSubscriptions");
    expect(readiness).toContain("currentLegalContentBinding");
    expect(readiness).toContain("checks.legalContent");
    expect(readiness).toContain("legal_acceptance_copy_sha256");
    expect(readiness).toContain('rpc("ap_manual_launch_schema_readiness")');
    expect(readiness).toContain("launchSchemaReadinessIsCurrent(schemaReadiness)");
    expect(readiness.match(/!infrastructure\.ready/g)).toHaveLength(2);
    expect(health).toContain("{ status: infrastructure.ready ? 200 : 503");
    expect(source("src/app/api/live/route.ts")).toContain('status: "ok"');
    expect(rendererReadiness).toContain('APP_RENDERER_RUNTIME_DISCOVERY_FAILED === "true"');
    expect(railway.deploy?.healthcheckPath).toBe("/api/live");
    const maintenance = source("src/app/api/cron/maintenance/route.ts");
    expect(maintenance).toContain('APP_LEGACY_BOARD_MAINTENANCE_ENABLED === "true"');
    expect(maintenance).toContain('rpc("ap_ensure_manual_launch_capacity_rollover")');
    expect(maintenance).toContain('"CAPACITY_ROLLOVER"');
    expect(source(".env.example")).toContain("APP_LEGACY_BOARD_MAINTENANCE_ENABLED=false");
  });

  it("fails launch readiness closed unless the exact runtime schema floor is active", () => {
    expect(launchSchemaReadinessIsCurrent(null)).toBe(false);
    expect(launchSchemaReadinessIsCurrent({
      ready: true,
      requiredSchemaVersion: "202610040078",
      requiredMigrations: ["202610040077", "202610040078"],
    })).toBe(false);
    expect(launchSchemaReadinessIsCurrent({
      ready: true,
      requiredSchemaVersion: REQUIRED_LAUNCH_SCHEMA_VERSION,
      requiredMigrations: [...REQUIRED_LAUNCH_MIGRATIONS],
    })).toBe(true);
    for (const missing of REQUIRED_LAUNCH_MIGRATIONS) {
      expect(launchSchemaReadinessIsCurrent({
        ready: true,
        requiredSchemaVersion: REQUIRED_LAUNCH_SCHEMA_VERSION,
        requiredMigrations: REQUIRED_LAUNCH_MIGRATIONS.filter((version) => version !== missing),
      })).toBe(false);
    }

    const priorMigration = source("supabase/migrations/202610040079_runtime_launch_schema_readiness.sql");
    const migration = source("supabase/migrations/202610040080_persistent_inventory_identity_guard.sql");
    expect(priorMigration).toContain("lock table public.ap_inventory_members in share row exclusive mode");
    expect(migration).toContain("lock table public.ap_inventory_members in access exclusive mode");
    expect(migration).toContain("create trigger ap_guard_inventory_member_identity");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("live_inventory as");
    expect(migration).toContain("selected_inventory_identity_conflict_requires_successor_inventory");
    expect(migration).toContain("public.ap_manual_launch_schema_readiness()");
    expect(migration).toContain("PERSISTENT_INVENTORY_IDENTITY_GUARD");
    const preflight = source("scripts/preflight-inventory-identity-conflicts.sql");
    expect(preflight).toContain("begin transaction isolation level repeatable read read only");
    expect(preflight).toContain("left_member.stable_normalized_job_id=right_member.stable_normalized_job_id");
    expect(preflight).toContain("left_job.external_job_id=right_job.external_job_id");
    expect(preflight).toContain("left_job.canonical_employer_domain is not distinct from right_job.canonical_employer_domain");
    expect(preflight).toContain("array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)");
    expect(preflight).toContain("array_remove(array[right_job.canonical_employer_listing_url,right_job.canonical_application_url],null)");
    expect(preflight).toContain("left_job.normalized_fingerprint=right_job.normalized_fingerprint");
    expect(preflight).toContain("INVENTORY_IDENTITY_PREFLIGHT_CONFLICT");
    expect(preflight).toContain("INVENTORY_IDENTITY_PREFLIGHT_CLEAN");
    const preflightRunner = source("scripts/check-inventory-identity-conflicts.mjs");
    expect(preflightRunner).toContain("AP_PREMIGRATION_DATABASE_URL");
    expect(preflightRunner).toContain("AP_PREMIGRATION_EXPECTED_HOST");
    expect(preflightRunner).toContain("AP_PREMIGRATION_EXPECTED_PORT");
    expect(preflightRunner).toContain("AP_PREMIGRATION_EXPECTED_DATABASE");
    expect(preflightRunner).toContain("AP_PREMIGRATION_EXPECTED_LOGIN_USER");
    expect(preflightRunner).toContain("AP_PREMIGRATION_EXPECTED_CURRENT_USER");
    expect(preflightRunner).toContain("AP_DEPLOYMENT_ENV");
    expect(preflightRunner).toContain("current_user='${connection.expectedCurrentUser}'");
    expect(preflightRunner).not.toContain("current_user='${connection.expectedLoginUser}'");
    expect(preflightRunner).toContain("pg_catalog.pg_stat_ssl");
    expect(preflightRunner).toContain("INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_ATTESTED");
    expect(preflightRunner).toContain("[REDACTED_DATABASE_CREDENTIAL]");
    expect(preflightRunner).toContain('process.argv.length !== 3');
    const manualLaunchRunbook = source("docs/runbooks/MANUAL_LAUNCH_RELEASE.md");
    expect(manualLaunchRunbook).toContain(
      "currently authorized hosted-staging scope is migrations 081 through 084 only",
    );
    expect(manualLaunchRunbook).toContain(
      "Migrations 077 through 080 are a required, already-applied predecessor state",
    );
    expect(manualLaunchRunbook).toContain(
      "exact ledger versions, names, statement counts, and reviewed statement-array digests",
    );
    expect(manualLaunchRunbook).toContain(
      "reads only `ApplyPack/Supabase/Staging/Database` from Windows Credential Manager",
    );
    expect(manualLaunchRunbook).toContain("proves `verify-full` TLS");
    expect(manualLaunchRunbook).toContain("do not set or construct a database URI");
    expect(manualLaunchRunbook).toContain("`AP_DEPLOYMENT_ENV=production`");
    expect(manualLaunchRunbook).toContain(
      "either checkout flag other than exact lowercase `false`",
    );
    expect(manualLaunchRunbook).toContain(
      "`STAGING_DATABASE_ADVANCEMENT_REQUIRES_INSPECTION`",
    );
    expect(manualLaunchRunbook).toContain("read-only observed-state inspection");
    expect(manualLaunchRunbook).toContain("state-specific forward-only recovery");
    const upgradeTest = source("scripts/run-supabase-inventory-upgrade-test.mjs");
    expect(upgradeTest).toContain("INVENTORY_IDENTITY_PREFLIGHT_CLEAN");
    expect(upgradeTest).toContain("INVENTORY_IDENTITY_PREFLIGHT_CONFLICT");
    expect(upgradeTest).toContain("CUTOVER_PRECHECK_READY");
    expect(upgradeTest).toContain("CUTOVER_ACCESS_EXCLUSIVE_WAITING");
    expect(upgradeTest).toContain("mode='AccessExclusiveLock' and not granted");
    expect(upgradeTest).toContain("MIGRATION_077_CONFLICT_ROLLBACK_OK");
    expect(upgradeTest).toContain("MIGRATION_080_RACE_ROLLBACK_OK");
    expect(upgradeTest).toContain("duplicate_inventory_job");
  });

  it("strictly canonicalizes only the authorized remote inventory preflight target", () => {
    const password = "p@ss:word";
    const encodedPassword = "p%40ss%3Aword";
    const stagingProjectRef = "fmugizadzdnqfckujqlw";
    const poolerHost = "aws-0-us-west-2.pooler.supabase.com";
    expect(PREFLIGHT_DEPLOYMENT_PROJECT_REFS).toEqual({ staging: stagingProjectRef });
    const expectedTarget = {
      deploymentEnvironment: "staging",
      expectedHost: poolerHost,
      expectedPort: "5432",
      expectedDatabase: "postgres",
      expectedLoginUser: `postgres.${stagingProjectRef}`,
      expectedCurrentUser: "postgres",
    };
    expect(validateAndCanonicalizePreflightConnection({
      uri: `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@AWS-0-US-WEST-2.POOLER.SUPABASE.COM:5432/postgres?sslmode=VERIFY-FULL`,
      ...expectedTarget,
    })).toEqual({
      canonicalUri: `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full`,
      password: encodedPassword,
      decodedPassword: password,
      expectedProjectRef: stagingProjectRef,
      endpointType: "session-pooler",
      ...expectedTarget,
    });

    const directTarget = {
      deploymentEnvironment: "staging",
      expectedHost: `db.${stagingProjectRef}.supabase.co`,
      expectedPort: "5432",
      expectedDatabase: "postgres",
      expectedLoginUser: "postgres",
      expectedCurrentUser: "postgres",
    };
    expect(validateAndCanonicalizePreflightConnection({
      uri: `postgresql://postgres:${encodedPassword}@db.${stagingProjectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
      ...directTarget,
    })).toEqual({
      canonicalUri: `postgresql://postgres:${encodedPassword}@db.${stagingProjectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
      password: encodedPassword,
      decodedPassword: password,
      expectedProjectRef: stagingProjectRef,
      endpointType: "direct",
      ...directTarget,
    });

    const weakUrls = [
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=disable`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=allow`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=prefer`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=require`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-ca`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full&sslmode=disable`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?host=%2Fvar%2Frun%2Fpostgresql&sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?hostaddr=127.0.0.1&sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?service=wrong-target&sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?servicefile=wrong-target&sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?gssencmode=prefer&sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslrootcert=system&sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@%2Fvar%2Frun%2Fpostgresql:5432/postgres?sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost},other.example.test:5432/postgres?sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@other.example.test:5432/postgres?sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:6543/postgres?sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/wrong_database?sslmode=verify-full`,
      `postgresql://wrong_user:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}@${poolerHost}:5432/postgres?sslmode=verify-full`,
      `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full#ignored`,
    ];
    for (const databaseUrl of weakUrls) {
      expect(() => validateAndCanonicalizePreflightConnection({ uri: databaseUrl, ...expectedTarget }))
        .toThrow("expected host, port, database, and login user");
    }

    for (const badExpectedTarget of [
      { ...expectedTarget, expectedHost: "localhost" },
      { ...expectedTarget, expectedHost: "127.0.0.1" },
      { ...expectedTarget, expectedPort: "0" },
      { ...expectedTarget, expectedPort: "65536" },
      { ...expectedTarget, expectedDatabase: "postgres/other" },
      { ...expectedTarget, expectedLoginUser: "operator other" },
      { ...expectedTarget, expectedCurrentUser: "operator other" },
    ]) {
      expect(() => validateAndCanonicalizePreflightConnection({
        uri: `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full`,
        ...badExpectedTarget,
      })).toThrow("expected-target identifiers");
    }

    const wrongProjectRef = "aaaaaaaaaaaaaaaaaaaa";
    expect(() => validateAndCanonicalizePreflightConnection({
      ...expectedTarget,
      expectedLoginUser: `postgres.${wrongProjectRef}`,
      uri: `postgresql://postgres.${wrongProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full`,
    })).toThrow("checked-in deployment project binding");
    expect(() => validateAndCanonicalizePreflightConnection({
      ...directTarget,
      expectedHost: `db.${wrongProjectRef}.supabase.co`,
      uri: `postgresql://postgres:${encodedPassword}@db.${wrongProjectRef}.supabase.co:5432/postgres?sslmode=verify-full`,
    })).toThrow("checked-in deployment project binding");
    expect(() => validateAndCanonicalizePreflightConnection({
      ...expectedTarget,
      deploymentEnvironment: "production",
      uri: `postgresql://postgres.${stagingProjectRef}:${encodedPassword}@${poolerHost}:5432/postgres?sslmode=verify-full`,
    })).toThrow("checked-in deployment project binding");
  });

  it("removes remote-preflight secrets from a Windows-style mixed-case environment", () => {
    expect(environmentWithoutPreflightSecrets({
      Path: "C:\\Windows\\System32",
      SAFE_VALUE: "preserved",
      AP_DEPLOYMENT_ENV: "staging",
      AP_PREMIGRATION_DATABASE_URL: "secret-one",
      Ap_PrEmIgRaTiOn_Expected_Host: "secret-two",
      ap_premigration_expected_login_user: "secret-three",
      AP_PREMIGRATION_EXPECTED_CURRENT_USER: "secret-four",
    })).toEqual({
      Path: "C:\\Windows\\System32",
      SAFE_VALUE: "preserved",
      AP_DEPLOYMENT_ENV: "staging",
    });
  });

  it("rejects a representative wrapper query override without printing credentials", () => {
    const password = "preflight-super-secret";
    const projectRef = "fmugizadzdnqfckujqlw";
    const poolerHost = "aws-0-us-west-2.pooler.supabase.com";
    const databaseUrl = `postgresql://postgres.${projectRef}:${password}@${poolerHost}:5432/postgres?host=%2Fvar%2Frun%2Fpostgresql&sslmode=verify-full`;
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/check-inventory-identity-conflicts.mjs"), "--remote"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          AP_DEPLOYMENT_ENV: "staging",
          AP_PREMIGRATION_DATABASE_URL: databaseUrl,
          AP_PREMIGRATION_EXPECTED_HOST: poolerHost,
          AP_PREMIGRATION_EXPECTED_PORT: "5432",
          AP_PREMIGRATION_EXPECTED_DATABASE: "postgres",
          AP_PREMIGRATION_EXPECTED_LOGIN_USER: `postgres.${projectRef}`,
          AP_PREMIGRATION_EXPECTED_CURRENT_USER: "postgres",
        },
      },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    expect(result.status).toBe(2);
    expect(output).toContain("expected host, port, database, and login user");
    expect(output).not.toContain(databaseUrl);
    expect(output).not.toContain(password);
  });

  it("executes the bound staging pooler preflight with verify-full through a scrubbed psql spawn", () => {
    const projectRef = "fmugizadzdnqfckujqlw";
    const password = "fake-spawn-password";
    const poolerHost = "aws-0-us-west-2.pooler.supabase.com";
    let spawnCount = 0;
    const result = runInventoryIdentityPreflight({
      mode: "--remote",
      environment: {
        ...process.env,
        AP_DEPLOYMENT_ENV: "staging",
        AP_PREMIGRATION_DATABASE_URL: `postgresql://postgres.${projectRef}:${password}@${poolerHost}:5432/postgres?sslmode=verify-full`,
        AP_PREMIGRATION_EXPECTED_HOST: poolerHost,
        AP_PREMIGRATION_EXPECTED_PORT: "5432",
        AP_PREMIGRATION_EXPECTED_DATABASE: "postgres",
        AP_PREMIGRATION_EXPECTED_LOGIN_USER: `postgres.${projectRef}`,
        AP_PREMIGRATION_EXPECTED_CURRENT_USER: "postgres",
      },
      spawn: ((command: string, args: string[], options: { input: string; env: Record<string, string> }) => {
        spawnCount += 1;
        expect(command).toBe("docker");
        expect(args).toEqual(["exec", "-i", "supabase_db_applypack", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
        expect(options.input).toContain(`\\connect 'postgresql://postgres.${projectRef}:${password}@${poolerHost}:5432/postgres?sslmode=verify-full'`);
        expect(options.input).toContain("pg_catalog.pg_stat_ssl");
        expect(options.input).toContain("current_user='postgres'");
        expect(options.env.AP_DEPLOYMENT_ENV).toBe("staging");
        expect(Object.keys(options.env).some((key) => key.startsWith("AP_PREMIGRATION_"))).toBe(false);
        return {
          status: 0,
          stdout: "INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_ATTESTED\nINVENTORY_IDENTITY_PREFLIGHT_CLEAN\n",
          stderr: "",
        };
      }) as typeof spawnSync,
    });
    expect(spawnCount).toBe(1);
    expect(result).toEqual({
      status: 0,
      stdout: "INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_ATTESTED\nINVENTORY_IDENTITY_PREFLIGHT_CLEAN\n",
      stderr: "",
    });
  });

  it("fails the executable psql attestation for a wrong server current_user", () => {
    const projectRef = "fmugizadzdnqfckujqlw";
    const poolerHost = "aws-0-us-west-2.pooler.supabase.com";
    const result = runInventoryIdentityPreflight({
      mode: "--remote",
      environment: {
        ...process.env,
        AP_DEPLOYMENT_ENV: "staging",
        AP_PREMIGRATION_DATABASE_URL: `postgresql://postgres.${projectRef}:fake-password@${poolerHost}:5432/postgres?sslmode=verify-full`,
        AP_PREMIGRATION_EXPECTED_HOST: poolerHost,
        AP_PREMIGRATION_EXPECTED_PORT: "5432",
        AP_PREMIGRATION_EXPECTED_DATABASE: "postgres",
        AP_PREMIGRATION_EXPECTED_LOGIN_USER: `postgres.${projectRef}`,
        AP_PREMIGRATION_EXPECTED_CURRENT_USER: "postgres",
      },
      spawn: ((_command: string, _args: string[], options: { input: string }) => {
        expect(options.input).toContain("current_user='postgres'");
        const actualServerCurrentUser = "wrong_server_role";
        const attested = options.input.includes(`current_user='${actualServerCurrentUser}'`);
        return {
          status: attested ? 0 : 1,
          stdout: attested
            ? "INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_ATTESTED\n"
            : "INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_REJECTED\n",
          stderr: "",
        };
      }) as typeof spawnSync,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_REJECTED");
    expect(result.stdout).not.toContain("INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_ATTESTED");
  });

  it("rejects matched wrong-project pooler inputs before spawning psql", () => {
    const wrongProjectRef = "aaaaaaaaaaaaaaaaaaaa";
    const poolerHost = "aws-0-us-west-2.pooler.supabase.com";
    let spawned = false;
    const result = runInventoryIdentityPreflight({
      mode: "--remote",
      environment: {
        ...process.env,
        AP_DEPLOYMENT_ENV: "staging",
        AP_PREMIGRATION_DATABASE_URL: `postgresql://postgres.${wrongProjectRef}:fake-password@${poolerHost}:5432/postgres?sslmode=verify-full`,
        AP_PREMIGRATION_EXPECTED_HOST: poolerHost,
        AP_PREMIGRATION_EXPECTED_PORT: "5432",
        AP_PREMIGRATION_EXPECTED_DATABASE: "postgres",
        AP_PREMIGRATION_EXPECTED_LOGIN_USER: `postgres.${wrongProjectRef}`,
        AP_PREMIGRATION_EXPECTED_CURRENT_USER: "postgres",
      },
      spawn: () => {
        spawned = true;
        throw new Error("psql must not run for an unbound project");
      },
    });
    expect(spawned).toBe(false);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("checked-in deployment project binding");
  });

  it("runs real document-render CI on pinned Windows Liberation Sans through the strict harness", () => {
    const workflow = source(".github/workflows/ci.yml");
    const documentRender = workflow.match(/(?:^|\r?\n)  document-render:\r?\n([\s\S]*)/)?.[1];
    if (!documentRender) throw new Error("document-render job missing");
    expect(documentRender).toContain("runs-on: windows-latest");
    expect(documentRender).toContain("APPLYPACK_LIBREOFFICE_PACKAGE_VERSION: '26.2.6'");
    expect(documentRender).toContain("APPLYPACK_POPPLER_PACKAGE_VERSION: '26.9.0'");
    expect(documentRender).toContain("choco install libreoffice-fresh --version=$env:APPLYPACK_LIBREOFFICE_PACKAGE_VERSION");
    expect(documentRender).toContain("choco install poppler --version=$env:APPLYPACK_POPPLER_PACKAGE_VERSION");
    expect(documentRender).toContain("choco install liberationfonts --version=$env:APPLYPACK_LIBERATION_FONTS_PACKAGE_VERSION");
    expect(documentRender).toContain("APP_DOCUMENT_RENDERER_IDENTITY: 'applypack-windows-ci-");
    const [jobConfiguration, renderAndUpload] = documentRender.split("      - name: Render actual DOCX files and verify PDF outputs");
    expect(jobConfiguration).not.toContain("APPLYPACK_RENDER_EVIDENCE_DIR");
    expect(renderAndUpload).toContain("APPLYPACK_RENDER_EVIDENCE_DIR: ${{ runner.temp }}\\applypack-chunk5-render-ci");
    expect(documentRender).toContain("run: .\\scripts\\test-document-render-windows.ps1");
    expect(documentRender).toContain("path: ${{ runner.temp }}\\applypack-chunk5-render-ci");
    expect(documentRender).not.toContain("apt-get");
    expect(documentRender).not.toContain("configure-renderer-runtime");
    const windowsHarness = source("scripts/test-document-render-windows.ps1");
    expect(windowsHarness).toContain("LiberationSans-Regular.ttf");
    expect(windowsHarness).toContain("LiberationSans-Bold.ttf");
    expect(windowsHarness).toContain("LiberationSans-Italic.ttf");
    expect(windowsHarness).toContain("LiberationSans-BoldItalic.ttf");
    expect(windowsHarness).toContain("d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb");
    expect(windowsHarness).toContain("A complete same-directory Poppler toolset is required.");
    expect(windowsHarness).toContain("APPLYPACK_EXPECTED_LIBREOFFICE_VERSION");
    expect(windowsHarness).toContain("APPLYPACK_EXPECTED_POPPLER_VERSION");
    expect(windowsHarness).toContain("npm.cmd run test:document-render -- --reporter=verbose");
  });

  it("finalizes encrypted intake and current legal acceptance through one retry-safe atomic command", () => {
    const finalize = source("src/app/api/intake/anonymous-draft/finalize/route.ts");
    const wizard = source("src/app/get-started/wizard-v3.tsx");
    const migration = source("supabase/migrations/202610030064_atomic_sensitive_intake_finalization.sql");
    const legalContentMigration = source("supabase/migrations/202610040073_immutable_legal_content_receipts.sql");
    const legalRollbackCompatibility = source("supabase/migrations/202610040074_legal_receipt_rollback_compatibility.sql");
    const appendOnlyLegalEpisodes = source("supabase/migrations/202610040075_append_only_legal_acceptance_episodes.sql");
    const reconciledLegalEpisodes = source("supabase/migrations/202610040076_reconcile_legacy_legal_acceptance_episodes.sql");
    const rollbackCompatibility = source("supabase/migrations/202610030065_preserve_intake_rollback_compatibility.sql");
    expect(finalize).toContain('rpc("ap_finalize_four_step_intake_with_legal_acceptance_v3"');
    expect(finalize).toContain("currentLegalContentBinding");
    expect(finalize).toContain("LEGAL_CONTENT_CONFIGURATION_MISMATCH");
    expect(finalize).not.toContain('rpc("ap_record_snapshot_legal_acceptance"');
    expect(finalize).not.toContain('from("ap_sensitive_payloads").insert');
    expect(finalize).not.toContain("randomUUID");
    expect(finalize).toContain('deterministicUuid(`intake-snapshot:${finalizationKey}`)');
    expect(finalize).toContain('deterministicUuid(`intake-sensitive:${finalizationKey}`)');
    expect(wizard).toContain("pendingFinalization.current");
    expect(wizard).toContain("body: JSON.stringify(command)");
    expect(migration).toContain("public.ap_finalize_four_step_intake(");
    expect(migration).toContain("public.ap_record_snapshot_legal_acceptance(");
    expect(migration).toContain("insert into public.ap_sensitive_payloads(");
    expect(migration).toContain("join public.ap_snapshot_legal_acceptances acceptance");
    expect(migration).toContain("revoke all on function public.ap_finalize_four_step_intake(");
    expect(migration).toContain("revoke all on function public.ap_record_snapshot_legal_acceptance(");
    expect(legalContentMigration).toContain("public.ap_snapshot_legal_content_receipts");
    expect(legalContentMigration).toContain("public.ap_finalize_four_step_intake_with_legal_acceptance_v3");
    expect(legalContentMigration).toContain("public.ap_has_current_content_bound_legal_acceptance");
    expect(legalContentMigration).toContain("ap_snapshot_legal_content_receipts_immutable");
    expect(legalRollbackCompatibility).toContain("public.ap_finalize_four_step_intake_with_legal_acceptance_v3(");
    expect(legalRollbackCompatibility).toContain("public.ap_upgrade_completed_intake_legal_acceptance");
    expect(legalRollbackCompatibility).toContain("Completed or checkout-locked drafts created by a rolling v2 process are not silently");
    expect(legalRollbackCompatibility).toContain("draft.state in ('COMPLETE','LOCKED_TO_CHECKOUT')");
    expect(appendOnlyLegalEpisodes).toContain("public.ap_upgrade_completed_intake_legal_acceptance");
    expect(appendOnlyLegalEpisodes).toContain("public.ap_record_snapshot_legal_acceptance");
    expect(reconciledLegalEpisodes).toContain("LEGACY_LEGAL_ACCEPTANCE_EPISODE_RECONCILIATION");
    expect(source("src/app/api/intake/anonymous-draft/legal-acceptance/route.ts"))
      .toContain('rpc("ap_upgrade_completed_intake_legal_acceptance"');
    expect(wizard).toContain("Confirm current Terms");
    expect(rollbackCompatibility).toContain("from public,anon,authenticated");
    expect(rollbackCompatibility).toContain("to service_role");
    expect(rollbackCompatibility).toContain("INTAKE_ROLLBACK_COMPATIBILITY");
  });

  it("forces production envelope encryption through AWS KMS and probes the isolated renderer", () => {
    const kms = source("src/lib/security/remote-kms.ts");
    const worker = source("src/lib/files/aws-document-worker.ts");
    const readiness = source("src/lib/operations/renderer-readiness.ts");
    const launchReadiness = source("src/lib/operations/launch-readiness.ts");
    const workerTemplate = source("infra/aws/document-worker/template.yaml");
    const deploymentRoleTemplate = source("infra/aws/document-worker/deployment-role-template.yaml");
    const workerImage = source("infra/aws/document-worker/Dockerfile");
    const renderer = source("src/lib/documents/renderer.ts");
    const extraction = source("src/lib/files/isolated-extraction.ts");
    const materialsCheckout = source("src/app/api/checkout/apply-packs/route.ts");
    const boardMaterialsCheckout = source("src/app/api/checkout/board-materials/[id]/route.ts");
    const preflight = source("scripts/aws-document-worker-preflight.mjs");
    const syntheticProbe = source("scripts/aws-document-worker-synthetic-probe.mjs");
    const syntheticProbeFixtures = source("scripts/test-aws-document-worker-synthetic-probe.mjs");
    const workerRunbook = source("docs/runbooks/AWS_DOCUMENT_WORKER.md");
    const documentRequirements = source("src/lib/documents/requirements.ts");
    const documentPolicy = source("supabase/migrations/202610030066_locked_document_generation_standard.sql");
    const documentCompatibility = source("supabase/migrations/202610030067_document_source_and_rollback_compatibility.sql");
    const accessOnlyCompatibility = source("supabase/migrations/202610030068_historical_document_access_only.sql");
    const durableDocumentAccess = source("supabase/migrations/202610030069_durable_delivered_document_access.sql");
    const sensitiveUploadCleanup = source("supabase/migrations/202610030070_all_sensitive_upload_cleanup_intents.sql");
    const rollbackCheck = source("scripts/run-supabase-rollback-test.mjs") + source("scripts/lib/supabase-structural-recovery.mjs");
    const rollbackRunbook = source("docs/runbooks/MANUAL_LAUNCH_RELEASE.md");
    expect(kms).toContain('environment.APP_DEPLOYMENT_ENV === "production"');
    expect(kms).toContain('environment.APP_KMS_PROVIDER !== "aws"');
    expect(worker).toContain('region === "us-east-1"');
    expect(worker).toContain("VERSION_ARN");
    expect(worker).toContain("APP_DOCUMENT_WORKER_IMAGE_DIGEST");
    expect(worker).toContain("APP_DOCUMENT_WORKER_PREFLIGHT_RECEIPT_SHA256");
    expect(worker).toContain("APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256");
    expect(worker).toContain("workerResponseAttestationMatches");
    expect(worker).toContain("hasWorkerConfiguration && !hostedEnvironment");
    expect(worker).toContain('environment.NODE_ENV === "development" || environment.NODE_ENV === "test"');
    expect(worker).toContain('InvocationType: "RequestResponse"');
    expect(worker).toContain('LogType: "None"');
    expect(worker).toContain("probe-document");
    expect(worker).toContain("docxExtractionVerified");
    expect(worker).toContain("renderedTextVerified");
    expect(worker).toContain('operation: "render-docx"');
    expect(worker).toContain("pdfTextBoundsAreValid");
    expect(readiness).toContain("probeDocumentWorker");
    expect(launchReadiness).toContain('rpc("ap_manual_launch_capacity_readiness")');
    expect(launchReadiness).toContain('from("storage_cleanup_queue")');
    expect(launchReadiness).toContain('.gte("attempts", 20)');
    expect(launchReadiness).toContain('from("ap_manual_launch_activations")');
    expect(launchReadiness).toContain("capacityAvailable");
    expect(launchReadiness).toContain("capacityByResource");
    expect(launchReadiness).toContain("legacy_subscription_retirement_reference");
    expect(source("src/app/api/checkout/search/route.ts")).toContain('authorizeCheckout(context.admin, "SEARCH"');
    expect(source("src/app/api/checkout/apply-packs/route.ts")).toContain('authorizeCheckout(admin, "MATERIALS"');
    expect(source("src/lib/commerce/checkout-authorization.ts")).toContain('manualLaunchCheckoutGate(admin, infrastructure, product, true)');
    const generation = source("src/app/api/admin/material-lines/[id]/generate/route.ts");
    const applicantFormatRequest = source("src/app/api/admin/material-lines/[id]/delivery-format-request/route.ts");
    expect(generation).toContain("renderDocumentForQa");
    for (const remoteSurface of [renderer, extraction, readiness, generation, materialsCheckout, boardMaterialsCheckout]) {
      expect(remoteSurface).toContain("documentWorkerExecutionMode");
    }
    expect(generation).not.toContain("renderDocumentLocallyForQa");
    expect(generation).toContain('storageBucket: "operator-drafts"');
    expect(generation).toContain("editableSourcePath");
    expect(generation).toContain("p_claim_provenance: {");
    expect(generation).toContain("...input.artifact.provenance");
    expect(generation).toContain("documentFontAttestation: {");
    expect(generation).toContain("manifestSha256: render.documentFontManifestSha256");
    expect(generation).toContain("styleSha256: render.documentFontStyleSha256");
    expect(generation).toContain("applicantWordRequested && !allowedFormats.includes(\"DOCX\")");
    expect(generation).toContain("requestReferenceSha256: applicantWordRequested");
    expect(generation).toContain("editableSource");
    expect(generation).toContain("uploadCleanup");
    expect(generation).toContain('admin.from("storage_cleanup_queue").upsert');
    expect(generation).toContain("bucket: upload.storageBucket");
    expect(generation).toContain('reason: "material_sensitive_upload_intent"');
    expect(generation).toContain('storageBucket: "operator-render-previews"');
    expect(generation).toContain('storageBucket: "customer-deliveries"');
    expect(generation).toContain("sensitive_upload_cleanup_intent_failed");
    expect(generation).toContain("sensitive_upload_cleanup_queue_failed");
    const handler = source("infra/aws/document-worker/handler.py");
    expect(handler).toContain('operation == "render-docx"');
    expect(handler).toContain('operation == "probe-document"');
    expect(handler).toContain("_docx_text(data");
    expect(handler).toContain("pdftoppm");
    expect(handler).toContain("network_isolation_verified");
    expect(handler).toContain("functionVersionArn");
    expect(handler).toContain("requested_memory");
    expect(handler).toContain("worker_memory_configuration_bound");
    expect(handler).toContain('ServerSideEncryption="AES256"');
    expect(handler).toContain('"regular": ("Regular", "LIBERATION_SANS_REGULAR_FONT_PATH"');
    expect(handler).toContain('"bold": ("Bold", "LIBERATION_SANS_BOLD_FONT_PATH"');
    expect(handler).toContain('"italic": ("Italic", "LIBERATION_SANS_ITALIC_FONT_PATH"');
    expect(handler).toContain('"boldItalic": ("Bold Italic", "LIBERATION_SANS_BOLD_ITALIC_FONT_PATH"');
    expect(handler).toContain('FONT_MANIFEST_SHA256 = "d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb"');
    expect(workerImage).toContain("LiberationSans-Regular.ttf");
    expect(workerImage).toContain("LiberationSans-Bold.ttf");
    expect(workerImage).toContain("LiberationSans-Italic.ttf");
    expect(workerImage).toContain("LiberationSans-BoldItalic.ttf");
    expect(workerImage).not.toContain("ARIAL_TTF");
    expect(documentRequirements).toContain('family: "Liberation Sans"');
    expect(documentRequirements).toContain('version: "2.1.5"');
    expect(documentRequirements).toContain('manifestSha256: "d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb"');
    expect(applicantFormatRequest).toContain("isSameOriginRequest(request)");
    expect(applicantFormatRequest).toContain('deliveryFormat: z.literal("DOCX")');
    expect(applicantFormatRequest).toContain('rpc("ap_record_applicant_document_format_request"');
    expect(applicantFormatRequest).toContain("requestReferenceSha256");
    expect(workerTemplate).toContain("ec2:DescribeSubnets");
    expect(workerTemplate).toContain("ec2:AssignPrivateIpAddresses");
    expect(workerTemplate).toContain("ec2:UnassignPrivateIpAddresses");
    expect(workerTemplate).toContain("MemorySize: 512");
    expect(workerTemplate).toContain("PrimaryAlertEmail");
    expect(workerTemplate).toContain("SecondaryAlertEmail");
    expect(workerTemplate).toContain('Default: "true"');
    expect(workerTemplate).toContain("DeploymentEnvironment:");
    expect(workerTemplate).toContain("AllowedValues: [staging, production]");
    expect(workerTemplate).toContain("Default: production");
    expect(workerTemplate).toContain('FunctionName: !Sub "applypack-${DeploymentEnvironment}-document-worker"');
    expect(workerTemplate).toContain("APPLYPACK_WORKER_DEPLOYMENT_ENV: !Ref DeploymentEnvironment");
    expect(workerTemplate).toContain("kms:EncryptionContext:deployment: !Ref DeploymentEnvironment");
    expect(workerTemplate).not.toContain("kms:EncryptionContext:deployment: production");
    expect(workerTemplate).toContain("RegionMustBeUsEast1:");
    expect(workerTemplate).toContain("WorkerImageDigest:");
    expect(workerTemplate).not.toContain("  WorkerImageUri:\n    Type: String");
    expect(workerTemplate).toContain("${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/applypack-${DeploymentEnvironment}-document-worker@${WorkerImageDigest}");
    expect(workerTemplate).toContain("PermissionsBoundary: !Ref WorkerRolePermissionsBoundaryArn");
    expect(workerTemplate).toContain("Attach only to the web runtime identity for this DeploymentEnvironment");
    expect(worker).toContain("APP_DOCUMENT_WORKER_DEPLOYMENT_ENV");
    expect(worker).toContain("response.deploymentEnvironment === configuration.workerDeploymentEnvironment");
    expect(handler).toContain('deployment_environment not in ("staging", "production")');
    expect(handler).toContain('"deploymentEnvironment": deployment_environment');
    expect(deploymentRoleTemplate).toContain("PermissionsBoundary: !Ref DeploymentRoleBoundary");
    expect(deploymentRoleTemplate).toContain("iam:PassedToService: lambda.amazonaws.com");
    expect(deploymentRoleTemplate).toContain("iam:PermissionsBoundary: !Ref WorkerRoleBoundary");
    expect(preflight).toContain("describe-managed-prefix-lists");
    expect(preflight).toContain("selected_route_tables_do_not_match_subnets");
    expect(preflight).toContain("route_table_has_non_approved_path");
    expect(preflight).toContain("imageTagMutability");
    expect(preflight).toContain("describe-image-scan-findings");
    expect(preflight).toContain("input.imageTag !== input.sourceCommitSha");
    expect(syntheticProbe).toContain('operation: "extract"');
    expect(syntheticProbe).toContain('operation: "render-docx"');
    expect(syntheticProbe).toContain("kmsCrossEnvironmentDenied");
    expect(syntheticProbe).toContain("expectedCrossEnvironmentKmsDenial");
    expect(syntheticProbe).toContain("AccessDeniedException|InvalidCiphertextException");
    expect(syntheticProbe).toContain("cleanupComplete");
    for (const unsafeFailure of ["UnrecognizedClientException", "Could not connect to the endpoint URL",
      "ThrottlingException", "ValidationException", "SIGTERM"]) {
      expect(syntheticProbeFixtures).toContain(unsafeFailure);
    }
    const orderedWorkerSteps = [
      "## 1. Bootstrap the environment repository and deployment role",
      "## 2. Build and push the exact source image",
      "## 3. Create the provider-backed read-only preflight receipt",
      "## 4. Deploy the main environment stack",
      "## 5. Run the synthetic worker and KMS probe",
      "## 6. Configure only the matching application service",
    ].map((heading) => workerRunbook.indexOf(heading));
    expect(orderedWorkerSteps.every((position, index) => position >= 0 && (index === 0 || position > orderedWorkerSteps[index - 1]))).toBe(true);
    expect(workerRunbook).toContain("Then execute sections 1 through 6 without reordering");
    expect(documentPolicy).toContain("document_font_family='Arial'");
    expect(documentPolicy).toContain("materials_generation_approved=false");
    expect(documentPolicy).toContain("LOCKED_DOCUMENT_GENERATION_STANDARD");
    expect(documentCompatibility).toContain("locked_editable_document_source_required");
    expect(documentCompatibility).toContain("resume_content_exceeds_employer_page_limit");
    expect(documentCompatibility).toContain("DOCUMENT_SOURCE_AND_ROLLBACK_COMPATIBILITY");
    expect(documentCompatibility).toContain("Liberation Sans");
    expect(accessOnlyCompatibility).toContain("ap_assert_supported_artifact_facts");
    expect(accessOnlyCompatibility).toContain("material_download_current_guard_anchor_missing");
    expect(accessOnlyCompatibility).toContain("HISTORICAL_DOCUMENT_ACCESS_ONLY");
    expect(durableDocumentAccess).toContain("DURABLE_DELIVERED_DOCUMENT_ACCESS");
    expect(durableDocumentAccess).toContain("Source freshness is a release-time");
    expect(durableDocumentAccess).toContain("ap_current_source_verifications(artifact.job_snapshot_id)");
    expect(durableDocumentAccess).toContain("not exists(select 1 from public.ap_release_members member");
    expect(durableDocumentAccess).toContain("ap_registered_editable_source_cleanup");
    expect(sensitiveUploadCleanup).toContain("ALL_SENSITIVE_UPLOAD_CLEANUP_INTENTS");
    expect(sensitiveUploadCleanup).toContain("'operator-render-previews'");
    expect(sensitiveUploadCleanup).toContain("claim_provenance->'uploadCleanup'");
    expect(sensitiveUploadCleanup).toContain("ap_invalidate_materials_for_job_content_change");
    expect(sensitiveUploadCleanup).toContain("ap_invalidate_materials_for_job_successor");
    expect(sensitiveUploadCleanup).toContain("not exists(select 1 from public.ap_release_members member");
    expect(rollbackCheck).toContain('minimumCompatibleApplicationRollbackSha = "aeae1dee597e153602febd6adfea5644e4628d20"');
    expect(rollbackCheck).toContain("AP_ROLLBACK_TARGET_SHA");
    expect(rollbackCheck).toContain('"merge-base"');
    expect(rollbackCheck).toContain('"--is-ancestor"');
    expect(rollbackCheck).toContain('storageBucket: "operator-drafts"');
    expect(rollbackCheck).toContain('storageBucket: "operator-render-previews"');
    expect(rollbackCheck).toContain('storageBucket: "customer-deliveries"');
    expect(rollbackCheck).toContain("materialIntentIndex >= materialUploadIndex");
    expect(rollbackCheck).toContain('"anonymous_source_upload_intent"');
    expect(rollbackCheck).toContain('"draft_source_upload_intent"');
    expect(rollbackCheck).toContain('"intake_source_upload_intent"');
    expect(rollbackCheck).toContain("for (const contract of sourceUploadContracts)");
    expect(rollbackCheck).toContain("intentIndex >= uploadIndex");
    expect(rollbackCheck).toContain("exact approved legal content");
    expect(rollbackCheck).toContain("ap_upgrade_completed_intake_legal_acceptance");
    expect(rollbackCheck).toContain('REQUIRED_LAUNCH_SCHEMA_VERSION = "202610250099"');
    expect(rollbackCheck).toContain('admin.rpc("ap_manual_launch_schema_readiness")');
    expect(rollbackCheck).toContain("launchSchemaReadinessIsCurrent(schemaReadiness)");
    expect(rollbackRunbook).toContain("minimum compatible application rollback commit is `aeae1dee597e153602febd6adfea5644e4628d20`");
    expect(rollbackRunbook).toContain("set `AP_ROLLBACK_TARGET_SHA` to the exact intended deployment commit");
    expect(documentCompatibility.indexOf("pg_advisory_xact_lock"))
      .toBeLessThan(documentCompatibility.indexOf("where resource=resource_value and enabled for update"));
  });

  it("binds refunds to immutable provider payment semantics and retires subscription renewals", () => {
    const webhook = source("src/app/api/stripe/webhook/route.ts");
    const workers = source("src/lib/commerce/workers.ts");
    const board = source("src/lib/job-board/stripe-events.ts");
    const canary = source("src/app/api/admin/manual-launch/canary-refunds/route.ts");
    const authorization = source("src/app/api/admin/manual-launch/canary-authorizations/route.ts");
    const retry = source("src/app/api/admin/manual-launch/canary-retries/route.ts");
    const activation = source("src/app/api/admin/manual-launch/activations/route.ts");
    const launchReadiness = source("src/lib/operations/launch-readiness.ts");
    const operationsSummary = source("src/lib/operations/summary.ts");
    const capacity = source("src/app/api/admin/capacity/[kind]/route.ts");
    const searchCheckout = source("src/app/api/checkout/search/route.ts");
    const materialsCheckout = source("src/app/api/checkout/apply-packs/route.ts");
    expect(webhook).toContain('rpc("ap_record_search_refund_result_verified"');
    expect(webhook).toContain("p_provider_payment_id: paymentIntentId");
    expect(webhook).toContain("p_amount_cents: refund.amount");
    expect(workers).toContain('rpc("ap_record_search_refund_result_verified"');
    expect(canary).toContain("isSameOriginRequest");
    expect(canary).toContain("requireAdmin()");
    expect(canary).toContain('access.role !== "admin"');
    expect(canary).toContain("safeReleaseSha()");
    expect(canary).toContain('rpc("ap_queue_manual_launch_canary_refund"');
    expect(canary).toContain('.select("state")');
    expect(canary).not.toContain("stripe.refunds");
    expect(existsSync(resolve(process.cwd(), "src/app/api/admin/manual-launch/canary-designations/route.ts"))).toBe(false);
    expect(authorization).toContain('rpc("ap_authorize_scoped_manual_launch_canary_checkout"');
    expect(authorization).toContain('rpc("ap_revoke_manual_launch_canary_checkout"');
    expect(authorization).toContain('access.role !== "admin"');
    expect(authorization).toContain("safeReleaseSha()");
    expect(retry).toContain('rpc("ap_supersede_manual_launch_canary_designation"');
    expect(retry).toContain("stripe.checkout.sessions.retrieve");
    expect(retry).toContain("stripe.checkout.sessions.expire");
    expect(retry).toContain('rpc("ap_reconcile_manual_launch_canary_provider_terminal"');
    expect(retry).toContain('access.role !== "admin"');
    expect(activation).toContain('rpc("ap_record_manual_launch_activation"');
    expect(activation).toContain('z.enum(["CANARY", "PUBLIC"])');
    expect(launchReadiness).toContain('activation.activation_phase === "PUBLIC"');
    expect(launchReadiness).toContain('activation.activation_phase !== "CANARY"');
    expect(launchReadiness).toContain('checkoutConfiguration().restrictedMode !== "CANARY"');
    expect(source(".env.example")).toContain("APP_CANARY_CHECKOUT_ENABLED=false");
    expect(launchReadiness).toContain('rpc("ap_manual_launch_canary_checkout_authorized"');
    expect(operationsSummary).toContain("payments: payment.commerceConfigured");
    expect(operationsSummary).not.toContain("payment.boardReady");
    expect(capacity).toContain('rpc("ap_set_manual_launch_capacity_state"');
    expect(capacity).not.toContain('from("capacity_limits")');
    expect(searchCheckout).toContain('rpc("ap_begin_authorized_search_checkout"');
    expect(materialsCheckout).toContain('rpc("ap_begin_authorized_material_checkout"');
    expect(materialsCheckout).toContain("${authorization.mode.toLowerCase()}:${authorization.authorizationId}");
    const initiation = source("src/lib/commerce/checkout-initiation.ts");
    expect(initiation).toContain('rpc("ap_bind_checkout_initiation"');
    expect(initiation).toContain("attempt.provider_idempotency_key");
    expect(workers).not.toContain("sessions.create");
    expect(board).toContain("cancel_at_period_end: true");
    expect(board).toContain("legacyBoardProviderProjection");
    expect(board).toContain("access_ends_at: accessEndsAt");
    expect(board).not.toContain("void requestedState");
  });
});
