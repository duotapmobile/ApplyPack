-- Chunk 3 final acceptance remediation.
-- Expand-only enforcement for exact review evidence binding. Existing immutable
-- rows are preserved; this trigger applies to new matching-rules-v3 reviews.

create or replace function public.ap_chunk3_customer_criterion_node_matches(p_key text,p_type text,p_value jsonb)
returns boolean language sql immutable set search_path='' as $$
  select case
    when p_key='customer:work-mode' then p_type='WORK_MODE'
    when p_key='customer:geography-state' then p_type in ('GEOGRAPHY','WORK_MODE')
    when p_key like 'customer:commute%' then p_type='COMMUTE'
    when p_key='customer:employment-type' then p_type='EMPLOYMENT_TYPE'
    when p_key='customer:title-restriction' then p_type='CUSTOMER_TITLE_RESTRICTION'
    when p_key like 'customer:blocked-industry:%' then p_type='INDUSTRY_DOMAIN'
      and regexp_replace(lower(coalesce(p_value->>'domain','')),'[^a-z0-9]+','-','g')=substring(p_key from length('customer:blocked-industry:')+1)
    when p_key like 'customer:benefit:%' then p_type='BENEFIT'
      and regexp_replace(lower(coalesce(p_value->>'benefit','')),'[^a-z0-9]+','-','g') like '%'||substring(p_key from length('customer:benefit:')+1)||'%'
    when p_key like 'customer:dealbreaker:%' then p_type in ('TRAVEL_PHYSICAL','DUTY_EXCLUSION','RESPONSIBILITY','COMPENSATION','CUSTOM_EXCLUSION')
    when p_key like 'customer:work-condition:%' then p_type in ('SCHEDULE','TRAVEL_PHYSICAL','DUTY_EXCLUSION','RESPONSIBILITY','BENEFIT','CUSTOM_EXCLUSION')
    else false
  end
$$;

create or replace function public.ap_guard_chunk3_exact_review_evidence()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.catalog_version<>'matching-rules-v3' then return new; end if;
  if new.review_kind='MATCH_EVIDENCE' then
    if exists(
      select 1 from jsonb_array_elements_text(new.decision->'sourceEvidenceNodeIds') evidence_id
      where not exists(
        select 1 from public.ap_requirement_nodes node
        where node.id=evidence_id::uuid and node.job_snapshot_id=new.job_snapshot_id
          and node.stable_criterion_id=(new.decision->>'stableCriterionId')::uuid
      )
    ) then raise exception 'match_evidence_not_exact_criterion'; end if;
    if exists(
      select 1 from jsonb_array_elements_text(new.decision->'candidateFactVersionIds') fact_id
      where not exists(
        select 1 from public.ap_candidate_facts fact
        where fact.id=fact_id::uuid and fact.snapshot_id=new.snapshot_id and fact.superseded_at is null
          and (fact.verification='CUSTOMER_CONFIRMED' or (fact.verification='HUMAN_VERIFIED' and fact.source_kind='HUMAN_VERIFICATION' and fact.supplied_source_id is not null))
      )
    ) then raise exception 'match_evidence_candidate_fact_not_current'; end if;
  end if;
  if new.review_kind='CUSTOMER_CRITERION' and not exists(
    select 1 from jsonb_array_elements_text(new.decision->'sourceEvidenceNodeIds') evidence_id
    join public.ap_requirement_nodes node on node.id=evidence_id::uuid and node.job_snapshot_id=new.job_snapshot_id
    where public.ap_chunk3_customer_criterion_node_matches(new.decision->>'customerCriterionKey',node.criterion_type::text,node.typed_value)
  ) then raise exception 'customer_criterion_not_exact_typed_evidence'; end if;
  return new;
end; $$;

create trigger ap_chunk3_exact_review_evidence_guard
  before insert on public.ap_human_review_records
  for each row execute function public.ap_guard_chunk3_exact_review_evidence();

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609060029','CHUNK3_FINAL_ACCEPTANCE_EXPAND',0,now())
on conflict (migration_id,checkpoint) do nothing;
