begin;
-- A changed-then-reverted canonical hash must not revive invalidated evidence.
do $$ declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.ap_current_verified_job_snapshots(uuid[])'::regprocedure);
 anchor:='order by s.live_verified_at desc';
 if position(anchor in definition)=0 then raise exception 'current_job_invalidation_anchor_missing'; end if;
 execute replace(definition,anchor,'and not exists(select 1 from public.ap_job_snapshot_invalidations invalid where invalid.job_snapshot_id=s.id) '||anchor);
 definition:=pg_get_functiondef('public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)'::regprocedure);
 anchor:='if j.id is null or j.legacy_compatibility';
 if position(anchor in definition)=0 then raise exception 'inventory_invalidation_anchor_missing'; end if;
 execute replace(definition,anchor,'if exists(select 1 from public.ap_job_snapshot_invalidations invalid where invalid.job_snapshot_id=j.id) or j.id is null or j.legacy_compatibility');
end $$;
-- Manual bounded research is an actor-attributed checklist, never a source
-- enumeration proof, closure signal or permission to waive candidate hard gates.
create table public.ap_manual_research_reviews (
 cell_id uuid primary key references public.ap_feasibility_coverage_cells(id),
 reviewer_id uuid not null references public.profiles(id), reviewed_at timestamptz not null,
 source_authorization_id uuid not null references public.ap_source_authorizations(id), authorization_head_revision bigint not null,
 job_snapshot_ids uuid[] not null, evidence_urls jsonb not null, checklist jsonb not null,
 evidence_notes text not null, recorded_at timestamptz not null default now()
);
alter table public.ap_manual_research_reviews enable row level security;
revoke all on public.ap_manual_research_reviews from public,anon,authenticated,service_role;
grant select on public.ap_manual_research_reviews to service_role;
create trigger ap_manual_research_reviews_immutable before update or delete on public.ap_manual_research_reviews
 for each row execute function public.ap_prevent_immutable_mutation();
create function public.ap_complete_manual_research_cell(p_cell_id uuid,p_actor_id uuid,p_reviewed_at timestamptz,
 p_job_snapshot_ids uuid[],p_evidence_urls jsonb,p_checklist jsonb,p_notes text) returns void
