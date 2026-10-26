-- Connected, default-disabled research preparation. No source grant, source
-- schedule enablement, human verification, checkout invitation or payment.
begin;
create table public.ap_research_preparation_configuration (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 revision bigint not null default 1 check(revision>0), configuration_ids uuid[] not null default '{}',
 approved_by uuid references public.profiles(id), updated_at timestamptz not null default now(),
 check(cardinality(configuration_ids)<=5), check(not enabled or (approved_by is not null and cardinality(configuration_ids)>0))
);
insert into public.ap_research_preparation_configuration(singleton) values(true);
create table public.ap_research_preparations (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.ap_feasibility_requests(id),
 snapshot_id uuid not null unique references public.ap_intake_snapshots(id), draft_id uuid not null references public.ap_anonymous_drafts(id),
 customer_id uuid references auth.users(id), snapshot_sha256 text not null check(snapshot_sha256~'^[a-f0-9]{64}$'),
 state text not null default 'QUEUED' check(state in('QUEUED','PREPARING','COLLECTING','OWNER_REVIEW','READY','COMPLETE','MANUAL_RESEARCH','EXCEPTION','STALE')),
 reason text check(reason in('SOURCE_POLICY_UNAVAILABLE','SOURCE_COLLECTION_INCOMPLETE','SOURCE_REVIEW_REQUIRED','SOURCE_CHANGED','PREPARATION_RETRY_EXHAUSTED','SNAPSHOT_CHANGED')),
 policy_revision bigint, plan_id uuid references public.ap_feasibility_coverage_plans(id),
 lease_token uuid, lease_until timestamptz, preparation_attempts integer not null default 0 check(preparation_attempts between 0 and 3),
 next_check_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((lease_token is null)=(lease_until is null))
);
create table public.ap_research_preparation_sources (
 id uuid primary key default gen_random_uuid(), preparation_id uuid not null references public.ap_research_preparations(id),
 snapshot_id uuid not null references public.ap_intake_snapshots(id), draft_id uuid not null references public.ap_anonymous_drafts(id), customer_id uuid references auth.users(id),
 configuration_id uuid not null references public.ap_feasibility_source_configurations(id),
 schedule_id uuid not null references public.job_source_schedules(id), source_authorization_id uuid not null references public.ap_source_authorizations(id),
 authorization_head_revision bigint not null check(authorization_head_revision>0), source_run_id uuid references public.job_source_runs(id),
 created_at timestamptz not null default now(), unique(preparation_id,configuration_id)
);
do $$ declare t text; begin
 foreach t in array array['ap_research_preparation_configuration','ap_research_preparations','ap_research_preparation_sources'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
  insert into public.ap_archive_fence_relations(schema_name,table_name) values('public',t);
  execute format('create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.%I for each statement execute function public.ap_guard_archive_source_mutation()',t);
 end loop;
 foreach t in array array['ap_research_preparations','ap_research_preparation_sources'] loop
  insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values(t,'id','{}');
  execute format('create trigger ap_service_retention_write before insert or update on public.%I for each row execute function public.ap_guard_service_retention_write()',t);
 end loop;
end $$;

-- 101 may extend this predicate for an explicitly open clarification. All new
-- preparation boundaries call it rather than duplicating currentness decisions.
create function public.ap_research_snapshot_current(p_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id
  where s.id=p_snapshot_id and s.finalized_at is not null and s.schema_version='applypack-intake-v4'
   and s.confirmed_review->>'contractVersion'='applypack-confirmed-intake-v1'
   and s.confirmed_review->>'reviewSha256'~'^[a-f0-9]{64}$' and d.finalized_snapshot_id=s.id
   and d.expires_at>clock_timestamp()
   and not exists(select 1 from public.ap_intake_snapshots n where (n.draft_id=s.draft_id or n.intake_id=s.intake_id) and n.version>s.version and n.finalized_at is not null)
   and not exists(select 1 from public.ap_retention_row_receipts where table_name='ap_intake_snapshots' and row_id=s.id::text));
$$;

create function public.ap_enqueue_research_preparation(p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.ap_feasibility_requests; s public.ap_intake_snapshots; result uuid;
begin
 select * into r from public.ap_feasibility_requests where id=p_request_id;
 select * into s from public.ap_intake_snapshots where id=r.snapshot_id;
 if not public.ap_research_snapshot_current(s.id) then return null; end if;
 insert into public.ap_research_preparations(request_id,snapshot_id,draft_id,customer_id,snapshot_sha256)
 values(r.id,s.id,r.draft_id,s.customer_id,s.content_sha256) on conflict(request_id) do nothing;
 select id into result from public.ap_research_preparations where request_id=r.id; return result;
end $$;

-- The same confirmed-snapshot boundary protects manual plans and the existing
-- invitation/checkout entry points. Older snapshot contracts keep their body.
create function public.ap_assert_research_snapshot_current(p_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; owners uuid[]; reread uuid[]; owner uuid;
begin
 select * into s from public.ap_intake_snapshots where id=p_snapshot_id;
 if s.schema_version is distinct from 'applypack-intake-v4' then return; end if;
 perform 1 from public.ap_retention_restore_lock where singleton and not locked for share;
 if not found then raise exception 'research_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_snapshot_id::text,45));
 select coalesce(array_agg(distinct value order by value),'{}'::uuid[]) into owners from unnest(public.ap_retention_snapshot_customers(p_snapshot_id)) value;
 foreach owner in array owners loop
  perform pg_advisory_xact_lock(hashtextextended('service-retention:'||owner::text,0));
  if exists(select 1 from public.ap_service_retention_claims where customer_id=owner and state='PENDING') then raise exception 'research_retention_locked'; end if;
 end loop;
 perform 1 from public.ap_anonymous_drafts where id=s.draft_id for update;
 select coalesce(array_agg(distinct value order by value),'{}'::uuid[]) into reread from unnest(public.ap_retention_snapshot_customers(p_snapshot_id)) value;
 if owners is distinct from reread or not public.ap_research_snapshot_current(p_snapshot_id) then raise exception 'research_snapshot_stale'; end if;
end $$;
revoke all on function public.ap_assert_research_snapshot_current(uuid) from public,anon,authenticated,service_role;
do $$ declare name text; definition text; rewritten text; begin
 foreach name in array array['ap_begin_research_round','ap_issue_search_checkout_invitation','ap_begin_invited_search_checkout','ap_begin_search_checkout'] loop
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
  rewritten:=regexp_replace(definition,E'\\mbegin\\M','begin'||chr(10)||' perform public.ap_assert_research_snapshot_current(p_snapshot_id);','i');
  if rewritten=definition then raise exception 'research_currentness_anchor_missing:%',name; end if;
  execute rewritten;
 end loop;
end $$;
create function public.ap_enqueue_confirmed_research_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.ap_enqueue_research_preparation(new.id); return new; end $$;
create trigger ap_enqueue_confirmed_research after insert on public.ap_feasibility_requests
 for each row execute function public.ap_enqueue_confirmed_research_trigger();
create function public.ap_enqueue_finalized_research_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.finalized_snapshot_id is distinct from old.finalized_snapshot_id then
  perform public.ap_enqueue_research_preparation(id) from public.ap_feasibility_requests where snapshot_id=new.finalized_snapshot_id;
 end if;
 return new;
end $$;
-- Existing finalization inserts its request before setting finalized_snapshot_id.
-- This second transaction-local seam makes the queue durable before return.
create trigger ap_enqueue_finalized_research after update of finalized_snapshot_id on public.ap_anonymous_drafts
 for each row execute function public.ap_enqueue_finalized_research_trigger();

create function public.ap_configure_research_preparation(p_actor_id uuid,p_expected_revision bigint,p_enabled boolean,p_configuration_ids uuid[])
returns bigint language plpgsql security definer set search_path='' as $$
declare c public.ap_research_preparation_configuration; total integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','operator')) then raise exception 'research_operator_required'; end if;
 select * into c from public.ap_research_preparation_configuration where singleton for update;
 if c.revision<>p_expected_revision or p_enabled is null or p_configuration_ids is null
  or cardinality(p_configuration_ids)>5 or cardinality(p_configuration_ids)<>(select count(distinct v) from unnest(p_configuration_ids)v)
  or (p_enabled and cardinality(p_configuration_ids)=0) then raise exception 'research_preparation_policy_invalid'; end if;
 select sum(result_bound) into total from public.ap_feasibility_source_configurations where id=any(p_configuration_ids);
 if (select count(*) from public.ap_feasibility_source_configurations where id=any(p_configuration_ids))<>cardinality(p_configuration_ids)
  or coalesce(total,0)>100 then raise exception 'research_preparation_policy_bound'; end if;
 update public.ap_research_preparation_configuration set enabled=p_enabled,configuration_ids=p_configuration_ids,
  approved_by=p_actor_id,revision=revision+1,updated_at=clock_timestamp() where singleton returning revision into total;
 return total;
end $$;

-- Serialize the existing research-plan advisory lock before row locks. Retention
-- owners are resolved again after locking; an anonymous draft may be claimed.
create function public.ap_lock_research_preparation(p_preparation_id uuid,p_skip_locked boolean default false)
returns public.ap_research_preparations language plpgsql security definer set search_path='' as $$
declare j public.ap_research_preparations; owners uuid[]; owner uuid;
begin
 perform 1 from public.ap_retention_restore_lock where singleton and not locked for share;
 if not found then raise exception 'research_restore_locked'; end if;
 select * into j from public.ap_research_preparations where id=p_preparation_id;
 if j.id is null then return null; end if;
 if p_skip_locked then
  if not pg_try_advisory_xact_lock(hashtextextended(j.snapshot_id::text,45)) then return null; end if;
 else perform pg_advisory_xact_lock(hashtextextended(j.snapshot_id::text,45)); end if;
 owners:=public.ap_retention_row_customers('ap_research_preparations',to_jsonb(j));
 for owner in select distinct value from unnest(owners) value order by value loop
  if p_skip_locked then
   if not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||owner::text,0)) then return null; end if;
  else perform pg_advisory_xact_lock(hashtextextended('service-retention:'||owner::text,0)); end if;
  if exists(select 1 from public.ap_service_retention_claims where customer_id=owner and state='PENDING')
   then if p_skip_locked then return null; else raise exception 'research_retention_locked'; end if; end if;
 end loop;
 if exists(select 1 from public.ap_retention_row_receipts where
   (table_name='ap_research_preparations' and row_id=j.id::text)
   or (table_name='ap_intake_snapshots' and row_id=j.snapshot_id::text)
   or (table_name='ap_anonymous_drafts' and row_id=j.draft_id::text))
 then if p_skip_locked then return null; else raise exception 'research_retention_locked'; end if; end if;
 if p_skip_locked then select * into j from public.ap_research_preparations where id=p_preparation_id for update skip locked;
 else select * into j from public.ap_research_preparations where id=p_preparation_id for update; end if;
 if j.id is not null and owners is distinct from public.ap_retention_row_customers('ap_research_preparations',to_jsonb(j))
  then raise exception 'research_ownership_changed'; end if;
 return j;
end $$;

create function public.ap_claim_research_preparation() returns setof public.ap_research_preparations
language plpgsql security definer set search_path='' as $$
declare c public.ap_research_preparation_configuration; j public.ap_research_preparations;
begin
 perform 1 from public.ap_retention_restore_lock where singleton and not locked for share;
 if not found then return; end if;
 select * into c from public.ap_research_preparation_configuration where singleton and enabled for share;
 if not found or not exists(select 1 from public.profiles where id=c.approved_by and role in('admin','operator')) then return; end if;
 -- Backfill only current confirmed pending requests; no historical snapshots are
 -- reinterpreted and no source work is performed by enqueueing.
 perform public.ap_enqueue_research_preparation(r.id) from public.ap_feasibility_requests r
  where r.state='PENDING' and public.ap_research_snapshot_current(r.snapshot_id)
   and not exists(select 1 from public.ap_research_preparations p where p.request_id=r.id)
  order by r.created_at limit 20;
 for j in select preparation.* from public.ap_research_preparations preparation where state in('QUEUED','PREPARING','COLLECTING','OWNER_REVIEW','READY')
   and next_check_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp())
   and not exists(select 1 from public.ap_retention_row_receipts receipt where
     (receipt.table_name='ap_research_preparations' and receipt.row_id=preparation.id::text)
     or (receipt.table_name='ap_intake_snapshots' and receipt.row_id=preparation.snapshot_id::text)
     or (receipt.table_name='ap_anonymous_drafts' and receipt.row_id=preparation.draft_id::text))
   and not exists(select 1 from public.ap_service_retention_claims claim where claim.state='PENDING'
     and claim.customer_id=any(public.ap_retention_row_customers('ap_research_preparations',to_jsonb(preparation))))
   order by next_check_at,id limit 50 loop
  j:=public.ap_lock_research_preparation(j.id,true);
  if j.id is null or j.lease_until>=clock_timestamp() then continue; end if;
  if not public.ap_research_snapshot_current(j.snapshot_id) then
   update public.ap_research_preparations set state='STALE',reason='SNAPSHOT_CHANGED',lease_token=null,lease_until=null where id=j.id; continue;
  end if;
  if j.plan_id is null and exists(select 1 from public.ap_research_rounds where snapshot_id=j.snapshot_id) then
   update public.ap_research_preparations set state='MANUAL_RESEARCH',reason=null,lease_token=null,lease_until=null where id=j.id; continue;
  end if;
  if j.policy_revision is not null and j.policy_revision<>c.revision then
   update public.ap_research_preparations set state='EXCEPTION',reason='SOURCE_CHANGED',lease_token=null,lease_until=null where id=j.id; continue;
  end if;
  if j.plan_id is null and j.preparation_attempts>=3 then
   update public.ap_research_preparations set state='EXCEPTION',reason='PREPARATION_RETRY_EXHAUSTED',lease_token=null,lease_until=null where id=j.id; continue;
  end if;
  update public.ap_research_preparations set state=case when plan_id is null then 'PREPARING' else state end,
   policy_revision=c.revision,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',
   preparation_attempts=preparation_attempts+case when plan_id is null then 1 else 0 end,
   next_check_at=clock_timestamp()+interval '15 minutes',updated_at=clock_timestamp()
   where id=j.id returning * into j;
  return next j; return;
 end loop;
