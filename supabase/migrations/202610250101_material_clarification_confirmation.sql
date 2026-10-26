-- A material pre-payment answer starts a separate review. It never edits the
-- confirmed snapshot or converts an answer into a confirmed fact by itself.
begin;
create table public.ap_intake_clarifications(
 id uuid primary key default gen_random_uuid(), source_snapshot_id uuid not null unique references public.ap_intake_snapshots(id),
 source_draft_id uuid not null references public.ap_anonymous_drafts(id), customer_id uuid references public.profiles(id),
 draft_id uuid unique references public.ap_anonymous_drafts(id), confirmed_snapshot_id uuid unique references public.ap_intake_snapshots(id),
 issued_by uuid not null references public.profiles(id), created_at timestamptz not null default clock_timestamp(),
 confirmed_at timestamptz, check((confirmed_snapshot_id is null)=(confirmed_at is null)));
create table public.ap_intake_inherited_documents(
 id uuid primary key default gen_random_uuid(), draft_id uuid not null references public.ap_anonymous_drafts(id),
 source_snapshot_id uuid not null references public.ap_intake_snapshots(id), document_version_id uuid not null references public.ap_document_versions(id),
 source_draft_id uuid not null references public.ap_anonymous_drafts(id), kind public.ap_document_kind not null,
 content_sha256 text not null check(content_sha256~'^[a-f0-9]{64}$'), excluded_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),unique(draft_id,kind));
create table public.ap_intake_clarification_answers(
 question_id uuid primary key references public.ap_candidate_questions(id), draft_id uuid not null references public.ap_anonymous_drafts(id),
 source_snapshot_id uuid not null references public.ap_intake_snapshots(id), answer_sha256 text not null check(answer_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp());

-- Return actual records; an inherited source never impersonates a new upload.
create function public.ap_effective_intake_documents(p_draft_id uuid) returns setof public.ap_document_versions
language sql stable security definer set search_path='' as $$
 select v.* from public.ap_document_versions v where v.draft_id=p_draft_id and v.is_current
 union all
 select v.* from public.ap_intake_inherited_documents inherited
 join public.ap_intake_clarifications c on c.draft_id=inherited.draft_id and c.source_snapshot_id=inherited.source_snapshot_id
 join public.ap_document_versions v on v.id=inherited.document_version_id and v.draft_id=inherited.source_draft_id
  and v.kind=inherited.kind and v.sha256=inherited.content_sha256 and v.is_current and v.retention_state='ACTIVE'
 where inherited.draft_id=p_draft_id and inherited.excluded_at is null
  and not exists(select 1 from public.ap_document_versions own where own.draft_id=p_draft_id and own.kind=inherited.kind and own.is_current);
$$;

create function public.ap_lock_material_clarification(p_snapshot_id uuid) returns public.ap_intake_snapshots
language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; d public.ap_anonymous_drafts; owners uuid[]; owner uuid;
begin
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked)
  then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_snapshot_id::text,45));
 perform pg_advisory_xact_lock(hashtextextended('intake-clarification:'||p_snapshot_id::text,0));
 select * into s from public.ap_intake_snapshots where id=p_snapshot_id;
 if s.id is null or s.schema_version is distinct from 'applypack-intake-v4' or s.confirmed_review->>'contractVersion' is distinct from 'applypack-confirmed-intake-v1'
  then raise exception 'confirmed_intake_required'; end if;
 owners:=public.ap_retention_snapshot_customers(s.id);
 for owner in select distinct value from unnest(owners) value order by value loop
  perform pg_advisory_xact_lock(hashtextextended('service-retention:'||owner::text,0));
  if exists(select 1 from public.ap_service_retention_claims where customer_id=owner and state='PENDING')
   then raise exception 'service_retention_purge_committed'; end if;
 end loop;
 select * into d from public.ap_anonymous_drafts where id=s.draft_id for update;
 if public.ap_retention_snapshot_customers(s.id) is distinct from owners
  then raise exception 'clarification_ownership_changed'; end if;
 if d.id is null or d.expires_at<=clock_timestamp() or d.retention_state<>'ACTIVE' or d.finalized_snapshot_id is distinct from s.id
  then raise exception 'question_owner_or_version_invalid'; end if;
 if d.state not in('COMPLETE') or exists(select 1 from public.ap_search_services where original_snapshot_id=s.id or active_snapshot_id=s.id)
  or exists(select 1 from public.ap_checkout_attempts where draft_id=d.id and state not in('EXPIRED','CANCELED','FAILED'))
  then raise exception 'clarification_paid_or_checkout_owner_exception'; end if;
 return s;
end $$;

