import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProtectedRecoveryRetentionPlanReader, inspectRecoveryRetention } from "./lib/protected-recovery-retention-plan.mjs";

export async function readProtectedRecoveryRetentionPlan(environment = process.env, create = createProtectedRecoveryRetentionPlanReader) {
  const context = create(environment);
  try { return await inspectRecoveryRetention(context); }
  finally { context.archive.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("PROTECTED_RECOVERY_RETENTION_PLAN_ARGUMENTS_FORBIDDEN");
    process.stdout.write(`${JSON.stringify(await readProtectedRecoveryRetentionPlan())}\n`);
  } catch {
    process.stderr.write(`${JSON.stringify({ status: "READ_ONLY_PLAN_FAILED", providerMutationPerformed: false })}\n`);
    process.exitCode = 1;
  }
}