language plpgsql security definer set search_path='' as $$
declare cell public.ap_feasibility_coverage_cells; plan public.ap_feasibility_coverage_plans; config public.ap_feasibility_source_configurations;
 head public.ap_source_authorization_heads; prior public.ap_manual_research_reviews; total integer; pages integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator')) then raise exception 'manual_research_operator_required'; end if;
 select * into cell from public.ap_feasibility_coverage_cells where id=p_cell_id for update;
 select * into plan from public.ap_feasibility_coverage_plans where id=cell.plan_id;
 select * into config from public.ap_feasibility_source_configurations where id=cell.configuration_id;
 select * into head from public.ap_source_authorization_heads where source_id=cell.source_id for share;
 if cell.id is null or cell.execution_path<>'MANUAL' or cell.authorization_mode<>'AUTHORIZED_MANUAL_ONLY'
  or head.current_authorization_id is distinct from cell.source_authorization_id
  or not exists(select 1 from public.ap_source_authorizations where id=head.current_authorization_id and state='AUTHORIZED_MANUAL_ONLY')
  or config.id is null or config.source_authorization_id<>head.current_authorization_id
  or config.pagination_bound<>cell.pagination_bound or config.result_bound<>cell.result_bound or config.lookback_bound<>cell.lookback_bound
  or not exists(select 1 from public.ap_intake_snapshots s where s.id=plan.snapshot_id and s.finalized_at is not null
   and not exists(select 1 from public.ap_intake_snapshots n where (n.draft_id=s.draft_id or n.intake_id=s.intake_id) and n.version>s.version))
  then raise exception 'manual_research_current_scope_required'; end if;
 if p_reviewed_at is null or p_reviewed_at>clock_timestamp() or p_reviewed_at<clock_timestamp()-interval '24 hours'
  or p_reviewed_at<plan.created_at or length(btrim(coalesce(p_notes,''))) not between 20 and 4000
  or p_job_snapshot_ids is null or cardinality(p_job_snapshot_ids)>least(cell.result_bound,500)
  or cardinality(p_job_snapshot_ids)<>(select count(distinct id) from unnest(p_job_snapshot_ids) id)
  or jsonb_typeof(p_evidence_urls) is distinct from 'array' or jsonb_array_length(p_evidence_urls) not between 1 and 20
  or exists(select 1 from jsonb_array_elements_text(p_evidence_urls) url where url is null or length(url)>2000 or url!~'^https://[^/@[:space:]]+(/[^[:space:]]*)?$')
  or jsonb_typeof(p_checklist) is distinct from 'object'
  or p_checklist->>'queryFingerprint' is distinct from cell.query_fingerprint
  or p_checklist->'allEncounteredListingsAccountedFor' is distinct from 'true'::jsonb
  or coalesce(p_checklist->>'stopReason','') not in ('REVIEWED_CONFIGURED_SCOPE','CONFIGURED_BOUND_REACHED')
  or coalesce(p_checklist->>'pagesReviewed','')!~'^[1-9][0-9]{0,5}$'
  then raise exception 'manual_research_checklist_invalid'; end if;
 pages:=(p_checklist->>'pagesReviewed')::integer;
 if pages>cell.pagination_bound then raise exception 'manual_research_bound_exceeded'; end if;
 select count(distinct j.id) into total from unnest(p_job_snapshot_ids) requested(id)
 join public.ap_job_snapshots j on j.id=requested.id and j.source_authorization_id=cell.source_authorization_id
 join public.ap_inventory_members m on m.job_snapshot_id=j.id and m.inventory_version_id=plan.inventory_version_id and m.selected_by_deduplication
 where exists(select 1 from public.ap_current_verified_job_snapshots(array[j.legacy_job_id]) current_job where current_job.id=j.id)
 and exists(select 1 from public.ap_match_evaluations e where e.inventory_member_id=m.id and e.job_snapshot_id=j.id
   and e.snapshot_id=plan.snapshot_id and e.invalidated_at is null and not e.legacy_compatibility);
 if total<>cardinality(p_job_snapshot_ids) then raise exception 'manual_research_verified_evaluation_required'; end if;
 if exists(select 1 from public.ap_inventory_members m join public.ap_job_snapshots j on j.id=m.job_snapshot_id
   where m.inventory_version_id=plan.inventory_version_id and m.selected_by_deduplication and j.source_authorization_id=cell.source_authorization_id
   and not (j.id=any(p_job_snapshot_ids))) then raise exception 'manual_research_known_inventory_omitted'; end if;
 select * into prior from public.ap_manual_research_reviews where cell_id=cell.id;
 if found then
  if prior.reviewer_id<>p_actor_id or prior.reviewed_at<>p_reviewed_at or prior.job_snapshot_ids<>p_job_snapshot_ids
   or prior.evidence_urls<>p_evidence_urls or prior.checklist<>p_checklist or prior.evidence_notes<>p_notes then raise exception 'manual_research_replay_conflict'; end if;
  return;
 end if;
 if cell.terminal_outcome is distinct from 'PENDING' then raise exception 'manual_research_already_terminal'; end if;
 insert into public.ap_manual_research_reviews values(cell.id,p_actor_id,p_reviewed_at,cell.source_authorization_id,head.revision,p_job_snapshot_ids,p_evidence_urls,p_checklist,p_notes,clock_timestamp());
 update public.ap_feasibility_coverage_cells set terminal_outcome=case when total=0 then 'SUCCEEDED_EMPTY' else 'SUCCEEDED_WITH_RESULTS' end,
  result_count=total,manual_checklist_complete=true,configured_bound_satisfied=false,normalized_and_deduplicated=true,
  parser_result=jsonb_build_object('status','COMPLETE','evidenceKind','MANUAL_BOUNDED_CHECKLIST','automatedEnumeration',false),
  cursor_or_stop_reason='MANUAL_BOUNDED_CHECKLIST:'||cell.id,started_at=plan.created_at,completed_at=p_reviewed_at where id=cell.id;
 update public.ap_feasibility_requests set state='PENDING',completed_assessment_id=null,error_code=null,updated_at=clock_timestamp()
  where snapshot_id=plan.snapshot_id and state in ('ERROR','COMPLETED');
end $$;
revoke all on function public.ap_complete_manual_research_cell(uuid,uuid,timestamptz,uuid[],jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.ap_complete_manual_research_cell(uuid,uuid,timestamptz,uuid[],jsonb,jsonb,text) to service_role;
commit;
