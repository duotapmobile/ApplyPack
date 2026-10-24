import "server-only";

import { createHash } from "node:crypto";
import { AWS_TEMPORARY_CLEANUP_MAX_OVERDUE_MS } from "@/lib/files/aws-temporary-cleanup";
import { sendTransactionalEmail } from "@/lib/email/send";
import {
  deploymentEnvironment,
  safeReleaseSha,
  type OperationsSummary,
} from "@/lib/operations/summary";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export const MAINTENANCE_ACTION_CODES = [
  "CAPACITY_ROLLOVER",
  "EXPIRATION_CLEANUP",
  "EXPIRED_LEASE_RECOVERY",
  "DOCUMENT_PROCESSING",
  "BOUNDED_QUEUE_PROCESSING",
  "STRIPE_RECONCILIATION",
  "BOARD_RECOMPUTATION",
] as const;

export type MaintenanceActionCode = typeof MAINTENANCE_ACTION_CODES[number];
export type MaintenanceActionStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";
export type MaintenanceActionEvidence = {
  code: MaintenanceActionCode;
  status: MaintenanceActionStatus;
};

export function maintenanceActionsSucceeded(
  actions: readonly MaintenanceActionEvidence[],
  allowedSkippedActions: readonly MaintenanceActionCode[] = [],
) {
  const allowedSkipped = new Set(allowedSkippedActions);
  return actions.every((action) => action.status === "SUCCEEDED"
    || (action.status === "SKIPPED" && allowedSkipped.has(action.code)));
}

export type DiagnosticCode =
  | "DATABASE_NOT_READY"
  | "PAYMENT_INTEGRITY_NOT_READY"
  | "EMAIL_NOT_READY"
  | "FILE_SAFETY_NOT_READY"
  | "ENCRYPTION_NOT_READY"
  | "DOCUMENT_RENDERING_NOT_READY"
  | "PROTECTED_RECOVERY_NOT_READY"
  | "PROTECTED_RECOVERY_AGING"
  | "SOURCE_PERMISSION_COVERAGE_MISSING"
  | "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN"
  | "RECOMPUTE_QUEUE_STALE"
  | "WORKFLOW_QUEUE_STALE"
  | "OUTBOX_QUEUE_STALE"
  | "COMMERCE_RECONCILIATION_STALE"
  | "STORAGE_CLEANUP_DEAD_LETTER"
  | "STORAGE_CLEANUP_OVERDUE"
  | "MAINTENANCE_DIAGNOSIS_FAILED"
  | "CAPACITY_ROLLOVER_FAILED"
  | "EXPIRED_LEASE_RECOVERY_FAILED"
  | "EXPIRATION_CLEANUP_FAILED"
  | "DOCUMENT_PROCESSING_FAILED"
  | "BOUNDED_QUEUE_PROCESSING_FAILED"
  | "STRIPE_RECONCILIATION_FAILED"
  | "BOARD_RECOMPUTATION_FAILED"
  | "MAINTENANCE_VERIFICATION_FAILED";

const FAIL_CLOSED_CODES: readonly DiagnosticCode[] = [
  "PROTECTED_RECOVERY_NOT_READY",
  "DATABASE_NOT_READY",
  "PAYMENT_INTEGRITY_NOT_READY",
  "FILE_SAFETY_NOT_READY",
  "ENCRYPTION_NOT_READY",
  "DOCUMENT_RENDERING_NOT_READY",
  "SOURCE_PERMISSION_COVERAGE_MISSING",
  "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN",
  "STORAGE_CLEANUP_DEAD_LETTER",
  "STORAGE_CLEANUP_OVERDUE",
];

