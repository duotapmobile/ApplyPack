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

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("October 2 manual-launch hardening", () => {
  it("binds legal acceptance to the exact displayed Terms, Privacy Policy, and acknowledgement copy", () => {
    expect(currentLegalContentBinding()).toEqual({
      termsVersion: "manual-launch-terms-2026-10-02-v2",
      privacyVersion: "privacy-v1",
      termsContentSha256: "eeec6398df29e6bd831aa1130453762927a467ee1b7a8d98b3659e07b8069d8c",
      privacyContentSha256: "9832a38d7fe5bbff04622a1e1a34e09febd44156dbf78eec4ea975283c1e92e9",
      acceptanceCopyVersion: "applypack-legal-acceptance-copy-2026-10-04-v1",
      acceptanceCopySha256: "0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283",
      contentCanonicalizationVersion: "applypack-c14n-v1",
      receiptSchemaVersion: "applypack-legal-content-receipt-v1",
    });
  });

  it("keeps later legal revisions append-only and rejects a rollback with altered legal text", () => {
    const binding = currentLegalContentBinding();
    expect(APPROVED_ROLLBACK_LEGAL_CONTRACT).toMatchObject(binding);
    const legalPages = source("src/content/public-pages.ts");
    const wizard = source("src/app/get-started/wizard-v3.tsx");
    const presentation = source("src/lib/legal/presentation.ts");
    expect(verifyRollbackLegalSource({
      publicPagesSource: legalPages,
      wizardSource: wizard,
      presentationSource: presentation,
    })).toEqual({ ok: true, failures: [] });
    expect(verifyRollbackLegalSource({
      publicPagesSource: legalPages.replace("Effective October 2, 2026", "Effective October 3, 2026"),
      wizardSource: wizard,
      presentationSource: presentation,
    })).toEqual({ ok: false, failures: ["legal_pages_source_mismatch"] });
    const spoofedPresentation = presentation
      .replace('prefix: "I agree to the "', 'prefix: "Different disclosure: "')
      .concat('\n// prefix: "I agree to the "\n');
    expect(verifyRollbackLegalSource({
      publicPagesSource: legalPages,
      wizardSource: wizard,
      presentationSource: spoofedPresentation,
    })).toEqual({ ok: false, failures: ["legal_acceptance_copy_mismatch"] });
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

    const rollback = source("scripts/run-supabase-rollback-test.mjs");
    expect(rollback).toContain("verifyRollbackLegalSource");
    expect(rollback).toContain("APPROVED_ROLLBACK_LEGAL_CONTRACT.termsContentSha256");
    expect(rollback).toContain("APPROVED_ROLLBACK_LEGAL_CONTRACT.privacyContentSha256");
    expect(rollback).toContain("APPROVED_ROLLBACK_LEGAL_CONTRACT.acceptanceCopySha256");
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
    const site = source("src/config/site.ts");
    expect(boardCheckout).toContain("status: 410");
    expect(boardCheckout).not.toContain("createStripe");
    expect(boardMaterials).toContain("boardOriginCheckoutIsDisabled");
    expect(boardMaterials).toContain("status: 410");
    expect(boardPage).toContain("notFound()");
    expect(boardPage).toContain("index: false");
    expect(site).not.toContain('href: "/job-board"');
    expect(site).not.toContain('"/job-board"');
  });

  it("binds search checkout to a short-lived operator invitation", () => {
    const search = source("src/app/api/checkout/search/route.ts");
    const issue = source("src/app/api/admin/search-checkout-invitations/route.ts");
    expect(search).toContain("invitationId: z.uuid()");
    expect(search).toContain("invitationSecret");
    expect(search).toContain('rpc("ap_begin_invited_search_checkout"');
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
    expect(preflightRunner).toContain("[REDACTED_DATABASE_URL]");
    expect(preflightRunner).toContain('process.argv.length !== 3');
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
    const documentPolicy = source("supabase/migrations/202610030066_locked_document_generation_standard.sql");
    const documentCompatibility = source("supabase/migrations/202610030067_document_source_and_rollback_compatibility.sql");
    const accessOnlyCompatibility = source("supabase/migrations/202610030068_historical_document_access_only.sql");
    const durableDocumentAccess = source("supabase/migrations/202610030069_durable_delivered_document_access.sql");
    const sensitiveUploadCleanup = source("supabase/migrations/202610030070_all_sensitive_upload_cleanup_intents.sql");
    const rollbackCheck = source("scripts/run-supabase-rollback-test.mjs");
    const rollbackRunbook = source("docs/runbooks/MANUAL_LAUNCH_RELEASE.md");
    expect(kms).toContain('environment.APP_DEPLOYMENT_ENV === "production"');
    expect(kms).toContain('environment.APP_KMS_PROVIDER !== "aws"');
    expect(worker).toContain('region === "us-east-1"');
    expect(worker).toContain("VERSION_ARN");
    expect(worker).toContain("APP_DOCUMENT_WORKER_IMAGE_DIGEST");
    expect(worker).toContain("APP_DOCUMENT_WORKER_NETWORK_ATTESTATION_SHA256");
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
    expect(source("src/app/api/checkout/search/route.ts")).toContain('manualLaunchCheckoutGate(context.admin, infrastructure, "SEARCH")');
    expect(source("src/app/api/checkout/apply-packs/route.ts")).toContain('manualLaunchCheckoutGate(admin, infrastructure, "MATERIALS")');
    const generation = source("src/app/api/admin/material-lines/[id]/generate/route.ts");
    expect(generation).toContain("renderDocumentForQa");
    expect(generation).not.toContain("renderDocumentLocallyForQa");
    expect(generation).toContain('storageBucket: "operator-drafts"');
    expect(generation).toContain("editableSourcePath");
    expect(generation).toContain("p_claim_provenance: { ...input.artifact.provenance, editableSource, uploadCleanup }");
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
    expect(workerTemplate).toContain("ec2:DescribeSubnets");
    expect(workerTemplate).toContain("ec2:AssignPrivateIpAddresses");
    expect(workerTemplate).toContain("ec2:UnassignPrivateIpAddresses");
    expect(workerTemplate).toContain("MemorySize: 512");
    expect(workerTemplate).toContain("PrimaryAlertEmail");
    expect(workerTemplate).toContain("SecondaryAlertEmail");
    expect(workerTemplate).toContain('Default: "true"');
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
    expect(rollbackCheck).toContain('REQUIRED_LAUNCH_SCHEMA_VERSION = "202610040080"');
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
    expect(authorization).toContain('rpc("ap_authorize_manual_launch_canary_checkout"');
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
    expect(launchReadiness).toContain('process.env.APP_CANARY_CHECKOUT_ENABLED !== "true"');
    expect(source(".env.example")).toContain("APP_CANARY_CHECKOUT_ENABLED=false");
    expect(launchReadiness).toContain('rpc("ap_manual_launch_canary_checkout_authorized"');
    expect(operationsSummary).toContain("payments: payment.commerceConfigured");
    expect(operationsSummary).not.toContain("payment.boardReady");
    expect(capacity).toContain('rpc("ap_set_manual_launch_capacity_state"');
    expect(capacity).not.toContain('from("capacity_limits")');
    expect(searchCheckout).toContain('rpc("ap_bind_manual_launch_canary_payment"');
    expect(materialsCheckout).toContain('rpc("ap_bind_manual_launch_canary_payment"');
    expect(materialsCheckout).toContain(":canary:${authorizationResult.data.id}");
    expect(board).toContain("cancel_at_period_end: true");
    expect(board).toContain('state: "CANCELED"');
  });
});
