import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { current100LockedPhaseSql, historical086PhaseSql, prepareHistorical086Workspace } from "./lib/supabase-upgrade-phases.mjs";

const seed = fileURLToPath(new URL("../tests/integration/legacy-board-083-upgrade-seed.sql", import.meta.url));
const verify = fileURLToPath(new URL("../tests/integration/legacy-board-084-upgrade-verify.sql", import.meta.url));

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
    ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    input,
  );
}
function sql(path) { return sqlText(readFileSync(path, "utf8")); }

const preservedBoardRows = `
  select 'subscription'::text as kind,to_jsonb(row) as immutable_record from public.ap_board_subscriptions row
  union all select 'provider_event',to_jsonb(row) from public.ap_board_provider_events row
`;
const expectedReplayedBoardRows = `
  select fixture.kind,case
    when fixture.kind='subscription' then
      jsonb_set(fixture.immutable_record,'{updated_at}',to_jsonb(subscription.updated_at))
    when fixture.kind='provider_event' and fixture.immutable_record->>'provider_event_id'='evt_upgrade_stale_refund' then
      jsonb_set(fixture.immutable_record,'{resulting_state}','"REFUNDED"'::jsonb)
    when fixture.kind='provider_event' and fixture.immutable_record->>'provider_event_id'='evt_upgrade_stale_dispute' then
      jsonb_set(fixture.immutable_record,'{resulting_state}','"DISPUTED"'::jsonb)
    else fixture.immutable_record end as immutable_record
  from public.board_retention_upgrade_preservation_fixture fixture
  left join public.ap_board_subscriptions subscription
    on fixture.kind='subscription' and subscription.id::text=fixture.immutable_record->>'id'
`;

let failure;
let historicalWorkspace;
try {
  historicalWorkspace = prepareHistorical086Workspace();
  run("supabase", ["db", "reset", "--local", "--no-seed", "--version", "202610190083"], undefined, false);
  if (!sql(seed).includes("LEGACY_BOARD_083_UPGRADE_SEED_OK")) {
    throw new Error("migration 083 legacy-board upgrade seed marker missing");
  }
  run("supabase", ["migration", "up", "--local", "--workdir", historicalWorkspace.path], undefined, false);
  sqlText(historical086PhaseSql);
  if (!sql(verify).includes("LEGACY_BOARD_084_UPGRADE_VERIFY_OK")) {
    throw new Error("migration 084 legacy-board upgrade verification marker missing");
  }
  sqlText(`create table public.board_retention_upgrade_preservation_fixture as ${preservedBoardRows};`);
  run("supabase", ["migration", "up", "--local"], undefined, false);
  sqlText(`${current100LockedPhaseSql}
    begin;
    do $$ declare replay_started_at timestamptz; begin
      -- The migration itself must preserve every field, including timestamps
      -- and the still-unreconciled historical receipt state.
      if exists(
        (select * from public.board_retention_upgrade_preservation_fixture except all (${preservedBoardRows}))
        union all
        ((${preservedBoardRows}) except all select * from public.board_retention_upgrade_preservation_fixture)
      ) then raise exception 'retention_087_changed_legacy_board_history'; end if;
      replay_started_at:=clock_timestamp();
      if public.ap_apply_legacy_board_terminal_event(
        'sub_upgrade_refund','evt_upgrade_stale_refund','refund.updated',100,'REFUNDED','FULL',
        're_upgrade_refund',null,4499,4499)->>'replayed' is distinct from 'true'
      or public.ap_apply_legacy_board_terminal_event(
        'sub_upgrade_dispute','evt_upgrade_stale_dispute','charge.dispute.created',101,'DISPUTED',null,
        null,'dp_upgrade_dispute',4499,4499)->>'replayed' is distinct from 'true'
      then raise exception 'retention_087_legacy_terminal_replay_not_recognized'; end if;
      -- The unchanged084 reconciliation routine repairs these two receipt
      -- states and refreshes updated_at. No other replay change is allowed.
      if exists(
        ((${expectedReplayedBoardRows}) except all (${preservedBoardRows}))
        union all
        ((${preservedBoardRows}) except all (${expectedReplayedBoardRows}))
      ) or exists(
        select 1 from public.board_retention_upgrade_preservation_fixture fixture
        join public.ap_board_subscriptions subscription
          on fixture.kind='subscription' and subscription.id::text=fixture.immutable_record->>'id'
        where subscription.updated_at<replay_started_at or subscription.updated_at>clock_timestamp()
          or subscription.updated_at<(fixture.immutable_record->>'updated_at')::timestamptz
      ) or public.ap_legacy_board_has_access('3b000000-0000-4000-8000-000000000001',now())
        or public.ap_legacy_board_has_access('3b000000-0000-4000-8000-000000000002',now())
      then raise exception 'retention_087_legacy_replay_changed_unrelated_history_or_access'; end if;
    end $$;
    rollback;
    select 'LEGACY_BOARD_087_PRESERVATION_OK';`);
} catch (error) {
  failure = error;
} finally {
  try { run("supabase", ["db", "reset", "--local", "--no-seed"], undefined, false); }
  catch (restoreError) { if (!failure) failure = restoreError; }
  try { historicalWorkspace?.dispose(); }
  catch (cleanupError) { if (!failure) failure = cleanupError; }
}
if (failure) throw failure;

console.log("Migration083 legacy board entitlements pass historical086 verification;090 preserves terminal replay integrity with purchasing locked.");
