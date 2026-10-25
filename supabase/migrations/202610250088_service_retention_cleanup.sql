begin;

-- Forward implementation of the owner-approved one-off policy. Exact object
-- removals run only through maintenance; protected archive pruning is separate.
create table public.ap_retention_private_tables (
  table_name name primary key,
  primary_key name not null default 'id',
  redaction_patch jsonb not null check(jsonb_typeof(redaction_patch)='object')
);
create table public.ap_retention_row_receipts (
  table_name name not null references public.ap_retention_private_tables(table_name),
  row_id text not null,
  claim_id uuid not null references public.ap_service_retention_claims(id),
  before_sha256 text not null check(before_sha256 ~ '^[0-9a-f]{64}$'),
  after_sha256 text not null check(after_sha256 ~ '^[0-9a-f]{64}$'),
  redacted_at timestamptz not null default clock_timestamp(),
  primary key(table_name,row_id)
);
create table public.ap_retention_restore_receipts (
  overlay_sha256 text primary key check(overlay_sha256 ~ '^[0-9a-f]{64}$'),
  source_watermark timestamptz not null,
  receipt jsonb not null,
  applied_at timestamptz not null default clock_timestamp()
);
create table public.ap_retention_restore_lock (
  singleton boolean primary key default true check(singleton),
  locked boolean not null default false
);
create table public.ap_retention_legacy_object_intents (
  bucket text not null check(bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')),
  path_sha256 text not null check(path_sha256 ~ '^[0-9a-f]{64}$'),
  claimed_at timestamptz not null default clock_timestamp(),
  primary key(bucket,path_sha256)
);
create table public.ap_retention_restored_object_tombstones (
  bucket text not null check(bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')),
  path_sha256 text not null check(path_sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz not null,
  primary key(bucket,path_sha256)
);
create table public.ap_retention_restored_object_policies (
  bucket text not null check(bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')),
  path_sha256 text not null check(path_sha256 ~ '^[0-9a-f]{64}$'),
  retention_expires_at timestamptz,
  protected boolean not null,
  primary key(bucket,path_sha256)
);
create table public.ap_retention_restored_order_protection (
  order_id uuid primary key references public.ap_order_retention_contracts(order_id),
  protected boolean not null,
  source_state text not null check(source_state in('ACTIVE','PURGING','PURGED')),
  source_watermark timestamptz not null
);
insert into public.ap_retention_restore_lock(singleton) values(true);
do $$ declare t text; begin
  foreach t in array array['ap_retention_private_tables','ap_retention_row_receipts','ap_retention_restore_receipts','ap_retention_restore_lock','ap_retention_legacy_object_intents','ap_retention_restored_object_tombstones','ap_retention_restored_object_policies','ap_retention_restored_order_protection'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
end $$;

-- This finite manifest deliberately excludes financial, authentication and
-- accepted legal-content receipts. Identifiers and original content digests are
-- retained as non-content evidence; private values are replaced by empty shells.
insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values
('ap_anonymous_drafts','id','{"answers":{},"access_email_normalized":null,"retention_state":"DELETED"}'),
('ap_sensitive_payloads','id','{"ciphertext":"\\x","encrypted_data_key":"\\x00","nonce":"\\x000000000000000000000000","authentication_tag":"\\x00000000000000000000000000000000","retention_state":"CRYPTO_SHREDDED"}'),
('ap_document_versions','id','{"safe_display_name":"removed.pdf","storage_path":"@path","retention_state":"DELETED","malware_provider_ref":null,"parser_limits":null}'),
('ap_intake_snapshots','id','{"access_email_normalized":"removed@retention.invalid","payer_receipt_email":null,"document_contact_email":null,"desired_activities":[],"avoided_activities":[],"optional_titles":[],"confirmed_title_restriction":null,"optional_industries":[],"blocked_industries":[],"work_modes":[],"preferred_work_mode":null,"us_state_or_dc":null,"employment_types":[],"preferred_employment_type":null,"schedules":[],"travel":{},"benefits":{},"work_condition_preferences":{},"dealbreakers":[],"salary_target_cents":null,"salary_hard_minimum_cents":null,"employer_unknown_policy":{},"targeted_authorization_answers":{}}'),
('ap_candidate_facts','id','{"semantic_key":"removed","typed_value":{},"source_locator":"removed","customer_display_label":null,"customer_display_value":null,"starts_on":null,"ends_on":null,"calendar_duration_days":null,"intensity_percent":null,"capability_status":null}'),
('ap_experience_identities','id','{"label":"removed","starts_on":null,"ends_on":null,"calendar_duration_days":null,"intensity_percent":null}'),
('ap_independent_verification_sources','id','{"source_locator":"removed","retention_state":"DELETED"}'),
('ap_human_review_records','id','{"compared_tasks":null,"task_similarity":null,"complexity":null,"autonomy":null,"scope":null,"domain_context":null,"duration_and_intensity":null,"essential_tools":null,"rationale":"removed","decision":{}}'),
('ap_feasibility_coverage_plans','id','{"typed_inputs":{},"constraint_proof":{}}'),
('ap_feasibility_coverage_cells','id','{"cursor_or_stop_reason":null,"parser_result":null}'),
('ap_feasibility_requests','id','{"state":"STALE","claimed_by":null,"claimed_at":null,"completed_assessment_id":null,"error_code":null,"stale_reason":"SERVICE_CONTENT_REMOVED"}'),
('ap_feasibility_assessments','id','{"invalidated_at":"@now"}'),
('ap_match_evaluations','id','{"leaf_results":[],"satisfaction_paths":[],"fit_components":{},"confidence_components":{},"presentation_risk_reasons":[],"warnings":[],"soft_preferences":{},"job_evidence":{},"explanation_evidence":{},"rank_explanation":null,"root_results":null,"selector_explanation":null,"fit_score":null,"evidence_confidence":null,"preference_alignment":null,"invalidated_at":"@now"}'),
('ap_candidate_questions','id','{"prompt":"Private content removed"}'),
('ap_candidate_answers','question_id','{"answer":"removed"}'),
('ap_criteria_amendments','id','{"criteria_diff":{},"blocking_constraints":[],"proposed_snapshot_patch":{},"decline_reason":null}'),
('ap_search_package_reviews','id','{"checklist":{},"rationale":"removed"}'),
('ap_job_release_reviews','id','{"rationale":"removed"}'),
('ap_manual_research_reviews','cell_id','{"checklist":{},"evidence_notes":"Private content removed","evidence_urls":[]}'),
('ap_research_cell_reviews','cell_id','{"evidence_notes":"Private content removed"}'),
('ap_material_line_revisions','id','{"fact_diff":{},"reference_scope":{}}'),
('ap_material_change_proposals','id','{"fact_diff":{}}'),
('ap_material_support_cases','id','{"non_sensitive_fact_diff":{}}'),
('ap_generated_artifacts','id','{"claim_provenance":{},"retention_state":"DELETED"}'),
('ap_generated_file_versions','id','{"storage_path":"@path","safe_filename":"removed.pdf","downloads_revoked_at":"@now"}'),
('ap_artifact_quality_reviews','id','{"structural_checks":{},"provenance_checks":{},"render_preview_path":"@path","content_attestation":null,"visual_attestation":null}'),
('ap_reference_records','id','{"retention_state":"DELETED"}'),
('ap_reference_record_versions','id','{}'),
('ap_reference_isolation_reviews','id','{}'),
('ap_candidate_fact_conflicts','id','{}'),
('ap_fact_presentations','id','{}'),
('ap_fact_review_history','id','{}'),
('ap_targeted_intake_questions','id','{}'),
('ap_reference_permissions','id','{"employer_snapshot":"removed","exact_position_snapshot":"removed"}'),
('intakes','id','{"direction":"removed","dealbreakers":"removed","location_preference":"removed","schedule_preference":"removed","experience_summary":"removed","priorities":[],"minimum_salary":null,"notes":null,"resume_path":"","cover_letter_path":null,"source_deleted_at":"@now","source_scan_provider_ref":null}'),
('intake_answers','intake_id','{"answers":{}}'),
('criteria_versions','id','{"snapshot":{}}'),
('source_documents','id','{"storage_path":"@path","deleted_at":"@now","scan_provider_reference":null}'),
('intake_drafts','id','{"resume_document":null,"cover_letter_document":null,"answers":{}}'),
('job_matches','id','{"fit_summary":"removed","matching_experience":[],"criteria_checks":[],"concerns":[],"release_explanation":{},"ranking_reason_codes":[]}'),
('conflict_reviews','id','{"explanation":"removed","resolution":null}'),
('correction_requests','id','{"correction_text":"removed","admin_notes":null}'),
('apply_pack_items','id','{"resume_path":null,"cover_letter_path":null,"draft_resume_path":null,"draft_cover_letter_path":null,"customer_update_notes":null,"do_not_mention_notes":null,"emphasis_notes":null,"human_review_checklist":{}}'),
('apply_pack_delivery_revisions','id','{"resume_path":"@path","cover_letter_path":"@path","review_note":null}'),
('workflow_tasks','id','{"summary":{}}');

create function public.ap_retention_snapshot_customers(p_snapshot uuid) returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct owner_id) filter(where owner_id is not null),'{}'::uuid[]) from (
   select s.customer_id owner_id from public.ap_intake_snapshots s where s.id=p_snapshot
   union select d.converted_customer_id from public.ap_intake_snapshots s join public.ap_anonymous_drafts d on d.id=s.draft_id where s.id=p_snapshot
   union select i.customer_id from public.ap_intake_snapshots s join public.intakes i on i.id=s.intake_id where s.id=p_snapshot
   union select customer_id from public.ap_search_services where original_snapshot_id=p_snapshot or active_snapshot_id=p_snapshot
 ) owners;
$$;
create function public.ap_retention_row_customers(p_table text,p_row jsonb) returns uuid[]
language plpgsql stable security definer set search_path='' as $$
declare owners uuid[]:='{}'; values_ids uuid[]; key text; ref uuid; resolved uuid;
begin
  foreach key in array array['customer_id','converted_customer_id'] loop
    if p_row->>key is not null then owners:=owners||((p_row->>key)::uuid); end if;
  end loop;
  foreach key in array array['snapshot_id','source_snapshot_id','original_snapshot_id','active_snapshot_id','parent_snapshot_id','child_snapshot_id','bound_snapshot_id','customer_assertion_snapshot_id'] loop
    if p_row->>key is not null then owners:=owners||public.ap_retention_snapshot_customers((p_row->>key)::uuid); end if;
  end loop;
  if p_table='ap_intake_snapshots' then owners:=owners||public.ap_retention_snapshot_customers((p_row->>'id')::uuid); end if;
  ref:=case when p_table='ap_anonymous_drafts' then (p_row->>'id')::uuid else (p_row->>'draft_id')::uuid end;
  if ref is not null then
    select coalesce(array_agg(distinct owner_id) filter(where owner_id is not null),'{}'::uuid[]) into values_ids from (
      select converted_customer_id owner_id from public.ap_anonymous_drafts where id=ref
      union select unnest(public.ap_retention_snapshot_customers(id)) from public.ap_intake_snapshots where draft_id=ref
    ) d; owners:=owners||values_ids;
  end if;
  if p_row->>'intake_id' is not null then select customer_id into resolved from public.intakes where id=(p_row->>'intake_id')::uuid; owners:=owners||resolved; end if;
  foreach key in array array['order_id','search_order_id','delivered_order_id','parent_order_id'] loop
    if p_row->>key is not null then select customer_id into resolved from public.orders where id=(p_row->>key)::uuid; owners:=owners||resolved; end if;
  end loop;
  if p_row->>'search_service_id' is not null then select customer_id into resolved from public.ap_search_services where id=(p_row->>'search_service_id')::uuid; owners:=owners||resolved; end if;
  ref:=coalesce((p_row->>'material_line_id')::uuid,(p_row->>'line_id')::uuid);
  if ref is not null then select o.customer_id into resolved from public.ap_material_lines l join public.orders o on o.id=l.delivered_order_id where l.id=ref; owners:=owners||resolved; end if;
  ref:=(p_row->>'artifact_id')::uuid;
  if ref is not null then select customer_id into resolved from public.ap_generated_artifacts where id=ref; owners:=owners||resolved; end if;
  if p_row->>'file_version_id' is not null then select a.customer_id into resolved from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id where f.id=(p_row->>'file_version_id')::uuid; owners:=owners||resolved; end if;
  if p_row->>'reference_record_id' is not null then select customer_id into resolved from public.ap_reference_records where id=(p_row->>'reference_record_id')::uuid; owners:=owners||resolved; end if;
  if p_row->>'reference_record_version_id' is not null then select r.customer_id into resolved from public.ap_reference_record_versions v join public.ap_reference_records r on r.id=v.reference_record_id where v.id=(p_row->>'reference_record_version_id')::uuid; owners:=owners||resolved; end if;
  if p_row->>'checkout_intent_id' is not null then select customer_id into resolved from public.ap_material_checkout_intents where id=(p_row->>'checkout_intent_id')::uuid; owners:=owners||resolved; end if;
  if p_row->>'checkout_item_id' is not null then select public.ap_retention_row_customers('ap_material_checkout_items',to_jsonb(i)) into values_ids from public.ap_material_checkout_items i where i.id=(p_row->>'checkout_item_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  if p_row->>'reference_permission_id' is not null then select public.ap_retention_row_customers('ap_reference_permissions',to_jsonb(p)) into values_ids from public.ap_reference_permissions p where p.id=(p_row->>'reference_permission_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  if p_row->>'supplied_source_id' is not null then select public.ap_retention_row_customers('ap_independent_verification_sources',to_jsonb(s)) into values_ids from public.ap_independent_verification_sources s where s.id=(p_row->>'supplied_source_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  foreach key in array array['document_version_id','document_id'] loop
    if p_row->>key is not null then select public.ap_retention_row_customers('ap_document_versions',to_jsonb(d)) into values_ids from public.ap_document_versions d where d.id=(p_row->>key)::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  end loop;
  foreach key in array array['encrypted_payload_id','sensitive_payload_id','answer_sensitive_payload_id','quarantined_payload_id'] loop
    if p_row->>key is not null then select public.ap_retention_row_customers('ap_sensitive_payloads',to_jsonb(d)) into values_ids from public.ap_sensitive_payloads d where d.id=(p_row->>key)::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  end loop;
  foreach key in array array['fact_id','conflicting_fact_id','source_fact_id','correction_fact_id'] loop
    if p_row->>key is not null then select public.ap_retention_row_customers('ap_candidate_facts',to_jsonb(d)) into values_ids from public.ap_candidate_facts d where d.id=(p_row->>key)::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  end loop;
  if p_row->>'job_match_id' is not null then select o.customer_id into resolved from public.job_matches m join public.orders o on o.id=m.search_order_id where m.id=(p_row->>'job_match_id')::uuid; owners:=owners||resolved; end if;
  if p_row->>'apply_pack_item_id' is not null then select o.customer_id into resolved from public.apply_pack_items i join public.orders o on o.id=i.order_id where i.id=(p_row->>'apply_pack_item_id')::uuid; owners:=owners||resolved; end if;
  if p_row->>'question_id' is not null then select public.ap_retention_snapshot_customers(snapshot_id) into values_ids from public.ap_candidate_questions where id=(p_row->>'question_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  if p_row->>'cell_id' is not null then select public.ap_retention_snapshot_customers(p.snapshot_id) into values_ids from public.ap_feasibility_coverage_cells c join public.ap_feasibility_coverage_plans p on p.id=c.plan_id where c.id=(p_row->>'cell_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  if p_row->>'plan_id' is not null then select public.ap_retention_snapshot_customers(snapshot_id) into values_ids from public.ap_feasibility_coverage_plans where id=(p_row->>'plan_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  if p_table='ap_feasibility_coverage_cells' then select public.ap_retention_snapshot_customers(snapshot_id) into values_ids from public.ap_feasibility_coverage_plans where id=(p_row->>'plan_id')::uuid; owners:=owners||coalesce(values_ids,'{}'); end if;
  return array(select distinct value from unnest(owners) value where value is not null order by value);
end $$;

create function public.ap_retention_object_references() returns table(bucket text,path text,customer_ids uuid[],prospective boolean)
language sql stable security definer set search_path='' as $$
 with artifacts as (
   select a.*,exists(select 1 from public.ap_order_retention_contracts c where c.order_id=coalesce(l.delivered_order_id,a.order_id)) prospective
   from public.ap_generated_artifacts a left join public.ap_material_lines l on l.id=a.material_line_id
 ), items as (
   select i.*,exists(select 1 from public.ap_order_retention_contracts c where c.order_id=coalesce(o.parent_order_id,o.id)) prospective
   from public.apply_pack_items i join public.orders o on o.id=i.order_id
 )
 select d.storage_bucket,d.storage_path,public.ap_retention_row_customers('ap_document_versions',to_jsonb(d)),exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=any(public.ap_retention_row_customers('ap_document_versions',to_jsonb(d)))) from public.ap_document_versions d where d.retention_state not in('DELETED','CRYPTO_SHREDDED')
 union all select f.storage_bucket,f.storage_path,public.ap_retention_row_customers('ap_generated_artifacts',to_jsonb(a)),a.prospective from public.ap_generated_file_versions f join artifacts a on a.id=f.artifact_id where a.retention_state<>'DELETED'
 union all select q.render_preview_bucket,q.render_preview_path,public.ap_retention_row_customers('ap_generated_artifacts',to_jsonb(a)),a.prospective from public.ap_artifact_quality_reviews q join public.ap_generated_file_versions f on f.id=q.file_version_id join artifacts a on a.id=f.artifact_id where a.retention_state<>'DELETED'
 union all select a.claim_provenance#>>'{editableSource,storageBucket}',a.claim_provenance#>>'{editableSource,storagePath}',public.ap_retention_row_customers('ap_generated_artifacts',to_jsonb(a)),a.prospective from artifacts a where a.retention_state<>'DELETED'
 union all select 'customer-source-documents',v.path,array[i.customer_id],exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=i.customer_id) from public.intakes i cross join lateral(values(i.resume_path),(i.cover_letter_path)) v(path) where i.source_deleted_at is null
 union all select 'customer-source-documents',s.storage_path,array[s.customer_id],exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=s.customer_id) from public.source_documents s where s.deleted_at is null
 union all select 'customer-source-documents',v.document->>'path',public.ap_retention_row_customers('intake_drafts',to_jsonb(d)),exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=d.customer_id) from public.intake_drafts d cross join lateral(values(d.resume_document),(d.cover_letter_document)) v(document)
 union all select v.bucket,v.path,public.ap_retention_row_customers('apply_pack_items',to_jsonb(i)),i.prospective from items i cross join lateral(values('customer-deliveries',i.resume_path),('customer-deliveries',i.cover_letter_path),('operator-drafts',i.draft_resume_path),('operator-drafts',i.draft_cover_letter_path)) v(bucket,path)
 union all select 'customer-deliveries',v.path,public.ap_retention_row_customers('apply_pack_delivery_revisions',to_jsonb(r)),i.prospective from public.apply_pack_delivery_revisions r join items i on i.id=r.apply_pack_item_id cross join lateral(values(r.resume_path),(r.cover_letter_path)) v(path)
 where not exists(select 1 from public.ap_retention_row_receipts receipt where receipt.table_name='apply_pack_delivery_revisions' and receipt.row_id=r.id::text);
$$;

create function public.ap_retention_cleanup_blocked(p_customer uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare policy public.ap_retention_private_tables; shared boolean;
begin
 if public.ap_service_retention_customer_protected(p_customer)
   or exists(select 1 from public.ap_retention_restored_order_protection p join public.ap_order_retention_contracts c on c.order_id=p.order_id where c.customer_id=p_customer and p.protected)
   or exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=p_customer and public.ap_service_retention_order_protected(c.order_id))
   or exists(select 1 from public.ap_outbox_messages where customer_id=p_customer and state not in('SENT'))
   or exists(select 1 from public.workflow_tasks w join public.orders o on o.id=w.order_id where o.customer_id=p_customer and w.status not in('completed','canceled'))
   or exists(select 1 from public.intake_drafts where customer_id=p_customer and expires_at>clock_timestamp())
   or exists(select 1 from public.ap_anonymous_drafts d where p_customer=any(public.ap_retention_row_customers('ap_anonymous_drafts',to_jsonb(d))) and d.expires_at>clock_timestamp()
     and not exists(select 1 from public.ap_intake_snapshots s join public.ap_search_services service on service.original_snapshot_id=s.id or service.active_snapshot_id=s.id where s.draft_id=d.id))
   or exists(select 1 from public.ap_material_checkout_references r where p_customer=any(public.ap_retention_row_customers('ap_material_checkout_references',to_jsonb(r))) and cardinality(public.ap_retention_row_customers('ap_material_checkout_references',to_jsonb(r)))<>1)
   then return true; end if;
 for policy in select * from public.ap_retention_private_tables loop
   execute format('select exists(select 1 from public.%I r where $1=any(public.ap_retention_row_customers(%L,to_jsonb(r))) and cardinality(public.ap_retention_row_customers(%L,to_jsonb(r)))<>1)',policy.table_name,policy.table_name,policy.table_name) into shared using p_customer;
   if shared then return true; end if;
 end loop;
 return exists(select 1 from public.ap_retention_object_references() owned join public.ap_retention_object_references() other on other.bucket=owned.bucket and other.path=owned.path
   where p_customer=any(owned.customer_ids) and owned.path is not null and owned.path<>'' and other.customer_ids is distinct from array[p_customer]);
end $$;

create function public.ap_legacy_retention_object_allowed(p_bucket text,p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_bucket is null or p_bucket not in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')
   or p_path is null or p_path ~ '[\\%?#[:cntrl:]]' or length(p_path)>1024 or p_path='' or exists(select 1 from unnest(string_to_array(p_path,'/')) s where s in('','.','..')) then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('retention-object:'||p_bucket||':'||p_path,0));
 if exists(select 1 from public.ap_retention_object_references() r
   join public.ap_order_retention_contracts c on c.customer_id=any(r.customer_ids)
   where r.bucket=p_bucket and r.path=p_path) then return false; end if;
 -- This is a durable removal intent, not a successful-deletion receipt. Even
 -- a failed/ambiguous legacy removal cannot race a newly attached alias.
 insert into public.ap_retention_legacy_object_intents(bucket,path_sha256) values(p_bucket,encode(extensions.digest(p_path,'sha256'),'hex')) on conflict do nothing;
 return true;
end $$;
create function public.ap_legacy_draft_retention_allowed(p_draft_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.intake_drafts d where d.id=p_draft_id and not exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=d.customer_id));
$$;

create or replace function public.ap_service_retention_object_policies() returns jsonb
language sql stable security definer set search_path='' as $$
 with owned as (
   select r.bucket,r.path,r.customer_ids,
     case when cardinality(r.customer_ids)=1 and r.prospective then public.ap_service_retention_customer_expiry(r.customer_ids[1]) end expiry,
     r.prospective
   from public.ap_retention_object_references() r where r.path is not null and r.path<>''
 ), grouped as (
   select bucket,encode(extensions.digest(path,'sha256'),'hex') path_hash,bool_or(expiry is null) protected,
     case when bool_or(expiry is null) then null else max(expiry) end expiry
   from owned group by bucket,path having bool_or(prospective)
 ), combined as (
   select * from grouped union all
   select p.bucket,p.path_sha256,p.protected,p.retention_expires_at from public.ap_retention_restored_object_policies p
   where not exists(select 1 from grouped g where g.bucket=p.bucket and g.path_hash=p.path_sha256)
 ) select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'pathSha256',path_hash,'retentionExpiresAt',expiry,'protected',protected) order by bucket,path_hash),'[]') from combined;
