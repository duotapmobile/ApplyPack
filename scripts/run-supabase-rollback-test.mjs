import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pdfcnRollbackPath = fileURLToPath(new URL("../supabase/rollback/202609040024_pdfcn_job_match_packet.rollback.sql", import.meta.url));
const foundationRollbackPath = fileURLToPath(new URL("../supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql", import.meta.url));
const deliveryFunction = "public.complete_search_delivery(uuid,uuid,jsonb,jsonb,timestamp with time zone,timestamp with time zone)";
const input = readFileSync(pdfcnRollbackPath, "utf8") + `
select case when to_regclass('public.job_match_packet_artifacts') is null
  and not exists(select 1 from information_schema.columns where table_schema = 'public' and table_name = 'job_matches' and column_name = 'match_category')
  and position('match_category' in pg_get_functiondef('${deliveryFunction}'::regprocedure)) = 0
  and has_function_privilege('service_role', '${deliveryFunction}', 'EXECUTE')
  and not has_function_privilege('anon', '${deliveryFunction}', 'EXECUTE')
  and not has_function_privilege('authenticated', '${deliveryFunction}', 'EXECUTE')
  then 'PDFCN_ROLLBACK_OK' else 'PDFCN_ROLLBACK_FAILED' end;
` + readFileSync(foundationRollbackPath, "utf8")
  + "\nselect case when to_regclass('public.orders') is not null and to_regclass('public.ap_anonymous_drafts') is null then 'ROLLBACK_OK' else 'ROLLBACK_FAILED' end;\n";
const result = spawnSync("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
  encoding: "utf8",
  input,
  stdio: ["pipe", "pipe", "pipe"],
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0 || !result.stdout.includes("PDFCN_ROLLBACK_OK") || !result.stdout.includes("ROLLBACK_OK")) process.exit(result.status || 1);