const MANAGED_ALERT_CODES: readonly DiagnosticCode[] = [
  "PROTECTED_RECOVERY_NOT_READY",
  "PROTECTED_RECOVERY_AGING",
  "DATABASE_NOT_READY",
  "PAYMENT_INTEGRITY_NOT_READY",
  "EMAIL_NOT_READY",
  "FILE_SAFETY_NOT_READY",
  "ENCRYPTION_NOT_READY",
  "DOCUMENT_RENDERING_NOT_READY",
  "SOURCE_PERMISSION_COVERAGE_MISSING",
  "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN",
  "RECOMPUTE_QUEUE_STALE",
  "WORKFLOW_QUEUE_STALE",
  "OUTBOX_QUEUE_STALE",
  "COMMERCE_RECONCILIATION_STALE",
  "STORAGE_CLEANUP_DEAD_LETTER",
  "STORAGE_CLEANUP_OVERDUE",
  "MAINTENANCE_DIAGNOSIS_FAILED",
  "CAPACITY_ROLLOVER_FAILED",
  "EXPIRED_LEASE_RECOVERY_FAILED",
  "EXPIRATION_CLEANUP_FAILED",
  "DOCUMENT_PROCESSING_FAILED",
  "BOUNDED_QUEUE_PROCESSING_FAILED",
  "STRIPE_RECONCILIATION_FAILED",
  "BOARD_RECOMPUTATION_FAILED",
  "MAINTENANCE_VERIFICATION_FAILED",
];

const ACTION_FAILURE_CODE_BY_ACTION: Readonly<Partial<Record<DiagnosticCode, MaintenanceActionCode>>> = {
  CAPACITY_ROLLOVER_FAILED: "CAPACITY_ROLLOVER",
  EXPIRED_LEASE_RECOVERY_FAILED: "EXPIRED_LEASE_RECOVERY",
  EXPIRATION_CLEANUP_FAILED: "EXPIRATION_CLEANUP",
  STORAGE_CLEANUP_DEAD_LETTER: "EXPIRATION_CLEANUP",
  STORAGE_CLEANUP_OVERDUE: "EXPIRATION_CLEANUP",
  DOCUMENT_PROCESSING_FAILED: "DOCUMENT_PROCESSING",
  BOUNDED_QUEUE_PROCESSING_FAILED: "BOUNDED_QUEUE_PROCESSING",
  STRIPE_RECONCILIATION_FAILED: "STRIPE_RECONCILIATION",
  BOARD_RECOMPUTATION_FAILED: "BOARD_RECOMPUTATION",
};

const POST_DIAGNOSIS_FAILURE_CODES: readonly DiagnosticCode[] = [
  ...Object.keys(ACTION_FAILURE_CODE_BY_ACTION) as DiagnosticCode[],
  "MAINTENANCE_VERIFICATION_FAILED",
];

// This code is derived from another critical alert. Persisting it as its own
// alert would make it observe itself and latch health red.
const NON_PERSISTED_DERIVED_CODES: readonly DiagnosticCode[] = [
  "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN",
];

export function diagnoseOperations(summary: OperationsSummary) {
  const codes: DiagnosticCode[] = [];
  if (!summary.readiness.database) codes.push("DATABASE_NOT_READY");
  if (!summary.readiness.payments) codes.push("PAYMENT_INTEGRITY_NOT_READY");
  if (!summary.readiness.email) codes.push("EMAIL_NOT_READY");
  if (!summary.readiness.fileSafety) codes.push("FILE_SAFETY_NOT_READY");
  if (summary.readiness.encryption === false) codes.push("ENCRYPTION_NOT_READY");
  if (summary.readiness.documentRendering === false) codes.push("DOCUMENT_RENDERING_NOT_READY");
  if (summary.environment === "production" && !summary.protectedRecovery?.ready) codes.push("PROTECTED_RECOVERY_NOT_READY");
  else if (summary.protectedRecovery?.required && summary.protectedRecovery.warning) codes.push("PROTECTED_RECOVERY_AGING");
  if (summary.inventory.unauthorizedScheduledAutomatedRealSources > 0) {
    codes.push("SOURCE_PERMISSION_COVERAGE_MISSING");
  }
  if ((summary.alerts.blockingCritical ?? summary.alerts.openCritical) > 0) codes.push("CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN");
  if (summary.queues.recompute.stale) codes.push("RECOMPUTE_QUEUE_STALE");
  if (summary.queues.workflow.stale) codes.push("WORKFLOW_QUEUE_STALE");
  if (summary.queues.outbox.stale) codes.push("OUTBOX_QUEUE_STALE");
  if (summary.queues.commerceReconciliation.stale) codes.push("COMMERCE_RECONCILIATION_STALE");
  if ((summary.queues.storageCleanup.states.deadLetter || 0) > 0) codes.push("STORAGE_CLEANUP_DEAD_LETTER");
  const cleanup = summary.queues.storageCleanup;
  if ((cleanup.states.awsDue || 0) > 0 && cleanup.stale
    && (cleanup.oldestItemAgeSeconds === null || cleanup.oldestItemAgeSeconds >= AWS_TEMPORARY_CLEANUP_MAX_OVERDUE_MS / 1_000)) {
    codes.push("STORAGE_CLEANUP_OVERDUE");
  }
  return {
    codes,
    failClosedCodes: codes.filter((code) => FAIL_CLOSED_CODES.includes(code)),
    repairableCodes: codes.filter((code) => !FAIL_CLOSED_CODES.includes(code) && code !== "EMAIL_NOT_READY"),
  };
}

