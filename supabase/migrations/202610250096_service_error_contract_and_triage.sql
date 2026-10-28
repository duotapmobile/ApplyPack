-- Prospective service-error reporting and owner triage. This migration does not
-- activate v4 terms, enroll any checkout, reopen a paid line, or deliver a repair.
begin;
create table public.ap_service_error_contracts (
 material_line_id uuid primary key references public.ap_material_lines(id),
 customer_id uuid not null references public.profiles(id), purchase_id uuid not null references public.ap_material_purchases(id),
 source_snapshot_id uuid not null references public.ap_intake_snapshots(id), legal_receipt_id uuid not null references public.ap_snapshot_legal_content_receipts(id),
 intake_review_id uuid not null, intake_review_sha256 text not null check(intake_review_sha256 ~ '^[a-f0-9]{64}$'),
 contract_version text not null check(contract_version='service-error-only-v1'),
 terms_version text not null check(terms_version='manual-launch-terms-2026-10-25-v4'), terms_content_sha256 text not null check(terms_content_sha256 ~ '^[a-f0-9]{64}$'),
 privacy_version text not null check(privacy_version='privacy-2026-10-25-v4'), privacy_content_sha256 text not null check(privacy_content_sha256 ~ '^[a-f0-9]{64}$'),
 confirmed_intake_version text not null check(confirmed_intake_version='applypack-confirmed-intake-v1'),
 reporting_time_zone text not null default 'America/New_York' check(reporting_time_zone='America/New_York'), bound_at timestamptz not null
);
create table public.ap_service_error_reports (
 id uuid primary key references public.ap_material_support_cases(id), customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null unique references public.ap_service_error_contracts(material_line_id),
 request_id uuid not null, sensitive_payload_id uuid not null unique references public.ap_sensitive_payloads(id),
 report_sha256 text not null check(report_sha256 ~ '^[a-f0-9]{64}$'),
 report_deadline timestamptz not null, reported_at timestamptz not null,
 unique(customer_id,request_id), check(reported_at<=report_deadline)
);
create table public.ap_service_error_decisions (
 id uuid primary key, request_id uuid not null unique, case_id uuid not null references public.ap_service_error_reports(id),
 customer_id uuid not null references public.profiles(id), material_line_id uuid not null references public.ap_material_lines(id),
 previous_decision_id uuid references public.ap_service_error_decisions(id), version integer not null check(version>0),
 sensitive_payload_id uuid not null unique references public.ap_sensitive_payloads(id), review_sha256 text not null check(review_sha256 ~ '^[a-f0-9]{64}$'),
 classification text not null check(classification in('CONFIRMED_SERVICE_ERROR','CUSTOMER_INPUT_CHANGE','EDITORIAL_REQUEST','EVIDENCE_INVESTIGATION')),
 reason_code text not null check(reason_code in('CONFIRMED_SOURCE_MISMATCH','UNSUPPORTED_GENERATED_CLAIM','MATERIAL_MISREPRESENTATION',
  'CUSTOMER_CONFIRMED_VALUE','NEW_OR_OMITTED_INFORMATION','WORDING_OR_SELECTION_PREFERENCE','CONFIRMATION_OR_PARSER_UNCLEAR','EVIDENCE_MISSING')),
 evidence jsonb not null check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence) between 1 and 30),
 affected jsonb not null check(jsonb_typeof(affected)='array' and jsonb_array_length(affected)<=30),
 reviewer_id uuid not null references public.profiles(id), decided_at timestamptz not null,
 unique(case_id,version), check((classification='CONFIRMED_SERVICE_ERROR')=(jsonb_array_length(affected)>0))
);
create table public.ap_service_error_affected_members (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.ap_service_error_reports(id),
 decision_id uuid references public.ap_service_error_decisions(id), customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id), source_snapshot_id uuid not null references public.ap_intake_snapshots(id),
 artifact_id uuid not null references public.ap_generated_artifacts(id), file_version_id uuid not null references public.ap_generated_file_versions(id),
 release_id uuid not null references public.ap_releases(id), position integer not null check(position>0),
 member_kind text not null check(member_kind in('REPORTED','ACCEPTED_ERROR')), created_at timestamptz not null default clock_timestamp(),
 check((member_kind='REPORTED')=(decision_id is null)), unique nulls not distinct(case_id,decision_id,file_version_id)
);
alter table public.ap_material_support_cases drop constraint ap_material_support_cases_case_kind_check;
alter table public.ap_material_support_cases add constraint ap_material_support_cases_case_kind_check
 check(case_kind in('POSTDELIVERY_MATERIAL_FALSE_CLAIM','INCLUDED_FACTUAL_CORRECTION','SERVICE_ERROR_REPORT'));

