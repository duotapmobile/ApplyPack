-- Source audit metadata and the September 8 requested employer batch.
-- All new structured sources remain unscheduled until a reviewed activation.

alter table public.job_sources add column if not exists ats_platform text;
alter table public.job_sources add column if not exists ats_tenant_identifier text;
alter table public.job_sources add column if not exists access_method text;
alter table public.job_sources add column if not exists refresh_schedule text;
alter table public.job_sources add column if not exists schedule_enabled boolean not null default false;
alter table public.job_sources add column if not exists ingestion_permission_status text not null default 'unverified';
alter table public.job_sources add column if not exists paid_display_permission_status text not null default 'unverified';
alter table public.job_sources add column if not exists permission_evidence_url text;

alter table public.job_sources drop constraint if exists job_sources_adapter_kind_check;
alter table public.job_sources add constraint job_sources_adapter_kind_check
  check (adapter_kind in ('lever','greenhouse','ashby','official_link_only','existing_import'));
alter table public.job_sources add constraint job_sources_ats_platform_check
  check (ats_platform is null or ats_platform in ('lever','greenhouse','ashby','workday','custom','unknown','none'));
alter table public.job_sources add constraint job_sources_access_method_check
  check (access_method is null or access_method in ('public_structured_endpoint','manual_official_career_page','manual_import','blocked'));
alter table public.job_sources add constraint job_sources_ingestion_permission_check
  check (ingestion_permission_status in ('approved_public_endpoint','manual_research_only','direct_link_only','unverified','requires_license_or_written_permission'));
alter table public.job_sources add constraint job_sources_paid_display_permission_check
  check (paid_display_permission_status in ('approved_public_endpoint','manual_research_only','direct_link_only','unverified','requires_license_or_written_permission'));

update public.job_sources set
  ats_platform = case when adapter_kind = 'lever' then 'lever' when adapter_kind = 'existing_import' then 'none' else coalesce(ats_platform, 'unknown') end,
  ats_tenant_identifier = case when adapter_kind = 'lever' then adapter_key when adapter_kind = 'existing_import' then 'none' else coalesce(ats_tenant_identifier, 'unknown') end,
  access_method = case when adapter_kind = 'lever' then 'public_structured_endpoint' when adapter_kind = 'existing_import' then 'manual_import' else 'manual_official_career_page' end,
  ingestion_permission_status = case when adapter_kind = 'lever' then 'approved_public_endpoint' when adapter_kind = 'existing_import' then 'unverified' else 'manual_research_only' end,
  paid_display_permission_status = case when is_direct_employer then 'direct_link_only' else 'unverified' end,
  permission_evidence_url = coalesce(permission_evidence_url, official_url);

update public.job_sources set
  ats_platform = 'workday', ats_tenant_identifier = 'strideinc/SK',
  official_url = 'https://www.stridelearning.com/careers/',
  alternate_official_urls = array['https://strideinc.wd1.myworkdayjobs.com/SK'],
  notes = 'Requested as Stride K12. Official Workday tenant verified; no Workday adapter is implemented.'
where id = 'stride';

update public.job_sources set permission_evidence_url = 'https://github.com/lever/postings-api'
where id in ('vipdesk-connect', 'five-star-call-centers');

insert into public.employers(id, display_name, source_category) values
  ('duolingo','Duolingo','selective_broad_employer'),
  ('ultimate-medical-academy','Ultimate Medical Academy','selective_broad_employer'),
  ('brightwheel','Brightwheel','selective_broad_employer'),
  ('classdojo','ClassDojo','selective_broad_employer'),
  ('capella-university','Capella University','selective_broad_employer'),
  ('outschool','Outschool','selective_broad_employer'),
  ('stripe','Stripe','selective_broad_employer'),
  ('block','Block','selective_broad_employer'),
  ('coinbase','Coinbase','selective_broad_employer')
on conflict (id) do update set display_name = excluded.display_name, source_category = excluded.source_category, updated_at = now();

