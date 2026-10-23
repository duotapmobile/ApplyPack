import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAUNCH_LEGAL_BINDING } from "./launch-legal-contract.mjs";

const fixture = fileURLToPath(new URL("../tests/integration/legal-receipt-074-fixture.sql", import.meta.url));
const verify = fileURLToPath(new URL("../tests/integration/legal-receipt-076-verify.sql", import.meta.url));
const currentVerify = fileURLToPath(new URL("../tests/integration/legal-receipt-086-verify.sql", import.meta.url));
const sourceSupabase = fileURLToPath(new URL("../supabase/", import.meta.url));
const temporaryRoot = resolve(tmpdir());
let historicalWorkspace;

function prepareHistoricalWorkspace() {
  historicalWorkspace = mkdtempSync(join(temporaryRoot, "applypack-legal-upgrade-"));
  const target = join(historicalWorkspace, "supabase");
  mkdirSync(join(target, "migrations"), { recursive: true });
  mkdirSync(join(target, "templates"));
  copyFileSync(join(sourceSupabase, "config.toml"), join(target, "config.toml"));
  copyFileSync(join(sourceSupabase, "templates", "applypack-code.html"), join(target, "templates", "applypack-code.html"));
  for (const name of readdirSync(join(sourceSupabase, "migrations"))) {
    const version = /^(\d{12})_.+\.sql$/u.exec(name)?.[1];
    if (version && version <= "202610040076") {
      copyFileSync(join(sourceSupabase, "migrations", name), join(target, "migrations", name));
    }
  }
}

function run(command, args, input, echo = true) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000,
  });
  if (echo && result.stdout) process.stdout.write(result.stdout);
  if (echo && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}`);
  return result.stdout;
}

function sqlText(input) {
  return run(
    "docker",
    ["exec", "-i", "supabase_db_applypack", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    input,
  );
}
function sql(path) { return sqlText(readFileSync(path, "utf8")); }

function verifyCurrent() {
  const literal = (value) => `'${value.replaceAll("'", "''")}'`;
  const settings = `select set_config('applypack_test.privacy_version',${literal(LAUNCH_LEGAL_BINDING.privacyVersion)},false),
    set_config('applypack_test.privacy_sha256',${literal(LAUNCH_LEGAL_BINDING.privacyContentSha256)},false);`;
  if (!sqlText(`${settings}\n${readFileSync(currentVerify, "utf8")}`).includes("LEGAL_ACCEPTANCE_CURRENT_UPGRADE_OK")) {
    throw new Error("current legal-receipt upgrade verification marker missing");
  }
}

let failure;
try {
  // Supabase migration up has no target-version flag. Give it an unchanged,
  // bounded source copy so the historical fixture actually runs at schema076.
  prepareHistoricalWorkspace();
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610040074"], undefined, false);
  if (!sql(fixture).includes("LEGAL_ACCEPTANCE_074_FIXTURE_OK")) {
    throw new Error("migration 074 legal-receipt fixture marker missing");
  }
  run("supabase", ["migration", "up", "--local", "--workdir", historicalWorkspace], undefined, false);
  sqlText(`do $$ begin
    if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610040076'
    then raise exception 'unexpected_legal_upgrade_schema'; end if;
  end $$;`);
  if (!sql(verify).includes("LEGAL_ACCEPTANCE_FORWARD_UPGRADE_OK")) {
    throw new Error("migration 076 forward-upgrade verification marker missing");
  }
  run("supabase", ["migration", "up", "--local", "--workdir", historicalWorkspace], undefined, false);
  if (!sql(verify).includes("LEGAL_ACCEPTANCE_FORWARD_UPGRADE_OK")) {
    throw new Error("migration 076 idempotent-replay marker missing");
  }
  sqlText(`create table public.legal_upgrade_preservation_fixture as
    select 'acceptance'::text as kind,to_jsonb(row) as immutable_record
      from public.ap_snapshot_legal_acceptances row where snapshot_id='f5300000-0000-4000-8000-000000000001'
    union all select 'receipt',to_jsonb(row)
      from public.ap_snapshot_legal_content_receipts row where snapshot_id='f5300000-0000-4000-8000-000000000001'
    union all select 'reconciliation',to_jsonb(row)
      from public.ap_legal_receipt_acceptance_reconciliations row
      where receipt_id in(select id from public.ap_snapshot_legal_content_receipts
        where snapshot_id='f5300000-0000-4000-8000-000000000001');`);
  run("supabase", ["migration", "up", "--local"], undefined, false);
  verifyCurrent();
  run("supabase", ["migration", "up", "--local"], undefined, false);
  verifyCurrent();
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"], undefined, false); }
  catch (restoreError) { if (!failure) failure = restoreError; }
  try {
    if (historicalWorkspace) {
      const target = resolve(historicalWorkspace);
      if (dirname(target) !== temporaryRoot || !basename(target).startsWith("applypack-legal-upgrade-")) {
        throw new Error("unsafe temporary legal-upgrade cleanup path");
      }
      rmSync(target, { recursive: true, force: true });
    }
  } catch (cleanupError) { if (!failure) failure = cleanupError; }
}
if (failure) throw failure;

console.log("Migration 074 legal receipts reconcile and replay at 076; latest upgrade preserves history, rejects obsolete privacy, and accepts current consent idempotently.");