$$;

do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_export_service_retention_overlay()'::regprocedure);
 if position('from public.ap_service_retention_objects where deleted_at is not null group by bucket,path_sha256' in definition)=0 then raise exception 'retention_overlay_tombstone_anchor_missing'; end if;
 definition:=replace(definition,'from public.ap_service_retention_objects where deleted_at is not null group by bucket,path_sha256',
   'from (select bucket,path_sha256,deleted_at from public.ap_service_retention_objects where deleted_at is not null union all select bucket,path_sha256,deleted_at from public.ap_retention_restored_object_tombstones) all_tombstones group by bucket,path_sha256');
 definition:=replace(definition,$a$coalesce((select max(deleted_at) from public.ap_service_retention_objects),'1970-01-01Z'::timestamptz)$a$,
   $a$greatest(coalesce((select max(deleted_at) from public.ap_service_retention_objects),'1970-01-01Z'::timestamptz),coalesce((select max(deleted_at) from public.ap_retention_restored_object_tombstones),'1970-01-01Z'::timestamptz))$a$);
 execute definition;
end $$;

-- The durable intent fences new references before an external Storage request.
-- After completion, row receipts prevent reusing redacted facts as a baseline.
create function public.ap_retention_row_object_paths(p_row jsonb) returns table(bucket text,path text)
language sql immutable set search_path='' as $$
 select distinct b,p from (values
   (p_row->>'storage_bucket',p_row->>'storage_path'),
   ('customer-source-documents',case when p_row ? 'intake_id' and p_row ? 'document_kind' then p_row->>'storage_path' end),
   (case when p_row ? 'experience_summary' then 'customer-source-documents' else 'customer-deliveries' end,p_row->>'resume_path'),
   (case when p_row ? 'experience_summary' then 'customer-source-documents' else 'customer-deliveries' end,p_row->>'cover_letter_path'),
   ('operator-drafts',p_row->>'draft_resume_path'),('operator-drafts',p_row->>'draft_cover_letter_path'),
   ('customer-source-documents',p_row#>>'{resume_document,path}'),('customer-source-documents',p_row#>>'{cover_letter_document,path}'),
   (p_row->>'render_preview_bucket',p_row->>'render_preview_path'),
   (p_row#>>'{claim_provenance,editableSource,storageBucket}',p_row#>>'{claim_provenance,editableSource,storagePath}')
 ) v(b,p) where b is not null and p is not null and p<>'' order by b,p;
$$;
create function public.ap_guard_service_retention_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; fk record; target_path record; parent_key text; row_value jsonb:=to_jsonb(new); identity_key text;
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),row_value) then return new; end if;
 for owner in select distinct value from unnest(public.ap_retention_row_customers(tg_table_name,row_value)
   ||case when tg_op='UPDATE' then public.ap_retention_row_customers(tg_table_name,to_jsonb(old)) else '{}'::uuid[] end) value order by value loop
   perform pg_advisory_xact_lock(hashtextextended('service-retention:'||owner::text,0));
   if exists(select 1 from public.ap_service_retention_claims where customer_id=owner and state='PENDING') then raise exception 'service_retention_purge_committed'; end if;
 end loop;
 for target_path in select * from public.ap_retention_row_object_paths(row_value) loop
   perform pg_advisory_xact_lock(hashtextextended('retention-object:'||target_path.bucket||':'||target_path.path,0));
   if exists(select 1 from public.ap_service_retention_objects where bucket=target_path.bucket and path_sha256=encode(extensions.digest(target_path.path,'sha256'),'hex'))
     or (exists(select 1 from public.ap_retention_legacy_object_intents where bucket=target_path.bucket and path_sha256=encode(extensions.digest(target_path.path,'sha256'),'hex'))
       and not(tg_op='UPDATE' and public.ap_retention_row_customers(tg_table_name,to_jsonb(old))=public.ap_retention_row_customers(tg_table_name,row_value)
         and exists(select 1 from public.ap_retention_row_object_paths(to_jsonb(old)) previous where previous.bucket=target_path.bucket and previous.path=target_path.path)))
     or exists(select 1 from public.ap_retention_restored_object_tombstones where bucket=target_path.bucket and path_sha256=encode(extensions.digest(target_path.path,'sha256'),'hex'))
     then raise exception 'service_retention_object_removal_committed'; end if;
 end loop;
 select primary_key into identity_key from public.ap_retention_private_tables where table_name=tg_table_name;
 if identity_key is not null and exists(select 1 from public.ap_retention_row_receipts where table_name=tg_table_name and row_id=row_value->>identity_key)
   then raise exception 'service_retention_content_removed'; end if;
 for fk in select p.table_name,a.attname from pg_constraint c join pg_class parent on parent.oid=c.confrelid
   join public.ap_retention_private_tables p on p.table_name=parent.relname
   join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
   where c.conrelid=tg_relid and c.contype='f' and cardinality(c.conkey)=1 loop
   parent_key:=row_value->>fk.attname;
   if parent_key is not null and exists(select 1 from public.ap_retention_row_receipts where table_name=fk.table_name and row_id=parent_key)
     then raise exception 'service_retention_content_removed'; end if;
 end loop;
 return new;
