begin;
-- Preserve historical Arial/scanner evidence. New approvals bind explicit font and
-- structural policy; legacy parameter names remain RPC wire compatibility only.
alter table public.ap_commerce_configuration
  add column document_font_family text check (document_font_family is null or document_font_family='Liberation Sans'),
  add column document_font_sha256 text check (document_font_sha256 is null or document_font_sha256 ~ '^[0-9a-f]{64}$'),
  add column document_safety_policy text check (document_safety_policy is null or document_safety_policy='generated-structural-v1');
alter table public.ap_artifact_quality_reviews
  alter column arial_font_sha256 drop not null,
  alter column arial_resolved drop not null,
  alter column malware_scanner_identity drop not null,
  add column document_font_family text,
  add column document_font_sha256 text check (document_font_sha256 is null or document_font_sha256 ~ '^[0-9a-f]{64}$'),
  add column document_font_resolved boolean,
  add column document_safety_policy text,
  add column malware_verdict text check (malware_verdict is null or malware_verdict='NOT_SCANNED');
update public.ap_commerce_configuration set materials_generation_approved=false,
  materials_generation_approval_reference=null;

-- Existing function signatures stay stable for rolling deployments. New evidence
-- is written only to generic columns; old records are never relabeled.
do $$
declare fn record; definition text;
begin
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname like 'ap_%'
  loop
    definition:=pg_get_functiondef(fn.oid);
    if definition like '%config.arial_font_sha256%' or definition like '%quality.arial_resolved%' or definition like '%renderer_identity,arial_font_sha256,malware_scanner_identity,%' then
      definition:=replace(definition,'config.arial_font_sha256','config.document_font_sha256');
      definition:=replace(definition,'config.malware_scanner_identity','(case when config.document_safety_policy=''generated-structural-v1'' and config.document_font_family=''Liberation Sans'' then ''NOT_SCANNED:generated-structural-v1'' else null end)');
      definition:=replace(definition,'quality.arial_resolved','quality.document_font_resolved');
      definition:=replace(definition,'renderer_identity,arial_font_sha256,malware_scanner_identity,','renderer_identity,document_font_sha256,document_safety_policy,');
      definition:=replace(definition,'rendered_page_sha256,arial_resolved,automated_passed_at','rendered_page_sha256,document_font_resolved,automated_passed_at');
      definition:=replace(definition,'fact.customer_id=purchase.customer_id','(fact.customer_id is null or fact.customer_id=purchase.customer_id) and public.ap_customer_owns_snapshot(purchase.customer_id,p_source_snapshot_id)');
      execute definition;
    end if;
  end loop;
end $$;
create function public.ap_stamp_document_safety_policy() returns trigger language plpgsql set search_path='' as $$
begin
  if new.document_safety_policy='NOT_SCANNED:generated-structural-v1' then
    new.document_safety_policy:='generated-structural-v1';
    new.document_font_family:='Liberation Sans';
    new.malware_verdict:='NOT_SCANNED';
  else raise exception 'explicit_document_safety_policy_required'; end if;
  return new;
end $$;
create trigger ap_stamp_document_safety_policy before insert on public.ap_artifact_quality_reviews
for each row execute function public.ap_stamp_document_safety_policy();
revoke all on function public.ap_stamp_document_safety_policy() from public,anon,authenticated;
-- Every new authorization checks the current generic policy, while keeping
-- historical approvals and released bytes as immutable history.
do $$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
  anchor:='  -- Only an explicit successor';
  if position(anchor in definition)=0 then raise exception 'document_policy_guard_anchor_missing'; end if;
  definition:=replace(definition,anchor,$guard$
  if artifact.generator_version is distinct from 'applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1' then
    raise exception 'document_policy_regeneration_required';
  end if;
  if not exists(select 1 from public.ap_generated_file_versions file
    join public.ap_artifact_quality_reviews quality on quality.file_version_id=file.id
    cross join public.ap_commerce_configuration config
    where config.singleton and file.artifact_id=artifact.id and file.version=artifact.current_file_version
      and quality.document_font_family=config.document_font_family
      and quality.document_font_sha256=config.document_font_sha256
      and quality.document_safety_policy=config.document_safety_policy
      and quality.renderer_identity=config.document_renderer_identity) then
    raise exception 'document_render_policy_stale';
  end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(artifact.claim_provenance->'matchingReviewIds','[]'::jsonb)) review_id
    where not exists(select 1 from public.ap_human_review_records review where review.id=review_id::uuid
      and (review.customer_id is null or review.customer_id=artifact.customer_id) and review.snapshot_id=artifact.source_snapshot_id
      and review.job_snapshot_id=artifact.job_snapshot_id and review.review_kind='MATCH_EVIDENCE' and review.invalidated_at is null)) then
    raise exception 'document_matching_review_stale';
  end if;
  -- Only an explicit successor$guard$);
  definition:=replace(definition,'fact.customer_id is distinct from artifact.customer_id','(fact.customer_id is not null and fact.customer_id is distinct from artifact.customer_id) or not public.ap_customer_owns_snapshot(artifact.customer_id,artifact.source_snapshot_id)');
  execute definition;
