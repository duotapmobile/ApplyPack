import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { proveRehearsalCheckoutConcurrency } from "./rehearsal-checkout-concurrency.mjs";
import { selectRehearsalPredecessors } from "./lib/rehearsal-upgrade-selection.mjs";
import { verifiedSourceRunSeedFixture } from "./lib/verified-source-run-fixture.mjs";

// Destructive operations are pinned to the project's disposable local stack.
// No database URL, linked project or remote credentials are accepted.
import { current091LockedPhaseSql, current092LockedPhaseSql, current093LockedPhaseSql, current094LockedPhaseSql, current095LockedPhaseSql, current096LockedPhaseSql, current097LockedPhaseSql, current098LockedPhaseSql, current099LockedPhaseSql, current100LockedPhaseSql, current101LockedPhaseSql, current102LockedPhaseSql, current103LockedPhaseSql, current104LockedPhaseSql, current105LockedPhaseSql, current106LockedPhaseSql } from "./lib/supabase-upgrade-phases.mjs";

const predecessors = selectRehearsalPredecessors(process.argv.slice(2));
const container = "supabase_db_applypack";
const temporaryRoot = resolve(tmpdir());
const historicalWorkspaces = [];
function prepareHistoricalWorkspace(maximumVersion) {
  const historicalWorkspace = mkdtempSync(join(temporaryRoot, "applypack-rehearsal-upgrade-"));
  historicalWorkspaces.push(historicalWorkspace);
  const source = fileURLToPath(new URL("../supabase/", import.meta.url));
  const target = join(historicalWorkspace, "supabase");
  mkdirSync(join(target, "migrations"), { recursive: true }); mkdirSync(join(target, "templates"));
  copyFileSync(join(source, "config.toml"), join(target, "config.toml"));
  copyFileSync(join(source, "templates", "applypack-code.html"), join(target, "templates", "applypack-code.html"));
  for (const name of readdirSync(join(source, "migrations"))) {
    const version = /^(\d{12})_.+\.sql$/u.exec(name)?.[1];
    if (version && version <= maximumVersion) copyFileSync(join(source, "migrations", name), join(target, "migrations", name));
  }
  return historicalWorkspace;
}
function ownerNoticeFixture(name) {
  if (!["owner-draft-notices-upgrade-seed.sql", "owner-draft-notices-upgrade-verify.sql", "owner-draft-notices.sql"].includes(name)) throw new Error("OWNER_NOTICE_FIXTURE_INVALID");
  const expand = (source, depth = 0) => source.replace(/^\\ir (owner-draft-notices-fixture|employer-rule-review-fixture|reviewed-source-fixture)\.sql\r?$/gm,
    (_line, helper) => {
      if (depth >= 3) throw new Error("OWNER_NOTICE_FIXTURE_INCLUDE_DEPTH");
      return expand(readFileSync(new URL(`../tests/integration/${helper}.sql`, import.meta.url), "utf8"), depth + 1);
    });
  const source = expand(readFileSync(new URL(`../tests/integration/${name}`, import.meta.url), "utf8"));
  if (/^\s*\\/mu.test(source)) throw new Error("OWNER_NOTICE_FIXTURE_INCLUDE_FORBIDDEN");
  return source;
}
function run(command, args, input, includeSuccessfulStderr = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 600_000,
  });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw result.error ?? new Error(`${command} failed with exit ${result.status}`);
  }
  return includeSuccessfulStderr ? result.stdout + result.stderr : result.stdout;
}
function sql(input, { includeNotices = false } = {}) {
  return run("docker", ["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], input, includeNotices);
}
let failure;
try {
  const historicalWorkspace = prepareHistoricalWorkspace("202610230086");
  const rule092Workspace = prepareHistoricalWorkspace("202610250092");
  const source093Workspace = prepareHistoricalWorkspace("202610250093");
  const stage094Workspace = prepareHistoricalWorkspace("202610250094");
  const reference095Workspace = prepareHistoricalWorkspace("202610250095");
  const service096Workspace = prepareHistoricalWorkspace("202610250096");
  const change097Workspace = prepareHistoricalWorkspace("202610250097");
  const archive098Workspace = prepareHistoricalWorkspace("202610250098");
  const repair099Workspace = prepareHistoricalWorkspace("202610250099");
  const research100Workspace = prepareHistoricalWorkspace("202610250100");
  const clarification101Workspace = prepareHistoricalWorkspace("202610250101");
  const case102Workspace = prepareHistoricalWorkspace("202610260102");
  const resume103Workspace = prepareHistoricalWorkspace("202610260103");
  const rule104Workspace = prepareHistoricalWorkspace("202610270104");
  const source105Workspace = prepareHistoricalWorkspace("202610270105");
  const notice106Workspace = prepareHistoricalWorkspace("202610280106");
  for (const predecessor of predecessors) {
    console.log(`Running isolated local upgrade ${predecessor} to 202610280106.`);
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
    if (predecessor <= "202610230086") {
      run("supabase", ["migration", "up", "--local", "--workdir", historicalWorkspace]);
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-086"]);
      if (!historical.includes("Database contract fixtures passed: 19. Schema phase: 202610230086.")) {
        throw new Error("Historical086 lifecycle proof missing");
      }
    } else if (predecessor === "202610240087") {
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-087"]);
      if (!historical.includes("Database contract fixtures passed: 1. Schema phase: 202610240087.")) {
        throw new Error("Historical087 missing-executor guard proof missing");
      }
    }
    if (predecessor === "202610250091") {
      sql(current091LockedPhaseSql);
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-091"]);
      if (!historical.includes("Database contract fixtures passed: 6. Schema phase: 202610250091.")) throw new Error("Historical091 lifecycle proof missing");
      sql(readFileSync(new URL("../tests/integration/material-rule-revalidation-upgrade-seed.sql", import.meta.url), "utf8"));
      run("supabase", ["migration", "up", "--local", "--workdir", rule092Workspace]);
      sql(current092LockedPhaseSql);
      const preservation = sql(readFileSync(new URL("../tests/integration/material-rule-revalidation-upgrade-verify.sql", import.meta.url), "utf8"));
      if (!preservation.includes("MATERIAL_RULE_092_UPGRADE_PRESERVED")) throw new Error("Rule092 historical preservation marker missing");
    }
    if (predecessor === "202610250091" || predecessor === "202610250092") {
      sql(current092LockedPhaseSql);
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-092"]);
      if (!historical.includes("Database contract fixtures passed: 7. Schema phase: 202610250092.")) throw new Error("Historical092 lifecycle proof missing");
      sql(readFileSync(new URL("../tests/integration/source-aware-document-upgrade-seed.sql", import.meta.url), "utf8"));
      run("supabase", ["migration", "up", "--local", "--workdir", source093Workspace]);
      sql(current093LockedPhaseSql);
      const preservation = sql(readFileSync(new URL("../tests/integration/source-aware-document-upgrade-verify.sql", import.meta.url), "utf8"));
      if (!preservation.includes("SOURCE_AWARE_093_UPGRADE_PRESERVED")) throw new Error("Source093 historical preservation marker missing");
    }
    if (predecessor >= "202610250091" && predecessor <= "202610250093") {
      sql(current093LockedPhaseSql);
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-093"]);
      if (!historical.includes("Database contract fixtures passed: 8. Schema phase: 202610250093.")) throw new Error("Historical093 lifecycle proof missing");
      sql(readFileSync(new URL("../tests/integration/material-draft-stage-upgrade-seed.sql", import.meta.url), "utf8"));
      run("supabase", ["migration", "up", "--local", "--workdir", stage094Workspace]);
      sql(current094LockedPhaseSql);
      const preservation = sql(readFileSync(new URL("../tests/integration/material-draft-stage-upgrade-verify.sql", import.meta.url), "utf8"));
      if (!preservation.includes("DRAFT_STAGE_094_UPGRADE_PRESERVED")) throw new Error("Stage094 historical preservation marker missing");
    }
    if (predecessor >= "202610250091" && predecessor <= "202610250094") {
      sql(current094LockedPhaseSql);
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-094"]);
      if (!historical.includes("Database contract fixtures passed: 9. Schema phase: 202610250094.")) throw new Error("Historical094 lifecycle proof missing");
      sql(readFileSync(new URL("../tests/integration/reference-draft-upgrade-seed.sql", import.meta.url), "utf8"));
    }
    if (predecessor <= "202610250095") {
    run("supabase", ["migration", "up", "--local", "--workdir", reference095Workspace]);
    sql(current095LockedPhaseSql);
    if (predecessor >= "202610250091" && predecessor <= "202610250094") {
      const preservation = sql(readFileSync(new URL("../tests/integration/reference-draft-upgrade-verify.sql", import.meta.url), "utf8"));
      if (!preservation.includes("REFERENCE_DRAFT_095_UPGRADE_PRESERVED")) throw new Error("Reference095 historical preservation marker missing");
    }
    if (predecessor === "202610250095") {
      const historical = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-095"]);
      if (!historical.includes("Database contract fixtures passed: 10. Schema phase: 202610250095.")) throw new Error("Historical095 lifecycle proof missing");
    }
    sql(readFileSync(new URL("../tests/integration/service-error-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", service096Workspace]);
    sql(current096LockedPhaseSql);
    const servicePreservation = sql(readFileSync(new URL("../tests/integration/service-error-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!servicePreservation.includes("SERVICE_ERROR_096_UPGRADE_PRESERVED")) throw new Error("Service096 historical preservation marker missing");
    }
    if (predecessor <= "202610250096") {
    sql(current096LockedPhaseSql);
    const historical096 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-096"]);
    if (!historical096.includes("Database contract fixtures passed: 11. Schema phase: 202610250096.")) throw new Error("Historical096 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/draft-change-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", change097Workspace]);
    sql(current097LockedPhaseSql);
    const changePreservation = sql(readFileSync(new URL("../tests/integration/draft-change-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!changePreservation.includes("DRAFT_CHANGE_097_UPGRADE_PRESERVED")) throw new Error("DraftChange097 historical preservation marker missing");
    }
    if (predecessor <= "202610250097") {
    sql(current097LockedPhaseSql);
    const historical097 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-097"]);
    if (!historical097.includes("Database contract fixtures passed: 12. Schema phase: 202610250097.")) throw new Error("Historical097 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/archive-lifecycle-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", archive098Workspace]);
    sql(current098LockedPhaseSql);
    const archivePreservation = sql(readFileSync(new URL("../tests/integration/archive-lifecycle-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!archivePreservation.includes("ARCHIVE_LIFECYCLE_098_UPGRADE_PRESERVED")) throw new Error("Archive098 historical preservation marker missing");
    }
    if (predecessor <= "202610250098") {
    sql(current098LockedPhaseSql);
    const historical098 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-098"]);
    if (!historical098.includes("Database contract fixtures passed: 13. Schema phase: 202610250098.")) throw new Error("Historical098 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/service-repair-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", repair099Workspace]);
    sql(current099LockedPhaseSql);
    const repairPreservation = sql(readFileSync(new URL("../tests/integration/service-repair-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!repairPreservation.includes("SERVICE_REPAIR_099_UPGRADE_PRESERVED")) throw new Error("Repair099 historical preservation marker missing");
    }
    if (predecessor <= "202610250099") {
    sql(current099LockedPhaseSql);
    const historical099 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-099"]);
    if (!historical099.includes("Database contract fixtures passed: 14. Schema phase: 202610250099.")) throw new Error("Historical099 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/research-preparation-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", research100Workspace]);
    sql(current100LockedPhaseSql);
    const researchPreservation = sql(readFileSync(new URL("../tests/integration/research-preparation-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!researchPreservation.includes("AUTOMATIC_RESEARCH_100_UPGRADE_PRESERVED")) throw new Error("Research100 historical preservation marker missing");
    }
    if (predecessor <= "202610250100") {
    sql(current100LockedPhaseSql);
    const historical100 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-100"]);
    if (!historical100.includes("Database contract fixtures passed: 15. Schema phase: 202610250100.")) throw new Error("Historical100 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/material-clarification-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", clarification101Workspace]);
    sql(current101LockedPhaseSql);
    const clarificationPreservation = sql(readFileSync(new URL("../tests/integration/material-clarification-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!clarificationPreservation.includes("MATERIAL_CLARIFICATION_101_UPGRADE_PRESERVED")) throw new Error("Clarification101 historical preservation marker missing");
    }
    if (predecessor <= "202610250101") {
    sql(current101LockedPhaseSql);
    const historical101 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-101"]);
    if (!historical101.includes("Database contract fixtures passed: 16. Schema phase: 202610250101.")) throw new Error("Historical101 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/service-repair-case-state-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", case102Workspace]);
    sql(current102LockedPhaseSql);
    const casePreservation = sql(readFileSync(new URL("../tests/integration/service-repair-case-state-upgrade-verify.sql", import.meta.url), "utf8"));
    if (!casePreservation.includes("SERVICE_REPAIR_CASE_STATE_102_UPGRADE_PRESERVED")) throw new Error("CaseState102 historical preservation marker missing");
    }
    if (predecessor <= "202610260102") {
      sql(current102LockedPhaseSql);
      const historical102 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-102"]);
      if (!historical102.includes("Database contract fixtures passed: 17. Schema phase: 202610260102.")) throw new Error("Historical102 lifecycle proof missing");
      sql(readFileSync(new URL("../tests/integration/material-clarification-resume-upgrade-seed.sql", import.meta.url), "utf8"));
      run("supabase", ["migration", "up", "--local", "--workdir", resume103Workspace]);
      const resumePreservation = sql(readFileSync(new URL("../tests/integration/material-clarification-resume-upgrade-verify.sql", import.meta.url), "utf8"));
      if (!resumePreservation.includes("MATERIAL_CLARIFICATION_RESUME_103_UPGRADE_PRESERVED")) throw new Error("Resume103 historical preservation marker missing");
    }
    if (predecessor <= "202610260103") {
    sql(current103LockedPhaseSql);
    const historical103 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-103"]);
    if (!historical103.includes("Database contract fixtures passed: 20. Schema phase: 202610260103.")) throw new Error("Historical103 lifecycle proof missing");
    sql(readFileSync(new URL("../tests/integration/employer-rule-review-upgrade-seed.sql", import.meta.url), "utf8"));
    run("supabase", ["migration", "up", "--local", "--workdir", rule104Workspace]);
    const rulePreservation = sql(readFileSync(new URL("../tests/integration/employer-rule-review-upgrade-preservation.sql", import.meta.url), "utf8"));
    if (!rulePreservation.includes("EMPLOYER_RULE_REVIEW_104_UPGRADE_PRESERVED")) throw new Error("Employer rule104 historical preservation marker missing");
    }
    if (predecessor <= "202610270104") {
    sql(current104LockedPhaseSql);
    const historical104 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-104"]);
    if (!historical104.includes("Database contract fixtures passed: 21. Schema phase: 202610270104.")) throw new Error("Historical104 lifecycle proof missing");
    const sourceBindingFixture = readFileSync(new URL("../tests/integration/verified-source-run-binding.sql", import.meta.url), "utf8");
    const sourceSeed = sql(verifiedSourceRunSeedFixture(sourceBindingFixture), { includeNotices: true });
    if (!sourceSeed.includes("VERIFIED_SOURCE_RUN_BINDING_104_SEEDED")) throw new Error("Source105 historical seed marker missing");
    run("supabase", ["migration", "up", "--local", "--workdir", source105Workspace]);
    const sourcePreservation = sql(sourceBindingFixture, { includeNotices: true });
    if (!sourcePreservation.includes("VERIFIED_SOURCE_RUN_BINDING_105_UPGRADE_PRESERVED")) throw new Error("Source105 historical preservation marker missing");
    }
    sql(current105LockedPhaseSql);
    const historical105 = run(process.execPath, ["scripts/run-supabase-db-tests-v2.mjs", "--historical-105"]);
    if (!historical105.includes("Database contract fixtures passed: 22. Schema phase: 202610270105.")) throw new Error("Historical105 lifecycle proof missing");
    const noticeSeed = sql(ownerNoticeFixture("owner-draft-notices-upgrade-seed.sql"), { includeNotices: true });
    if (!noticeSeed.includes("OWNER_DRAFT_READY_NOTICES_105_SEEDED")) throw new Error("Owner notice106 historical seed marker missing");
    run("supabase", ["migration", "up", "--local", "--workdir", notice106Workspace]);
    const noticePreservation = sql(ownerNoticeFixture("owner-draft-notices-upgrade-verify.sql"), { includeNotices: true });
    if (!noticePreservation.includes("OWNER_DRAFT_READY_NOTICES_106_UPGRADE_PRESERVED")) throw new Error("Owner notice106 historical preservation marker missing");
    sql(current106LockedPhaseSql);
    const result = sql(`
      do $$ begin
        if public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '202610280106'
          or public.ap_manual_launch_schema_readiness()->>'ready' is distinct from 'true'
          or not public.ap_one_off_retention_schema_installed()
          or not public.ap_material_draft_pair_schema_installed()
          or not public.ap_source_aware_document_schema_installed()
          or not public.ap_material_draft_stage_claiming_schema_installed()
          or not public.ap_reference_aware_draft_schema_installed()
          or not public.ap_service_error_triage_schema_installed()
          or not public.ap_material_draft_change_schema_installed()
          or not public.ap_service_repair_schema_installed()
          or not public.ap_automatic_research_schema_installed()
          or not public.ap_material_clarification_schema_installed()
          or not public.ap_service_repair_case_state_schema_installed()
          or not public.ap_material_clarification_resume_schema_installed()
          or not public.ap_employer_rule_review_schema_installed()
          or not public.ap_verified_source_run_schema_installed()
          or not public.ap_owner_draft_notices_schema_installed()
          or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled)
          or not public.ap_protected_archive_schema_installed()
          or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
          or exists(select 1 from public.ap_archive_writer_runs)
          or exists(select 1 from public.ap_archive_retention_runs)
          or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
          or public.ap_manual_launch_schema_readiness()->'requiredMigrations' is distinct from jsonb_build_array(
            '202610040077','202610040078','202610040079','202610040080','202610190081',
            '202610190082','202610190083','202610190084','202610220085','202610230086','202610240087',
            '202610250088','202610250089','202610250090','202610250091','202610250092','202610250093','202610250094','202610250095','202610250096','202610250097','202610250098','202610250099','202610250100','202610250101','202610260102','202610260103','202610270104','202610270105','202610280106')
          or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
          or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
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
       select 'REHEARSAL_UPGRADE_${predecessor}_TO_106_OK';
    `);
    if (!result.includes(`REHEARSAL_UPGRADE_${predecessor}_TO_106_OK`)) throw new Error("Upgrade proof marker missing");
    // The retained105 graph contains actionable owner work. Legacy singleton
    // queue fixtures run on the fresh current database in required database-core;
    // keep those obligations here and exercise the106 lifecycle around them.
    const ownerLifecycle = sql(ownerNoticeFixture("owner-draft-notices.sql"), { includeNotices: true });
    if (!ownerLifecycle.includes("OWNER_DRAFT_READY_NOTICES_CONTRACT_OK")) throw new Error("Retained owner notice lifecycle proof missing");
    const retainedAfterLifecycle = sql(ownerNoticeFixture("owner-draft-notices-upgrade-verify.sql"), { includeNotices: true });
    if (!retainedAfterLifecycle.includes("OWNER_DRAFT_READY_NOTICES_106_UPGRADE_PRESERVED")) throw new Error("Post-lifecycle paid history proof missing");
    sql(current106LockedPhaseSql);
    console.log(`PASS: isolated local upgrade ${predecessor} to 202610280106; paid history preserved before and after owner notice lifecycle; purchasing remains locked. Fresh current contracts are required separately by database-core.`);
  }
  // Positive checkout concurrency belongs to the unchanged historical contract.
  // The historical087 fixture independently proves missing executors block checkout.
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610230086"]);
  await proveRehearsalCheckoutConcurrency();
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"]); }
  catch (error) { if (!failure) failure = error; }
  try {
    for (const historicalWorkspace of historicalWorkspaces) {
      const target = resolve(historicalWorkspace);
      if (dirname(target) !== temporaryRoot || !basename(target).startsWith("applypack-rehearsal-upgrade-")) throw new Error("UNSAFE_UPGRADE_CLEANUP_PATH");
      rmSync(target, { recursive: true, force: true });
    }
  } catch (error) { if (!failure) failure = error; }
}
if (failure) throw failure;
console.log(process.argv.length === 2
  ? "All twenty-six launch upgrade predecessors passed; latest disposable local schema restored."
  : `Selected launch upgrade predecessor ${predecessors[0]} passed; latest disposable local schema restored.`);