end $$;

-- Add an exact-row permit branch only to guards on the finite private graph.
-- Neither session flags nor service-role writes can create a permit.
do $$ declare guard record; definition text; clone_name text; policy record; begin
 for guard in select distinct p.oid,p.proname from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_class r on r.oid=t.tgrelid
   join public.ap_retention_private_tables m on m.table_name=r.relname where not t.tgisinternal and (t.tgtype::int & 16)=16 loop
   definition:=pg_get_functiondef(guard.oid);
   if definition !~* '\mbegin\M' then raise exception 'retention_guard_language_unsupported'; end if;
   clone_name:='ap_rr_'||substr(md5(guard.proname),1,24);
   definition:=replace(definition,'FUNCTION public.'||guard.proname||'(','FUNCTION public.'||clone_name||'(');
   definition:=regexp_replace(definition,'\mbegin\M',E'begin\n if TG_OP=''UPDATE'' and public.ap_retention_redaction_permitted(TG_RELID,to_jsonb(OLD),to_jsonb(NEW)) then return NEW; end if;','i');
   execute definition;
   execute format('revoke all on function public.%I() from public,anon,authenticated,service_role',clone_name);
   for policy in select t.tgname,pg_get_triggerdef(t.oid) trigger_definition from pg_trigger t join pg_class r on r.oid=t.tgrelid
     join public.ap_retention_private_tables m on m.table_name=r.relname where t.tgfoid=guard.oid and not t.tgisinternal loop
     execute format('drop trigger %I on %s',policy.tgname,split_part(split_part(policy.trigger_definition,' ON ',2),' FOR ',1));
     execute replace(replace(policy.trigger_definition,'EXECUTE FUNCTION public.'||guard.proname||'(','EXECUTE FUNCTION public.'||clone_name||'('),
       'EXECUTE FUNCTION '||guard.proname||'(','EXECUTE FUNCTION public.'||clone_name||'(');
   end loop;
 end loop;
 for policy in select table_name from public.ap_retention_private_tables union select unnest(array['orders','ap_payment_attempts','ap_material_lines','ap_search_services','ap_material_checkout_intents','ap_material_checkout_items','ap_material_checkout_references','ap_service_retention_holds','ap_checkout_initiations'])::name loop
   execute format('create trigger ap_service_retention_write before insert or update on public.%I for each row execute function public.ap_guard_service_retention_write()',policy.table_name);
 end loop;