create function public.ap_guard_service_error_history() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 raise exception 'service_error_history_immutable';
end $$;
create function public.ap_guard_service_error_contract() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.ap_intake_snapshots; receipt public.ap_snapshot_legal_content_receipts; intent public.ap_material_checkout_intents;
begin
 select * into s from public.ap_intake_snapshots where id=new.source_snapshot_id;
 select * into receipt from public.ap_snapshot_legal_content_receipts where id=new.legal_receipt_id;
 select * into intent from public.ap_material_checkout_intents where purchase_id=new.purchase_id;
 if not exists(select 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id
  where l.id=new.material_line_id and p.id=new.purchase_id and p.customer_id=new.customer_id)
  or intent.customer_id is distinct from new.customer_id or intent.source_snapshot_id is distinct from new.source_snapshot_id
  or s.customer_id is distinct from new.customer_id or s.confirmed_review->>'contractVersion' is distinct from new.confirmed_intake_version
  or s.confirmed_review->>'id' is distinct from new.intake_review_id::text or s.confirmed_review->>'reviewSha256' is distinct from new.intake_review_sha256
  or receipt.snapshot_id is distinct from s.id or receipt.terms_version is distinct from new.terms_version or receipt.privacy_version is distinct from new.privacy_version
  or receipt.terms_content_sha256 is distinct from new.terms_content_sha256 or receipt.privacy_content_sha256 is distinct from new.privacy_content_sha256
  or receipt.accepted_at>intent.created_at or new.bound_at>clock_timestamp()
  then raise exception 'service_error_contract_binding_invalid'; end if;
 return new;
end $$;
create trigger ap_service_error_contract_binding before insert on public.ap_service_error_contracts for each row execute function public.ap_guard_service_error_contract();

create function public.ap_service_error_contract_json(p_line uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('materialLineId',material_line_id,'customerId',customer_id,'purchaseId',purchase_id,'sourceSnapshotId',source_snapshot_id,
 'legalReceiptId',legal_receipt_id,'intakeReviewId',intake_review_id,'intakeReviewSha256',intake_review_sha256,'contractVersion',contract_version,
 'termsVersion',terms_version,'termsContentSha256',terms_content_sha256,'privacyVersion',privacy_version,'privacyContentSha256',privacy_content_sha256,
 'confirmedIntakeVersion',confirmed_intake_version,'reportingTimeZone',reporting_time_zone,'boundAt',bound_at)
 from public.ap_service_error_contracts where material_line_id=p_line;
$$;
create function public.ap_service_error_deadline(p_delivered_at timestamptz) returns timestamptz
language sql immutable set search_path='' as $$
 select ((p_delivered_at at time zone 'America/New_York')+interval '3 days') at time zone 'America/New_York';
$$;

-- The new process binds a specific immutable091 file-to-release member. Merely
-- belonging to an artifact that was once released does not prove this version.
create function public.ap_service_error_member(p_customer uuid,p_member jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if jsonb_typeof(p_member) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p_member) key)
  is distinct from array['artifactId','fileVersionId','releaseId']::text[] then raise exception 'service_error_delivery_invalid'; end if;
 select jsonb_build_object('artifactId',a.id,'fileVersionId',f.id,'releaseId',r.id,'materialLineId',a.material_line_id,
  'sourceSnapshotId',a.source_snapshot_id,'checksumSha256',f.checksum_sha256,'deliveredAt',r.committed_at) into result
 from public.ap_generated_artifacts a join public.ap_generated_file_versions f on f.artifact_id=a.id
 join public.ap_material_draft_members m on m.artifact_id=a.id and m.file_version_id=f.id
 join public.ap_material_draft_versions v on v.id=m.draft_version_id
 join public.ap_releases r on r.id=v.release_id and r.customer_id=a.customer_id and r.material_line_id=a.material_line_id
 join public.ap_release_members rm on rm.release_id=r.id and rm.member_type='GENERATED_ARTIFACT' and rm.member_id=a.id
 where a.id=(p_member->>'artifactId')::uuid and f.id=(p_member->>'fileVersionId')::uuid and r.id=(p_member->>'releaseId')::uuid
  and a.customer_id=p_customer and m.customer_id=p_customer and v.customer_id=p_customer
  and m.material_line_id=v.material_line_id and v.material_line_id=a.material_line_id
  and m.artifact_type=a.artifact_type and m.source_sha256=v.source_sha256
  and m.file_sha256=f.checksum_sha256 and r.committed_at<=clock_timestamp();
 if result is null then raise exception 'service_error_delivery_invalid'; end if;
 return result;
