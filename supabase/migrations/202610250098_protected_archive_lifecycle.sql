-- Local archive lifecycle foundation. No hosted deletion or enablement.
-- A durable fence deliberately has no automatic expiry: a timed-out S3 request
-- may still complete. Only exact reconciliation may unlock source mutations.
begin;
create table public.ap_archive_lifecycle_configuration(
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 writer_protocol text not null default 'archive-lifecycle-v1' check(writer_protocol='archive-lifecycle-v1'));
insert into public.ap_archive_lifecycle_configuration(singleton) values(true);
create table public.ap_archive_writer_runs(
 id uuid primary key, kind text not null check(kind in('FILE','DATABASE')), release_sha text not null check(release_sha~'^[a-f0-9]{40}$'),
 state text not null default 'OPEN' check(state in('OPEN','COMPLETE','CANCELED')), started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz, result_sha256 text check(result_sha256~'^[a-f0-9]{64}$'), provider_dispatched boolean not null default false,
 completion_receipt jsonb,
 check((state='OPEN')=(finished_at is null)),check(state<>'COMPLETE' or result_sha256 is not null and completion_receipt is not null));
create table public.ap_archive_retention_runs(
 id uuid primary key, release_sha text not null check(release_sha~'^[a-f0-9]{40}$'),
 state text not null default 'FENCED' check(state in('FENCED','PLANNED','DISPATCHING','RECONCILIATION_REQUIRED','COMPLETE','CANCELED')),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
 plan_sha256 text check(plan_sha256~'^[a-f0-9]{64}$'), proof_sha256 text check(proof_sha256~'^[a-f0-9]{64}$'),
 inventory_sha256 text check(inventory_sha256~'^[a-f0-9]{64}$'), completion_receipt jsonb,
 check((state in('COMPLETE','CANCELED'))=(finished_at is not null)));
create unique index ap_archive_single_retention_fence on public.ap_archive_retention_runs((true)) where state not in('COMPLETE','CANCELED');
create table public.ap_archive_retention_versions(
 run_id uuid not null references public.ap_archive_retention_runs(id), archive_key text not null,
 version_id text not null check(length(version_id) between 1 and 1024 and version_id<>'null' and version_id~'^[A-Za-z0-9._~+/=:-]+$'),
 state text not null default 'PLANNED' check(state in('PLANNED','DISPATCHED','ABSENT','RETAINED')),
 identity_sha256 text not null check(identity_sha256~'^[a-f0-9]{64}$'), dispatched_at timestamptz,
 observed_at timestamptz, observation_sha256 text check(observation_sha256~'^[a-f0-9]{64}$'),
 primary key(run_id,archive_key,version_id),
 check(archive_key~'^objects/(customer-source-documents|customer-deliveries|operator-drafts|operator-render-previews)/[a-f0-9]{64}$'
    or archive_key~'^manifests/[a-f0-9]{64}\.json$'),
 check((state in('DISPATCHED','ABSENT'))=(dispatched_at is not null)),check((state='ABSENT')=(observed_at is not null)));
create table public.ap_archive_fence_relations(schema_name name not null,table_name name not null,primary key(schema_name,table_name));
create table public.ap_archive_fence_function_contracts(signature text primary key,definition_sha256 text not null check(definition_sha256~'^[a-f0-9]{64}$'));