end $$;

create function public.ap_retention_patch_row(p_table name,p_before jsonb,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare after_value jsonb:=p_before||p_patch; item record; key_name text;
begin
 select primary_key into key_name from public.ap_retention_private_tables where table_name=p_table;
 for item in select key,value from jsonb_each(p_patch) loop
   if item.value='"@path"'::jsonb then after_value:=jsonb_set(after_value,array[item.key],to_jsonb('retained-shell/'||p_table||'/'||(p_before->>key_name)||'/'||item.key)); end if;
   if item.value='"@now"'::jsonb then after_value:=jsonb_set(after_value,array[item.key],to_jsonb(clock_timestamp())); end if;
   -- Keep null shape where an existing constraint distinguishes an absent proof.
   if p_table='ap_feasibility_coverage_plans' and item.key='constraint_proof' and p_before->'constraint_proof'='null'::jsonb then after_value:=jsonb_set(after_value,array[item.key],'null'); end if;
 end loop;
 return after_value;
end $$;

create function public.ap_redact_service_retention_claim(p_claim_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare claim public.ap_service_retention_claims; policy public.ap_retention_private_tables; row_value jsonb; after_value jsonb; sets text; row_count integer:=0; before_hash text; after_hash text;
begin
 select * into claim from public.ap_service_retention_claims where id=p_claim_id for update;
 if claim.id is null then raise exception 'service_retention_claim_missing'; end if;
 if claim.state='COMPLETE' then return claim.redacted_rows; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||claim.customer_id::text,0));
 if public.ap_retention_cleanup_blocked(claim.customer_id) then raise exception 'service_retention_protected'; end if;
 for policy in select * from public.ap_retention_private_tables order by table_name loop
   select string_agg(format('%I = typed.%I',key,key),',') into sets from jsonb_object_keys(policy.redaction_patch) key;
   for row_value in execute format('select to_jsonb(r) from public.%I r where $1=any(public.ap_retention_row_customers(%L,to_jsonb(r))) and not exists(select 1 from public.ap_retention_row_receipts x where x.table_name=%L and x.row_id=to_jsonb(r)->>%L) for update',policy.table_name,policy.table_name,policy.table_name,policy.primary_key) using claim.customer_id loop
     after_value:=public.ap_retention_patch_row(policy.table_name,row_value,policy.redaction_patch);
     before_hash:=encode(extensions.digest((row_value-'updated_at')::text,'sha256'),'hex');
     after_hash:=encode(extensions.digest((after_value-'updated_at')::text,'sha256'),'hex');
     if sets is not null then
       insert into public.ap_retention_redaction_permits values(txid_current(),pg_backend_pid(),('public.'||policy.table_name)::regclass,before_hash,after_hash);
       execute format('update public.%I r set %s from jsonb_populate_record(null::public.%I,$1) typed where r.%I::text=$2',policy.table_name,sets,policy.table_name,policy.primary_key) using after_value,row_value->>policy.primary_key;
     end if;
     insert into public.ap_retention_row_receipts(table_name,row_id,claim_id,before_sha256,after_sha256) values(policy.table_name,row_value->>policy.primary_key,claim.id,before_hash,after_hash);
     delete from public.ap_retention_redaction_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid();
     row_count:=row_count+1;
   end loop;
 end loop;
 return row_count;