end $$;

create function public.ap_service_error_lock(p_customer uuid,p_line uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'service_error_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||p_customer::text,0));
 if exists(select 1 from public.ap_service_retention_claims where customer_id=p_customer and state='PENDING') then raise exception 'service_retention_purge_committed'; end if;
 perform 1 from public.ap_material_lines l join public.ap_material_purchases p on p.id=l.purchase_id
  where l.id=p_line and p.customer_id=p_customer for update of l;
 if not found then raise exception 'service_error_line_unavailable'; end if;
end $$;

create function public.ap_material_service_error_context(p_customer_id uuid,p_material_line_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.ap_service_error_contracts; first_delivery timestamptz; files jsonb;
begin
 perform public.ap_service_error_lock(p_customer_id,p_material_line_id);
 select * into c from public.ap_service_error_contracts where material_line_id=p_material_line_id and customer_id=p_customer_id;
 if c.material_line_id is null then raise exception 'service_error_historical_flow_required'; end if;
 select min(r.committed_at) into first_delivery from public.ap_releases r where r.material_line_id=c.material_line_id and r.release_kind in('MATERIAL_PAIR','MATERIAL_TRIPLE');
 select coalesce(jsonb_agg(jsonb_build_object('artifactId',m.artifact_id,'fileVersionId',m.file_version_id,'releaseId',v.release_id,
  'checksumSha256',m.file_sha256,'deliveredAt',r.committed_at,'artifactType',m.artifact_type,'safeFilename',f.safe_filename) order by r.committed_at,m.artifact_type),'[]') into files
 from public.ap_material_draft_members m join public.ap_material_draft_versions v on v.id=m.draft_version_id
 join public.ap_generated_file_versions f on f.id=m.file_version_id and f.checksum_sha256=m.file_sha256
 join public.ap_releases r on r.id=v.release_id where m.material_line_id=c.material_line_id and m.customer_id=p_customer_id;
 if first_delivery is null or jsonb_array_length(files)=0 then raise exception 'service_error_delivery_invalid'; end if;
 return jsonb_build_object('scope',jsonb_build_object('materialLineId',c.material_line_id,'customerId',c.customer_id,'purchaseId',c.purchase_id,
  'sourceSnapshotId',c.source_snapshot_id,'acceptedTermsVersion',c.terms_version,'acceptedPrivacyVersion',c.privacy_version),
  'contract',public.ap_service_error_contract_json(c.material_line_id),'reportDeadline',public.ap_service_error_deadline(first_delivery),'files',files,
  'existingReport',(select public.ap_read_material_service_error_report(p_customer_id,request_id) from public.ap_service_error_reports where material_line_id=c.material_line_id and customer_id=p_customer_id));
end $$;
create function public.ap_read_material_service_error_report(p_customer_id uuid,p_request_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('caseId',r.id,'requestId',r.request_id,'customerId',r.customer_id,'materialLineId',r.material_line_id,
  'payloadId',r.sensitive_payload_id,'reportSha256',r.report_sha256,'reportDeadline',r.report_deadline,'reportedAt',r.reported_at,'state',s.state,
  'latestDecisionId',(select id from public.ap_service_error_decisions where case_id=r.id order by version desc limit 1),
  'members',(select jsonb_agg(jsonb_build_object('artifactId',artifact_id,'fileVersionId',file_version_id,'releaseId',release_id) order by position)
   from public.ap_service_error_affected_members where case_id=r.id and member_kind='REPORTED'))
 from public.ap_service_error_reports r join public.ap_material_support_cases s on s.id=r.id where r.customer_id=p_customer_id and r.request_id=p_request_id;
$$;
create function public.ap_open_material_service_error_report(p_customer_id uuid,p_request_id uuid,p_material_line_id uuid,p_payload_id uuid,p_report_sha256 text,p_members jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior jsonb; ctx jsonb; member jsonb; bound jsonb; case_id uuid:=gen_random_uuid(); at_time timestamptz:=clock_timestamp(); i integer:=0;
begin
 if p_request_id is null or p_report_sha256 is null or p_report_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_members) is distinct from 'array'
  or jsonb_array_length(p_members) not between 1 and 3 or (select count(distinct value->>'fileVersionId') from jsonb_array_elements(p_members))<>jsonb_array_length(p_members)
  then raise exception 'service_error_report_invalid'; end if;
 perform public.ap_service_error_lock(p_customer_id,p_material_line_id);
 prior:=public.ap_read_material_service_error_report(p_customer_id,p_request_id);
 if prior is not null then
  if prior->>'materialLineId' is distinct from p_material_line_id::text or prior->>'payloadId' is distinct from p_payload_id::text
   or prior->>'reportSha256' is distinct from p_report_sha256 or prior->'members' is distinct from p_members then raise exception 'service_error_report_identity_conflict'; end if;
  return prior;
 end if;
 ctx:=public.ap_material_service_error_context(p_customer_id,p_material_line_id);at_time:=clock_timestamp();
 if at_time>(ctx->>'reportDeadline')::timestamptz then raise exception 'service_error_report_window_closed'; end if;
 if exists(select 1 from public.ap_service_error_reports where material_line_id=p_material_line_id) then raise exception 'service_error_grouped_request_already_recorded'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=p_customer_id and content_sha256=p_report_sha256 and retention_state='ACTIVE')
  then raise exception 'service_error_payload_invalid'; end if;
 for member in select value from jsonb_array_elements(p_members) loop
  bound:=public.ap_service_error_member(p_customer_id,member);
  if bound->>'materialLineId' is distinct from p_material_line_id::text then raise exception 'service_error_delivery_invalid'; end if;
 end loop;
 insert into public.ap_material_support_cases(id,customer_id,material_line_id,artifact_id,sensitive_payload_id,case_kind,state,non_sensitive_fact_diff,opened_at)
 values(case_id,p_customer_id,p_material_line_id,(p_members->0->>'artifactId')::uuid,p_payload_id,'SERVICE_ERROR_REPORT','OPEN',
  jsonb_build_object('reportSha256',p_report_sha256,'contractVersion','service-error-only-v1'),at_time);
 insert into public.ap_service_error_reports values(case_id,p_customer_id,p_material_line_id,p_request_id,p_payload_id,p_report_sha256,(ctx->>'reportDeadline')::timestamptz,at_time);
 for member in select value from jsonb_array_elements(p_members) loop
  bound:=public.ap_service_error_member(p_customer_id,member);i:=i+1;
  insert into public.ap_service_error_affected_members(case_id,customer_id,material_line_id,source_snapshot_id,artifact_id,file_version_id,release_id,position,member_kind)
  values(case_id,p_customer_id,p_material_line_id,(bound->>'sourceSnapshotId')::uuid,(member->>'artifactId')::uuid,(member->>'fileVersionId')::uuid,(member->>'releaseId')::uuid,i,'REPORTED');
 end loop;
 return public.ap_read_material_service_error_report(p_customer_id,p_request_id);
end $$;

create function public.ap_read_material_service_error_decision(p_reviewer_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select jsonb_build_object('decisionId',id,'requestId',request_id,'caseId',case_id,'customerId',customer_id,'materialLineId',material_line_id,
  'payloadId',sensitive_payload_id,'reviewSha256',review_sha256,'previousDecisionId',previous_decision_id,'reviewerId',reviewer_id,
  'classification',classification,'reasonCode',reason_code,'evidence',evidence,'affected',affected,'decidedAt',decided_at) into result
 from public.ap_service_error_decisions where request_id=p_request_id and reviewer_id=p_reviewer_id;
 return result;
end $$;
create function public.ap_inspect_material_service_error(p_reviewer_id uuid,p_case_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare report public.ap_service_error_reports;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into report from public.ap_service_error_reports where id=p_case_id;
 if report.id is null then raise exception 'service_error_case_unavailable'; end if;
 perform public.ap_service_error_lock(report.customer_id,report.material_line_id);
 return jsonb_build_object('report',public.ap_read_material_service_error_report(report.customer_id,report.request_id),
  'contract',public.ap_service_error_contract_json(report.material_line_id),'decisions',coalesce((select jsonb_agg(
   jsonb_build_object('decisionId',id,'requestId',request_id,'caseId',case_id,'customerId',customer_id,'materialLineId',material_line_id,
    'payloadId',sensitive_payload_id,'reviewSha256',review_sha256,'previousDecisionId',previous_decision_id,'reviewerId',reviewer_id,
    'classification',classification,'reasonCode',reason_code,'evidence',evidence,'affected',affected,'decidedAt',decided_at) order by version)
   from public.ap_service_error_decisions where case_id=report.id),'[]'));
end $$;

create function public.ap_record_material_service_error_decision(p_reviewer_id uuid,p_case_id uuid,p_request_id uuid,p_previous_decision_id uuid,
 p_payload_id uuid,p_review_sha256 text,p_classification text,p_reason_code text,p_evidence jsonb,p_affected jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare report public.ap_service_error_reports; support public.ap_material_support_cases; prior jsonb; latest public.ap_service_error_decisions;
 item jsonb; member jsonb; bound jsonb; fact uuid; document uuid; decision_id uuid:=gen_random_uuid(); i integer:=0;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into report from public.ap_service_error_reports where id=p_case_id;
 if report.id is null then raise exception 'service_error_case_unavailable'; end if;
 perform public.ap_service_error_lock(report.customer_id,report.material_line_id);
 prior:=public.ap_read_material_service_error_decision(p_reviewer_id,p_request_id);
 if prior is not null then
  if prior->>'caseId' is distinct from p_case_id::text or prior->>'previousDecisionId' is distinct from p_previous_decision_id::text
   or prior->>'payloadId' is distinct from p_payload_id::text or prior->>'reviewSha256' is distinct from p_review_sha256
   or prior->>'classification' is distinct from p_classification or prior->>'reasonCode' is distinct from p_reason_code
   or prior->'evidence' is distinct from p_evidence or prior->'affected' is distinct from p_affected then raise exception 'service_error_decision_identity_conflict'; end if;
  return prior;
 end if;
 select * into support from public.ap_material_support_cases where id=report.id for update;
 select * into latest from public.ap_service_error_decisions where case_id=report.id order by version desc limit 1;
 if support.state is distinct from 'OPEN' or latest.id is distinct from p_previous_decision_id then raise exception 'service_error_case_changed'; end if;
 if p_request_id is null or p_review_sha256 is null or p_review_sha256 !~ '^[a-f0-9]{64}$'
  or jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence) not between 1 and 30
  or jsonb_typeof(p_affected) is distinct from 'array' or jsonb_array_length(p_affected)>30
  or (p_classification='CONFIRMED_SERVICE_ERROR') is distinct from (jsonb_array_length(p_affected)>0)
  or (p_classification,p_reason_code) not in(('CONFIRMED_SERVICE_ERROR','CONFIRMED_SOURCE_MISMATCH'),('CONFIRMED_SERVICE_ERROR','UNSUPPORTED_GENERATED_CLAIM'),
   ('CONFIRMED_SERVICE_ERROR','MATERIAL_MISREPRESENTATION'),('CUSTOMER_INPUT_CHANGE','CUSTOMER_CONFIRMED_VALUE'),('CUSTOMER_INPUT_CHANGE','NEW_OR_OMITTED_INFORMATION'),
   ('EDITORIAL_REQUEST','WORDING_OR_SELECTION_PREFERENCE'),('EVIDENCE_INVESTIGATION','CONFIRMATION_OR_PARSER_UNCLEAR'),('EVIDENCE_INVESTIGATION','EVIDENCE_MISSING'))
  then raise exception 'service_error_decision_invalid'; end if;
 if latest.classification='CONFIRMED_SERVICE_ERROR' and p_classification<>'CONFIRMED_SERVICE_ERROR' then raise exception 'service_error_accepted_repair_unfinished'; end if;
 if latest.classification='CONFIRMED_SERVICE_ERROR' and not (p_affected @> latest.affected) then raise exception 'service_error_accepted_repair_scope_missing'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=report.customer_id and content_sha256=p_review_sha256 and retention_state='ACTIVE')
  then raise exception 'service_error_payload_invalid'; end if;
 for item in select value from jsonb_array_elements(p_evidence) loop
  if (select array_agg(key order by key) from jsonb_object_keys(item) key) is distinct from array['artifactId','documentVersionIds','fileVersionId','releaseId','sourceFactIds','sourceSnapshotId']::text[]
   or jsonb_typeof(item->'sourceFactIds') is distinct from 'array' or jsonb_array_length(item->'sourceFactIds')>30
   or jsonb_typeof(item->'documentVersionIds') is distinct from 'array' or jsonb_array_length(item->'documentVersionIds')>10 then raise exception 'service_error_evidence_invalid'; end if;
  bound:=public.ap_service_error_member(report.customer_id,item-array['sourceSnapshotId','sourceFactIds','documentVersionIds']);
  if bound->>'sourceSnapshotId' is distinct from item->>'sourceSnapshotId' then raise exception 'service_error_evidence_invalid'; end if;
  for fact in select value::uuid from jsonb_array_elements_text(item->'sourceFactIds') loop
   if not exists(select 1 from public.ap_candidate_facts f where f.id=fact and f.customer_id=report.customer_id
    and (f.snapshot_id=(item->>'sourceSnapshotId')::uuid or f.semantic_key='document_contact.confirmed'
     and exists(select 1 from public.ap_material_lines l join public.ap_material_checkout_intents ci on ci.purchase_id=l.purchase_id
      where l.id=(bound->>'materialLineId')::uuid and ci.source_snapshot_id=f.snapshot_id and ci.contact_payload_id=f.id))) then raise exception 'service_error_evidence_invalid'; end if;
  end loop;
  for document in select value::uuid from jsonb_array_elements_text(item->'documentVersionIds') loop
   if not exists(select 1 from public.ap_document_versions d join public.ap_candidate_facts f on f.document_version_id=d.id
    where d.id=document and f.snapshot_id=(item->>'sourceSnapshotId')::uuid and f.customer_id=report.customer_id
     and f.id in(select value::uuid from jsonb_array_elements_text(item->'sourceFactIds'))) then raise exception 'service_error_evidence_invalid'; end if;
  end loop;
 end loop;
 if (select count(distinct value->>'fileVersionId') from jsonb_array_elements(p_affected))<>jsonb_array_length(p_affected) then raise exception 'service_error_evidence_invalid'; end if;
 for member in select value from jsonb_array_elements(p_affected) loop
  bound:=public.ap_service_error_member(report.customer_id,member);
  if not exists(select 1 from jsonb_array_elements(p_evidence) e where e-array['sourceSnapshotId','sourceFactIds','documentVersionIds']=member) then raise exception 'service_error_evidence_invalid'; end if;
 end loop;
 insert into public.ap_service_error_decisions values(decision_id,p_request_id,report.id,report.customer_id,report.material_line_id,latest.id,coalesce(latest.version,0)+1,
  p_payload_id,p_review_sha256,p_classification,p_reason_code,p_evidence,p_affected,p_reviewer_id,clock_timestamp());
 for member in select value from jsonb_array_elements(p_affected) loop
  bound:=public.ap_service_error_member(report.customer_id,member);i:=i+1;
  insert into public.ap_service_error_affected_members(case_id,decision_id,customer_id,material_line_id,source_snapshot_id,artifact_id,file_version_id,release_id,position,member_kind)
  values(report.id,decision_id,report.customer_id,(bound->>'materialLineId')::uuid,(bound->>'sourceSnapshotId')::uuid,(member->>'artifactId')::uuid,
   (member->>'fileVersionId')::uuid,(member->>'releaseId')::uuid,i,'ACCEPTED_ERROR');
 end loop;
 if p_classification in('CUSTOMER_INPUT_CHANGE','EDITORIAL_REQUEST') then
  update public.ap_material_support_cases set state='RESOLVED',resolved_by=p_reviewer_id,resolved_at=clock_timestamp() where id=report.id;
 end if;
 return public.ap_read_material_service_error_decision(p_reviewer_id,p_request_id);
end $$;

-- Open reported/accepted defects protect the exact affected order family. They
-- never extend downloads or the original optional-purchase cutoff themselves.
alter function public.ap_service_retention_order_protected(uuid) rename to ap_service_retention_order_protected_before_096;
create function public.ap_service_retention_order_protected(p_order_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.ap_service_retention_order_protected_before_096(p_order_id) or exists(
  select 1 from public.ap_service_error_affected_members m join public.ap_material_support_cases s on s.id=m.case_id
  join public.ap_material_lines l on l.id=m.material_line_id where l.delivered_order_id=p_order_id and s.state='OPEN');
$$;
insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values
 ('ap_service_error_contracts','material_line_id','{}'),('ap_service_error_reports','id','{}'),
 ('ap_service_error_decisions','id','{}'),('ap_service_error_affected_members','id','{}');
do $$ declare name text; f record; begin
 foreach name in array array['ap_service_error_contracts','ap_service_error_reports','ap_service_error_decisions','ap_service_error_affected_members'] loop
  execute format('alter table public.%I enable row level security',name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',name);
  execute format('grant select on public.%I to service_role',name);
  execute format('create trigger ap_service_retention_write before insert or update on public.%I for each row execute function public.ap_guard_service_retention_write()',name);
  execute format('create trigger ap_service_error_history before update or delete on public.%I for each row execute function public.ap_guard_service_error_history()',name);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and (p.proname like 'ap_%service_error%' or p.proname in('ap_service_retention_order_protected','ap_service_retention_order_protected_before_096')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('alter function %s set lock_timeout=''5s''',f.signature);
  if f.proname in('ap_material_service_error_context','ap_read_material_service_error_report','ap_open_material_service_error_report',
   'ap_read_material_service_error_decision','ap_inspect_material_service_error','ap_record_material_service_error_decision','ap_service_retention_order_protected')
   then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250096','SERVICE_ERROR_CONTRACT_AND_TRIAGE',0,clock_timestamp());
create function public.ap_service_error_triage_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250096' and checkpoint='SERVICE_ERROR_CONTRACT_AND_TRIAGE')
 and (select count(*)=4 from public.ap_retention_private_tables where table_name in(
  'ap_service_error_contracts','ap_service_error_reports','ap_service_error_decisions','ap_service_error_affected_members') and redaction_patch='{}')
 and to_regprocedure('public.ap_open_material_service_error_report(uuid,uuid,uuid,uuid,text,jsonb)') is not null
 and to_regprocedure('public.ap_record_material_service_error_decision(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)') is not null
 and position('ap_service_error_affected_members' in pg_get_functiondef('public.ap_service_retention_order_protected(uuid)'::regprocedure))>0
 and not has_table_privilege('service_role','public.ap_service_error_contracts','INSERT')
 and not has_table_privilege('authenticated','public.ap_service_error_reports','SELECT');
$$;
revoke all on function public.ap_service_error_triage_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_service_error_triage_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=19 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250095''' in definition)=0
  or position('(''202610250095'',''REFERENCE_AWARE_DRAFT_DELIVERY'')' in definition)=0 or position('''202610250094'',''202610250095''' in definition)=0
  then raise exception 'service_error_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=19 as installed','select count(*)=20 as installed');
 definition:=replace(definition,'(''202610250095'',''REFERENCE_AWARE_DRAFT_DELIVERY'')','(''202610250095'',''REFERENCE_AWARE_DRAFT_DELIVERY''),(''202610250096'',''SERVICE_ERROR_CONTRACT_AND_TRIAGE'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250095''','''requiredSchemaVersion'', ''202610250096''');
 definition:=replace(definition,'''202610250094'',''202610250095''','''202610250094'',''202610250095'',''202610250096''');
 definition:=replace(definition,'public.ap_reference_aware_draft_schema_installed()','public.ap_reference_aware_draft_schema_installed() and public.ap_service_error_triage_schema_installed()');
 execute definition;
end $$;
commit;