do $$ declare t text; begin
 foreach t in array array['ap_archive_lifecycle_configuration','ap_archive_writer_runs','ap_archive_retention_runs','ap_archive_retention_versions','ap_archive_fence_relations','ap_archive_fence_function_contracts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function public.ap_archive_fence_active() returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.ap_archive_retention_runs where state not in('COMPLETE','CANCELED'));
$$;
create function public.ap_guard_archive_source_mutation() returns trigger language plpgsql security definer set search_path='' as $$
declare old_bucket text; new_bucket text;
begin
 if tg_table_schema='storage' and tg_op<>'TRUNCATE' then
  if tg_op in('INSERT','UPDATE') then new_bucket:=case when tg_table_name='buckets' then to_jsonb(new)->>'id' else to_jsonb(new)->>'bucket_id' end; end if;
  if tg_op in('DELETE','UPDATE') then old_bucket:=case when tg_table_name='buckets' then to_jsonb(old)->>'id' else to_jsonb(old)->>'bucket_id' end; end if;
  if new_bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews') then null;
  elsif old_bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews') then null;
  else if tg_op='DELETE' then return old; else return new; end if; end if;
 end if;
 perform pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then
  raise exception using errcode='40001',message='archive_maintenance_retry_required';
 end if;
 if tg_level='STATEMENT' then return null; elsif tg_op='DELETE' then return old; else return new; end if;
end $$;

-- Finite alias/ownership/paid/hold graph plus the existing private-table registry.
-- Auth users, audit intake and webhook_events are intentionally not blocked.
insert into public.ap_archive_fence_relations
 select 'public',table_name from public.ap_retention_private_tables
 union select 'public',unnest(array[
 'orders','payments','ap_releases','ap_search_services','ap_material_lines','ap_material_purchases',
 'ap_material_checkout_intents','ap_material_checkout_items','ap_material_checkout_references','ap_payment_attempts','ap_refund_operations',
 'ap_checkout_attempts','ap_checkout_initiations','ap_outbox_messages','ap_order_retention_contracts','ap_retention_checkout_contracts',
 'ap_service_retention_holds','ap_service_retention_claims','ap_service_retention_objects','ap_reference_regenerations',
 'ap_retention_private_tables','ap_retention_row_receipts','ap_retention_restore_lock','ap_retention_restored_object_tombstones',
 'ap_retention_restored_object_policies','ap_retention_restored_order_protection','ap_retention_legacy_object_intents','ap_unpaid_source_cleanup'
 ]::name[])
 union select 'storage','objects'
 union select 'storage','buckets';
do $$ declare r record; begin
 for r in select * from public.ap_archive_fence_relations order by schema_name,table_name loop
  if to_regclass(format('%I.%I',r.schema_name,r.table_name)) is null then raise exception 'archive_fence_relation_missing:%',r.table_name; end if;
  if r.schema_name='storage' then
   execute format('create trigger ap_archive_source_mutation before insert or update or delete on storage.%I for each row execute function public.ap_guard_archive_source_mutation()',r.table_name);
   execute format('create trigger ap_archive_source_truncate before truncate on storage.%I for each statement execute function public.ap_guard_archive_source_mutation()',r.table_name);
  else
   execute format('create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.%I for each statement execute function public.ap_guard_archive_source_mutation()',r.table_name);
  end if;
 end loop;
end $$;
insert into public.ap_archive_fence_function_contracts
 select signature,encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex') from unnest(array[
 'public.ap_retention_row_customers(text,jsonb)','public.ap_retention_object_references()',
 'public.ap_service_retention_order_protected(uuid)','public.ap_service_retention_customer_protected(uuid)',
 'public.ap_service_retention_order_protected_before_096(uuid)','public.ap_service_retention_deadlines(uuid)','public.ap_retention_snapshot_customers(uuid)',
 'public.ap_retention_cleanup_blocked(uuid)','public.ap_service_retention_customer_expiry(uuid)',
 'public.ap_service_retention_object_policies()','public.ap_export_service_retention_overlay()'
 ]) signature;