end $$;

create function public.ap_claim_expired_service_retention(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path='' as $$
declare customer uuid; v_claim_id uuid; contract public.ap_order_retention_contracts; target_path record; after_value jsonb; expiry timestamptz; result jsonb:='[]'; objects jsonb;
begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'service_retention_limit_invalid'; end if;
 for customer in select distinct c.customer_id from public.ap_order_retention_contracts c where c.state<>'PURGED' order by c.customer_id loop
   exit when jsonb_array_length(result)>=p_limit;
   if not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||customer::text,0)) then continue; end if;
   select id into v_claim_id from public.ap_service_retention_claims where customer_id=customer and state='PENDING';
   if v_claim_id is null then
     expiry:=public.ap_service_retention_customer_expiry(customer);
     if expiry is null or expiry>clock_timestamp() or public.ap_retention_cleanup_blocked(customer) then continue; end if;
     for target_path in select distinct r.bucket,r.path from public.ap_retention_object_references() r where customer=any(r.customer_ids) and r.path is not null and r.path<>'' order by r.bucket,r.path loop
       perform pg_advisory_xact_lock(hashtextextended('retention-object:'||target_path.bucket||':'||target_path.path,0));
     end loop;
     -- Re-read after object locks: another owner may have attached a shared
     -- alias while this transaction waited. Either that alias or this intent wins.
     if public.ap_retention_cleanup_blocked(customer) then continue; end if;
     insert into public.ap_service_retention_claims(customer_id,order_ids) select customer,array_agg(order_id order by order_id) from public.ap_order_retention_contracts where customer_id=customer and state='ACTIVE' returning id into v_claim_id;
     insert into public.ap_service_retention_objects(claim_id,bucket,path,path_sha256)
       select v_claim_id,r.bucket,r.path,encode(extensions.digest(r.path,'sha256'),'hex') from public.ap_retention_object_references() r
       where customer=any(r.customer_ids) and r.path is not null and r.path<>'' group by r.bucket,r.path;
     if (select count(*) from public.ap_service_retention_objects where ap_service_retention_objects.claim_id=v_claim_id)>40000 then raise exception 'service_retention_object_bound_exceeded'; end if;
     for contract in select * from public.ap_order_retention_contracts where customer_id=customer and state='ACTIVE' for update loop
       after_value:=to_jsonb(contract)||jsonb_build_object('state','PURGING','updated_at',clock_timestamp());
       insert into public.ap_retention_redaction_permits values(txid_current(),pg_backend_pid(),'public.ap_order_retention_contracts'::regclass,
         encode(extensions.digest((to_jsonb(contract)-'updated_at')::text,'sha256'),'hex'),encode(extensions.digest((after_value-'updated_at')::text,'sha256'),'hex'));
       update public.ap_order_retention_contracts set state='PURGING',updated_at=(after_value->>'updated_at')::timestamptz where order_id=contract.order_id;
       delete from public.ap_retention_redaction_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid();
     end loop;
   end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket,'path',path,'pathSha256',path_sha256) order by id),'[]') into objects from public.ap_service_retention_objects o where o.claim_id=v_claim_id and deleted_at is null;
   result:=result||jsonb_build_array(jsonb_build_object('claimId',v_claim_id,'objects',objects));
 end loop;
 return result;
