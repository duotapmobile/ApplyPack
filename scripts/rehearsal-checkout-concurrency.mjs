import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = ["exec", "-i", "supabase_db_applypack", "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
function sql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Local concurrency SQL timed out")); }, 60_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Local concurrency SQL failed (${code}): ${stderr}`));
      else resolve(stdout.trim());
    });
    child.stdin.end(input);
  });
}

// Called only by the serial local upgrade runner, whose finally block restores
// the disposable schema. Never accepts a URL, linked project or credentials.
export async function proveRehearsalCheckoutConcurrency() {
  const source = (name) => readFileSync(fileURLToPath(new URL(`../tests/integration/${name}`, import.meta.url)), "utf8");
  const seed = source("chunk4-commerce-release.sql").split("savepoint before_cross_draft_expired_invitation;")[0];
  const rehearsal = source("rehearsal-checkout-attempts.sql").split("create temporary table rehearsal_fixture_result")[0];
  if (!seed.includes("current likely feasibility with capacity") || !rehearsal.includes("begin_rehearsal_checkout")) {
    throw new Error("Reviewed concurrency fixture anchors changed");
  }
  const result = spawnSync("docker", args, {
    input: seed.replace(/^\\ir reviewed-source-fixture\.sql\r?$/gm, () => source("reviewed-source-fixture.sql"))
      + rehearsal + "\ncommit;\n",
    encoding: "utf8", timeout: 120_000,
  });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  const begin = `select checkout_attempt_id::text||':'||provider_idempotency_key
    from public.ap_begin_authorized_search_checkout(
      'e4300000-0000-4000-8000-000000000085',repeat('7',64),
      '34000000-0000-4000-8000-000000000001',repeat('a',64),
      '54000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',
      'rehearsal-provider-retry','e4200000-0000-4000-8000-000000000085',repeat('6',64),
      'e4300000-0000-4000-8000-000000000086','search-checkout/rehearsal-provider-retry',
      'e4400000-0000-4000-8000-000000000085','e4500000-0000-4000-8000-000000000085',
      repeat('5',64),repeat('4',64),'REHEARSAL','14000000-0000-4000-8000-000000000001',repeat('a',40),
      (select id from public.ap_staging_rehearsal_authorizations where evidence_reference='fixture-rehearsal-exact-customer-draft'),
      '5a000000-0000-4000-8000-000000000001');`;
  const replies = await Promise.all(Array.from({ length: 6 }, () => sql(begin)));
  if (new Set(replies).size !== 1 || !replies[0].includes("e4400000-0000-4000-8000-000000000085:search-checkout/rehearsal-provider-retry")) {
    throw new Error("Concurrent retries returned different provider attempts");
  }
  await Promise.all([
    sql(`select public.ap_revoke_staging_rehearsal_checkout(
      (select id from public.ap_staging_rehearsal_authorizations where evidence_reference='fixture-rehearsal-exact-customer-draft'),
      '14000000-0000-4000-8000-000000000003','fixture-concurrent-revoke-provider-bind');`),
    sql(`select public.ap_bind_checkout_initiation('e4400000-0000-4000-8000-000000000085','cs_concurrent_rehearsal',
      (select provider_session_deadline from public.ap_checkout_initiations where id='e4400000-0000-4000-8000-000000000085'));`),
  ]);
  const verification = await sql(`select case when
    (select count(*)=1 from public.ap_checkout_initiations where request_key='rehearsal-provider-retry')
    and (select count(*)=1 from public.ap_payment_attempts where id='e4500000-0000-4000-8000-000000000085')
    and (select count(*)=1 from public.ap_capacity_allocations where request_key='search-checkout:rehearsal-provider-retry')
    and (select state='EXPIRATION_REQUIRED' and provider_session_id='cs_concurrent_rehearsal'
      from public.ap_checkout_initiations where id='e4400000-0000-4000-8000-000000000085')
    then 'REHEARSAL_CONCURRENCY_OK' else 'REHEARSAL_CONCURRENCY_FAILED' end;`);
  if (verification !== "REHEARSAL_CONCURRENCY_OK") throw new Error(verification);
  console.log("PASS: six independent SQL connections reuse one attempt/payment/reservation; concurrent revoke/provider binding retains the Session and requires expiration.");
  const cleanupReplies = await Promise.all(Array.from({ length: 6 }, () => sql(
    "select public.ap_begin_aws_temporary_cleanup('85000000-0000-4000-8000-00000000aa06','staging');",
  )));
  if (new Set(cleanupReplies).size !== 1 || JSON.parse(cleanupReplies[0]).keys?.length !== 4) {
    throw new Error("Concurrent AWS cleanup registration changed operation keys or lease");
  }
  const cleanupVerification = await sql(`select case when count(*)=4 and count(distinct created_at)=1
    and count(distinct not_before)=1 and bool_and(attempts=0 and completed_at is null
      and not_before=created_at+interval '10 minutes')
    then 'AWS_CLEANUP_CONCURRENCY_OK' else 'AWS_CLEANUP_CONCURRENCY_FAILED' end
    from public.ap_aws_temporary_cleanup where operation_id='85000000-0000-4000-8000-00000000aa06';`);
  if (cleanupVerification !== "AWS_CLEANUP_CONCURRENCY_OK") throw new Error(cleanupVerification);
  console.log("PASS: six independent SQL connections register exactly four AWS cleanup keys with one immutable submission/cleanup lease.");
}
