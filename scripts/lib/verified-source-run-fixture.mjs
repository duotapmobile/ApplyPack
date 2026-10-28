/** Retain only the explicit exact104 upgrade seed. Ordinary fixture executions
 * remain rollback-only. Both source and emitted bytes belong in proof receipts. */
export function verifiedSourceRunSeedFixture(source) {
  if (typeof source !== "string" || source.length > 2 * 1024 * 1024
    || (source.match(/^begin;\r?$/gmu) || []).length !== 1
    || (source.match(/^rollback;\r?$/gmu) || []).length !== 1
    || /^commit;\r?$/mu.test(source)
    || !/\r?\nrollback;\r?\n?$/u.test(source)
    || !source.includes("applypack.fixture_source_run_binding_seed")
    || !source.includes("verified_source_run_upgrade_exact104_required")
    || !source.includes("202610270104")) {
    throw new Error("SOURCE_RUN_SEED_FIXTURE_BOUNDARY_INVALID");
  }
  return "do $$ begin if (select max(version) from supabase_migrations.schema_migrations) is distinct from '202610270104'"
    + " or to_regprocedure('public.ap_verified_source_run_schema_installed()') is not null"
    + " then raise exception 'verified_source_run_seed_exact104_required'; end if; end $$;\n"
    + "set applypack.fixture_source_run_binding_seed='true';\n"
    + source.replace(/\r?\nrollback;\r?\n?$/u, "\ncommit;\n")
    + "reset applypack.fixture_source_run_binding_seed;\n";
}