create function public.ap_archive_fence_coverage_current() returns boolean language sql stable security definer set search_path='' as $$
 select (select count(*)=11 from public.ap_archive_fence_function_contracts)
  and not exists(select 1 from unnest(array[
   'public.ap_retention_row_customers(text,jsonb)','public.ap_retention_object_references()',
   'public.ap_service_retention_order_protected(uuid)','public.ap_service_retention_customer_protected(uuid)',
   'public.ap_service_retention_order_protected_before_096(uuid)','public.ap_service_retention_deadlines(uuid)','public.ap_retention_snapshot_customers(uuid)',
   'public.ap_retention_cleanup_blocked(uuid)','public.ap_service_retention_customer_expiry(uuid)',
   'public.ap_service_retention_object_policies()','public.ap_export_service_retention_overlay()'
  ]) required(signature) where not exists(select 1 from public.ap_archive_fence_function_contracts c where c.signature=required.signature))
  and not exists(select 1 from public.ap_archive_fence_function_contracts c where
    to_regprocedure(c.signature) is null or encode(extensions.digest(pg_get_functiondef(to_regprocedure(c.signature)),'sha256'),'hex')<>c.definition_sha256)
  and not exists(select 1 from unnest(array[
   'orders','payments','ap_releases','ap_search_services','ap_material_lines','ap_material_purchases',
   'ap_material_checkout_intents','ap_material_checkout_items','ap_material_checkout_references','ap_payment_attempts','ap_refund_operations',
   'ap_checkout_attempts','ap_checkout_initiations','ap_outbox_messages','ap_order_retention_contracts','ap_retention_checkout_contracts',
   'ap_service_retention_holds','ap_service_retention_claims','ap_service_retention_objects','ap_reference_regenerations',
   'ap_retention_private_tables','ap_retention_row_receipts','ap_retention_restore_lock','ap_retention_restored_object_tombstones',
   'ap_retention_restored_object_policies','ap_retention_restored_order_protection','ap_retention_legacy_object_intents','ap_unpaid_source_cleanup'
  ]) required(table_name) where not exists(select 1 from public.ap_archive_fence_relations r where r.schema_name='public' and r.table_name=required.table_name))
  and (select count(*)=2 from public.ap_archive_fence_relations where schema_name='storage' and table_name in('objects','buckets'))
  and not exists(select 1 from public.ap_retention_private_tables p where not exists(select 1 from public.ap_archive_fence_relations r where r.schema_name='public' and r.table_name=p.table_name))
  and not exists(select 1 from public.ap_archive_fence_relations r where not exists(
   select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname=r.schema_name and c.relname=r.table_name and t.tgname='ap_archive_source_mutation' and t.tgenabled='O'
    and t.tgfoid='public.ap_guard_archive_source_mutation()'::regprocedure))
  and not exists(select 1 from public.ap_archive_fence_relations r where r.schema_name='storage' and not exists(
   select 1 from pg_trigger where tgrelid=to_regclass(format('%I.%I',r.schema_name,r.table_name)) and tgname='ap_archive_source_truncate' and tgenabled='O'
    and tgfoid='public.ap_guard_archive_source_mutation()'::regprocedure));
$$;
create function public.ap_assert_archive_lifecycle() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and enabled)
  or not public.ap_archive_fence_coverage_current() then raise exception 'archive_lifecycle_disabled_or_unverified'; end if;
end $$;

