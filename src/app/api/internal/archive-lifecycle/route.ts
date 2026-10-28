import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recoveryHeaders } from "@/lib/operations/protected-recovery-source";
import { authorizeRecoveryRequest, boundedRecoveryOperation, buildRecoveryInventory, createSupabaseRecoveryReader,
  recoverySourceConfiguration, signRecoveryReceipt } from "../../../../../scripts/lib/protected-recovery-source.mjs";
import { createArchiveLifecycleService, createArchiveLifecycleStore } from "../../../../../scripts/lib/archive-lifecycle-service.mjs";
import { createWorkloadArchiveEvidenceReader } from "../../../../../scripts/lib/aws-archive-verifier-credentials.mjs";
import { DATABASE_RECOVERY } from "../../../../../scripts/lib/database-recovery-protocol.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readBody(request: Request, signal: AbortSignal): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json" || !request.body) throw new Error("ARCHIVE_REQUEST_INVALID");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const end = Date.now() + 10000;
  try {
    for (;;) {
      if (signal.aborted || Date.now() >= end) throw new Error("ARCHIVE_REQUEST_TIMEOUT");
      const part = await boundedRecoveryOperation(() => reader.read(), Math.max(1, end - Date.now()));
      if (part.done) break;
      size += part.value.length; if (size > 1024 * 1024) throw new Error("ARCHIVE_REQUEST_LIMIT"); chunks.push(part.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
  } finally { for (const chunk of chunks) chunk.fill(0); void reader.cancel().catch(() => {}); }
}

export async function POST(request: Request) {
  let verifier: ReturnType<typeof createWorkloadArchiveEvidenceReader> | undefined;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(300000)]);
  try {
    if (process.env.APP_ARCHIVE_LIFECYCLE_ENABLED !== "true" || new URL(request.url).search) throw new Error("ARCHIVE_DISABLED");
    const configuration = recoverySourceConfiguration(process.env);
    const databaseSecret = process.env.APP_DATABASE_BACKUP_LIFECYCLE_SECRET;
    if (!databaseSecret || !/^[A-Za-z0-9_+/=-]{43,256}$/u.test(databaseSecret)
      || [configuration.readerSecret, configuration.completionSecret, configuration.receiptSecret, configuration.retentionSecret, process.env.CRON_SECRET].includes(databaseSecret)) throw new Error("ARCHIVE_CONFIGURATION");
    const capabilities = [
      ["FILE_WRITER", configuration.completionSecret], ["DATABASE_WRITER", databaseSecret], ["RETENTION", configuration.retentionSecret],
    ] as const;
    const accepted = capabilities.filter(([, secret]) => { try { authorizeRecoveryRequest(request, secret); return true; } catch { return false; } });
    if (accepted.length !== 1) return Response.json({ error: "Unauthorized archive connection." }, { status: 401, headers: recoveryHeaders });
    const input = await readBody(request, signal);
    const admin = createSupabaseAdminClient(); if (!admin) throw new Error("ARCHIVE_DATABASE_UNAVAILABLE");
    verifier = createWorkloadArchiveEvidenceReader(process.env);
    const service = createArchiveLifecycleService({ store: createArchiveLifecycleStore(admin), evidenceReader: verifier,
      configuration: { ...configuration, enabled: true, schemaVersion: DATABASE_RECOVERY.schemaVersion },
      readInventory: async () => buildRecoveryInventory({ reader: createSupabaseRecoveryReader(admin), releaseSha: configuration.releaseSha,
        signReceipt: (inventory: Parameters<typeof signRecoveryReceipt>[0]) => signRecoveryReceipt(inventory, configuration.receiptSecret) }),
      readCheckpoint: async ({ signal: readSignal }: { signal: AbortSignal }) => {
        const result = await admin.from("operational_heartbeats").select("summary,last_succeeded_at").eq("task_name", "protected_recovery").abortSignal(readSignal).maybeSingle();
        if (result.error || !result.data || !result.data.summary || typeof result.data.summary !== "object" || Array.isArray(result.data.summary)
          || !result.data.last_succeeded_at || typeof result.data.summary.sourceStartedAt !== "string"
          || Date.parse(result.data.last_succeeded_at) !== Date.parse(result.data.summary.sourceStartedAt)) throw new Error("ARCHIVE_CHECKPOINT_UNAVAILABLE");
        return result.data.summary;
      },
    });
    const result = await service.execute(input, { capability: accepted[0][0], signal });
    if (signal.aborted) throw new Error("ARCHIVE_REQUEST_TIMEOUT");
    return Response.json(result, { headers: recoveryHeaders });
  } catch { return Response.json({ error: "Archive maintenance is unavailable. Reconcile any unconfirmed operation before retrying." }, { status: 503, headers: recoveryHeaders }); }
  finally { verifier?.close(); }
}
