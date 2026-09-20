-- Preserve releases and files, revoke new downloads/approvals when cited truth changes.
begin;

create or replace function public.ap_invalidate_materials_for_candidate_fact()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.superseded_at is not distinct from old.superseded_at
    and new.verification is not distinct from old.verification then return new; end if;
  if new.superseded_at is null and new.verification in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED') then return new; end if;
  update public.ap_generated_file_versions file
    set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
    from public.ap_generated_artifacts artifact
    where artifact.id=file.artifact_id and artifact.customer_id=new.customer_id
      and (artifact.claim_provenance#>'{sourceBinding,candidateFactIds}') @> jsonb_build_array(new.id::text);
  update public.ap_artifact_quality_reviews review set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
    from public.ap_generated_file_versions file, public.ap_generated_artifacts artifact
    where review.file_version_id=file.id and file.artifact_id=artifact.id and artifact.customer_id=new.customer_id
      and (artifact.claim_provenance#>'{sourceBinding,candidateFactIds}') @> jsonb_build_array(new.id::text);
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
    values(new.customer_id,'MATERIAL_FACT_DEPENDENCY_INVALIDATED','CANDIDATE_FACT',new.id,
      jsonb_build_object('regenerationRequired',true),'master-production-v1');
  return new;
end;
$$;
create trigger ap_material_fact_dependency_changed
after update of superseded_at,verification on public.ap_candidate_facts
for each row execute function public.ap_invalidate_materials_for_candidate_fact();

-- Also reject new file registration/approval against facts already superseded.
create or replace function public.ap_guard_material_file_fact_bindings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare artifact public.ap_generated_artifacts; fact_id text; fact public.ap_candidate_facts;
begin
  if new.downloads_revoked_at is not null or new.superseded_at is not null then return new; end if;
  select * into artifact from public.ap_generated_artifacts where id=new.artifact_id;
  if artifact.material_line_id is null then return new; end if;
  for fact_id in select jsonb_array_elements_text(coalesce(artifact.claim_provenance#>'{sourceBinding,candidateFactIds}','[]'::jsonb)) loop
    select * into fact from public.ap_candidate_facts where id=fact_id::uuid for share;
    if fact.id is null or fact.customer_id is distinct from artifact.customer_id
      or fact.snapshot_id is distinct from artifact.source_snapshot_id
      or fact.superseded_at is not null or fact.verification not in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
      then raise exception 'material_candidate_fact_binding_stale'; end if;
  end loop;
  return new;
end;
$$;
create trigger ap_material_file_fact_binding_guard
before insert or update on public.ap_generated_file_versions
for each row execute function public.ap_guard_material_file_fact_bindings();

revoke all on function public.ap_invalidate_materials_for_candidate_fact() from public,anon,authenticated;
revoke all on function public.ap_guard_material_file_fact_bindings() from public,anon,authenticated;
commit;