function uniqueCodes(codes: readonly DiagnosticCode[]) {
  return [...new Set(codes)].sort() as DiagnosticCode[];
}

export function maintenanceOutcome(
  before: OperationsSummary,
  after: OperationsSummary,
  actions: readonly MaintenanceActionEvidence[] = MAINTENANCE_ACTION_CODES.map((code) => ({ code, status: "SUCCEEDED" as const })),
  additionalCodes: readonly DiagnosticCode[] = [],
) {
  const beforeCodes = diagnoseOperations(before).codes;
  const afterDiagnostic = diagnoseOperations(after);
  const failedActionCodes = actions.filter((action) => action.status === "FAILED").map((action) => action.code);
  const actionFailureCodes = Object.entries(ACTION_FAILURE_CODE_BY_ACTION)
    // Observed backlog/dead-letter conditions are not inferred from an unrelated
    // cleanup failure; their mapping only governs alert preservation/recovery.
    .filter(([code, action]) => code.endsWith("_FAILED") && failedActionCodes.includes(action!))
    .map(([code]) => code as DiagnosticCode);
  const unresolvedCodes = uniqueCodes([...afterDiagnostic.codes, ...additionalCodes, ...actionFailureCodes]);
  return {
    beforeCodes,
    actions: actions.map((action) => ({ code: action.code, status: action.status })),
    actionCodes: actions.filter((action) => action.status === "SUCCEEDED").map((action) => action.code),
    failedActionCodes,
    afterCodes: afterDiagnostic.codes,
    recoveredCodes: beforeCodes.filter((code) => !unresolvedCodes.includes(code)),
    unresolvedCodes,
    failClosedCodes: unresolvedCodes.filter((code) => FAIL_CLOSED_CODES.includes(code)),
  };
}

function alertCategory(code: DiagnosticCode) {
  if (code === "OUTBOX_QUEUE_STALE") return "OUTBOX";
  if (code === "COMMERCE_RECONCILIATION_STALE" || code === "PAYMENT_INTEGRITY_NOT_READY" || code === "STRIPE_RECONCILIATION_FAILED") return "WEBHOOK";
  return "WORKER";
}

function isCritical(code: DiagnosticCode) {
  return FAIL_CLOSED_CODES.includes(code) || code.endsWith("_FAILED");
}

async function reconcileMaintenanceAlerts(
  admin: AdminClient,
  activeCodes: readonly DiagnosticCode[],
  environment: "staging" | "production",
  releaseSha: string,
  nowIso: string,
  preserveCodes: readonly DiagnosticCode[] = [],
) {
  const desired = uniqueCodes(activeCodes).filter((code) => !NON_PERSISTED_DERIVED_CODES.includes(code));
  for (const code of desired) {
    // Only the transition out of RESOLVED starts another alert episode. A
    // concurrent/repeated diagnosis must retain the existing episode identity.
    const reopened = await admin.from("ap_operational_alerts")
      .update({ state: "OPEN", resolved_at: null, opened_at: nowIso })
      .eq("alert_key", `maintenance/${code}`).in("state", ["RESOLVED"]);
    if (reopened.error) throw new Error("MAINTENANCE_ALERT_REOPEN_FAILED");
    const result = await admin.from("ap_operational_alerts").upsert({
      alert_key: `maintenance/${code}`,
      category: alertCategory(code),
      severity: isCritical(code) ? "CRITICAL" : "WARNING",
      state: "OPEN",
      resolved_at: null,
      reference_id: null,
      non_sensitive_details: { environment, code, releaseSha },
    }, { onConflict: "alert_key" });
    if (result.error) throw new Error("MAINTENANCE_ALERT_WRITE_FAILED");
  }

  for (const code of MANAGED_ALERT_CODES) {
    if (desired.includes(code) || preserveCodes.includes(code)) continue;
    const result = await admin.from("ap_operational_alerts")
      .update({ state: "RESOLVED", resolved_at: nowIso })
      .eq("alert_key", `maintenance/${code}`)
      .in("state", ["OPEN", "ACKNOWLEDGED"]);
    if (result.error) throw new Error("MAINTENANCE_ALERT_RESOLUTION_FAILED");
  }
}