end $$;

create function public.ap_authorize_service_retention_object(p_claim_id uuid,p_object_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare claim public.ap_service_retention_claims; target public.ap_service_retention_objects;
begin
 select * into claim from public.ap_service_retention_claims where id=p_claim_id for update;
 if claim.id is null or claim.state<>'PENDING' then raise exception 'service_retention_claim_missing'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||claim.customer_id::text,0));
 if public.ap_retention_cleanup_blocked(claim.customer_id) then raise exception 'service_retention_protected'; end if;
 select * into target from public.ap_service_retention_objects where id=p_object_id and claim_id=p_claim_id;
 if target.id is null or target.deleted_at is not null then return null; end if;
 if target.path ~ '[\\%?#[:cntrl:]]' or length(target.path)>1024 or target.path='' or exists(select 1 from unnest(string_to_array(target.path,'/')) s where s in('','.','..'))
   or target.path_sha256<>encode(extensions.digest(target.path,'sha256'),'hex') then raise exception 'service_retention_object_invalid'; end if;
 return jsonb_build_object('id',target.id,'bucket',target.bucket,'path',target.path,'pathSha256',target.path_sha256);
end $$;
create function public.ap_finish_service_retention_object(p_claim_id uuid,p_object_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.ap_service_retention_objects where id=p_object_id and claim_id=p_claim_id and deleted_at is not null) then return true; end if;
 perform public.ap_authorize_service_retention_object(p_claim_id,p_object_id);
 update public.ap_service_retention_objects set path=null,deleted_at=clock_timestamp() where id=p_object_id and claim_id=p_claim_id and deleted_at is null;
 return found;
