import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { proveRehearsalCheckoutConcurrency } from "./rehearsal-checkout-concurrency.mjs";

// Destructive operations are pinned to the project's disposable local stack.
// No database URL, linked project or remote credentials are accepted.
const predecessors = ["202610040080", "202610190081", "202610190082", "202610190083", "202610190084", "202610220085"];
const container = "supabase_db_applypack";
function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 600_000,
  });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw result.error ?? new Error(`${command} failed with exit ${result.status}`);
  }
  return result.stdout;
}
function sql(input) {
  return run("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], input);
}
let failure;
try {
  for (const predecessor of predecessors) {
    console.log(`Running isolated local upgrade ${predecessor} to 202610230086.`);
    run("supabase", ["db", "reset", "--local", "--no-seed", "--version", predecessor]);
    sql(`
      do $$ begin
        if (select max(version) from supabase_migrations.schema_migrations)<>'${predecessor}'
          then raise exception 'unexpected_local_upgrade_predecessor'; end if;
      end $$;
      insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
        raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('85000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rehearsal-upgrade@example.invalid','',now(),'{}','{}',now(),now());
      insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,
        currency,settlement,dispute,payment_verified_at,provider_payment_status,payment_method_type,
        immediate_charge_verified)
      values('85000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000001',
        'stripe','pi_historical_upgrade_${predecessor}',2000,'USD','PAID','NONE',
        '2026-09-01T12:00:00Z','succeeded','card',true);
      create table public.rehearsal_upgrade_preservation_fixture as
        select to_jsonb(payment) as immutable_record from public.ap_payment_attempts payment
        where id='85000000-0000-4000-8000-000000000002';
      insert into public.storage_cleanup_queue(bucket,storage_path,reason,attempts,not_before)
        select bucket,'upgrade-fixture/${predecessor}/render-preview.pdf','historical-supabase-cleanup',3,
          '2026-09-01T12:10:00Z'::timestamptz
        from unnest(array['customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews']) bucket;
      create table public.aws_cleanup_upgrade_preservation_fixture as
        select to_jsonb(cleanup) as immutable_record from public.storage_cleanup_queue cleanup
        where reason='historical-supabase-cleanup';
    `);
    if (predecessor === "202610220085") {
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-085"]);
      if (!historical.includes("Database contract fixtures passed: 18. Schema phase: 202610220085.")) {
        throw new Error("Historical085 lifecycle proof missing");
      }
      // Prove preservation using real085 state in one rolled-back transaction.
      // The migration's exact source is used apart from its outer transaction.
      const migration = readFileSync(new URL("../supabase/migrations/202610230086_sandbox_validation_launch_activation.sql", import.meta.url), "utf8");
      if (!/^begin;\r?\n/i.test(migration) || !/\r?\ncommit;\r?\n?$/i.test(migration)) {
        throw new Error("Activation086 migration transaction boundary changed");
      }
      const seed = readFileSync(new URL("../tests/integration/sandbox-activation-086-upgrade-seed.sql", import.meta.url), "utf8");
      const verify = readFileSync(new URL("../tests/integration/sandbox-activation-086-upgrade-verify.sql", import.meta.url), "utf8");
      const preservation = sql(`begin;\n${seed}\n${migration.replace(/^begin;\r?\n/i, "").replace(/\r?\ncommit;\r?\n?$/i, "")}\n${verify}\nrollback;`);
      if (!preservation.includes("SANDBOX_ACTIVATION_086_UPGRADE_VERIFY_OK")) throw new Error("Activation086 historical preservation marker missing");
    }
    run("supabase", ["migration", "up", "--local"]);
    const result = sql(`
      do $$ begin
        if public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610230086'
          or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
          or public.ap_manual_launch_schema_readiness()->'requiredMigrations' is distinct from jsonb_build_array(
            '202610040077','202610040078','202610040079','202610040080','202610190081',
            '202610190082','202610190083','202610190084','202610220085','202610230086')
          or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
          or exists(select 1 from public.ap_checkout_initiations)
          or exists(select 1 from public.ap_staging_rehearsal_authorizations)
          or exists(select 1 from public.ap_aws_temporary_cleanup)
          or exists(select 1 from pg_index where not indisvalid)
          or not exists(select 1 from public.ap_payment_attempts payment
            join public.rehearsal_upgrade_preservation_fixture fixture on fixture.immutable_record=to_jsonb(payment)
            where payment.id='85000000-0000-4000-8000-000000000002')
          or (select count(*) from public.storage_cleanup_queue cleanup
            join public.aws_cleanup_upgrade_preservation_fixture fixture on fixture.immutable_record=to_jsonb(cleanup)
            where cleanup.reason='historical-supabase-cleanup')<>4
          or has_table_privilege('anon','public.ap_checkout_initiations','SELECT')
          or has_table_privilege('authenticated','public.ap_staging_rehearsal_authorizations','SELECT')
          or has_table_privilege('service_role','public.ap_checkout_initiations','UPDATE')
          or has_table_privilege('authenticated','public.ap_aws_temporary_cleanup','SELECT')
          or has_table_privilege('service_role','public.ap_aws_temporary_cleanup','DELETE')
          then raise exception 'rehearsal_upgrade_contract_failed'; end if;
      end $$;
      select 'REHEARSAL_UPGRADE_${predecessor}_TO_086_OK';
    `);
    if (!result.includes(`REHEARSAL_UPGRADE_${predecessor}_TO_086_OK`)) throw new Error("Upgrade proof marker missing");
    const lifecycle = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs"]);
    if (!lifecycle.includes("Database contract fixtures passed: 19.")) throw new Error("Upgraded lifecycle fixture proof missing");
    console.log(`PASS: isolated local upgrade ${predecessor} to 202610230086; paid history preserved, mode locked, service-only ledger; all 19 lifecycle fixtures passed.`);
  }
  // Start from a clean final schema before the independent-connection proof.
  run("supabase", ["db", "reset", "--local", "--no-seed"]);
  await proveRehearsalCheckoutConcurrency();
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"]); }
  catch (error) { if (!failure) failure = error; }
}
if (failure) throw failure;
console.log("All six launch upgrade predecessors passed; latest disposable local schema restored.");