insert into public.job_sources(
  id, canonical_employer_id, source_name, source_category, official_url, alternate_official_urls,
  adapter_kind, adapter_key, automation_status, is_official, is_direct_employer, is_active, priority,
  ats_platform, ats_tenant_identifier, access_method, refresh_schedule, schedule_enabled,
  ingestion_permission_status, paid_display_permission_status, permission_evidence_url, notes
) values
  ('duolingo','duolingo','Duolingo Careers','selective_broad_employer','https://careers.duolingo.com/',array['https://job-boards.greenhouse.io/duolingo/'],'greenhouse','duolingo','automated',true,true,true,75,'greenhouse','duolingo','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.greenhouse.io/job-board.html','Bounded endpoint test passed 2026-09-08; not scheduled or persisted until reviewed activation.'),
  ('ultimate-medical-academy','ultimate-medical-academy','Ultimate Medical Academy Careers','selective_broad_employer','https://workatuma.com/',array['https://job-boards.greenhouse.io/umaeducationinc/'],'greenhouse','umaeducationinc','automated',true,true,true,75,'greenhouse','umaeducationinc','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.greenhouse.io/job-board.html','Bounded endpoint test passed 2026-09-08; not scheduled or persisted until reviewed activation.'),
  ('brightwheel','brightwheel','Brightwheel Careers','selective_broad_employer','https://mybrightwheel.com/careers/',array['https://jobs.ashbyhq.com/brightwheel'],'ashby','brightwheel','automated',true,true,true,75,'ashby','brightwheel','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.ashbyhq.com/docs/public-job-posting-api','Bounded endpoint test passed 2026-09-08; not scheduled or persisted until reviewed activation.'),
  ('classdojo','classdojo','ClassDojo Careers','selective_broad_employer','https://www.classdojo.com/jobs/','{}'::text[],'official_link_only',null,'official_link_only',true,true,true,75,'unknown','unknown','manual_official_career_page',null,false,'manual_research_only','direct_link_only','https://www.classdojo.com/jobs/','Official page verified; no supported public ATS tenant was identified.'),
  ('capella-university','capella-university','Capella University Careers','selective_broad_employer','https://www.capella.edu/careers/',array['https://strayer.wd1.myworkdayjobs.com/CU_Careers'],'official_link_only',null,'official_link_only',true,true,true,75,'workday','strayer/CU_Careers','manual_official_career_page',null,false,'manual_research_only','direct_link_only','https://www.capella.edu/careers/','Workday tenant verified; no Workday adapter is implemented.'),
  ('outschool','outschool','Outschool Careers','selective_broad_employer','https://outschool.com/careers',array['https://job-boards.greenhouse.io/outschool/'],'greenhouse','outschool','automated',true,true,true,75,'greenhouse','outschool','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.greenhouse.io/job-board.html','Bounded endpoint test passed 2026-09-08; not scheduled or persisted until reviewed activation.'),
  ('stripe','stripe','Stripe Careers','selective_broad_employer','https://stripe.com/careers/search',array['https://job-boards.greenhouse.io/stripe/'],'greenhouse','stripe','automated',true,true,true,55,'greenhouse','stripe','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.greenhouse.io/job-board.html','Bounded endpoint test passed 2026-09-08; specialized roles require relevance filtering; not scheduled.'),
  ('block','block','Block Careers','selective_broad_employer','https://block.xyz/careers/jobs',array['https://job-boards.greenhouse.io/block/'],'greenhouse','block','automated',true,true,true,55,'greenhouse','block','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.greenhouse.io/job-board.html','Bounded endpoint test passed 2026-09-08; specialized roles require relevance filtering; not scheduled.'),
  ('coinbase','coinbase','Coinbase Careers','selective_broad_employer','https://www.coinbase.com/careers/positions?location=all',array['https://job-boards.greenhouse.io/coinbase/'],'greenhouse','coinbase','automated',true,true,true,55,'greenhouse','coinbase','public_structured_endpoint',null,false,'approved_public_endpoint','direct_link_only','https://developers.greenhouse.io/job-board.html','Bounded endpoint test passed 2026-09-08; specialized roles require relevance filtering; not scheduled.'),
  ('edtech-com-fully-remote',null,'EdTech.com Fully Remote Jobs','third_party_aggregator','https://www.edtech.com/jobs/fully-remote-jobs','{}'::text[],'official_link_only',null,'pending_verification',false,false,false,70,'none','none','blocked',null,false,'requires_license_or_written_permission','requires_license_or_written_permission','https://www.edtech.com/terms','Evaluated 2026-09-08. HTTP 403 blocked the audit client and no ingestion or paid-display license was established.')
on conflict (id) do update set
  canonical_employer_id=excluded.canonical_employer_id, source_name=excluded.source_name, source_category=excluded.source_category,
  official_url=excluded.official_url, alternate_official_urls=excluded.alternate_official_urls, adapter_kind=excluded.adapter_kind,
  adapter_key=excluded.adapter_key, automation_status=excluded.automation_status, is_official=excluded.is_official,
  is_direct_employer=excluded.is_direct_employer, is_active=excluded.is_active, priority=excluded.priority,
  ats_platform=excluded.ats_platform, ats_tenant_identifier=excluded.ats_tenant_identifier, access_method=excluded.access_method,
  refresh_schedule=excluded.refresh_schedule, schedule_enabled=excluded.schedule_enabled,
  ingestion_permission_status=excluded.ingestion_permission_status, paid_display_permission_status=excluded.paid_display_permission_status,
  permission_evidence_url=excluded.permission_evidence_url, notes=excluded.notes, updated_at=now();