end $$;
create function public.ap_finish_service_retention_claim(p_claim_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare claim public.ap_service_retention_claims; contract public.ap_order_retention_contracts; after_value jsonb; redacted integer;
begin
 select * into claim from public.ap_service_retention_claims where id=p_claim_id for update;
 if claim.id is null then raise exception 'service_retention_claim_missing'; end if;
 if claim.state='COMPLETE' then return true; end if;
 if exists(select 1 from public.ap_service_retention_objects where claim_id=p_claim_id and deleted_at is null) then return false; end if;
 redacted:=public.ap_redact_service_retention_claim(p_claim_id);
 for contract in select * from public.ap_order_retention_contracts where order_id=any(claim.order_ids) for update loop
   after_value:=to_jsonb(contract)||jsonb_build_object('state','PURGED','purged_at',clock_timestamp(),'updated_at',clock_timestamp());
   insert into public.ap_retention_redaction_permits values(txid_current(),pg_backend_pid(),'public.ap_order_retention_contracts'::regclass,
     encode(extensions.digest((to_jsonb(contract)-'updated_at')::text,'sha256'),'hex'),encode(extensions.digest((after_value-'updated_at')::text,'sha256'),'hex'));
   update public.ap_order_retention_contracts set state='PURGED',purged_at=(after_value->>'purged_at')::timestamptz,updated_at=(after_value->>'updated_at')::timestamptz where order_id=contract.order_id;
   delete from public.ap_retention_redaction_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 end loop;
 update public.ap_service_retention_claims set state='COMPLETE',completed_at=clock_timestamp(),redacted_rows=redacted,
   redaction_sha256=(select encode(extensions.digest(coalesce(string_agg(table_name||':'||row_id||':'||after_sha256,',' order by table_name,row_id),''),'sha256'),'hex') from public.ap_retention_row_receipts where claim_id=p_claim_id) where id=p_claim_id;
 return true;
end $$;

-- Restore filtering uses the same graph/redactor and leaves access locked. The
-- outer recovery runner authenticates two complete current source inventories.
-- This digest is reviewed source evidence, not a cryptographic provider attestation.
create function public.ap_apply_retention_restore_overlay(p_overlay_json text,p_overlay_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare overlay jsonb; entry jsonb; customer uuid; v_claim_id uuid; count_orders integer:=0; sanitized integer:=0; revoked integer:=0; receipt jsonb; source_time timestamptz; existing_receipt jsonb;
begin
 if p_overlay_json is null or p_overlay_sha256 is null or octet_length(p_overlay_json)>8388608 or p_overlay_sha256 !~ '^[a-f0-9]{64}$' or encode(extensions.digest(p_overlay_json,'sha256'),'hex')<>p_overlay_sha256 then raise exception 'retention_restore_digest_invalid'; end if;
 overlay:=p_overlay_json::jsonb;
 if jsonb_typeof(overlay) is distinct from 'object' or overlay-array['schemaVersion','policyVersion','sourceWatermark','orders','holds','objectTombstones','objectPolicies']<>'{}'
   or overlay->>'schemaVersion' is distinct from 'applypack-service-retention-overlay-v1' or overlay->>'policyVersion' is distinct from 'one_off_30d_v1'
   or jsonb_typeof(overlay->'orders') is distinct from 'array' or jsonb_typeof(overlay->'holds') is distinct from 'array' or jsonb_typeof(overlay->'objectTombstones') is distinct from 'array' or jsonb_typeof(overlay->'objectPolicies') is distinct from 'array'
   or jsonb_array_length(overlay->'orders')>10000 or jsonb_array_length(overlay->'holds')>40000 or jsonb_array_length(overlay->'objectTombstones')>40000 or jsonb_array_length(overlay->'objectPolicies')>40000
   then raise exception 'retention_restore_overlay_invalid'; end if;
 source_time:=(overlay->>'sourceWatermark')::timestamptz;
 if source_time is null or source_time>clock_timestamp() or source_time<greatest(coalesce((select max(source_watermark) from public.ap_retention_restore_receipts),'1970-01-01Z'),coalesce((select max(updated_at) from public.ap_order_retention_contracts where state<>'PURGED'),'1970-01-01Z'),coalesce((select max(deleted_at) from public.ap_service_retention_objects),'1970-01-01Z')) then raise exception 'retention_restore_stale'; end if;
 if (select count(*) from jsonb_array_elements(overlay->'orders'))<>(select count(distinct x->>'orderId') from jsonb_array_elements(overlay->'orders') x) then raise exception 'retention_restore_duplicate'; end if;
 if exists(select 1 from public.ap_commerce_configuration where checkout_enabled) then raise exception 'retention_restore_checkout_must_be_locked'; end if;
 if exists(select 1 from public.ap_order_retention_contracts c where not exists(select 1 from jsonb_array_elements(overlay->'orders') x where x->>'orderId'=c.order_id::text and x->>'customerId'=c.customer_id::text and x->>'legalReceiptId'=c.legal_receipt_id::text)) then raise exception 'retention_restore_contract_coverage_missing'; end if;
 for entry in select value from jsonb_array_elements(overlay->'orders') loop
   if jsonb_typeof(entry) is distinct from 'object' or entry-array['orderId','customerId','legalReceiptId','actionExpiresAt','accessExpiresAt','familyExpiresAt','protected','state','purgedAt']<>'{}'
     or not entry ?& array['orderId','customerId','legalReceiptId','actionExpiresAt','accessExpiresAt','familyExpiresAt','protected','state','purgedAt']
     or jsonb_typeof(entry->'protected') is distinct from 'boolean' or coalesce(entry->>'state','') not in('ACTIVE','PURGING','PURGED')
     or ((entry->>'state'='PURGED') is distinct from (entry->>'purgedAt' is not null))
     or (entry->>'purgedAt')::timestamptz>source_time then raise exception 'retention_restore_overlay_invalid'; end if;
   perform (entry->>'orderId')::uuid,(entry->>'customerId')::uuid,(entry->>'legalReceiptId')::uuid,
     (entry->>'actionExpiresAt')::timestamptz,(entry->>'accessExpiresAt')::timestamptz,(entry->>'familyExpiresAt')::timestamptz;
 end loop;
 for entry in select value from jsonb_array_elements(overlay->'holds') loop
   if jsonb_typeof(entry) is distinct from 'object' or entry-array['id','orderId','reasonCode','createdAt','releasedAt']<>'{}'
     or not entry ?& array['id','orderId','reasonCode','createdAt','releasedAt'] or coalesce(entry->>'reasonCode','') not in('LEGAL_REQUIREMENT','PAYMENT_DISPUTE','SUPPORT_REVIEW','UNFULFILLED_WORK')
     or (entry->>'createdAt')::timestamptz is null or (entry->>'createdAt')::timestamptz>source_time
     or (entry->>'releasedAt')::timestamptz>(source_time) or (entry->>'releasedAt')::timestamptz<(entry->>'createdAt')::timestamptz
     or not exists(select 1 from jsonb_array_elements(overlay->'orders') o where o->>'orderId'=entry->>'orderId') then raise exception 'retention_restore_overlay_invalid'; end if;
   perform (entry->>'id')::uuid;
 end loop;
 if (select count(*) from jsonb_array_elements(overlay->'holds'))<>(select count(distinct x->>'id') from jsonb_array_elements(overlay->'holds') x)
   or (select count(*) from jsonb_array_elements(overlay->'objectTombstones'))<>(select count(distinct (x->>'bucket',x->>'pathSha256')) from jsonb_array_elements(overlay->'objectTombstones') x)
   or (select count(*) from jsonb_array_elements(overlay->'objectPolicies'))<>(select count(distinct (x->>'bucket',x->>'pathSha256')) from jsonb_array_elements(overlay->'objectPolicies') x) then raise exception 'retention_restore_duplicate'; end if;
 for entry in select value from jsonb_array_elements(overlay->'objectTombstones') loop
   if entry-array['bucket','pathSha256','deletedAt']<>'{}' or not entry ?& array['bucket','pathSha256','deletedAt']
     or coalesce(entry->>'bucket','') not in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')
     or coalesce(entry->>'pathSha256','') !~ '^[a-f0-9]{64}$' or (entry->>'deletedAt')::timestamptz is null or (entry->>'deletedAt')::timestamptz>source_time then raise exception 'retention_restore_overlay_invalid'; end if;
 end loop;
 for entry in select value from jsonb_array_elements(overlay->'objectPolicies') loop
   if entry-array['bucket','pathSha256','retentionExpiresAt','protected']<>'{}' or not entry ?& array['bucket','pathSha256','retentionExpiresAt','protected']
     or coalesce(entry->>'bucket','') not in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')
     or coalesce(entry->>'pathSha256','') !~ '^[a-f0-9]{64}$' or jsonb_typeof(entry->'protected') is distinct from 'boolean'
     then raise exception 'retention_restore_overlay_invalid'; end if;
   perform (entry->>'retentionExpiresAt')::timestamptz;
 end loop;
 update public.ap_retention_restore_lock set locked=true where singleton;
 select r.receipt into existing_receipt from public.ap_retention_restore_receipts r where overlay_sha256=p_overlay_sha256;
 if existing_receipt is not null then return existing_receipt; end if;
 insert into public.ap_retention_restored_order_protection(order_id,protected,source_state,source_watermark)
   select c.order_id,(x->>'protected')::boolean,x->>'state',source_time from jsonb_array_elements(overlay->'orders') x
   join public.ap_order_retention_contracts c on c.order_id=(x->>'orderId')::uuid
   on conflict(order_id) do update set protected=excluded.protected,source_state=excluded.source_state,source_watermark=excluded.source_watermark;
 for customer in select distinct c.customer_id from public.ap_order_retention_contracts c loop
   perform pg_advisory_xact_lock(hashtextextended('service-retention:'||customer::text,0));
   if exists(select 1 from jsonb_array_elements(overlay->'orders') x where x->>'customerId'=customer::text and x->>'state'='PURGED')
     and exists(select 1 from jsonb_array_elements(overlay->'orders') x where x->>'customerId'=customer::text and x->>'state'<>'PURGED')
     then raise exception 'retention_restore_mixed_history_requires_reconciliation'; end if;
   if exists(select 1 from jsonb_array_elements(overlay->'orders') x where x->>'customerId'=customer::text and
     ((x->>'protected')::boolean is distinct from false or x->>'familyExpiresAt' is null or (x->>'familyExpiresAt')::timestamptz>clock_timestamp()))
     or exists(select 1 from jsonb_array_elements(overlay->'holds') h join jsonb_array_elements(overlay->'orders') o on o->>'orderId'=h->>'orderId' where o->>'customerId'=customer::text and h->>'releasedAt' is null)
     then continue; end if;
   -- An old target's unknown/unresolved obligations require reconciliation; a
   -- current source receipt cannot silently remove its stronger hold.
   if public.ap_retention_cleanup_blocked(customer) then raise exception 'retention_restore_reconciliation_required'; end if;
   if exists(select 1 from public.ap_order_retention_contracts where customer_id=customer and state<>'PURGED') then
     select id into v_claim_id from public.ap_service_retention_claims where customer_id=customer and state='PENDING';
     if v_claim_id is null then insert into public.ap_service_retention_claims(customer_id,order_ids) select customer,array_agg(order_id order by order_id) from public.ap_order_retention_contracts where customer_id=customer returning id into v_claim_id; end if;
     -- No Storage API runs here. This fresh target must exclude these exact
     -- objects through the recovery inventory's expiry/tombstone filter.
     if exists(select 1 from public.ap_service_retention_objects where claim_id=v_claim_id and deleted_at is null) then raise exception 'retention_restore_pending_objects_require_reconciliation'; end if;
     perform public.ap_finish_service_retention_claim(v_claim_id);
     sanitized:=sanitized+(select count(*) from public.ap_order_retention_contracts where customer_id=customer);
   end if;
 end loop;
 count_orders:=(select count(*) from public.ap_order_retention_contracts);
 insert into public.ap_retention_restored_object_tombstones(bucket,path_sha256,deleted_at)
   select x->>'bucket',x->>'pathSha256',(x->>'deletedAt')::timestamptz from jsonb_array_elements(overlay->'objectTombstones') x
   on conflict(bucket,path_sha256) do update set deleted_at=greatest(ap_retention_restored_object_tombstones.deleted_at,excluded.deleted_at);
 get diagnostics revoked=row_count;
 insert into public.ap_retention_restored_object_policies(bucket,path_sha256,retention_expires_at,protected)
   select x->>'bucket',x->>'pathSha256',(x->>'retentionExpiresAt')::timestamptz,(x->>'protected')::boolean from jsonb_array_elements(overlay->'objectPolicies') x
   on conflict(bucket,path_sha256) do update set retention_expires_at=excluded.retention_expires_at,protected=excluded.protected;
 receipt:=jsonb_build_object('policyVersion','one_off_30d_v1','overlayDigest',p_overlay_sha256,'ordersExamined',count_orders,'ordersSanitized',sanitized,'objectsRevoked',revoked,'expiredPrivateRecordsRemaining',0,'accessLocked',true);
 insert into public.ap_retention_restore_receipts(overlay_sha256,source_watermark,receipt) values(p_overlay_sha256,source_time,receipt);
 return receipt;
end $$;

-- Restored targets never reopen private reads merely because the sanitization
-- RPC succeeded. Recovery acceptance must separately release this database lock.
do $$ declare definition text; f regprocedure; begin
 definition:=pg_get_functiondef('public.ap_retention_private_row_visible(text,jsonb)'::regprocedure);
 definition:=regexp_replace(definition,'\mbegin\M',E'begin\n if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then return false; end if;','i');
 execute definition;
 definition:=pg_get_functiondef('public.ap_service_retention_order_protected(uuid)'::regprocedure);
 definition:=replace(definition,split_part(split_part(definition,'AS $function$',2),'$function$',1),
   ' select exists(select 1 from public.ap_retention_restored_order_protection where order_id=p_order_id and protected) or ('||
   regexp_replace(btrim(split_part(split_part(definition,'AS $function$',2),'$function$',1)),'^select\s+|;\s*$','','gi')||'); ');
 execute definition;
 foreach f in array array['public.ap_service_retention_access_allowed(uuid,uuid,boolean)'::regprocedure,
   'public.ap_retention_customer_private_access_allowed(uuid)'::regprocedure,'public.ap_retention_snapshot_private_access_allowed(uuid)'::regprocedure,
   'public.ap_legacy_delivery_access_allowed(uuid,uuid)'::regprocedure] loop
   definition:=pg_get_functiondef(f);
   definition:=replace(definition,split_part(split_part(definition,'AS $function$',2),'$function$',1),
     ' select not exists(select 1 from public.ap_retention_restore_lock where singleton and locked) and ('||
     regexp_replace(btrim(split_part(split_part(definition,'AS $function$',2),'$function$',1)),'^select\s+|;\s*$','','gi')||'); ');
   execute definition;
 end loop;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
  'ap_retention_snapshot_customers','ap_retention_row_customers','ap_retention_object_references','ap_retention_cleanup_blocked','ap_legacy_retention_object_allowed','ap_legacy_draft_retention_allowed','ap_retention_row_object_paths','ap_guard_service_retention_write','ap_retention_patch_row','ap_redact_service_retention_claim',
  'ap_claim_expired_service_retention','ap_authorize_service_retention_object','ap_finish_service_retention_object','ap_finish_service_retention_claim','ap_apply_retention_restore_overlay']) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
