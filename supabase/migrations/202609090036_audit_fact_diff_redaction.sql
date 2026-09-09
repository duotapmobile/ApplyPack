-- Customer correction content belongs in encrypted payloads and proposal records,
-- never in the operational audit stream. Preserve only a non-content field count.
create or replace function public.ap_scrub_audit_fact_diff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare field_count integer:=0;
begin
  if new.non_sensitive_details ? 'factDiff' then
    if jsonb_typeof(new.non_sensitive_details->'factDiff')='object' then
      select count(*) into field_count
      from jsonb_object_keys(new.non_sensitive_details->'factDiff');
    end if;
    new.non_sensitive_details=(new.non_sensitive_details-'factDiff')
      || jsonb_build_object('factDiffFieldCount',field_count);
  end if;
  return new;
end;
$$;

drop trigger if exists ap_scrub_audit_fact_diff_trigger on public.ap_audit_events;
create trigger ap_scrub_audit_fact_diff_trigger
before insert on public.ap_audit_events
for each row execute function public.ap_scrub_audit_fact_diff();

revoke all on function public.ap_scrub_audit_fact_diff() from public,anon,authenticated;
grant execute on function public.ap_scrub_audit_fact_diff() to service_role;

comment on function public.ap_scrub_audit_fact_diff() is
  'Removes customer factual-correction values from immutable audit events before storage.';