create function public.ap_begin_archive_writer(p_id uuid,p_kind text,p_release_sha text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_writer_runs;
begin
 perform pg_advisory_xact_lock(6384910250098); perform public.ap_assert_archive_lifecycle();
 select * into r from public.ap_archive_writer_runs where id=p_id for update;
 if found then
  if r.kind is distinct from p_kind or r.release_sha is distinct from p_release_sha then raise exception 'archive_writer_replay_mismatch'; end if;
  return to_jsonb(r);
 end if;
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 insert into public.ap_archive_writer_runs(id,kind,release_sha) values(p_id,p_kind,p_release_sha) returning * into r;
 return to_jsonb(r);
end $$;
-- Exact finite ASCII metadata has the same sorted-key compact JSON encoding as
-- the server's receipt digest. This is a structural receipt check, not a claim
-- that PostgreSQL independently contacted S3 or authenticated provider bytes.
create function public.ap_archive_writer_receipt_sha256(p_receipt jsonb) returns text
language sql immutable security definer set search_path='' as $$
 select encode(extensions.digest('{'||string_agg(to_json(key)::text||':'||value::text,',' order by key)||'}','sha256'),'hex') from jsonb_each(p_receipt);
$$;
create function public.ap_finish_archive_writer(p_id uuid,p_result_sha256 text,p_cancel boolean default false,p_completion_receipt jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_writer_runs; target text:=case when p_cancel then 'CANCELED' else 'COMPLETE' end; k text;
begin
 perform pg_advisory_xact_lock(6384910250098);
 select * into strict r from public.ap_archive_writer_runs where id=p_id for update;
 if p_cancel is null or p_result_sha256 is null or p_result_sha256!~'^[a-f0-9]{64}$' then raise exception 'archive_writer_result_required'; end if;
 if p_cancel and (r.provider_dispatched or p_completion_receipt is not null) then raise exception 'archive_writer_reconciliation_required'; end if;
 if r.state<>'OPEN' then
  if r.state<>target or r.result_sha256<>p_result_sha256 or r.completion_receipt is distinct from p_completion_receipt then raise exception 'archive_writer_replay_mismatch'; end if;
  return to_jsonb(r);
 end if;
 if not p_cancel then
  if not r.provider_dispatched or p_completion_receipt is null or jsonb_typeof(p_completion_receipt)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(p_completion_receipt) key) is distinct from array[
    'applicationCheckpointSha256','databaseSnapshotAt','evidenceExpiresAt','inventoryDigest','kind','manifestSha256','manifestVersionId',
    'pairedFileManifestSha256','pairedFileManifestVersionId','providerVerificationSha256','releaseSha','runId','schemaVersion',
    'snapshotSchemaVersion','sourceProjectRef','sourceWatermark','verifiedAt'] then raise exception 'archive_writer_receipt_shape'; end if;
  foreach k in array array['applicationCheckpointSha256','inventoryDigest','manifestSha256','pairedFileManifestSha256','providerVerificationSha256'] loop
   if jsonb_typeof(p_completion_receipt->k)<>'string' or p_completion_receipt->>k!~'^[a-f0-9]{64}$' then raise exception 'archive_writer_receipt_shape'; end if;
  end loop;
  foreach k in array array['schemaVersion','runId','kind','releaseSha','sourceProjectRef'] loop
   if jsonb_typeof(p_completion_receipt->k)<>'string' then raise exception 'archive_writer_receipt_shape'; end if;
  end loop;
  foreach k in array array['manifestVersionId','pairedFileManifestVersionId'] loop
   if jsonb_typeof(p_completion_receipt->k)<>'string' or length(p_completion_receipt->>k) not between 1 and 1024
    or p_completion_receipt->>k='null' or p_completion_receipt->>k!~'^[A-Za-z0-9._~+/=:-]+$' then raise exception 'archive_writer_receipt_shape'; end if;
  end loop;
  if p_completion_receipt->>'schemaVersion'<>'applypack-archive-writer-completion-v1'
   or p_completion_receipt->>'runId'<>r.id::text or p_completion_receipt->>'kind'<>r.kind
   or p_completion_receipt->>'releaseSha'<>r.release_sha or p_completion_receipt->>'sourceProjectRef'<>'spjaaxndiduhrcleazwb'
   or p_result_sha256 is distinct from public.ap_archive_writer_receipt_sha256(p_completion_receipt) then raise exception 'archive_writer_receipt_binding'; end if;
  foreach k in array array['sourceWatermark','verifiedAt','evidenceExpiresAt'] loop
   if jsonb_typeof(p_completion_receipt->k)<>'string' or p_completion_receipt->>k!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9:]+)$' then raise exception 'archive_writer_receipt_shape'; end if;
  end loop;
  if (p_completion_receipt->>'verifiedAt')::timestamptz>clock_timestamp()
   or (p_completion_receipt->>'verifiedAt')::timestamptz<r.started_at
   or clock_timestamp()-(p_completion_receipt->>'verifiedAt')::timestamptz>interval '60 seconds'
   or clock_timestamp()-r.started_at>interval '5 minutes'
   or (p_completion_receipt->>'sourceWatermark')::timestamptz>(p_completion_receipt->>'verifiedAt')::timestamptz
   or (p_completion_receipt->>'verifiedAt')::timestamptz-(p_completion_receipt->>'sourceWatermark')::timestamptz>interval '10 minutes'
   or (p_completion_receipt->>'evidenceExpiresAt')::timestamptz<>(p_completion_receipt->>'sourceWatermark')::timestamptz+interval '15 minutes'
   then raise exception 'archive_writer_receipt_time'; end if;
  if r.kind='DATABASE' then
   if jsonb_typeof(p_completion_receipt->'snapshotSchemaVersion')<>'string' or p_completion_receipt->>'snapshotSchemaVersion'!~'^20261025009[0-9]$'
    or jsonb_typeof(p_completion_receipt->'databaseSnapshotAt')<>'string'
    or (p_completion_receipt->>'databaseSnapshotAt')::timestamptz<r.started_at
    or (p_completion_receipt->>'databaseSnapshotAt')::timestamptz>(p_completion_receipt->>'verifiedAt')::timestamptz
    or (p_completion_receipt->>'sourceWatermark')::timestamptz>(p_completion_receipt->>'databaseSnapshotAt')::timestamptz then raise exception 'archive_writer_receipt_database'; end if;
  elsif p_completion_receipt->'snapshotSchemaVersion'<>'null'::jsonb or p_completion_receipt->'databaseSnapshotAt'<>'null'::jsonb
   or (p_completion_receipt->>'sourceWatermark')::timestamptz<r.started_at
   or p_completion_receipt->>'pairedFileManifestSha256'<>p_completion_receipt->>'manifestSha256'
   or p_completion_receipt->>'pairedFileManifestVersionId'<>p_completion_receipt->>'manifestVersionId' then raise exception 'archive_writer_receipt_file'; end if;
 end if;
 update public.ap_archive_writer_runs set state=target,result_sha256=p_result_sha256,completion_receipt=p_completion_receipt,finished_at=clock_timestamp() where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