end $$;
grant execute on function public.ap_claim_expired_service_retention(integer),public.ap_authorize_service_retention_object(uuid,uuid),public.ap_finish_service_retention_object(uuid,uuid),public.ap_finish_service_retention_claim(uuid),public.ap_apply_retention_restore_overlay(text,text) to service_role;
grant execute on function public.ap_legacy_retention_object_allowed(text,text),public.ap_legacy_draft_retention_allowed(uuid) to service_role;

create function public.ap_service_retention_cleanup_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select to_regprocedure('public.ap_finish_service_retention_claim(uuid)') is not null
   and (select count(*)>=37 from public.ap_retention_private_tables)
   and not exists(select 1 from public.ap_retention_private_tables p where not exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
     where c.conrelid=('public.'||p.table_name)::regclass and c.contype='p' and cardinality(c.conkey)=1 and a.attname=p.primary_key))
   and not exists(select 1 from public.ap_retention_private_tables p cross join lateral jsonb_object_keys(p.redaction_patch) k
     where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=p.table_name::text and c.column_name=k))
   and not exists(select 1 from public.ap_retention_private_tables p where not exists(select 1 from pg_trigger t
     where t.tgrelid=('public.'||p.table_name)::regclass and t.tgname='ap_service_retention_write' and not t.tgisinternal and t.tgenabled='O'));
$$;
revoke all on function public.ap_service_retention_cleanup_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_service_retention_cleanup_schema_installed() to service_role;
insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610250088','SERVICE_RETENTION_CLEANUP',0,clock_timestamp());
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_one_off_retention_schema_installed()'::regprocedure);
 if position('select to_regprocedure' in definition)=0 then raise exception 'retention_readiness_anchor_missing'; end if;
 execute replace(definition,'select to_regprocedure','select public.ap_service_retention_cleanup_schema_installed() and to_regprocedure');
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=11 as installed' in definition)=0
   or position('''requiredSchemaVersion'', ''202610240087''' in definition)=0
   or position('(''202610240087'',''ONE_OFF_SERVICE_RETENTION'')' in definition)=0
   or position('''202610230086'',''202610240087''' in definition)=0 then raise exception 'retention_schema_floor_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=11 as installed','select count(*)=12 as installed');
 definition:=replace(definition,'(''202610240087'',''ONE_OFF_SERVICE_RETENTION'')','(''202610240087'',''ONE_OFF_SERVICE_RETENTION''),(''202610250088'',''SERVICE_RETENTION_CLEANUP'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610240087''','''requiredSchemaVersion'', ''202610250088''');
 definition:=replace(definition,'''202610230086'',''202610240087''','''202610230086'',''202610240087'',''202610250088''');
 execute definition;
end $$;

commit;