end $$;

create function public.ap_prepare_automatic_research(p_preparation_id uuid,p_lease_token uuid,p_families jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_research_preparations; c public.ap_research_preparation_configuration; source_binding record; plan uuid; digest text;
begin
 j:=public.ap_lock_research_preparation(p_preparation_id);
 select * into c from public.ap_research_preparation_configuration where singleton and enabled for share;
 if j.id is null or c.revision is distinct from j.policy_revision or j.lease_token is distinct from p_lease_token
  or j.lease_until<=clock_timestamp() or not public.ap_research_snapshot_current(j.snapshot_id)
  or exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'research_preparation_claim_changed'; end if;
 if j.plan_id is not null then return j.plan_id; end if;
 if jsonb_typeof(p_families) is distinct from 'array' or jsonb_array_length(p_families) not between 1 and 100
  or exists(select 1 from jsonb_array_elements(p_families) f where f->>'id' is null or f->>'fingerprint'!~'^[a-f0-9]{64}$' or f->>'neutral' is distinct from 'true')
  or (select count(distinct f->>'id') from jsonb_array_elements(p_families)f)<>jsonb_array_length(p_families)
  then raise exception 'research_preparation_families_invalid'; end if;
 if (select count(*) from public.ap_feasibility_source_configurations conf
  join public.ap_source_authorizations a on a.id=conf.source_authorization_id
  join public.ap_source_authorization_heads h on h.current_authorization_id=a.id and h.source_id=a.source_id
  join public.job_source_schedules s on s.source_id=a.source_id and s.source_authorization_id=a.id and s.authorization_head_revision=h.revision
  where conf.id=any(c.configuration_ids) and a.state='AUTHORIZED_AUTOMATED' and a.access_method='AUTOMATED'
   and 'ENUMERATE_JOBS'=any(a.allowed_actions) and s.enabled and s.paused_reason is null
   and s.result_bound<=conf.result_bound and s.page_bound<=conf.pagination_bound)<>cardinality(c.configuration_ids)
  then raise exception 'research_preparation_current_sources_required'; end if;
 digest:=encode(extensions.digest(jsonb_build_object('snapshotId',j.snapshot_id,'snapshotSha256',j.snapshot_sha256,
  'configurationIds',c.configuration_ids,'families',p_families,'policyRevision',c.revision)::text,'sha256'),'hex');
 -- created_by identifies the approved automation policy's responsible operator;
 -- this is a plan only, never a source/evidence/coverage attestation.
 plan:=public.ap_begin_research_round(j.snapshot_id,c.approved_by,digest,p_families,c.configuration_ids,1);
 for source_binding in select conf.id,s.id schedule_id,a.id authorization_id,h.revision from public.ap_feasibility_source_configurations conf
  join public.ap_source_authorizations a on a.id=conf.source_authorization_id
  join public.ap_source_authorization_heads h on h.current_authorization_id=a.id
  join public.job_source_schedules s on s.source_id=a.source_id where conf.id=any(c.configuration_ids) loop
  insert into public.ap_research_preparation_sources(preparation_id,snapshot_id,draft_id,customer_id,configuration_id,schedule_id,source_authorization_id,authorization_head_revision)
   values(j.id,j.snapshot_id,j.draft_id,j.customer_id,source_binding.id,source_binding.schedule_id,source_binding.authorization_id,source_binding.revision);
 end loop;
 update public.ap_research_preparations set plan_id=plan,state='COLLECTING',reason='SOURCE_COLLECTION_INCOMPLETE',
  lease_token=null,lease_until=null,next_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
 return plan;
end $$;

create function public.ap_bind_prepared_research_run(p_preparation_id uuid,p_lease_token uuid,p_source_id uuid,p_run_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_research_preparations; binding public.ap_research_preparation_sources; r public.job_source_runs; conf public.ap_feasibility_source_configurations;
begin
 j:=public.ap_lock_research_preparation(p_preparation_id);
 select * into binding from public.ap_research_preparation_sources where id=p_source_id and preparation_id=j.id for update;
 select * into r from public.job_source_runs where id=p_run_id;
 select * into conf from public.ap_feasibility_source_configurations where id=binding.configuration_id;
 if j.id is null or binding.id is null or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp()
  or not public.ap_research_snapshot_current(j.snapshot_id)
  or not exists(select 1 from public.ap_research_preparation_configuration where singleton and enabled and revision=j.policy_revision)
  or exists(select 1 from public.ap_retention_restore_lock where singleton and locked)
  or r.id is null or r.schedule_id is distinct from binding.schedule_id or r.source_authorization_id is distinct from binding.source_authorization_id
  or r.authorization_head_revision is distinct from binding.authorization_head_revision
  or r.status<>'succeeded' or r.enumeration_status<>'complete' or r.checkpoint_start is not null
  or r.completed_at is null or r.completed_at>clock_timestamp() or r.completed_at<clock_timestamp()-interval '24 hours'
  or r.fetched_count>conf.result_bound or r.pages_completed>conf.pagination_bound
  or not exists(select 1 from public.ap_source_authorization_heads h where h.source_id=r.source_id and h.current_authorization_id=r.source_authorization_id and h.revision=r.authorization_head_revision)
  or (select count(*) from public.job_source_listing_projections where run_id=r.id)<>r.fetched_count
 then raise exception 'research_preparation_run_unavailable'; end if;
 if binding.source_run_id is not null and binding.source_run_id<>r.id then raise exception 'research_preparation_run_immutable'; end if;
 update public.ap_research_preparation_sources set source_run_id=r.id where id=binding.id;
 return r.id;
end $$;

create function public.ap_research_preparation_ready(p_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when not exists(select 1 from public.ap_intake_snapshots s join public.ap_feasibility_requests r on r.snapshot_id=s.id
   where r.id=p_request_id and s.schema_version='applypack-intake-v4') then true else exists(
  select 1 from public.ap_feasibility_requests request join lateral
   (select plan.* from public.ap_feasibility_coverage_plans plan where plan.snapshot_id=request.snapshot_id order by plan.created_at desc limit 1) plan on true
   where request.id=p_request_id and public.ap_research_snapshot_current(request.snapshot_id)
    and ((plan.coverage_disposition='NOT_REQUIRED_CONSTRAINT_COLLISION'
      and plan.constraint_proof->>'kind'='TYPED_CONTRADICTION'
      and coalesce(plan.constraint_proof->>'inputHash','')~'^[a-f0-9]{64}$'
      and length(btrim(coalesce(plan.constraint_proof->>'version','')))>0)
     or (plan.coverage_disposition='REQUIRED'
    and not exists(select 1 from public.ap_feasibility_coverage_cells c where c.plan_id=plan.id and c.terminal_outcome not in('SUCCEEDED_WITH_RESULTS','SUCCEEDED_EMPTY'))
    and exists(select 1 from public.ap_feasibility_coverage_cells c where c.plan_id=plan.id)
    and not exists(select 1 from public.ap_inventory_members m where m.inventory_version_id=plan.inventory_version_id and m.selected_by_deduplication
      and (select count(*) from public.ap_match_evaluations e where e.inventory_member_id=m.id and e.snapshot_id=request.snapshot_id
        and e.invalidated_at is null and not e.legacy_compatibility)<>1)
    and not exists(select 1 from public.ap_research_preparations p where p.request_id=request.id and p.plan_id=plan.id
      and exists(select 1 from public.ap_research_preparation_sources source where source.preparation_id=p.id and source.source_run_id is null))))) end;
$$;
create function public.ap_promote_prepared_research_observation(p_preparation_id uuid,p_projection_id uuid,p_actor_id uuid,
 p_criteria_snapshot_id uuid,p_inventory_version_id uuid,p_review jsonb,p_stable_job_id text,p_job_snapshot jsonb,p_requirement_nodes jsonb,p_normalized jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare j public.ap_research_preparations; inventory uuid; verified_snapshot uuid;
begin
 j:=public.ap_lock_research_preparation(p_preparation_id);
 select inventory_version_id into inventory from public.ap_feasibility_coverage_plans where id=j.plan_id;
 if j.id is null or j.state not in('COLLECTING','OWNER_REVIEW') or not public.ap_research_snapshot_current(j.snapshot_id)
  or j.snapshot_id is distinct from p_criteria_snapshot_id or inventory is distinct from p_inventory_version_id
  or not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','operator'))
  or exists(select 1 from public.ap_retention_restore_lock where singleton and locked)
  or not exists(select 1 from public.job_source_listing_projections projection join public.ap_research_preparation_sources source
   on source.source_run_id=projection.run_id where projection.id=p_projection_id and source.preparation_id=j.id)
  or not exists(select 1 from public.ap_research_preparation_configuration where singleton and enabled and revision=j.policy_revision)
 then raise exception 'research_preparation_review_changed'; end if;
 -- Current matching requires the independent immutable verification lineage.
 -- The historical041 bridge is preserved; it cannot establish045 coverage.
 verified_snapshot:=public.ap_verify_source_observation(p_projection_id,p_actor_id,p_review,p_stable_job_id,p_job_snapshot,p_requirement_nodes,p_normalized);
 return public.ap_admit_verified_inventory_snapshot(p_criteria_snapshot_id,p_inventory_version_id,verified_snapshot,p_stable_job_id);
end $$;
create function public.ap_complete_prepared_research_review(p_preparation_id uuid,p_actor_id uuid,p_notes text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.ap_research_preparations; cell record;
begin
 j:=public.ap_lock_research_preparation(p_preparation_id);
 if j.id is null or not public.ap_research_snapshot_current(j.snapshot_id)
  or j.state not in('OWNER_REVIEW','READY') or not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','operator'))
  or exists(select 1 from public.ap_retention_restore_lock where singleton and locked)
  or not exists(select 1 from public.ap_research_preparation_configuration where singleton and enabled and revision=j.policy_revision)
  or exists(select 1 from public.ap_research_preparation_sources where preparation_id=j.id and source_run_id is null)
 then raise exception 'research_preparation_coverage_not_reviewable'; end if;
 for cell in select c.id,s.source_run_id from public.ap_feasibility_coverage_cells c join public.ap_research_preparation_sources s
  on s.configuration_id=c.configuration_id and s.preparation_id=j.id where c.plan_id=j.plan_id loop
  -- Existing function requires a current full source run, every observed listing
  -- verified/admitted/evaluated, and the actual human reviewer's evidence notes.
  perform public.ap_complete_research_cell(cell.id,cell.source_run_id,p_actor_id,p_notes);
 end loop;
 if not public.ap_research_preparation_ready(j.request_id) then raise exception 'research_preparation_coverage_incomplete'; end if;
 update public.ap_research_preparations set state='READY',reason=null,lease_token=null,lease_until=null,
  next_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.id;
 return true;
end $$;
create function public.ap_finish_research_preparation_check(p_preparation_id uuid,p_lease_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j public.ap_research_preparations; next_state text;
begin
 j:=public.ap_lock_research_preparation(p_preparation_id);
 if j.id is null or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp()
  or not public.ap_research_snapshot_current(j.snapshot_id) then raise exception 'research_preparation_claim_changed'; end if;
 if exists(select 1 from public.ap_feasibility_requests where id=j.request_id and state='COMPLETED') then next_state:='COMPLETE';
 elsif public.ap_research_preparation_ready(j.request_id) then next_state:='READY';
 elsif not exists(select 1 from public.ap_research_preparation_sources where preparation_id=j.id and source_run_id is null) then next_state:='OWNER_REVIEW';
 else next_state:='COLLECTING'; end if;
 update public.ap_research_preparations set state=next_state,reason=case when next_state='COLLECTING' then 'SOURCE_COLLECTION_INCOMPLETE' when next_state='OWNER_REVIEW' then 'SOURCE_REVIEW_REQUIRED' else null end,
  lease_token=null,lease_until=null,updated_at=clock_timestamp() where id=j.id;
 return next_state;
end $$;

revoke all on function public.ap_enqueue_confirmed_research_trigger(),public.ap_enqueue_finalized_research_trigger() from public,anon,authenticated,service_role;
revoke all on function public.ap_lock_research_preparation(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.ap_research_snapshot_current(uuid),public.ap_enqueue_research_preparation(uuid),
 public.ap_configure_research_preparation(uuid,bigint,boolean,uuid[]),public.ap_claim_research_preparation(),
 public.ap_prepare_automatic_research(uuid,uuid,jsonb),public.ap_bind_prepared_research_run(uuid,uuid,uuid,uuid),
 public.ap_promote_prepared_research_observation(uuid,uuid,uuid,uuid,uuid,jsonb,text,jsonb,jsonb,jsonb),public.ap_complete_prepared_research_review(uuid,uuid,text),
 public.ap_research_preparation_ready(uuid),public.ap_finish_research_preparation_check(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ap_research_snapshot_current(uuid),public.ap_enqueue_research_preparation(uuid),
 public.ap_configure_research_preparation(uuid,bigint,boolean,uuid[]),public.ap_claim_research_preparation(),
 public.ap_prepare_automatic_research(uuid,uuid,jsonb),public.ap_bind_prepared_research_run(uuid,uuid,uuid,uuid),
 public.ap_promote_prepared_research_observation(uuid,uuid,uuid,uuid,uuid,jsonb,text,jsonb,jsonb,jsonb),public.ap_complete_prepared_research_review(uuid,uuid,text),
 public.ap_research_preparation_ready(uuid),public.ap_finish_research_preparation_check(uuid,uuid) to service_role;

-- A database archive may name only an explicitly reviewed schema that is
-- actually installed. Forward migrations extend this finite helper; historical
-- receipts and every other completion binding retain their original semantics.
create function public.ap_archive_snapshot_schema_supported(p_schema text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(p_schema=any(array[
  '202610250090','202610250091','202610250092','202610250093','202610250094','202610250095',
  '202610250096','202610250097','202610250098','202610250099','202610250100'
 ]) and exists(select 1 from supabase_migrations.schema_migrations where version=p_schema),false);
$$;
revoke all on function public.ap_archive_snapshot_schema_supported(text) from public,anon,authenticated,service_role;
do $$ declare definition text; old_guard text:=$guard$p_completion_receipt->>'snapshotSchemaVersion'!~'^20261025009[0-9]$'$guard$; begin
 select pg_get_functiondef('public.ap_finish_archive_writer(uuid,text,boolean,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1
  then raise exception 'archive_writer_schema_guard_changed'; end if;
 execute replace(definition,old_guard,'not public.ap_archive_snapshot_schema_supported(p_completion_receipt->>''snapshotSchemaVersion'')');
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250100','AUTOMATIC_RESEARCH_PREPARATION',0,clock_timestamp());
create function public.ap_automatic_research_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250100' and checkpoint='AUTOMATIC_RESEARCH_PREPARATION')
 and public.ap_archive_fence_coverage_current()
 and (select count(*)=2 from public.ap_retention_private_tables where table_name in('ap_research_preparations','ap_research_preparation_sources'))
 and (select count(*)=2 from pg_trigger where not tgisinternal and tgenabled='O'
   and tgname='ap_service_retention_write' and tgrelid in('public.ap_research_preparations'::regclass,'public.ap_research_preparation_sources'::regclass)
   and tgfoid='public.ap_guard_service_retention_write()'::regprocedure)
 and exists(select 1 from pg_trigger where not tgisinternal and tgenabled='O' and tgname='ap_enqueue_confirmed_research'
   and tgrelid='public.ap_feasibility_requests'::regclass and tgfoid='public.ap_enqueue_confirmed_research_trigger()'::regprocedure)
 and exists(select 1 from pg_trigger where not tgisinternal and tgenabled='O' and tgname='ap_enqueue_finalized_research'
   and tgrelid='public.ap_anonymous_drafts'::regclass and tgfoid='public.ap_enqueue_finalized_research_trigger()'::regprocedure)
 and not has_function_privilege('authenticated','public.ap_prepare_automatic_research(uuid,uuid,jsonb)','EXECUTE')
 and not has_function_privilege('service_role','public.ap_lock_research_preparation(uuid,boolean)','EXECUTE')
 and not has_table_privilege('service_role','public.ap_research_preparations','INSERT,UPDATE,DELETE,TRUNCATE')
 and not has_table_privilege('service_role','public.ap_research_preparation_sources','INSERT,UPDATE,DELETE,TRUNCATE');
$$;
revoke all on function public.ap_automatic_research_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_automatic_research_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=23 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250099''' in definition)=0
  or position('(''202610250099'',''SCOPED_SERVICE_ERROR_REPAIRS'')' in definition)=0 or position('''202610250098'',''202610250099''' in definition)=0
  or position('public.ap_service_repair_schema_installed()' in definition)=0 then raise exception 'automatic_research_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=23 as installed','select count(*)=24 as installed');
 definition:=replace(definition,'(''202610250099'',''SCOPED_SERVICE_ERROR_REPAIRS'')','(''202610250099'',''SCOPED_SERVICE_ERROR_REPAIRS''),(''202610250100'',''AUTOMATIC_RESEARCH_PREPARATION'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250099''','''requiredSchemaVersion'', ''202610250100''');
 definition:=replace(definition,'''202610250098'',''202610250099''','''202610250098'',''202610250099'',''202610250100''');
 definition:=replace(definition,'public.ap_service_repair_schema_installed()','public.ap_service_repair_schema_installed() and public.ap_automatic_research_schema_installed()');
 execute definition;
end $$;
commit;