end $$;
-- No activation: the operator must approve the actual renderer and new font hash.

alter table public.ap_document_versions add column structural_review_ready_at timestamptz,
  add column structural_policy text, add column malware_deferred boolean not null default false;
create function public.ap_record_isolated_document_review(p_draft_id uuid,p_document_id uuid,p_sha256 text,p_parser_identity text,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare document public.ap_document_versions; item record;
begin
  perform 1 from public.ap_anonymous_drafts where id=p_draft_id and state='IN_PROGRESS' and expires_at>clock_timestamp() for update;
  if not found then raise exception 'draft_not_available'; end if;
  select * into document from public.ap_document_versions where id=p_document_id and draft_id=p_draft_id and is_current and retention_state='ACTIVE' for update;
  if not found or document.sha256 is distinct from p_sha256 or p_parser_identity is distinct from 'isolated-extractor-v1'
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'document_review_binding_invalid'; end if;
  if document.structural_review_ready_at is not null then return; end if;
  for item in select value,ordinality from jsonb_array_elements_text(p_lines) with ordinality loop
    if item.value is null or length(btrim(item.value)) not between 1 and 2000 then raise exception 'document_review_line_bound'; end if;
    insert into public.ap_candidate_facts(draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,source_locator,
      verification,catalog_version,schema_version,fact_tier,customer_display_label,customer_display_value)
    values(p_draft_id,'document.excerpt.'||p_document_id::text||'.'||item.ordinality::text,'VERBATIM_DOCUMENT_EXCERPT',jsonb_build_object('verbatim',item.value),
      'DOCUMENT',p_document_id,'extracted-line:'||item.ordinality::text,'EXTRACTED_UNCONFIRMED','isolated-extractor-v1','verbatim-v1','DOCUMENT_ONLY',
      'Review this statement from your document',jsonb_build_object('summary',item.value));
  end loop;
  -- SCANNING is the legacy processing phase, not a CLEAN malware verdict.
  update public.ap_document_versions set processing_state='QUARANTINED' where id=p_document_id and processing_state in ('UPLOADED','FAILED');
  update public.ap_document_versions set processing_state='SCANNING' where id=p_document_id and processing_state='QUARANTINED';
  update public.ap_document_versions set processing_state='EXTRACTING',parse_status='SUCCEEDED',parser_identity=p_parser_identity,
    structural_review_ready_at=clock_timestamp(),structural_policy='isolated-structural-v1',malware_deferred=true,
    malware_status='PENDING',malware_provider_ref=null,model_ready_at=null,reference_isolation_status='CLEAR',leak_scan_status='CLEAR',failure_code=null
    where id=p_document_id;
end $$;
revoke all on function public.ap_record_isolated_document_review(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ap_record_isolated_document_review(uuid,uuid,text,text,jsonb) to service_role;
do $$
declare definition text; anchor text;
begin
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_finalize_four_step_intake';
  anchor:='and processing_state<>''FAILED''';
  if position(anchor in definition)=0 then raise exception 'document_finalize_guard_anchor_missing'; end if;
  definition:=replace(definition,anchor,'and (processing_state=''READY'' or (structural_review_ready_at is not null and structural_policy=''isolated-structural-v1'' and malware_deferred and parse_status=''SUCCEEDED'' and failure_code is null))');
  execute definition;
end $$;

create table public.ap_document_processing_jobs (
  document_id uuid primary key references public.ap_document_versions(id),
  state text not null default 'PENDING' check(state in ('PENDING','CLAIMED','COMPLETED','FAILED')),
  attempts integer not null default 0, lease_token uuid, leased_until timestamptz,
  next_attempt_at timestamptz not null default now(), last_error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.ap_document_processing_jobs enable row level security;
revoke all on public.ap_document_processing_jobs from public,anon,authenticated,service_role;
grant select on public.ap_document_processing_jobs to service_role;
create function public.ap_queue_document_processing() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.draft_id is not null then insert into public.ap_document_processing_jobs(document_id) values(new.id) on conflict do nothing; end if;
  return new;
end $$;
create trigger ap_queue_document_processing after insert on public.ap_document_versions for each row execute function public.ap_queue_document_processing();
create function public.ap_claim_document_processing(p_limit integer) returns table(document_id uuid,draft_id uuid,storage_path text,verified_mime_type text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  update public.ap_document_processing_jobs set state='FAILED',last_error_code='LEASE_EXHAUSTED',updated_at=now() where state='CLAIMED' and attempts>=3 and leased_until<now();
  return query with selected as (
    select job.document_id from public.ap_document_processing_jobs job
    join public.ap_document_versions doc on doc.id=job.document_id
    join public.ap_anonymous_drafts draft on draft.id=doc.draft_id
    where doc.is_current and doc.retention_state='ACTIVE' and draft.state='IN_PROGRESS' and draft.expires_at>now()
      and job.attempts<3 and job.next_attempt_at<=now()
      and (job.state='PENDING' or (job.state='CLAIMED' and job.leased_until<now()))
    order by job.created_at for update of job skip locked limit greatest(1,least(p_limit,2))
  ), claimed as (
    update public.ap_document_processing_jobs job set state='CLAIMED',attempts=attempts+1,
      lease_token=gen_random_uuid(),leased_until=now()+interval '2 minutes',updated_at=now()
    from selected where job.document_id=selected.document_id returning job.*
  ) select doc.id,doc.draft_id,doc.storage_path,doc.verified_mime_type,claimed.lease_token
    from claimed join public.ap_document_versions doc on doc.id=claimed.document_id;
end $$;
create function public.ap_complete_document_processing(p_document_id uuid,p_lease_token uuid,p_succeeded boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.ap_document_processing_jobs set state=case when p_succeeded then 'COMPLETED' when attempts>=3 then 'FAILED' else 'PENDING' end,
    next_attempt_at=now()+interval '5 minutes',last_error_code=case when p_succeeded then null else 'ISOLATED_PROCESSING_FAILED' end,
    leased_until=null,lease_token=null,updated_at=now()
  where document_id=p_document_id and lease_token=p_lease_token and state='CLAIMED';
  if not found then raise exception 'document_processing_lease_lost'; end if;
end $$;
create function public.ap_retry_document_processing(p_document_id uuid,p_draft_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.ap_document_versions where id=p_document_id and draft_id=p_draft_id and is_current) then raise exception 'document_not_current'; end if;
  insert into public.ap_document_processing_jobs(document_id) values(p_document_id)
  on conflict(document_id) do update set state='PENDING',attempts=0,next_attempt_at=now(),last_error_code=null
    where ap_document_processing_jobs.state<>'CLAIMED' or ap_document_processing_jobs.leased_until<now();
end $$;
revoke all on function public.ap_queue_document_processing(),public.ap_claim_document_processing(integer),public.ap_complete_document_processing(uuid,uuid,boolean),public.ap_retry_document_processing(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ap_claim_document_processing(integer),public.ap_complete_document_processing(uuid,uuid,boolean),public.ap_retry_document_processing(uuid,uuid) to service_role;
do $$
declare fn record; definition text;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_apply_verified_search_payment'
  loop
    definition:=pg_get_functiondef(fn.oid);
    definition:=replace(definition,'and processing_state=''READY''','and (processing_state=''READY'' or (structural_review_ready_at is not null and structural_policy=''isolated-structural-v1'' and malware_deferred and parse_status=''SUCCEEDED'' and failure_code is null))');
    definition:=replace(definition,'snapshot_row.finalized_at,''clean'',snapshot_row.finalized_at','snapshot_row.finalized_at,case when exists(select 1 from public.ap_document_versions doc where doc.draft_id=checkout_row.draft_id and doc.storage_path=resume_path and doc.malware_status=''CLEAN'') then ''clean'' else ''pending'' end,null');
    execute definition;
  end loop;
end $$;
commit;
