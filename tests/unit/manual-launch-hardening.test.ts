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

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("October 2 manual-launch hardening", () => {
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
  });

  it("separates healthy infrastructure from accepting orders and excludes dormant board commerce", () => {
    const health = source("src/app/api/health/route.ts");
    expect(health).toContain("commerceConfigured: infrastructure.commerceConfigured");
    expect(health).toContain("manualLaunchCheckoutGate(admin, infrastructure)");
    expect(health).not.toContain("STRIPE_JOB_BOARD");
    expect(health).not.toContain("boardSubscriptions");
    expect(source("src/app/api/live/route.ts")).toContain('status: "ok"');
    const maintenance = source("src/app/api/cron/maintenance/route.ts");
    expect(maintenance).toContain('APP_LEGACY_BOARD_MAINTENANCE_ENABLED === "true"');
    expect(maintenance).toContain('rpc("ap_ensure_manual_launch_capacity_rollover")');
    expect(maintenance).toContain('"CAPACITY_ROLLOVER"');
    expect(source(".env.example")).toContain("APP_LEGACY_BOARD_MAINTENANCE_ENABLED=false");
  });

  it("finalizes intake and current legal acceptance through one atomic database command", () => {
    const finalize = source("src/app/api/intake/anonymous-draft/finalize/route.ts");
    const migration = source("supabase/migrations/202610030063_atomic_intake_legal_acceptance.sql");
    expect(finalize).toContain('rpc("ap_finalize_four_step_intake_with_legal_acceptance"');
    expect(finalize).not.toContain('rpc("ap_record_snapshot_legal_acceptance"');
    expect(finalize.indexOf('select("terms_version,privacy_version")')).toBeLessThan(finalize.indexOf('from("ap_sensitive_payloads").insert'));
    expect(migration).toContain("public.ap_finalize_four_step_intake(");
    expect(migration).toContain("public.ap_record_snapshot_legal_acceptance(");
    expect(migration).toContain("join public.ap_snapshot_legal_acceptances acceptance");
  });

  it("forces production envelope encryption through AWS KMS and probes the isolated renderer", () => {
    const kms = source("src/lib/security/remote-kms.ts");
    const worker = source("src/lib/files/aws-document-worker.ts");
    const readiness = source("src/lib/operations/renderer-readiness.ts");
    const launchReadiness = source("src/lib/operations/launch-readiness.ts");
    const workerTemplate = source("infra/aws/document-worker/template.yaml");
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
    expect(launchReadiness).toContain('from("ap_manual_launch_activations")');
    expect(launchReadiness).toContain("capacityAvailable");
    expect(launchReadiness).toContain("capacityByResource");
    expect(launchReadiness).toContain("legacy_subscription_retirement_reference");
    expect(source("src/app/api/checkout/search/route.ts")).toContain('manualLaunchCheckoutGate(context.admin, infrastructure, "SEARCH")');
    expect(source("src/app/api/checkout/apply-packs/route.ts")).toContain('manualLaunchCheckoutGate(admin, infrastructure, "MATERIALS")');
    const generation = source("src/app/api/admin/material-lines/[id]/generate/route.ts");
    expect(generation).toContain("renderDocumentForQa");
    expect(generation).not.toContain("renderDocumentLocallyForQa");
    const handler = source("infra/aws/document-worker/handler.py");
    expect(handler).toContain('operation == "render-docx"');
    expect(handler).toContain('operation == "probe-document"');
    expect(handler).toContain("_docx_text(data");
    expect(handler).toContain("pdftoppm");
    expect(handler).toContain("network_isolation_verified");
    expect(handler).toContain("functionVersionArn");
    expect(handler).toContain('ServerSideEncryption="AES256"');
    expect(workerTemplate).toContain("ec2:DescribeSubnets");
    expect(workerTemplate).toContain("ec2:AssignPrivateIpAddresses");
    expect(workerTemplate).toContain("ec2:UnassignPrivateIpAddresses");
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