async function updateFailureEvidence(admin: AdminClient, summary: Record<string, unknown>, nowIso: string) {
  const result = await admin.from("operational_heartbeats")
    .update({ updated_at: nowIso, summary })
    .eq("task_name", "maintenance");
  if (result.error) throw new Error("MAINTENANCE_FAILURE_EVIDENCE_WRITE_FAILED");
}

export async function recordMaintenanceDiagnosis(admin: AdminClient, before: OperationsSummary, now = new Date()) {
  const diagnostic = diagnoseOperations(before);
  const nowIso = now.toISOString();
  await reconcileMaintenanceAlerts(
    admin,
    diagnostic.codes,
    before.environment,
    before.releaseSha,
    nowIso,
    POST_DIAGNOSIS_FAILURE_CODES,
  );
  await updateFailureEvidence(admin, {
    schemaVersion: 2,
    phase: "DIAGNOSED",
    beforeCodes: diagnostic.codes,
    actions: [],
    unresolvedCodes: diagnostic.codes,
  }, nowIso);
  const protectedRecoveryAlert = await sendProtectedRecoveryAlert(admin, before, diagnostic.codes, now);
  return { ...diagnostic, protectedRecoveryAlert };
}

/** Alert failures never interrupt already-paid work; the cron receipt reports delivery separately. */
export async function sendProtectedRecoveryAlert(
  admin: AdminClient, summary: OperationsSummary, codes: readonly DiagnosticCode[], now = new Date(),
): Promise<"not_needed" | "sent" | "already_sent" | "failed"> {
  const recoveryCodes = codes.filter((code) => code === "PROTECTED_RECOVERY_NOT_READY" || code === "PROTECTED_RECOVERY_AGING");
  if (!recoveryCodes.length) return "not_needed";
  const recipient = process.env.APP_ADMIN_ALERT_EMAIL;
  if (!recipient || !summary.readiness.email) return "failed";
  try {
    const markers = await recoveryEpisodeMarkers(admin, recoveryCodes);
    if (markers.length !== recoveryCodes.length) return "failed";
    const idempotencyKey = `protected-recovery-alert/${createHash("sha256")
      .update([summary.environment, ...recoveryCodes.sort(), ...markers].join("|")).digest("hex").slice(0, 32)}`;
    const existing = await admin.from("email_events").select("status").eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing.error) return "failed";
    if (existing.data?.status === "sent") return "already_sent";
    const sent = await sendTransactionalEmail({
      to: recipient, subject: "ApplyPack protected recovery needs attention",
      lines: [`Environment: ${summary.environment}`, `Time: ${now.toISOString()}`, `Release: ${summary.releaseSha}`,
        `Condition: ${recoveryCodes.join(", ")}`,
        "Check the recovery service and archive before reopening new intake or checkout. Existing paid obligations remain in the service workflow."],
      actionLabel: "Open operations", actionUrl: "https://applypack.work/admin", idempotencyKey,
    });
    if (sent.skipped || !sent.providerMessageId) return "failed";
    const recorded = await admin.from("email_events").upsert({
      recipient, template: "admin_protected_recovery", status: "sent",
      provider_message_id: sent.providerMessageId, idempotency_key: idempotencyKey,
    }, { onConflict: "idempotency_key" });
    return recorded.error ? "failed" : "sent";
  } catch { return "failed"; }
}

