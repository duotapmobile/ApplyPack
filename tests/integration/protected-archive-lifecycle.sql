-- Fictional local maintenance state only. No S3/provider operations.
begin;
-- Rollback-only fixture models the Storage API's delete transaction context.
-- Supabase's provider-owned statement guard otherwise rejects before our row
-- fence can run. No deployed trigger/role is altered by this setting.
-- https://github.com/supabase/storage/blob/master/migrations/tenant/0055-prevent-direct-deletes.sql
set local storage.allow_delete_query='true';
do $$ declare r jsonb; receipt jsonb; original_heartbeat jsonb; checked_at timestamptz; relation record; blocked boolean; original_helper text; writer uuid:='f9800000-0000-4000-8000-000000000001';
 run_id uuid:='f9800000-0000-4000-8000-000000000002'; key text:='objects/customer-source-documents/'||repeat('b',64);
begin
 -- Upgrade rehearsals retain prior successful heartbeats. Cancellation must
 -- neither create success nor alter that historical evidence.
 select to_jsonb(heartbeat) into original_heartbeat from public.operational_heartbeats heartbeat
  where task_name='protected_recovery_retention';
 if not public.ap_protected_archive_schema_installed()
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' not in ('202610250098','202610250099','202610250100','202610250101','202610260102')
  or not (public.ap_manual_launch_schema_readiness()->'requiredMigrations' @> '["202610250096","202610250097","202610250098"]'::jsonb)
 then raise exception 'archive schema checkpoint not installed'; end if;
 if not public.ap_archive_fence_coverage_current() then raise exception 'archive fence coverage missing'; end if;
 -- Local Supabase's postgres test role owns application tables, not Storage.
 -- Exercise a disabled guard on our own table; Storage guards are verified by
 -- their catalog identity and by actual private/unrelated DML below.
 alter table public.ap_unpaid_source_cleanup disable trigger ap_archive_source_mutation;
 if public.ap_protected_archive_schema_installed() then raise exception 'disabled source fence was ready'; end if;
 alter table public.ap_unpaid_source_cleanup enable trigger ap_archive_source_mutation;
 delete from public.ap_archive_fence_relations where schema_name='storage' and table_name='objects';
 if public.ap_archive_fence_coverage_current() then raise exception 'missing finite storage roster accepted'; end if;
 insert into public.ap_archive_fence_relations values('storage','objects');
 if exists(select 1 from public.ap_archive_lifecycle_configuration where enabled) then raise exception 'archive lifecycle unexpectedly enabled'; end if;
 begin perform public.ap_begin_archive_retention(run_id,repeat('a',40)); raise exception 'disabled lifecycle admitted';
 exception when others then if sqlerrm<>'archive_lifecycle_disabled_or_unverified' then raise; end if; end;
 update public.ap_archive_lifecycle_configuration set enabled=true;
 original_helper:=pg_get_functiondef('public.ap_retention_snapshot_customers(uuid)'::regprocedure);
 execute $changed$create or replace function public.ap_retention_snapshot_customers(p_snapshot uuid) returns uuid[] language sql stable security definer set search_path='' as 'select array[]::uuid[]'$changed$;
 if public.ap_archive_fence_coverage_current() then raise exception 'transitive helper drift was accepted'; end if;
 begin perform public.ap_begin_archive_retention(run_id,repeat('a',40)); raise exception 'changed ownership helper admitted';
 exception when others then if sqlerrm<>'archive_lifecycle_disabled_or_unverified' then raise; end if; end;
 execute original_helper;
 if not public.ap_archive_fence_coverage_current() then raise exception 'restored helper was not recognized'; end if;
 insert into storage.buckets(id,name) values('archive-unrelated-fixture','archive-unrelated-fixture');
 if (select count(*) from storage.buckets where id in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews'))<>4 then raise exception 'four private bucket fixture prerequisites absent'; end if;
 insert into storage.objects(bucket_id,name) select id,'archive-fixture' from storage.buckets where id in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews');
 r:=public.ap_begin_archive_writer(writer,'DATABASE',repeat('a',40));
 if r->>'state'<>'OPEN' then raise exception 'writer did not open'; end if;
 begin perform public.ap_begin_archive_retention(run_id,repeat('a',40)); raise exception 'open writer did not block';
 exception when serialization_failure then if sqlerrm<>'archive_writer_reconciliation_required' then raise; end if; end;
 perform public.ap_dispatch_archive_writer(writer);
 begin perform public.ap_finish_archive_writer(writer,repeat('b',64),true); raise exception 'uncertain writer canceled';
 exception when others then if sqlerrm<>'archive_writer_reconciliation_required' then raise; end if; end;
 begin perform public.ap_finish_archive_writer(writer,repeat('b',64)); raise exception 'opaque writer hash counted as completion';
 exception when others then if sqlerrm<>'archive_writer_receipt_shape' then raise; end if; end;
 checked_at:=clock_timestamp();
 receipt:=jsonb_build_object('schemaVersion','applypack-archive-writer-completion-v1','runId',writer,'kind','DATABASE',
  'releaseSha',repeat('a',40),'sourceProjectRef','spjaaxndiduhrcleazwb','snapshotSchemaVersion','202610250098',
  'sourceWatermark',checked_at-interval '1 second','databaseSnapshotAt',checked_at,'verifiedAt',checked_at,
  'evidenceExpiresAt',checked_at+interval '14 minutes 59 seconds','manifestSha256',repeat('b',64),'manifestVersionId','db-v1',
  'inventoryDigest',repeat('c',64),'pairedFileManifestSha256',repeat('d',64),'pairedFileManifestVersionId','file-v1',
  'applicationCheckpointSha256',repeat('e',64),'providerVerificationSha256',repeat('f',64));
 begin perform public.ap_finish_archive_writer(writer,repeat('b',64),false,receipt); raise exception 'wrong receipt hash counted as completion';
 exception when others then if sqlerrm<>'archive_writer_receipt_binding' then raise; end if; end;
 r:=public.ap_finish_archive_writer(writer,public.ap_archive_writer_receipt_sha256(receipt),false,receipt);
 if r->'completion_receipt' is distinct from receipt or public.ap_latest_verified_database_archive() is distinct from r then raise exception 'verified completion metadata missing'; end if;
 r:=public.ap_begin_archive_retention(run_id,repeat('a',40));
 if r->>'state'<>'FENCED' or public.ap_begin_archive_retention(run_id,repeat('a',40))<>r then raise exception 'fence replay changed'; end if;
 -- Each private bucket is fenced, while unrelated Storage remains usable.
 for relation in select id from storage.buckets where id in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews') loop
  begin insert into storage.objects(bucket_id,name) values(relation.id,'late-object'); raise exception 'private object inserted through fence';
  exception when serialization_failure then null; end;
  begin update storage.objects set name='moved' where bucket_id=relation.id; raise exception 'private object changed through fence';
  exception when serialization_failure then null; end;
  begin delete from storage.objects where bucket_id=relation.id; raise exception 'private object deleted through fence';
  exception when serialization_failure then null; end;
  begin update storage.buckets set public=true where id=relation.id; raise exception 'private bucket changed through fence';
  exception when serialization_failure then null; end;
 end loop;
 insert into storage.objects(bucket_id,name) values('archive-unrelated-fixture','allowed');
 update storage.objects set name='still-allowed' where bucket_id='archive-unrelated-fixture';
 delete from storage.objects where bucket_id='archive-unrelated-fixture';
 -- Every installed relation blocks actual SQL mutation, even a new empty alias
 -- statement. This includes paid obligations, holds and the private registry.
 for relation in select f.*,a.attname from public.ap_archive_fence_relations f
  join pg_class c on c.oid=to_regclass(format('%I.%I',f.schema_name,f.table_name))
  join lateral(select attname from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped and attgenerated='' and attidentity='' order by attnum limit 1)a on true
  where f.schema_name='public' loop
   blocked:=false;
   begin execute format('update public.%I set %I=%I where false',relation.table_name,relation.attname,relation.attname);
   exception when serialization_failure then blocked:=sqlerrm='archive_maintenance_retry_required'; end;
   if not blocked then raise exception 'unguarded archive source mutation:%',relation.table_name; end if;
 end loop;
 begin perform public.ap_begin_archive_writer('f9800000-0000-4000-8000-000000000003','FILE',repeat('a',40)); raise exception 'writer started through fence';
 exception when serialization_failure then if sqlerrm<>'archive_maintenance_retry_required' then raise; end if; end;
 begin perform public.ap_plan_archive_retention(run_id,repeat('b',64),repeat('c',64),repeat('d',64),jsonb_build_array(jsonb_build_object(
  'key','database/dumps/'||repeat('e',64)||'.dump','versionId','v1','identitySha256',repeat('f',64)))); raise exception 'database deletion accepted';
 exception when check_violation then null; end;
 perform public.ap_plan_archive_retention(run_id,repeat('b',64),repeat('c',64),repeat('d',64),jsonb_build_array(jsonb_build_object(
  'key',key,'versionId','v1','identitySha256',repeat('f',64))));
 -- Signature/account checking happens before webhook_events insertion in the
 -- real route; intake stays durable while fulfillment receives retryable errors.
 insert into public.webhook_events(provider,provider_event_id,event_type) values('stripe','evt_archive_fixture_late','checkout.session.completed');
 begin perform public.ap_dispatch_archive_retention_version(run_id,key,'v1',repeat('b',64)); raise exception 'late payment did not block delete';
 exception when serialization_failure then if sqlerrm<>'archive_payment_reconciliation_required' then raise; end if; end;
 if not exists(select 1 from public.webhook_events where provider_event_id='evt_archive_fixture_late' and processed_at is null) then raise exception 'late event lost'; end if;
 perform public.ap_finish_archive_retention(run_id,repeat('b',64),true);
 if (select to_jsonb(heartbeat) from public.operational_heartbeats heartbeat where task_name='protected_recovery_retention')
  is distinct from original_heartbeat then raise exception 'canceled cleanup changed success evidence'; end if;
 if public.ap_archive_fence_active() then raise exception 'undispatched canceled fence remained'; end if;
 -- Once source writes resume, the ordinary verified payment handler can retry.
 update public.webhook_events set processed_at=clock_timestamp() where provider_event_id='evt_archive_fixture_late';
end $$;
do $$ declare run_id uuid:='f9800000-0000-4000-8000-000000000004'; key text:='manifests/'||repeat('a',64)||'.json'; r jsonb; receipt jsonb; original_finish timestamptz;
begin
 perform public.ap_begin_archive_retention(run_id,repeat('a',40));
 perform public.ap_plan_archive_retention(run_id,repeat('b',64),repeat('c',64),repeat('d',64),jsonb_build_array(jsonb_build_object('key',key,'versionId','v1','identitySha256',repeat('f',64))));
 perform public.ap_dispatch_archive_retention_version(run_id,key,'v1',repeat('b',64));
 begin perform public.ap_dispatch_archive_retention_version(run_id,key,'v1',repeat('b',64)); raise exception 'delete redispatched';
 exception when others then if sqlerrm<>'archive_retention_dispatch_not_replayable' then raise; end if; end;
 r:=public.ap_finish_archive_retention(run_id,repeat('b',64),true);
 if r->>'state'<>'RECONCILIATION_REQUIRED' or not public.ap_archive_fence_active() then raise exception 'uncertain delete released fence'; end if;
 begin update public.ap_service_retention_holds set reason_code=reason_code where false; raise exception 'uncertain hold guard absent';
 exception when serialization_failure then null; end;
 perform public.ap_observe_archive_retention_absence(run_id,key,'v1',repeat('e',64));
 perform public.ap_observe_archive_retention_absence(run_id,key,'v1',repeat('e',64));
 begin perform public.ap_observe_archive_retention_absence(run_id,key,'v1',repeat('f',64)); raise exception 'observation replay changed';
 exception when others then if sqlerrm<>'archive_retention_observation_mismatch' then raise; end if; end;
 begin perform public.ap_finish_archive_retention(run_id,repeat('b',64)); raise exception 'absence alone reported verified retained graph';
 exception when others then if sqlerrm<>'archive_retention_completion_receipt_invalid' then raise; end if; end;
 receipt:=jsonb_build_object('schemaVersion','applypack-protected-recovery-retention-v1','sourceEnvironment','production','sourceProjectRef','spjaaxndiduhrcleazwb',
  'releaseSha',repeat('a',40),'sourceStartedAt',(select started_at from public.ap_archive_retention_runs where id=run_id),'completedAt',clock_timestamp(),
  'inventoryDigest',repeat('d',64),'planSha256',repeat('b',64),'providerVerificationSha256',repeat('e',64),'deletedVersionCount',1,'retainedVersionCount',2);
 begin perform public.ap_finish_archive_retention(run_id,repeat('b',64),false,receipt||'{"deletedVersionCount":0}'); raise exception 'wrong count accepted';
 exception when others then if sqlerrm<>'archive_retention_completion_receipt_invalid' then raise; end if; end;
 r:=public.ap_finish_archive_retention(run_id,repeat('b',64),false,receipt);
 if r->>'state'<>'COMPLETE' or public.ap_archive_fence_active() then raise exception 'observed completion failed'; end if;
 if not exists(select 1 from public.operational_heartbeats where task_name='protected_recovery_retention' and summary=receipt
  and last_succeeded_at=(receipt->>'sourceStartedAt')::timestamptz) then raise exception 'strict retention heartbeat absent'; end if;
 original_finish:=(r->>'finished_at')::timestamptz;
 r:=public.ap_finish_archive_retention(run_id,repeat('b',64),false,receipt);
 if (r->>'finished_at')::timestamptz<>original_finish then raise exception 'replayed completion refreshed time'; end if;
 if has_table_privilege('service_role','public.ap_archive_retention_versions','UPDATE')
   or has_function_privilege('authenticated','public.ap_dispatch_archive_retention_version(uuid,text,text,text)','EXECUTE') then raise exception 'archive lifecycle privilege leak'; end if;
end $$;
select 'PROTECTED_ARCHIVE_LIFECYCLE_FOUNDATION_OK';
rollback;
