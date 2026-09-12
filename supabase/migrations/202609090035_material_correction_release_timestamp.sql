-- Forward repair: ap_releases records the delivery commit as committed_at.
-- Migration 034 was already applied to staging before the transactional fixture exposed this reference.
create or replace function public.ap_open_postdelivery_false_claim_case(
  p_customer_id uuid,p_material_line_id uuid,p_artifact_id uuid,p_sensitive_payload_id uuid,
  p_non_sensitive_report jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases;
  case_id uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp(); release_at timestamptz;
begin
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select max(release.committed_at) into release_at
  from public.ap_generated_artifacts artifact
  join public.ap_release_members member on member.member_id=artifact.id and member.member_type='GENERATED_ARTIFACT'
  join public.ap_releases release on release.id=member.release_id and release.material_line_id=line_row.id
  where artifact.id=p_artifact_id and artifact.material_line_id=line_row.id
    and artifact.customer_id=p_customer_id;
  if purchase.customer_id<>p_customer_id or line_row.fulfillment<>'DELIVERED'
    or jsonb_typeof(p_non_sensitive_report)<>'object' or p_non_sensitive_report='{}'::jsonb
    or not exists(select 1 from public.ap_sensitive_payloads
      where id=p_sensitive_payload_id and customer_id=p_customer_id)
    or release_at is null
    then raise exception 'included_correction_case_invalid'; end if;
  if release_at < now_at-interval '3 days' then
    raise exception 'included_correction_window_closed';
  end if;
  if exists(select 1 from public.ap_material_support_cases
      where material_line_id=line_row.id and case_kind='INCLUDED_FACTUAL_CORRECTION') then
    raise exception 'included_correction_round_already_used';
  end if;
  update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    where file.artifact_id=p_artifact_id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(invalidated_at,now_at)
    from public.ap_generated_file_versions file where quality.file_version_id=file.id
      and file.artifact_id=p_artifact_id;
  insert into public.ap_material_support_cases(
    id,customer_id,material_line_id,artifact_id,sensitive_payload_id,case_kind,state,non_sensitive_fact_diff,opened_at
  ) values(case_id,p_customer_id,line_row.id,p_artifact_id,p_sensitive_payload_id,
    'INCLUDED_FACTUAL_CORRECTION','OPEN',p_non_sensitive_report,now_at);
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'INCLUDED_MATERIAL_CORRECTION_OPENED','MATERIAL_SUPPORT_CASE',case_id,
    jsonb_build_object('materialLineId',line_row.id,'artifactId',p_artifact_id,
      'includedRound',1,'requestWithinDays',3,'downloadsRevoked',true),'final-integration-v1');
  return case_id;
end;
$$;