create function public.ap_latest_verified_database_archive() returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(r) from public.ap_archive_writer_runs r where kind='DATABASE' and state='COMPLETE' order by finished_at desc,id desc limit 1;
$$;
create function public.ap_archive_writer_status(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(r) from public.ap_archive_writer_runs r where id=p_id;
$$;
create function public.ap_dispatch_archive_writer(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_writer_runs;
begin
 perform pg_advisory_xact_lock(6384910250098); perform public.ap_assert_archive_lifecycle();
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 select * into strict r from public.ap_archive_writer_runs where id=p_id for update;
 if r.state<>'OPEN' then raise exception 'archive_writer_dispatch_state'; end if;
 update public.ap_archive_writer_runs set provider_dispatched=true where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
create function public.ap_begin_archive_retention(p_id uuid,p_release_sha text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_retention_runs;
begin
 perform pg_advisory_xact_lock(6384910250098); perform public.ap_assert_archive_lifecycle();
 select * into r from public.ap_archive_retention_runs where id=p_id for update;
 if found then
  if r.release_sha is distinct from p_release_sha then raise exception 'archive_retention_replay_mismatch'; end if;
  return to_jsonb(r);
 end if;
 if exists(select 1 from public.ap_archive_writer_runs where state='OPEN') then raise exception using errcode='40001',message='archive_writer_reconciliation_required'; end if;
 if exists(select 1 from public.webhook_events where processed_at is null)
   or exists(select 1 from public.ap_provider_events where applied_at is null) then raise exception using errcode='40001',message='archive_payment_reconciliation_required'; end if;
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 insert into public.ap_archive_retention_runs(id,release_sha) values(p_id,p_release_sha) returning * into r;
 return to_jsonb(r);
end $$;
create function public.ap_plan_archive_retention(p_id uuid,p_plan_sha256 text,p_proof_sha256 text,p_inventory_sha256 text,p_versions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_retention_runs; v jsonb;
begin
 perform pg_advisory_xact_lock(6384910250098); perform public.ap_assert_archive_lifecycle();
 select * into strict r from public.ap_archive_retention_runs where id=p_id for update;
 if r.state<>'FENCED' or r.plan_sha256 is not null then raise exception 'archive_retention_plan_state'; end if;
 if p_plan_sha256 is null or p_proof_sha256 is null or p_inventory_sha256 is null
  or p_plan_sha256!~'^[a-f0-9]{64}$' or p_proof_sha256!~'^[a-f0-9]{64}$' or p_inventory_sha256!~'^[a-f0-9]{64}$'
  or p_versions is null or jsonb_typeof(p_versions)<>'array' or jsonb_array_length(p_versions)>1000 then raise exception 'archive_retention_plan_invalid'; end if;
 for v in select value from jsonb_array_elements(p_versions) loop
  if jsonb_typeof(v)<>'object' or (select array_agg(key order by key) from jsonb_object_keys(v) key) is distinct from array['identitySha256','key','versionId'] then raise exception 'archive_retention_version_invalid'; end if;
  insert into public.ap_archive_retention_versions(run_id,archive_key,version_id,identity_sha256) values(p_id,v->>'key',v->>'versionId',v->>'identitySha256');
 end loop;
 update public.ap_archive_retention_runs set state='PLANNED',plan_sha256=p_plan_sha256,proof_sha256=p_proof_sha256,inventory_sha256=p_inventory_sha256 where id=p_id returning * into r;
 return to_jsonb(r);
end $$;
create function public.ap_dispatch_archive_retention_version(p_id uuid,p_key text,p_version_id text,p_plan_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_retention_runs; v public.ap_archive_retention_versions;
begin
 perform pg_advisory_xact_lock(6384910250098); perform public.ap_assert_archive_lifecycle();
 select * into strict r from public.ap_archive_retention_runs where id=p_id for update;
 if r.state not in('PLANNED','DISPATCHING') or r.plan_sha256 is distinct from p_plan_sha256 then raise exception 'archive_retention_dispatch_state'; end if;
 -- A verified event received after the fence must be reconciled before any new
 -- delete dispatch. The webhook event remains durable and its handler retries.
 -- Do not filter by received_at: a transaction that began before the fence can
 -- commit its durable event afterward with an earlier now() timestamp.
 if exists(select 1 from public.webhook_events where processed_at is null)
   or exists(select 1 from public.ap_provider_events where applied_at is null) then raise exception using errcode='40001',message='archive_payment_reconciliation_required'; end if;
 select * into strict v from public.ap_archive_retention_versions where run_id=p_id and archive_key=p_key and version_id=p_version_id for update;
 if v.state<>'PLANNED' then raise exception 'archive_retention_dispatch_not_replayable'; end if;
 update public.ap_archive_retention_versions set state='DISPATCHED',dispatched_at=clock_timestamp() where run_id=p_id and archive_key=p_key and version_id=p_version_id returning * into v;
 update public.ap_archive_retention_runs set state='DISPATCHING' where id=p_id;
 return to_jsonb(v);
end $$;
create function public.ap_observe_archive_retention_absence(p_id uuid,p_key text,p_version_id text,p_observation_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.ap_archive_retention_versions;
begin
 perform pg_advisory_xact_lock(6384910250098);
 perform 1 from public.ap_archive_retention_runs where id=p_id and state in('DISPATCHING','RECONCILIATION_REQUIRED') for update;
 if not found or p_observation_sha256 is null or p_observation_sha256!~'^[a-f0-9]{64}$' then raise exception 'archive_retention_observation_state'; end if;
 select * into strict v from public.ap_archive_retention_versions where run_id=p_id and archive_key=p_key and version_id=p_version_id for update;
 if v.state='ABSENT' then
  if v.observation_sha256<>p_observation_sha256 then raise exception 'archive_retention_observation_mismatch'; end if; return to_jsonb(v);
 end if;
 if v.state<>'DISPATCHED' then raise exception 'archive_retention_observation_state'; end if;
 update public.ap_archive_retention_versions set state='ABSENT',observed_at=clock_timestamp(),observation_sha256=p_observation_sha256
  where run_id=p_id and archive_key=p_key and version_id=p_version_id returning * into v;
 return to_jsonb(v);
end $$;
create function public.ap_finish_archive_retention(p_id uuid,p_plan_sha256 text,p_cancel boolean default false,p_completion_receipt jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ap_archive_retention_runs; finished timestamptz; removed_count integer;
begin
 perform pg_advisory_xact_lock(6384910250098);
 select * into strict r from public.ap_archive_retention_runs where id=p_id for update;
 if r.plan_sha256 is distinct from p_plan_sha256 then raise exception 'archive_retention_plan_mismatch'; end if;
 if p_cancel is null then raise exception 'archive_retention_finish_invalid'; end if;
 if r.state in('COMPLETE','CANCELED') then
  if (r.state='CANCELED') is distinct from p_cancel or r.completion_receipt is distinct from p_completion_receipt then raise exception 'archive_retention_finish_mismatch'; end if; return to_jsonb(r);
 end if;
 if exists(select 1 from public.ap_archive_retention_versions where run_id=p_id and state='DISPATCHED') then
  update public.ap_archive_retention_runs set state='RECONCILIATION_REQUIRED' where id=p_id returning * into r; return to_jsonb(r);
 end if;
 if not p_cancel and (r.state='FENCED' or exists(select 1 from public.ap_archive_retention_versions where run_id=p_id and state<>'ABSENT')) then raise exception 'archive_retention_incomplete'; end if;
 if p_cancel and p_completion_receipt is not null then raise exception 'archive_retention_cancel_has_no_success'; end if;
 if not p_cancel then
  perform public.ap_assert_archive_lifecycle();
  select count(*) into removed_count from public.ap_archive_retention_versions where run_id=p_id and state='ABSENT';
  if p_completion_receipt is null or jsonb_typeof(p_completion_receipt)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(p_completion_receipt) key) is distinct from
    array['completedAt','deletedVersionCount','inventoryDigest','planSha256','providerVerificationSha256','releaseSha','retainedVersionCount','schemaVersion','sourceEnvironment','sourceProjectRef','sourceStartedAt']
   or exists(select 1 from jsonb_each(p_completion_receipt) e where jsonb_typeof(e.value) is distinct from case when e.key in('deletedVersionCount','retainedVersionCount') then 'number' else 'string' end)
   or p_completion_receipt->>'schemaVersion'<>'applypack-protected-recovery-retention-v1'
   or p_completion_receipt->>'sourceEnvironment'<>'production' or p_completion_receipt->>'sourceProjectRef'<>'spjaaxndiduhrcleazwb'
   or p_completion_receipt->>'releaseSha'<>r.release_sha or p_completion_receipt->>'inventoryDigest'<>r.inventory_sha256
   or p_completion_receipt->>'planSha256'<>r.plan_sha256 or (p_completion_receipt->>'providerVerificationSha256')!~'^[a-f0-9]{64}$'
   or (p_completion_receipt->>'deletedVersionCount')!~'^(0|[1-9][0-9]{0,5})$' or (p_completion_receipt->>'retainedVersionCount')!~'^(0|[1-9][0-9]{0,5})$'
   or (p_completion_receipt->>'deletedVersionCount')::integer<>removed_count or (p_completion_receipt->>'retainedVersionCount')::integer>100000
   or (p_completion_receipt->>'sourceStartedAt')::timestamptz<>r.started_at then raise exception 'archive_retention_completion_receipt_invalid'; end if;
  finished:=(p_completion_receipt->>'completedAt')::timestamptz;
  if finished<r.started_at or finished>clock_timestamp() or finished-r.started_at>interval '5 minutes'
   or clock_timestamp()-finished>interval '30 seconds' then raise exception 'archive_retention_completion_stale'; end if;
 end if;
 if p_cancel then update public.ap_archive_retention_versions set state='RETAINED' where run_id=p_id and state='PLANNED'; end if;
 update public.ap_archive_retention_runs set state=case when p_cancel then 'CANCELED' else 'COMPLETE' end,finished_at=clock_timestamp(),completion_receipt=p_completion_receipt where id=p_id returning * into r;
 if not p_cancel then
  insert into public.operational_heartbeats(task_name,last_succeeded_at,summary,updated_at)
   values('protected_recovery_retention',r.started_at,p_completion_receipt,clock_timestamp())
   on conflict(task_name) do update set last_succeeded_at=excluded.last_succeeded_at,summary=excluded.summary,updated_at=excluded.updated_at
    where public.operational_heartbeats.last_succeeded_at<excluded.last_succeeded_at;
 end if;
 return to_jsonb(r);
end $$;
create function public.ap_archive_retention_status(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.ap_archive_retention_runs;
begin
 select * into strict r from public.ap_archive_retention_runs where id=p_id;
 return jsonb_build_object('run',to_jsonb(r),'coverageCurrent',public.ap_archive_fence_coverage_current(),
  'versions',coalesce((select jsonb_agg(to_jsonb(v) order by archive_key,version_id) from public.ap_archive_retention_versions v where run_id=p_id),'[]'));
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_archive_fence_active','ap_guard_archive_source_mutation','ap_archive_fence_coverage_current','ap_assert_archive_lifecycle',
    'ap_archive_writer_receipt_sha256','ap_archive_writer_status','ap_latest_verified_database_archive','ap_begin_archive_writer','ap_dispatch_archive_writer','ap_finish_archive_writer','ap_begin_archive_retention','ap_plan_archive_retention',
    'ap_dispatch_archive_retention_version','ap_observe_archive_retention_absence','ap_finish_archive_retention','ap_archive_retention_status') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('ap_archive_writer_status','ap_latest_verified_database_archive','ap_begin_archive_writer','ap_dispatch_archive_writer','ap_finish_archive_writer','ap_begin_archive_retention','ap_plan_archive_retention',
    'ap_dispatch_archive_retention_version','ap_observe_archive_retention_absence','ap_finish_archive_retention','ap_archive_retention_status') then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;
insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250098','PROTECTED_ARCHIVE_LIFECYCLE',0,clock_timestamp());
create function public.ap_protected_archive_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250098' and checkpoint='PROTECTED_ARCHIVE_LIFECYCLE')
 and exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and writer_protocol='archive-lifecycle-v1')
 and public.ap_archive_fence_coverage_current()
 and (select count(*)=6 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity
  and c.relname in('ap_archive_lifecycle_configuration','ap_archive_writer_runs','ap_archive_retention_runs','ap_archive_retention_versions','ap_archive_fence_relations','ap_archive_fence_function_contracts'))
 and not exists(select 1 from unnest(array['ap_archive_lifecycle_configuration','ap_archive_writer_runs','ap_archive_retention_runs','ap_archive_retention_versions','ap_archive_fence_relations','ap_archive_fence_function_contracts']) t
  cross join unnest(array['anon','authenticated','service_role']) r where has_table_privilege(r,'public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE'))
 and to_regprocedure('public.ap_begin_archive_writer(uuid,text,text)') is not null
 and to_regprocedure('public.ap_dispatch_archive_writer(uuid)') is not null
 and to_regprocedure('public.ap_finish_archive_writer(uuid,text,boolean,jsonb)') is not null
 and to_regprocedure('public.ap_latest_verified_database_archive()') is not null
 and to_regprocedure('public.ap_plan_archive_retention(uuid,text,text,text,jsonb)') is not null
 and to_regprocedure('public.ap_dispatch_archive_retention_version(uuid,text,text,text)') is not null
 and to_regprocedure('public.ap_observe_archive_retention_absence(uuid,text,text,text)') is not null
 and to_regprocedure('public.ap_finish_archive_retention(uuid,text,boolean,jsonb)') is not null
 and has_function_privilege('service_role','public.ap_latest_verified_database_archive()','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_begin_archive_writer(uuid,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_begin_archive_retention(uuid,text)','EXECUTE');
$$;
revoke all on function public.ap_protected_archive_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_protected_archive_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=21 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250097''' in definition)=0
  or position('(''202610250097'',''MATERIAL_DRAFT_CHANGE_REQUESTS'')' in definition)=0 or position('''202610250096'',''202610250097''' in definition)=0
  or position('public.ap_material_draft_change_schema_installed()' in definition)=0 then raise exception 'archive_lifecycle_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=21 as installed','select count(*)=22 as installed');
 definition:=replace(definition,'(''202610250097'',''MATERIAL_DRAFT_CHANGE_REQUESTS'')','(''202610250097'',''MATERIAL_DRAFT_CHANGE_REQUESTS''),(''202610250098'',''PROTECTED_ARCHIVE_LIFECYCLE'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250097''','''requiredSchemaVersion'', ''202610250098''');
 definition:=replace(definition,'''202610250096'',''202610250097''','''202610250096'',''202610250097'',''202610250098''');
 definition:=replace(definition,'public.ap_material_draft_change_schema_installed()','public.ap_material_draft_change_schema_installed() and public.ap_protected_archive_schema_installed()');
 execute definition;
end $$;
commit;
