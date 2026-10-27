begin;
do $$ declare item record; actual text; definition text; missing_functions jsonb; missing_relations jsonb; begin
 if not public.ap_employer_rule_review_schema_installed() then
  definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
  execute 'select jsonb_agg(signature) from unnest('||split_part(split_part(definition,'unnest(',2),') required(signature)',1)||') required(signature) where not exists(select 1 from public.ap_archive_fence_function_contracts c where c.signature=required.signature)' into missing_functions;
  execute 'select jsonb_agg(table_name) from unnest('||split_part(split_part(definition,'unnest(',3),') required(table_name)',1)||') required(table_name) where not exists(select 1 from public.ap_archive_fence_relations r where r.schema_name=''public'' and r.table_name=required.table_name)' into missing_relations;
  raise exception '104 installation contract missing' using detail=jsonb_build_object(
   'missingFunctions',missing_functions,'missingRelations',missing_relations,
   'storageCount',(select count(*) from public.ap_archive_fence_relations where schema_name='storage' and table_name in('objects','buckets')),
   'missingStorageTruncate',(select jsonb_agg(to_jsonb(r)) from public.ap_archive_fence_relations r where r.schema_name='storage' and not exists(select 1 from pg_trigger where tgrelid=to_regclass(format('%I.%I',r.schema_name,r.table_name)) and tgname='ap_archive_source_truncate' and tgenabled='O' and tgfoid='public.ap_guard_archive_source_mutation()'::regprocedure)),
   'coverage',public.ap_archive_fence_coverage_current(),'functions',(select count(*) from public.ap_archive_fence_function_contracts),
   'missingTriggers',(select jsonb_agg(to_jsonb(r)) from public.ap_archive_fence_relations r where not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=r.schema_name and c.relname=r.table_name and t.tgname='ap_archive_source_mutation' and t.tgenabled='O' and t.tgfoid='public.ap_guard_archive_source_mutation()'::regprocedure)),
   'unfencedPrivate',(select jsonb_agg(p.table_name) from public.ap_retention_private_tables p where not exists(select 1 from public.ap_archive_fence_relations r where r.schema_name='public' and r.table_name=p.table_name)),
   'coverageDefinition',pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure),
   'badHashes',(select jsonb_agg(signature) from public.ap_archive_fence_function_contracts where definition_sha256<>encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex')),
   'authSelect',has_table_privilege('authenticated','public.ap_employer_rule_review_receipts','SELECT'),
   'serviceInsert',has_table_privilege('service_role','public.ap_employer_rule_review_receipts','INSERT'),
   'sourceTrigger',(select count(*) from pg_trigger where tgrelid='public.ap_requirement_nodes'::regclass and tgname='ap_employer_rule_source_evidence_immutable' and tgenabled='O'),
   'index',(select count(*) from pg_index where indexrelid=to_regclass('public.ap_employer_rule_source_evidence_one_per_job') and indisunique and indisvalid),
   'rpcPrivileges',(select jsonb_agg(jsonb_build_object('signature',signature,'service',has_function_privilege('service_role',signature,'EXECUTE'),'auth',has_function_privilege('authenticated',signature,'EXECUTE'),'anon',has_function_privilege('anon',signature,'EXECUTE')))
    from unnest(array['public.ap_employer_rule_review_basis(uuid,uuid)','public.ap_confirm_employer_submission_rules(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)','public.ap_employer_rule_review_receipt(uuid,uuid)','public.ap_prepare_employer_rule_source_evidence(uuid,uuid)']) signature))::text;
 end if;
 for item in select * from public.employer_rule_104_preservation_fixture order by kind,identity loop
  actual:=null;
  if item.kind='table' then
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into actual;
  elsif item.kind='function' then actual:=encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex');
  elsif item.kind='paid_context' then actual:=public.ap_material_draft_context_sha256(item.identity::uuid);
  elsif item.kind='checkpoint' then select encode(extensions.digest(to_jsonb(c)::text,'sha256'),'hex') into actual from public.ap_migration_checkpoints c where migration_id||':'||checkpoint=item.identity;
  elsif item.kind='fence_relation' then select encode(extensions.digest(to_jsonb(r)::text,'sha256'),'hex') into actual from public.ap_archive_fence_relations r where schema_name||'.'||table_name=item.identity;
  elsif item.kind='fence_function' then select encode(extensions.digest(to_jsonb(f)::text,'sha256'),'hex') into actual from public.ap_archive_fence_function_contracts f where signature=item.identity;
  else raise exception 'unknown preservation identity'; end if;
  if actual is distinct from item.body_sha256 then raise exception '104 changed historical % %',item.kind,item.identity; end if;
 end loop;
 if exists(select 1 from public.ap_employer_rule_review_receipts) then raise exception '104 invented staff review'; end if;
 if exists(select 1 from public.ap_requirement_nodes where classification_method='employer-instruction-source-v1') then raise exception '104 prepared evidence without explicit review action'; end if;
 if (select count(*) from public.ap_archive_fence_function_contracts)<>(select count(*)+17 from public.employer_rule_104_preservation_fixture where kind='fence_function') then raise exception '104 function roster is not append-only'; end if;
 if exists(select 1 from public.ap_archive_fence_relations r where not exists(select 1 from public.employer_rule_104_preservation_fixture p where p.kind='fence_relation' and p.identity=r.schema_name||'.'||r.table_name)
 and (r.schema_name<>'public' or r.table_name not in('ap_employer_rule_review_receipts','ap_requirement_nodes','ap_employer_submission_rules'))) then raise exception '104 unexpected fence relation'; end if;
 if (select count(*) from public.ap_migration_checkpoints)<>(select count(*)+1 from public.employer_rule_104_preservation_fixture where kind='checkpoint') then raise exception '104 unexpected checkpoint mutation'; end if;
 if public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610270104' then raise exception '104 readiness target missing'; end if;
end $$;
drop table public.employer_rule_104_preservation_fixture;
commit;
select 'EMPLOYER_RULE_REVIEW_104_UPGRADE_PRESERVED';
