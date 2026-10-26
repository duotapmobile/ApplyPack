-- Native/isolated PG17 only: reproduce Supabase's application-owner versus
-- Storage-owner distinction. This transaction never changes deployed grants.
begin;
-- The native stand-in must also model the provider's statement guard, which
-- runs before ApplyPack's row fence. These synthetic objects roll back too.
create function storage.ap_archive_fixture_protect_delete() returns trigger language plpgsql as $$
begin
 if coalesce(current_setting('storage.allow_delete_query',true),'false')<>'true' then
  raise exception 'fixture_storage_api_context_required' using errcode='42501';
 end if;
 return null;
end $$;
create trigger ap_archive_fixture_protect_delete before delete on storage.objects for each statement execute function storage.ap_archive_fixture_protect_delete();
create role ap_archive_fixture_non_owner nologin nosuperuser bypassrls;
grant usage on schema auth,storage,extensions to ap_archive_fixture_non_owner;
grant usage,create on schema public to ap_archive_fixture_non_owner;
grant select,insert,update,delete on all tables in schema public to ap_archive_fixture_non_owner;
grant usage,select on all sequences in schema public to ap_archive_fixture_non_owner;
grant execute on all functions in schema public to ap_archive_fixture_non_owner;
grant select,insert,update,delete on storage.objects,storage.buckets to ap_archive_fixture_non_owner;
alter table public.ap_unpaid_source_cleanup owner to ap_archive_fixture_non_owner;
alter function public.ap_retention_snapshot_customers(uuid) owner to ap_archive_fixture_non_owner;
set local role ap_archive_fixture_non_owner;
set local storage.allow_delete_query='false';
do $$ begin
 if (select rolsuper from pg_roles where rolname=current_user)
  or pg_has_role(current_user,(select relowner from pg_class where oid='storage.objects'::regclass),'MEMBER')
  then raise exception 'archive_non_owner_fixture_boundary_missing'; end if;
 begin
  alter table storage.objects disable trigger ap_archive_source_mutation;
  raise exception 'non_owner_could_disable_storage_fence';
 exception when insufficient_privilege then null; end;
 begin
  delete from storage.objects where false;
  raise exception 'provider_delete_guard_missing_from_fixture';
 exception when insufficient_privilege then null; end;
end $$;
-- The included fixture rolls back this entire outer transaction, including
-- the temporary role/ownership changes. Its own BEGIN is intentionally nested.
\ir protected-archive-lifecycle.sql
select 'PROTECTED_ARCHIVE_NON_OWNER_BOUNDARY_OK';