export async function recordMaintenanceFailure(
  admin: AdminClient,
  before: OperationsSummary | null,
  failureCode: DiagnosticCode,
  actions: readonly MaintenanceActionEvidence[] = [],
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const beforeDiagnostic = before ? diagnoseOperations(before) : { codes: [] as DiagnosticCode[], failClosedCodes: [] as DiagnosticCode[] };
  const unresolvedCodes = uniqueCodes([...beforeDiagnostic.codes, failureCode]);
  const environment = before?.environment ?? deploymentEnvironment();
  const releaseSha = before?.releaseSha ?? safeReleaseSha();
  const succeededActions = new Set(
    actions.filter((action) => action.status === "SUCCEEDED").map((action) => action.code),
  );
  const preserveCodes = POST_DIAGNOSIS_FAILURE_CODES.filter((code) => {
    const action = ACTION_FAILURE_CODE_BY_ACTION[code];
    return !action || !succeededActions.has(action);
  });
  await reconcileMaintenanceAlerts(admin, unresolvedCodes, environment, releaseSha, nowIso, preserveCodes);
  await updateFailureEvidence(admin, {
    schemaVersion: 2,
    phase: "FAILED",
    beforeCodes: beforeDiagnostic.codes,
    actions: actions.map((action) => ({ code: action.code, status: action.status })),
    unresolvedCodes,
  }, nowIso);
  return { unresolvedCodes, failClosedCodes: beforeDiagnostic.failClosedCodes };
}

export function recoveryEmailIdempotencyKey(
  environment: "staging" | "production",
  recoveredCodes: readonly DiagnosticCode[],
  episodeMarkers: readonly string[],
) {
  const material = [environment, ...[...recoveredCodes].sort(), ...[...episodeMarkers].sort()].join("|");
  return `maintenance-recovery/${createHash("sha256").update(material).digest("hex").slice(0, 32)}`;
}

async function recoveryEpisodeMarkers(admin: AdminClient, recoveredCodes: readonly DiagnosticCode[]) {
  const keys = recoveredCodes
    .filter((code) => !NON_PERSISTED_DERIVED_CODES.includes(code))
    .map((code) => `maintenance/${code}`);
  if (!keys.length) return [];
  const result = await admin.from("ap_operational_alerts").select("alert_key,opened_at").in("alert_key", keys);
  if (result.error) throw new Error("MAINTENANCE_RECOVERY_MARKER_READ_FAILED");
  return (result.data || []).map((row) => `${row.alert_key}:${row.opened_at}`).sort();
}

export async function recordMaintenanceOutcome(
  admin: AdminClient,
  before: OperationsSummary,
  after: OperationsSummary,
  actions: readonly MaintenanceActionEvidence[],
  now = new Date(),
  allowedSkippedActions: readonly MaintenanceActionCode[] = [],
) {
  const outcome = maintenanceOutcome(before, after, actions);
  const nowIso = now.toISOString();
  const episodeMarkers = await recoveryEpisodeMarkers(admin, outcome.recoveredCodes);

  // Alert reconciliation must succeed before a success heartbeat can be refreshed.
  await reconcileMaintenanceAlerts(admin, outcome.unresolvedCodes, after.environment, after.releaseSha, nowIso);
  if (outcome.unresolvedCodes.length || !maintenanceActionsSucceeded(actions, allowedSkippedActions)) {
    await updateFailureEvidence(admin, { schemaVersion: 2, phase: "FAILED", ...outcome }, nowIso);
    return { ...outcome, recoveryEmail: "not_needed" as const };
  }

  const heartbeat = await admin.from("operational_heartbeats").upsert({
    task_name: "maintenance",
    last_succeeded_at: nowIso,
    updated_at: nowIso,
    summary: { schemaVersion: 2, phase: "VERIFIED", ...outcome },
  }, { onConflict: "task_name" });
  if (heartbeat.error) throw new Error("MAINTENANCE_HEARTBEAT_WRITE_FAILED");

  let recoveryEmail: "not_needed" | "sent" | "skipped" | "failed" = "not_needed";
  const recipient = process.env.APP_ADMIN_ALERT_EMAIL;
  if (outcome.recoveredCodes.length && recipient) {
    try {
      const sent = await sendTransactionalEmail({
        to: recipient,
        subject: "ApplyPack maintenance recovered an operational condition",
        lines: [
          `Environment: ${after.environment}`,
          `Time: ${nowIso}`,
          `Release: ${after.releaseSha}`,
          `Recovered codes: ${outcome.recoveredCodes.join(", ")}`,
        ],
        actionLabel: "Open operations runbook",
        actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://applypack.work"}/admin`,
        idempotencyKey: recoveryEmailIdempotencyKey(after.environment, outcome.recoveredCodes, episodeMarkers),
      });
      recoveryEmail = sent.skipped ? "skipped" : "sent";
    } catch {
      recoveryEmail = "failed";
    }
  }
  return { ...outcome, recoveryEmail };
}
