import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readDatabaseArchiveStatus } from "../../../scripts/lib/archive-writer-completion.mjs";
import { DATABASE_RECOVERY } from "../../../scripts/lib/database-recovery-protocol.mjs";
import { assessMonitorDatabase, buildIndependentMonitorSnapshot, MONITOR_TASKS, type MonitorConfiguration } from "./independent-monitor";

/** Bounded, read-only metadata queries. This endpoint does not probe renderers,
 * decrypt customer content, call payment providers, or write a heartbeat. */
export async function readIndependentMonitorSnapshot(configuration: MonitorConfiguration, nonce: string, external: AbortSignal) {
  const controller = new AbortController(), signal = AbortSignal.any([external, controller.signal]);
  const timer = setTimeout(() => controller.abort(), 5_000);
  let onAbort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const admin = createSupabaseAdminClient({ signal });
    if (!admin) throw new Error("MONITOR_UNAVAILABLE");
    const reads = Promise.all([
      admin.from("operational_heartbeats").select("task_name,last_succeeded_at,updated_at,summary")
        .in("task_name", [...MONITOR_TASKS]).limit(4).abortSignal(signal),
      configuration.environment === "production" ? readDatabaseArchiveStatus({
        releaseSha: configuration.releaseSha, expectedSchemaVersion: DATABASE_RECOVERY.schemaVersion, signal,
        readLatestDatabaseCompletion: async ({ signal: readSignal }: { signal: AbortSignal }) => {
          const result = await admin.rpc("ap_latest_verified_database_archive").abortSignal(readSignal);
          if (result.error) throw new Error("MONITOR_DATABASE_READ_UNAVAILABLE");
          return result.data;
        },
      }) : null,
    ]);
    const [heartbeats, database] = await Promise.race([reads, new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("MONITOR_UNAVAILABLE"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
    signal.throwIfAborted();
    if (heartbeats.error || !Array.isArray(heartbeats.data) || heartbeats.data.length > 3) throw new Error("MONITOR_UNAVAILABLE");
    const now = Date.now();
    return buildIndependentMonitorSnapshot({ configuration, nonce, rows: heartbeats.data,
      database: assessMonitorDatabase(database, configuration, DATABASE_RECOVERY.schemaVersion, now), now });
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