alter function public.ap_issue_candidate_question(uuid,uuid,uuid,uuid,text) rename to ap_issue_candidate_question_before_101;
create function public.ap_issue_candidate_question(p_snapshot_id uuid,p_job_snapshot_id uuid,p_node_id uuid,p_actor_id uuid,p_prompt text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; q uuid; allocation uuid; successor uuid;
begin
 select * into s from public.ap_intake_snapshots where id=p_snapshot_id;
 if s.schema_version is distinct from 'applypack-intake-v4' then
  return public.ap_issue_candidate_question_before_101(p_snapshot_id,p_job_snapshot_id,p_node_id,p_actor_id,p_prompt); end if;
 s:=public.ap_lock_material_clarification(p_snapshot_id);
 if exists(select 1 from public.ap_intake_clarifications where source_snapshot_id=s.id and confirmed_snapshot_id is not null)
  then raise exception 'question_owner_or_version_invalid'; end if;
 if (select count(*) from public.ap_candidate_questions where snapshot_id=s.id)>=20
  and not exists(select 1 from public.ap_candidate_questions where snapshot_id=s.id and job_snapshot_id=p_job_snapshot_id and requirement_node_id=p_node_id)
  then raise exception 'clarification_owner_exception_required'; end if;
 q:=public.ap_issue_candidate_question_before_101(p_snapshot_id,p_job_snapshot_id,p_node_id,p_actor_id,p_prompt);
 insert into public.ap_intake_clarifications(source_snapshot_id,source_draft_id,customer_id,issued_by)
  values(s.id,s.draft_id,s.customer_id,p_actor_id) on conflict(source_snapshot_id) do nothing;
 select draft_id into successor from public.ap_intake_clarifications where source_snapshot_id=s.id;
 if successor is not null then
  update public.ap_anonymous_drafts d set answers=jsonb_set(d.answers,'{clarifications}',coalesce(d.answers->'clarifications','[]')||
   jsonb_build_array(jsonb_build_object('questionId',q,'prompt',(select prompt from public.ap_candidate_questions where id=q),'answer',''))),
   version=d.version+1,confirmation_receipt=null,updated_at=clock_timestamp()
   where d.id=successor and d.state='IN_PROGRESS' and not exists(select 1 from jsonb_array_elements(d.answers->'clarifications') a where a->>'questionId'=q::text);
 end if;
 -- The same advisory lock is acquired at the start of invitation and checkout.
 -- A provider command already in flight is rejected above, never expired here.
 update public.ap_search_checkout_invitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where snapshot_id=s.id and consumed_at is null;
 for allocation in select id from public.ap_capacity_allocations where criteria_revision_id=s.id and lifecycle='RESERVED' loop
  perform public.ap_release_unconsumed_capacity(allocation,'MATERIAL_CLARIFICATION_REQUIRED'); end loop;
 update public.ap_match_evaluations set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where snapshot_id=s.id;
 update public.ap_feasibility_assessments set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where snapshot_id=s.id;
 update public.ap_quotes set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where snapshot_id=s.id;
 update public.ap_human_review_records set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where snapshot_id=s.id;
 update public.ap_feasibility_requests set state='STALE',claimed_by=null,claimed_at=null,completed_assessment_id=null,
  stale_reason='MATERIAL_CLARIFICATION_REVIEW_REQUIRED',updated_at=clock_timestamp() where snapshot_id=s.id;
 update public.ap_research_preparations set state='STALE',reason='SNAPSHOT_CHANGED',lease_token=null,lease_until=null,
  updated_at=clock_timestamp() where snapshot_id=s.id and state<>'STALE';
 return q;
end $$;

create function public.ap_clone_clarification_sources(p_clarification_id uuid,p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.ap_intake_clarifications; document public.ap_document_versions; f public.ap_candidate_facts;
 ids jsonb:='{}'; value jsonb; copied public.ap_candidate_facts; answers jsonb; reviews jsonb:='{}'; corrections jsonb:='{}'; entry record;
begin
 select * into strict c from public.ap_intake_clarifications where id=p_clarification_id;
 select d.answers into strict answers from public.ap_anonymous_drafts d where d.id=c.source_draft_id;
 for document in select * from public.ap_effective_intake_documents(c.source_draft_id) order by id loop
  perform pg_advisory_xact_lock(hashtextextended('retention-object:'||document.storage_bucket||':'||document.storage_path,0));
  if document.retention_state<>'ACTIVE' or exists(select 1 from public.ap_retention_legacy_object_intents where bucket=document.storage_bucket
    and path_sha256=encode(extensions.digest(document.storage_path,'sha256'),'hex')) then raise exception 'clarification_source_unavailable'; end if;
  insert into public.ap_intake_inherited_documents(draft_id,source_snapshot_id,document_version_id,source_draft_id,kind,content_sha256)
   values(p_draft_id,c.source_snapshot_id,document.id,document.draft_id,document.kind,document.sha256);
 end loop;
 for f in select source.* from public.ap_candidate_facts source
  where source.draft_id=c.source_draft_id and source.snapshot_id is null and source.source_kind='DOCUMENT' and source.superseded_at is null
   and source.document_version_id in(select id from public.ap_effective_intake_documents(c.source_draft_id)) loop
  ids:=ids||jsonb_build_object(f.id::text,gen_random_uuid()); end loop;
 for f in select * from public.ap_candidate_facts where ids ? id::text loop
  value:=f.typed_value;
  if value ? 'employmentFactId' then
   if not(ids ? (value->>'employmentFactId')) then raise exception 'clarification_source_relationship_invalid'; end if;
   value:=jsonb_set(value,'{employmentFactId}',ids->(value->>'employmentFactId')); end if;
  if value ? 'sourceFactIds' then
   if exists(select 1 from jsonb_array_elements_text(value->'sourceFactIds') x where not(ids ? x)) then raise exception 'clarification_source_relationship_invalid'; end if;
   value:=jsonb_set(value,'{sourceFactIds}',(select jsonb_agg(ids->x order by ordinal) from jsonb_array_elements_text(value->'sourceFactIds') with ordinality e(x,ordinal))); end if;
  copied:=jsonb_populate_record(null::public.ap_candidate_facts,to_jsonb(f)||jsonb_build_object('id',ids->f.id::text,'draft_id',p_draft_id,
   'customer_id',c.customer_id,'snapshot_id',null,'typed_value',value,'verification','EXTRACTED_UNCONFIRMED',
   'confirmed_or_corrected_at',null,'supersedes_fact_id',null,'created_at',clock_timestamp()));
  insert into public.ap_candidate_facts select copied.*;
  if answers->'factReviews' ? f.id::text then reviews:=reviews||jsonb_build_object(ids->>f.id::text,answers->'factReviews'->f.id::text); end if;
  if answers->'factCorrections' ? f.id::text then corrections:=corrections||jsonb_build_object(ids->>f.id::text,answers->'factCorrections'->f.id::text); end if;
 end loop;
 return answers||jsonb_build_object('factReviews',reviews,'factCorrections',corrections,'backgroundReviewed',false,'termsAccepted',false);
end $$;

create function public.ap_material_clarification_answer_context(p_question_id uuid,p_draft_id uuid,p_secret_hash text,p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.ap_intake_snapshots; successor uuid;
begin
 select snapshot.* into s from public.ap_candidate_questions q join public.ap_intake_snapshots snapshot on snapshot.id=q.snapshot_id where q.id=p_question_id;
 if s.id is null then raise exception 'question_owner_or_version_invalid'; end if;
 if p_customer_id is not null then
  if p_draft_id is not null or p_secret_hash is not null or not public.ap_customer_owns_snapshot(p_customer_id,s.id)
   then raise exception 'question_owner_or_version_invalid'; end if;
 elsif not exists(select 1 from public.ap_anonymous_drafts d where d.id=p_draft_id and d.capability_secret_hash=p_secret_hash
  and d.expires_at>clock_timestamp() and d.retention_state='ACTIVE' and (d.id=s.draft_id or exists(
   select 1 from public.ap_intake_clarifications where source_snapshot_id=s.id and draft_id=d.id)))
  then raise exception 'question_owner_or_version_invalid'; end if;
 select draft_id into successor from public.ap_intake_clarifications where source_snapshot_id=s.id;
 return jsonb_build_object('mode',case when s.schema_version='applypack-intake-v4' then 'CONFIRMED_INTAKE' else 'LEGACY' end,
  'sourceDraftId',s.draft_id,'successorDraftId',successor);
end $$;

create function public.ap_answer_material_clarification(p_question_id uuid,p_draft_id uuid,p_secret_hash text,p_customer_id uuid,
 p_answer text,p_successor_draft_id uuid,p_successor_secret_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.ap_candidate_questions; s public.ap_intake_snapshots; c public.ap_intake_clarifications; d public.ap_anonymous_drafts;
 prior public.ap_intake_clarification_answers; working_answers jsonb; answer_hash text; fact uuid;
begin
 if p_answer is null or length(btrim(p_answer)) not between 1 and 5000 or p_successor_draft_id is null
  or p_successor_secret_hash is null or p_successor_secret_hash!~'^[a-f0-9]{64}$' then raise exception 'clarification_answer_invalid'; end if;
 select * into q from public.ap_candidate_questions where id=p_question_id;
 select * into s from public.ap_intake_snapshots where id=q.snapshot_id;
 if s.id is null then raise exception 'question_owner_or_version_invalid'; end if;
 if p_customer_id is not null then
  if p_draft_id is not null or p_secret_hash is not null or not public.ap_customer_owns_snapshot(p_customer_id,s.id)
   then raise exception 'question_owner_or_version_invalid'; end if;
 elsif not exists(select 1 from public.ap_anonymous_drafts auth where auth.id=p_draft_id and auth.capability_secret_hash=p_secret_hash
   and auth.expires_at>clock_timestamp() and auth.retention_state='ACTIVE' and (auth.id=s.draft_id or exists(
    select 1 from public.ap_intake_clarifications where source_snapshot_id=s.id and draft_id=auth.id)))
  then raise exception 'question_owner_or_version_invalid'; end if;
 if s.schema_version is distinct from 'applypack-intake-v4' then
  fact:=case when p_customer_id is not null then public.ap_answer_customer_question(p_customer_id,q.id,p_answer)
   else public.ap_answer_candidate_question(q.id,p_draft_id,p_secret_hash,p_answer) end;
  return jsonb_build_object('state','LEGACY_EVIDENCE_RECORDED','factId',fact); end if;
 s:=public.ap_lock_material_clarification(s.id);
 select * into c from public.ap_intake_clarifications where source_snapshot_id=s.id for update;
 if c.id is null or c.confirmed_snapshot_id is not null then raise exception 'clarification_not_open'; end if;
 if c.customer_id is not null and p_customer_id is not null and c.customer_id<>p_customer_id then raise exception 'question_owner_or_version_invalid'; end if;
 if c.draft_id is null then
  insert into public.ap_anonymous_drafts(id,capability_secret_hash,expires_at,flow_version,answers)
   select p_successor_draft_id,p_successor_secret_hash,expires_at,flow_version,'{}' from public.ap_anonymous_drafts where id=s.draft_id;
  update public.ap_intake_clarifications set draft_id=p_successor_draft_id,customer_id=coalesce(customer_id,p_customer_id) where id=c.id returning * into c;
  working_answers:=public.ap_clone_clarification_sources(c.id,c.draft_id);
  update public.ap_anonymous_drafts set answers=working_answers||jsonb_build_object('clarifications',
   (select jsonb_agg(jsonb_build_object('questionId',question.id,'prompt',question.prompt,'answer','') order by question.created_at,question.id)
    from public.ap_candidate_questions question where question.snapshot_id=s.id)) where id=c.draft_id;
 end if;
  select * into d from public.ap_anonymous_drafts where id=c.draft_id for update;
  -- Authorization may have changed while the original or successor row lock
  -- was pending. Both possible capability rows are now locked by this action.
  if p_customer_id is not null then
   if p_draft_id is not null or p_secret_hash is not null or not public.ap_customer_owns_snapshot(p_customer_id,s.id)
    then raise exception 'question_owner_or_version_invalid'; end if;
  elsif not exists(select 1 from public.ap_anonymous_drafts auth where auth.id=p_draft_id and auth.capability_secret_hash=p_secret_hash
    and auth.expires_at>clock_timestamp() and auth.retention_state='ACTIVE' and (auth.id=s.draft_id or auth.id=d.id))
   then raise exception 'question_owner_or_version_invalid'; end if;
  if d.state<>'IN_PROGRESS' or d.expires_at<=clock_timestamp() or d.retention_state<>'ACTIVE' then raise exception 'clarification_not_open'; end if;
 -- Authenticated recovery may replace only this customer's unpaid capability.
 -- Anonymous replay must prove the original or already-issued successor secret.
 if p_customer_id is null and d.capability_secret_hash<>p_successor_secret_hash then raise exception 'clarification_capability_conflict'; end if;
 if p_customer_id is not null and d.capability_secret_hash<>p_successor_secret_hash then
  update public.ap_anonymous_drafts set capability_secret_hash=p_successor_secret_hash,capability_version=capability_version+1,
   capability_rotated_at=clock_timestamp() where id=d.id; end if;
 answer_hash:=encode(extensions.digest(convert_to(btrim(p_answer),'UTF8'),'sha256'),'hex');
 select * into prior from public.ap_intake_clarification_answers where question_id=q.id;
 if prior.question_id is not null then
  if prior.draft_id<>d.id or prior.answer_sha256<>answer_hash then raise exception 'clarification_answer_already_saved_edit_review'; end if;
 else
  select jsonb_agg(case when value->>'questionId'=q.id::text then jsonb_set(value,'{answer}',to_jsonb(btrim(p_answer))) else value end order by ordinal)
   into working_answers from jsonb_array_elements(d.answers->'clarifications') with ordinality e(value,ordinal);
  update public.ap_anonymous_drafts set answers=jsonb_set(d.answers,'{clarifications}',working_answers),confirmation_receipt=null,
   version=version+1,updated_at=clock_timestamp() where id=d.id returning * into d;
  insert into public.ap_intake_clarification_answers(question_id,draft_id,source_snapshot_id,answer_sha256)
   values(q.id,d.id,s.id,answer_hash);
 end if;
 return jsonb_build_object('state','FULL_REVIEW_REQUIRED','draftId',d.id,'version',d.version,'expiresAt',d.expires_at,'replayed',prior.question_id is not null);
end $$;

create function public.ap_guard_confirmed_draft_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare source_draft uuid; confirmed_snapshot uuid; previous jsonb:=to_jsonb(old); next_value jsonb:=to_jsonb(new);
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,previous,next_value) then return new; end if;
 -- Reparenting cannot make the old confirmed source disappear from the check.
 -- Serialize both parents for this exceptional identity change, including a
 -- concurrent confirmation of either draft; ordinary writes keep their existing lock path.
 if tg_table_name<>'ap_anonymous_drafts' and tg_op='UPDATE'
  and next_value->'draft_id' is distinct from previous->'draft_id' then
  perform 1 from public.ap_anonymous_drafts where id in((previous->>'draft_id')::uuid,(next_value->>'draft_id')::uuid)
   order by id for update;
 end if;
 for source_draft in select distinct id from unnest(case when tg_table_name='ap_anonymous_drafts'
   then array[(previous->>'id')::uuid] else array[(previous->>'draft_id')::uuid,(next_value->>'draft_id')::uuid] end) id
   where id is not null order by id loop
 select s.id into confirmed_snapshot from public.ap_anonymous_drafts d join public.ap_intake_snapshots s on s.id=d.finalized_snapshot_id
   where d.id=source_draft and s.schema_version='applypack-intake-v4' and s.confirmed_review is not null;
 if confirmed_snapshot is not null then
   if tg_table_name='ap_anonymous_drafts' and (next_value->'answers' is distinct from previous->'answers' or next_value->'current_step' is distinct from previous->'current_step'
    or next_value->>'state'='IN_PROGRESS'
   or next_value->'confirmation_receipt' is distinct from previous->'confirmation_receipt' or next_value->'finalized_snapshot_id' is distinct from previous->'finalized_snapshot_id')
   then raise exception 'confirmed_intake_requires_successor_review'; end if;
  if tg_table_name='ap_document_versions' and (tg_op in('INSERT','DELETE') or
    exists(select 1 from unnest(array['id','draft_id','kind','version','storage_bucket','storage_path','sha256','size_bytes',
     'safe_display_name','client_mime_type','verified_mime_type','is_current']) field where next_value->field is distinct from previous->field))
   then raise exception 'confirmed_intake_source_frozen'; end if;
   -- Separate paid correction/search-adjustment snapshots retain their existing
   -- contract and guards. Only this confirmed intake and its upload facts freeze.
   if tg_table_name='ap_candidate_facts' and (
     (tg_op<>'DELETE' and next_value->>'snapshot_id' is null)
     or (tg_op<>'INSERT' and previous->>'snapshot_id' is null)
     or next_value->>'snapshot_id'=confirmed_snapshot::text or previous->>'snapshot_id'=confirmed_snapshot::text)
    and (tg_op in('INSERT','DELETE') or next_value->'typed_value' is distinct from previous->'typed_value'
   or next_value->'draft_id' is distinct from previous->'draft_id'
   or next_value->'snapshot_id' is distinct from previous->'snapshot_id' or next_value->'document_version_id' is distinct from previous->'document_version_id')
   then raise exception 'confirmed_intake_source_frozen'; end if;
 end if;
 end loop;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger ap_confirmed_draft_source_frozen before update on public.ap_anonymous_drafts for each row execute function public.ap_guard_confirmed_draft_source();
create trigger ap_confirmed_document_source_frozen before insert or update or delete on public.ap_document_versions for each row execute function public.ap_guard_confirmed_draft_source();
create trigger ap_confirmed_fact_source_frozen before insert or update or delete on public.ap_candidate_facts for each row execute function public.ap_guard_confirmed_draft_source();

create function public.ap_material_clarification_answers_valid(p_draft_id uuid,p_answers jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if jsonb_typeof(p_answers) is distinct from 'object' then return false; end if;
 if not exists(select 1 from public.ap_intake_clarifications where draft_id=p_draft_id) then return not(p_answers ? 'clarifications'); end if;
 if jsonb_typeof(p_answers->'clarifications') is distinct from 'array' then return false; end if;
 return jsonb_array_length(p_answers->'clarifications') between 1 and 20
  and not exists(select 1 from jsonb_array_elements(p_answers->'clarifications') a where jsonb_typeof(a) is distinct from 'object'
   or not(a ?& array['questionId','prompt','answer']) or a-array['questionId','prompt','answer']<>'{}'
   or jsonb_typeof(a->'answer') is distinct from 'string' or length(btrim(a->>'answer')) not between 1 and 5000
   or not exists(select 1 from public.ap_candidate_questions q join public.ap_intake_clarifications c on c.source_snapshot_id=q.snapshot_id
    where c.draft_id=p_draft_id and q.id::text=a->>'questionId' and q.prompt=a->>'prompt'))
  and (select count(distinct a->>'questionId') from jsonb_array_elements(p_answers->'clarifications') a)=jsonb_array_length(p_answers->'clarifications')
  and (select count(*) from public.ap_candidate_questions q join public.ap_intake_clarifications c on c.source_snapshot_id=q.snapshot_id where c.draft_id=p_draft_id)=jsonb_array_length(p_answers->'clarifications');
end;
$$;

create function public.ap_lock_clarification_finalization(p_draft_id uuid,p_secret_hash text,p_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare c public.ap_intake_clarifications;
begin
 select clarification.* into c from public.ap_intake_clarifications clarification
  join public.ap_anonymous_drafts d on d.id=clarification.draft_id
  where d.id=p_draft_id and d.capability_secret_hash=p_secret_hash and d.expires_at>clock_timestamp() and d.retention_state='ACTIVE';
 if c.id is null then return; end if;
 -- Acquire the original-source fence before the successor draft row. Issuance
 -- and confirmation must agree on the complete question set at one serial point.
 perform public.ap_lock_material_clarification(c.source_snapshot_id);
 select * into strict c from public.ap_intake_clarifications where id=c.id for update;
 if c.confirmed_snapshot_id is not null and c.confirmed_snapshot_id is distinct from p_snapshot_id
  then raise exception 'clarification_not_open'; end if;
end $$;

create function public.ap_bind_material_clarification(p_snapshot_id uuid,p_snapshot jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; c public.ap_intake_clarifications; d public.ap_anonymous_drafts; answer jsonb;
 q public.ap_candidate_questions; node public.ap_requirement_nodes; fact uuid;
begin
 select * into strict s from public.ap_intake_snapshots where id=p_snapshot_id;
 select * into c from public.ap_intake_clarifications where draft_id=s.draft_id for update;
 if c.id is null then return; end if;
 select * into strict d from public.ap_anonymous_drafts where id=s.draft_id;
 if c.confirmed_snapshot_id is not null or public.ap_material_clarification_answers_valid(d.id,d.answers) is not true
  or p_snapshot->'clarifications' is distinct from d.answers->'clarifications' then raise exception 'clarification_full_review_required'; end if;
 for answer in select value from jsonb_array_elements(d.answers->'clarifications') loop
  select * into strict q from public.ap_candidate_questions where id=(answer->>'questionId')::uuid and snapshot_id=c.source_snapshot_id;
  select * into strict node from public.ap_requirement_nodes where id=q.requirement_node_id;
  insert into public.ap_candidate_facts(draft_id,customer_id,snapshot_id,semantic_key,value_kind,typed_value,source_kind,
   customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,customer_display_label,customer_display_value)
   values(d.id,c.customer_id,s.id,node.semantic_key,'CLARIFICATION',jsonb_build_object('statement',answer->>'answer','questionId',q.id),
     'CUSTOMER_ASSERTION',s.id,'clarification:'||q.id,'question:'||q.id,'CUSTOMER_CONFIRMED',clock_timestamp(),'confirmed-clarification-v1',s.schema_version,q.prompt,jsonb_build_object('summary',answer->>'answer')) returning id into fact;
  insert into public.ap_candidate_answers(question_id,fact_id,answer) values(q.id,fact,answer->>'answer');
 end loop;
 update public.ap_intake_clarifications set confirmed_snapshot_id=s.id,confirmed_at=clock_timestamp() where id=c.id;
end $$;

-- Narrow, checked source substitutions preserve the published finalizer and
-- legal acceptance transaction. Original records and global path uniqueness stay.
do $$ declare definition text; original text; name text; anchor text; begin
 foreach name in array array['ap_intake_confirmation_source','ap_assert_confirmed_intake','ap_bind_confirmed_review_facts','ap_annotate_document_facts'] loop
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
  original:=definition;
  if name='ap_intake_confirmation_source' then
   definition:=replace(definition,'from public.ap_document_versions v where v.draft_id=d.id and v.is_current','from public.ap_effective_intake_documents(d.id) v');
  elsif name='ap_assert_confirmed_intake' then
   definition:=replace(definition,'from public.ap_document_versions where draft_id=d.id and kind=','from public.ap_effective_intake_documents(d.id) where kind=');
   definition:=replace(definition,'join public.ap_document_versions v on v.id=f.document_version_id','join public.ap_effective_intake_documents(d.id) v on v.id=f.document_version_id');
   definition:=replace(definition,'  if p_snapshot->>''entryMode''=''GUIDED'' then',
    '  if public.ap_material_clarification_answers_valid(d.id,d.answers) is not true or p_snapshot->''clarifications'' is distinct from d.answers->''clarifications'' then raise exception ''clarification_full_review_required''; end if;'||chr(10)||'  if p_snapshot->>''entryMode''=''GUIDED'' then');
  elsif name='ap_bind_confirmed_review_facts' then
   definition:=replace(definition,'join public.ap_document_versions doc on doc.id=fact.document_version_id','join public.ap_effective_intake_documents(s.draft_id) doc on doc.id=fact.document_version_id');
  else
   definition:=replace(definition,'join public.ap_document_versions d on d.id=f.document_version_id','join public.ap_effective_intake_documents(p_draft_id) d on d.id=f.document_version_id');
   definition:=replace(definition,'and d.draft_id=p_draft_id and d.is_current','and d.is_current');
  end if;
  if original=definition then raise exception 'clarification_source_anchor_missing:%',name; end if; execute definition;
 end loop;
  definition:=pg_get_functiondef('public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)'::regprocedure);
  original:=definition;
  definition:=regexp_replace(definition,E'\\mbegin\\M','begin'||chr(10)||' perform public.ap_lock_clarification_finalization(p_draft_id,p_secret_hash,p_snapshot_id);','i');
  if definition=original then raise exception 'clarification_finalize_lock_anchor_missing'; end if;
 anchor:='prior_snapshot:=d.finalized_snapshot_id;';
 if position(anchor in definition)=0 then raise exception 'clarification_parent_anchor_missing'; end if;
 definition:=replace(definition,anchor,'prior_snapshot:=coalesce(d.finalized_snapshot_id,(select source_snapshot_id from public.ap_intake_clarifications where draft_id=d.id));');
 anchor:='  request_id:=gen_random_uuid();';
 if position(anchor in definition)=0 then raise exception 'clarification_finalize_anchor_missing'; end if;
 definition:=replace(definition,anchor,'  perform public.ap_bind_material_clarification(p_snapshot_id,p_snapshot);'||chr(10)||anchor);
 -- Existing finalization can stale a claimed request; clear its lease columns.
 definition:=replace(definition,'set state=''STALE'',stale_reason=''SUPERSEDED_PRE_ACTIVATION_SNAPSHOT''',
  'set state=''STALE'',claimed_by=null,claimed_at=null,completed_assessment_id=null,stale_reason=''SUPERSEDED_PRE_ACTIVATION_SNAPSHOT''');
 execute definition;
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ap_apply_verified_search_payment';
 original:=definition;
 definition:=replace(definition,'from public.ap_document_versions where draft_id=checkout_row.draft_id','from public.ap_effective_intake_documents(checkout_row.draft_id) where true');
 definition:=replace(definition,'from public.ap_document_versions doc where doc.draft_id=checkout_row.draft_id','from public.ap_effective_intake_documents(checkout_row.draft_id) doc where true');
 if original=definition then raise exception 'clarification_payment_source_anchor_missing'; end if; execute definition;
end $$;

alter function public.ap_research_snapshot_current(uuid) rename to ap_research_snapshot_current_before_101;
create function public.ap_research_snapshot_current(p_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.ap_research_snapshot_current_before_101(p_snapshot_id)
  and not exists(select 1 from public.ap_intake_clarifications where source_snapshot_id=p_snapshot_id);
$$;
create function public.ap_assert_clarification_checkout(p_snapshot_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked)
  then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_snapshot_id::text,45));
 perform pg_advisory_xact_lock(hashtextextended('intake-clarification:'||p_snapshot_id::text,0));
 if exists(select 1 from public.ap_intake_clarifications where source_snapshot_id=p_snapshot_id)
  then raise exception 'clarification_full_review_required'; end if;
end $$;
do $$ declare name text; definition text; rewritten text; begin
 foreach name in array array['ap_issue_search_checkout_invitation','ap_begin_invited_search_checkout','ap_begin_search_checkout'] loop
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
  rewritten:=regexp_replace(definition,E'\\mbegin\\M','begin'||chr(10)||' perform public.ap_assert_clarification_checkout(p_snapshot_id);','i');
  if definition=rewritten then raise exception 'clarification_checkout_anchor_missing:%',name; end if; execute rewritten;
 end loop;
end $$;

-- The historical answer entry points cannot bypass the new review contract.
do $$ declare name text; definition text; rewritten text; begin
 foreach name in array array['ap_answer_candidate_question','ap_answer_customer_question'] loop
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
  rewritten:=regexp_replace(definition,E'\\mbegin\\M','begin'||chr(10)||
   ' if exists(select 1 from public.ap_candidate_questions q join public.ap_intake_snapshots s on s.id=q.snapshot_id where q.id=p_question_id and s.schema_version=''applypack-intake-v4'') then raise exception ''clarification_full_review_required''; end if;','i');
  if definition=rewritten then raise exception 'clarification_answer_anchor_missing:%',name; end if; execute rewritten;
 end loop;
end $$;

create function public.ap_guard_clarification_snapshot() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.ap_intake_clarifications;
begin
 select * into c from public.ap_intake_clarifications where draft_id=new.draft_id;
  if c.id is not null and new.snapshot_kind in('INITIAL','PRE_ACTIVATION_EDIT') then
  if new.parent_snapshot_id is distinct from c.source_snapshot_id or c.confirmed_snapshot_id is not null
   or new.schema_version<>'applypack-intake-v4' or new.confirmed_review is null then raise exception 'clarification_snapshot_binding_invalid'; end if;
  new.customer_id:=c.customer_id;
 end if;
 return new;
end $$;
create trigger ap_clarification_snapshot_binding before insert on public.ap_intake_snapshots for each row execute function public.ap_guard_clarification_snapshot();

create function public.ap_intake_source_lineage(p_draft_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('draftId',c.draft_id,'sourceDraftId',c.source_draft_id,'sourceSnapshotId',c.source_snapshot_id,
  'sourceSnapshotSha256',source.content_sha256,'confirmedSnapshotId',c.confirmed_snapshot_id,
  'customerId',coalesce(c.customer_id,d.converted_customer_id),
  'documents',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'draftId',v.draft_id,'sha256',v.sha256) order by v.id)
    from public.ap_intake_inherited_documents inherited join public.ap_effective_intake_documents(c.draft_id) v on v.id=inherited.document_version_id
    where inherited.draft_id=c.draft_id and inherited.excluded_at is null),'[]'::jsonb))
from public.ap_intake_clarifications c join public.ap_anonymous_drafts d on d.id=c.draft_id
 join public.ap_intake_snapshots source on source.id=c.source_snapshot_id where c.draft_id=p_draft_id;
$$;

do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_intake_confirmation_source(uuid,text,bigint)'::regprocedure);
 anchor:='  return encode(extensions.digest(convert_to(payload::text,''UTF8''),''sha256''),''hex'');';
 if position(anchor in definition)=0 then raise exception 'clarification_confirmation_lineage_anchor_missing'; end if;
 definition:=replace(definition,anchor,
  '  if public.ap_intake_source_lineage(d.id) is not null then payload:=payload||jsonb_build_object(''sourceLineage'',public.ap_intake_source_lineage(d.id)-''confirmedSnapshotId''-''customerId''); end if;'||chr(10)||anchor);
 execute definition;
end $$;

-- An inherited source can be replaced or removed from the successor without
-- changing its original record or scheduling the shared bytes for deletion.
alter function public.ap_remove_anonymous_document(uuid,text,bigint,public.ap_document_kind) rename to ap_remove_anonymous_document_before_101;
create function public.ap_remove_anonymous_document(p_draft_id uuid,p_secret_hash text,p_expected_draft_version bigint,p_kind public.ap_document_kind)
returns table(document_id uuid,storage_bucket text,storage_path text,draft_version bigint)
language plpgsql security definer set search_path='' as $$
declare d public.ap_anonymous_drafts; inherited public.ap_intake_inherited_documents; v public.ap_document_versions; source_snapshot uuid;
begin
 select c.source_snapshot_id into source_snapshot from public.ap_intake_clarifications c join public.ap_anonymous_drafts auth on auth.id=c.draft_id
  where auth.id=p_draft_id and auth.capability_secret_hash=p_secret_hash and auth.expires_at>clock_timestamp();
 if source_snapshot is not null then perform public.ap_lock_material_clarification(source_snapshot); end if;
 select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash and expires_at>clock_timestamp() for update;
 if d.id is not null and not exists(select 1 from public.ap_intake_clarifications where draft_id=d.id)
  and not exists(select 1 from public.ap_intake_snapshots where id=d.finalized_snapshot_id and schema_version='applypack-intake-v4') then
  return query select * from public.ap_remove_anonymous_document_before_101(p_draft_id,p_secret_hash,p_expected_draft_version,p_kind); return; end if;
 if d.id is null or d.state<>'IN_PROGRESS' then raise exception 'draft_capability_invalid'; end if;
 if d.version<>p_expected_draft_version then raise exception 'draft_version_conflict'; end if;
 select * into inherited from public.ap_intake_inherited_documents where draft_id=d.id and kind=p_kind and excluded_at is null for update;
 if inherited.id is not null then update public.ap_intake_inherited_documents set excluded_at=clock_timestamp() where id=inherited.id; end if;
 if exists(select 1 from public.ap_document_versions where draft_id=d.id and kind=p_kind and is_current) or inherited.id is null then
  return query select * from public.ap_remove_anonymous_document_before_101(p_draft_id,p_secret_hash,p_expected_draft_version,p_kind); return; end if;
 select * into strict v from public.ap_document_versions where id=inherited.document_version_id;
 update public.ap_anonymous_drafts set version=version+1,confirmation_receipt=null,updated_at=clock_timestamp() where id=d.id returning version into d.version;
 return query select v.id,v.storage_bucket,v.storage_path,d.version;
end $$;

alter function public.ap_retention_snapshot_customers(uuid) rename to ap_retention_snapshot_customers_before_101;
create function public.ap_retention_snapshot_customers(p_snapshot uuid) returns uuid[]
language sql stable security definer set search_path='' as $$
 with recursive descendants(id) as (
  select p_snapshot union select c.confirmed_snapshot_id from public.ap_intake_clarifications c join descendants parent on parent.id=c.source_snapshot_id where c.confirmed_snapshot_id is not null
 ), owners as (
  select unnest(public.ap_retention_snapshot_customers_before_101(id)) owner from descendants
  union select c.customer_id from public.ap_intake_clarifications c join descendants s on s.id=c.source_snapshot_id
  union select d.converted_customer_id from public.ap_intake_clarifications c join descendants s on s.id=c.source_snapshot_id join public.ap_anonymous_drafts d on d.id=c.draft_id
 ) select coalesce(array_agg(distinct owner order by owner) filter(where owner is not null),'{}'::uuid[]) from owners;
$$;
alter function public.ap_legacy_retention_object_allowed(text,text) rename to ap_legacy_retention_object_allowed_before_101;
create function public.ap_legacy_retention_object_allowed(p_bucket text,p_path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('retention-object:'||p_bucket||':'||p_path,0));
 if exists(select 1 from public.ap_intake_inherited_documents inherited join public.ap_document_versions v on v.id=inherited.document_version_id
  join public.ap_anonymous_drafts d on d.id=inherited.draft_id where v.storage_bucket=p_bucket and v.storage_path=p_path
   and inherited.excluded_at is null and d.retention_state='ACTIVE' and d.expires_at>clock_timestamp()) then return false; end if;
 return public.ap_legacy_retention_object_allowed_before_101(p_bucket,p_path);
end $$;

-- Both the exported context and its locks include exact inherited sources. A
-- non-inherited draft keeps the old source projection and hash unchanged.
do $$ declare definition text; original text; anchor text; begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_material_draft_context_sha256';
  original:=definition;
  if position('public.ap_fact_review_history,public.ap_document_versions,public.ap_sensitive_payloads,' in definition)=0
   or position('from public.ap_document_versions where draft_id=s.draft_id and is_current' in definition)=0
   or position('from public.ap_document_versions d where d.draft_id=s.draft_id and d.is_current' in definition)=0
   then raise exception 'clarification_context_source_anchor_missing'; end if;
  definition:=replace(definition,'public.ap_fact_review_history,public.ap_document_versions,public.ap_sensitive_payloads,',
  'public.ap_fact_review_history,public.ap_document_versions,public.ap_intake_clarifications,public.ap_intake_inherited_documents,public.ap_sensitive_payloads,');
 definition:=replace(definition,'from public.ap_document_versions where draft_id=s.draft_id and is_current','from public.ap_effective_intake_documents(s.draft_id)');
 definition:=replace(definition,'from public.ap_document_versions d where d.draft_id=s.draft_id and d.is_current','from public.ap_effective_intake_documents(s.draft_id) d');
  anchor:='return encode(extensions.digest(body::text,''sha256''),''hex'');';
 if position(anchor in definition)=0 then raise exception 'clarification_context_lineage_anchor_missing'; end if;
 definition:=replace(definition,anchor,
  '  if public.ap_intake_source_lineage(s.draft_id) is not null then body:=body||jsonb_build_object(''sourceLineage'',public.ap_intake_source_lineage(s.draft_id)); end if;'||chr(10)||anchor);
 if definition=original then raise exception 'clarification_context_source_anchor_missing'; end if; execute definition;
end $$;

create function public.ap_material_clarification_questions(p_draft_id uuid,p_secret_hash text,p_customer_id uuid)
returns table(id uuid,prompt text,answered boolean,review_required boolean) language plpgsql security definer set search_path='' as $$
declare source uuid;
begin
 if p_customer_id is not null then
  if p_draft_id is not null or p_secret_hash is not null then raise exception 'question_owner_or_version_invalid'; end if;
  return query select q.id,q.prompt,exists(select 1 from public.ap_candidate_answers a where a.question_id=q.id)
    or exists(select 1 from public.ap_intake_clarification_answers a where a.question_id=q.id),
    exists(select 1 from public.ap_intake_clarifications c where c.source_snapshot_id=q.snapshot_id and c.draft_id is not null and c.confirmed_snapshot_id is null)
   from public.ap_candidate_questions q where public.ap_current_customer_question(p_customer_id,q.id) order by q.created_at,q.id limit 101;
 else
  select coalesce(c.source_snapshot_id,d.finalized_snapshot_id) into source from public.ap_anonymous_drafts d
   left join public.ap_intake_clarifications c on c.draft_id=d.id where d.id=p_draft_id and d.capability_secret_hash=p_secret_hash and d.expires_at>clock_timestamp() and d.retention_state='ACTIVE';
  if source is null then return; end if;
  return query select q.id,q.prompt,exists(select 1 from public.ap_candidate_answers a where a.question_id=q.id)
    or exists(select 1 from public.ap_intake_clarification_answers a where a.question_id=q.id),
    exists(select 1 from public.ap_intake_clarifications c where c.source_snapshot_id=q.snapshot_id and c.draft_id is not null and c.confirmed_snapshot_id is null)
   from public.ap_candidate_questions q where q.snapshot_id=source order by q.created_at,q.id limit 101;
 end if;
end $$;

do $$ declare name text; f record; begin
 foreach name in array array['ap_intake_clarifications','ap_intake_inherited_documents','ap_intake_clarification_answers'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to service_role',name);
  insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values(name,case when name='ap_intake_clarification_answers' then 'question_id' else 'id' end,'{}');
  execute format('create trigger ap_service_retention_write before insert or update or delete on public.%I for each row execute function public.ap_guard_service_retention_write()',name);
  insert into public.ap_archive_fence_relations values('public',name);
  execute format('create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.%I for each statement execute function public.ap_guard_archive_source_mutation()',name);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_effective_intake_documents','ap_lock_material_clarification','ap_issue_candidate_question','ap_issue_candidate_question_before_101',
   'ap_clone_clarification_sources','ap_material_clarification_answer_context','ap_answer_material_clarification','ap_guard_confirmed_draft_source','ap_material_clarification_answers_valid',
   'ap_lock_clarification_finalization','ap_bind_material_clarification','ap_research_snapshot_current','ap_research_snapshot_current_before_101','ap_assert_clarification_checkout',
   'ap_guard_clarification_snapshot','ap_intake_source_lineage','ap_remove_anonymous_document','ap_remove_anonymous_document_before_101',
   'ap_retention_snapshot_customers','ap_retention_snapshot_customers_before_101','ap_legacy_retention_object_allowed','ap_legacy_retention_object_allowed_before_101',
   'ap_material_clarification_questions') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('alter function %s set lock_timeout=''5s''',f.signature);
   if f.proname in('ap_effective_intake_documents','ap_issue_candidate_question','ap_material_clarification_answer_context','ap_answer_material_clarification','ap_research_snapshot_current',
   'ap_intake_source_lineage','ap_remove_anonymous_document','ap_legacy_retention_object_allowed','ap_material_clarification_questions') then
   execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;

-- 099/100 are independent predecessors. Only these reviewed changed ownership
-- helpers are re-pinned; newly called helper definitions are explicit too.
update public.ap_archive_fence_function_contracts set definition_sha256=encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex')
 where signature='public.ap_retention_snapshot_customers(uuid)';
insert into public.ap_archive_fence_function_contracts values('public.ap_retention_snapshot_customers_before_101(uuid)',
 encode(extensions.digest(pg_get_functiondef('public.ap_retention_snapshot_customers_before_101(uuid)'::regprocedure),'sha256'),'hex'));
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
 if position('count(*)=17' in definition)=0 then raise exception 'clarification_archive_roster_anchor_missing'; end if;
 definition:=replace(definition,'count(*)=17','count(*)=18');
 definition:=replace(definition,'''public.ap_retention_snapshot_customers(uuid)''','''public.ap_retention_snapshot_customers(uuid)'',''public.ap_retention_snapshot_customers_before_101(uuid)''');
 execute definition;
end $$;
create or replace function public.ap_archive_snapshot_schema_supported(p_schema text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(p_schema=any(array[
  '202610250090','202610250091','202610250092','202610250093','202610250094','202610250095',
  '202610250096','202610250097','202610250098','202610250099','202610250100','202610250101'
 ]) and exists(select 1 from supabase_migrations.schema_migrations where version=p_schema),false);
$$;
revoke all on function public.ap_archive_snapshot_schema_supported(text) from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250101','MATERIAL_CLARIFICATION_CONFIRMATION',0,clock_timestamp());
create function public.ap_material_clarification_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250101' and checkpoint='MATERIAL_CLARIFICATION_CONFIRMATION')
 and public.ap_archive_fence_coverage_current()
 and (select count(*)=3 from public.ap_retention_private_tables where table_name in('ap_intake_clarifications','ap_intake_inherited_documents','ap_intake_clarification_answers') and redaction_patch='{}')
 and (select count(*)=3 from pg_trigger where not tgisinternal and tgenabled='O' and tgname='ap_service_retention_write'
  and tgrelid in('public.ap_intake_clarifications'::regclass,'public.ap_intake_inherited_documents'::regclass,'public.ap_intake_clarification_answers'::regclass)
  and tgfoid='public.ap_guard_service_retention_write()'::regprocedure)
 and not exists(select 1 from (values
   ('ap_anonymous_drafts','ap_confirmed_draft_source_frozen','public.ap_guard_confirmed_draft_source()'),
   ('ap_document_versions','ap_confirmed_document_source_frozen','public.ap_guard_confirmed_draft_source()'),
   ('ap_candidate_facts','ap_confirmed_fact_source_frozen','public.ap_guard_confirmed_draft_source()'),
   ('ap_intake_snapshots','ap_clarification_snapshot_binding','public.ap_guard_clarification_snapshot()')) expected(table_name,trigger_name,signature)
  where not exists(select 1 from pg_trigger where not tgisinternal and tgenabled='O' and tgname=expected.trigger_name
   and tgrelid=('public.'||expected.table_name)::regclass and tgfoid=expected.signature::regprocedure))
 and position('ap_lock_clarification_finalization(p_draft_id,p_secret_hash,p_snapshot_id)' in pg_get_functiondef('public.ap_finalize_four_step_intake(uuid,text,bigint,uuid,jsonb,text,uuid,jsonb)'::regprocedure))>0
 and position('ap_material_clarification_answers_valid' in pg_get_functiondef('public.ap_assert_confirmed_intake(uuid,text,bigint,jsonb,jsonb)'::regprocedure))>0
 and not has_function_privilege('authenticated','public.ap_answer_material_clarification(uuid,uuid,text,uuid,text,uuid,text)','EXECUTE')
 and not has_function_privilege('anon','public.ap_material_clarification_answer_context(uuid,uuid,text,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.ap_lock_clarification_finalization(uuid,text,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.ap_clone_clarification_sources(uuid,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.ap_issue_candidate_question_before_101(uuid,uuid,uuid,uuid,text)','EXECUTE')
 and not exists(select 1 from unnest(array['ap_intake_clarifications','ap_intake_inherited_documents','ap_intake_clarification_answers']) name
   where has_table_privilege('service_role','public.'||name,'INSERT,UPDATE,DELETE,TRUNCATE'));
$$;
revoke all on function public.ap_material_clarification_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_material_clarification_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=24 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250100''' in definition)=0
  or position('(''202610250100'',''AUTOMATIC_RESEARCH_PREPARATION'')' in definition)=0 or position('''202610250099'',''202610250100''' in definition)=0
  or position('public.ap_automatic_research_schema_installed()' in definition)=0 then raise exception 'clarification_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=24 as installed','select count(*)=25 as installed');
 definition:=replace(definition,'(''202610250100'',''AUTOMATIC_RESEARCH_PREPARATION'')','(''202610250100'',''AUTOMATIC_RESEARCH_PREPARATION''),(''202610250101'',''MATERIAL_CLARIFICATION_CONFIRMATION'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250100''','''requiredSchemaVersion'', ''202610250101''');
 definition:=replace(definition,'''202610250099'',''202610250100''','''202610250099'',''202610250100'',''202610250101''');
 definition:=replace(definition,'public.ap_automatic_research_schema_installed()','public.ap_automatic_research_schema_installed() and public.ap_material_clarification_schema_installed()');
 execute definition;
end $$;
commit;
