-- Forward-only expansion of the existing manual job table. Existing compatibility
-- columns remain in place because delivered-match and Apply Pack clients use them.

create table public.employers (
  id text primary key,
  display_name text not null unique,
  source_category text not null check (source_category in ('core_direct_employer','remote_first_employer','selective_broad_employer','contractor_staffing_flexible','unclassified')),
  aliases text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.employer_aliases (
  alias_normalized text primary key,
  alias_display_name text not null,
  canonical_employer_id text not null references public.employers(id),
  status text not null default 'redirect' check (status in ('redirect','search_alias','inactive')),
  created_at timestamptz not null default now()
);

create table public.job_sources (
  id text primary key,
  canonical_employer_id text references public.employers(id),
  source_name text not null unique,
  source_category text not null check (source_category in ('core_direct_employer','remote_first_employer','selective_broad_employer','contractor_staffing_flexible','local_affiliate_directory','third_party_aggregator')),
  official_url text,
  alternate_official_urls text[] not null default '{}',
  adapter_kind text not null check (adapter_kind in ('lever','official_link_only','existing_import')),
  adapter_key text,
  automation_status text not null check (automation_status in ('automated','official_link_only','existing_import','pending_verification')),
  is_official boolean not null,
  is_direct_employer boolean not null,
  is_active boolean not null default true,
  priority integer not null default 0,
  default_employment_type text,
  default_w2_or_contractor text,
  default_benefits_status text,
  notes text,
  last_health_checked_at timestamptz,
  last_successful_sync_at timestamptz,
  health_status text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (official_url is null or official_url ~ '^https://'),
  check (not is_direct_employer or is_official)
);

create table public.affiliate_source_directories (
  id text primary key,
  directory_name text not null,
  official_url text not null check (official_url ~ '^https://'),
  notes text not null,
  is_employer boolean not null default false check (is_employer = false)
);

create table public.job_source_exclusions (
  normalized_name text primary key,
  exclusion_status text not null check (exclusion_status in ('hard_excluded','held')),
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.job_source_runs (
  id uuid primary key default gen_random_uuid(),
  source_id text not null references public.job_sources(id),
  status text not null check (status in ('started','succeeded','failed','rate_limited','link_only')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  fetched_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  error_code text,
  error_message text
);

alter table public.jobs
  add column canonical_employer_id text references public.employers(id),
  add column employer_display_name text,
  add column employer_aliases text[] not null default '{}',
  add column source_id text references public.job_sources(id),
  add column source_name text,
  add column source_category text,
  add column is_official_source boolean not null default false,
  add column is_direct_employer_source boolean not null default false,
  add column official_application_url text,
  add column source_job_url text,
  add column normalized_source_url text,
  add column external_job_id text,
  add column normalized_title text,
  add column raw_title text,
  add column description text,
  add column department text,
  add column employment_type text not null default 'unknown' check (employment_type in ('w2_full_time','w2_part_time','1099','independent_contractor','temporary','staffing_assignment','seasonal','unknown')),
  add column w2_or_contractor text not null default 'unknown' check (w2_or_contractor in ('w2','contractor','staffing','unknown')),
  add column work_mode text not null default 'unknown' check (work_mode in ('remote_us_nationwide','remote_us_state_limited','remote_us_timezone_limited','remote_country_limited','remote_global','hybrid','onsite','unknown')),
  add column remote_scope text,
  add column eligible_states text[],
  add column eligible_countries text[],
  add column timezone_requirement text,
  add column schedule_type text,
  add column salary_min numeric,
  add column salary_max numeric,
  add column salary_currency text,
  add column pay_period text,
  add column pay_model text not null default 'unknown' check (pay_model in ('hourly','salary','per_minute','commission','contract_rate','unknown')),
  add column phone_intensity text not null default 'none_or_unknown' check (phone_intensity in ('none_or_unknown','low','mixed','high')),
  add column sales_flag boolean not null default false,
  add column commission_flag boolean not null default false,
  add column marketing_flag boolean not null default false,
  add column high_volume_contact_center_flag boolean not null default false,
  add column degree_required boolean,
  add column experience_level text not null default 'unknown' check (experience_level in ('entry_level','early_career','mid_level','senior','unknown')),
  add column equipment_requirement text,
  add column equipment_cost_responsibility text not null default 'unknown' check (equipment_cost_responsibility in ('employer','applicant','shared','unknown')),
  add column applicant_cost numeric check (applicant_cost is null or applicant_cost >= 0),
  add column benefits_status text not null default 'unknown' check (benefits_status in ('provided','not_provided','varies','unknown')),
  add column language_requirements text[],
  add column posted_at timestamptz,
  add column closing_at timestamptz,
  add column last_verified_at timestamptz,
  add column source_freshness_status text not null default 'unknown' check (source_freshness_status in ('fresh','aging','stale','unknown')),
  add column content_hash text,
  add column deduplication_key text,
  add column is_active boolean not null default true,
  add column review_status text not null default 'pending' check (review_status in ('pending','approved','needs_review','rejected')),
  add column rejection_reason text;

alter table public.job_matches
  add column ranking_reason_codes jsonb not null default '[]'::jsonb,
  add column ranking_score integer;

create table public.job_source_references (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  source_id text not null references public.job_sources(id),
  source_name text not null,
  source_job_url text,
  normalized_source_url text,
  official_application_url text,
  external_job_id text,
  is_official boolean not null default false,
  is_direct_employer boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique(job_id, source_id, external_job_id),
  check (source_job_url is null or source_job_url ~ '^https?://'),
  check (official_application_url is null or official_application_url ~ '^https://')
);

create table public.job_deduplication_reviews (
  id uuid primary key default gen_random_uuid(),
  existing_job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_payload jsonb not null,
  similarity numeric not null check (similarity between 0 and 1),
  status text not null default 'pending' check (status in ('pending','merged','separate','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.employers(id, display_name, source_category) values
  ('concentrix','Concentrix','core_direct_employer'), ('foundever','Foundever','core_direct_employer'),
  ('tp','TP','core_direct_employer'), ('alorica','Alorica','core_direct_employer'),
  ('conduent','Conduent','core_direct_employer'), ('ttec','TTEC','core_direct_employer'),
  ('cvs-health','CVS Health','core_direct_employer'), ('unitedhealth-group','UnitedHealth Group','core_direct_employer'),
  ('humana','Humana','core_direct_employer'), ('cigna-evernorth','Cigna and Evernorth','core_direct_employer'),
  ('progressive','Progressive','core_direct_employer'), ('geico','GEICO','core_direct_employer'),
  ('liberty-mutual','Liberty Mutual','core_direct_employer'), ('allstate','Allstate','core_direct_employer'),
  ('state-farm','State Farm','core_direct_employer'), ('broadpath','BroadPath','core_direct_employer'),
  ('sedgwick','Sedgwick','core_direct_employer'), ('american-express','American Express','core_direct_employer'),
  ('capital-one','Capital One','core_direct_employer'), ('chewy','Chewy','core_direct_employer'),
  ('pearson','Pearson','core_direct_employer'), ('stride','Stride Inc.','core_direct_employer'),
  ('transcom','Transcom','core_direct_employer'), ('asurion','Asurion','core_direct_employer'),
  ('carenet-health','Carenet Health','core_direct_employer'), ('quest-diagnostics','Quest Diagnostics','core_direct_employer'),
  ('fidelity-investments','Fidelity Investments','core_direct_employer'), ('first-citizens-bank','First Citizens Bank','core_direct_employer'),
  ('abc-legal-services','ABC Legal Services','core_direct_employer'), ('labcorp','Labcorp','core_direct_employer'),
  ('gitlab','GitLab','remote_first_employer'), ('zapier','Zapier','remote_first_employer'),
  ('automattic','Automattic','remote_first_employer'),
  ('amazon','Amazon','selective_broad_employer'), ('apple','Apple','selective_broad_employer'),
  ('dell-technologies','Dell Technologies','selective_broad_employer'), ('hp','HP','selective_broad_employer'),
  ('salesforce','Salesforce','selective_broad_employer'), ('hubspot','HubSpot','selective_broad_employer'),
  ('wells-fargo','Wells Fargo','selective_broad_employer'), ('us-bank','U.S. Bank','selective_broad_employer'),
  ('pnc-bank','PNC Bank','selective_broad_employer'), ('xerox','Xerox','selective_broad_employer'),
  ('wayfair','Wayfair','selective_broad_employer'), ('nordstrom','Nordstrom','selective_broad_employer'),
  ('williams-sonoma','Williams-Sonoma','selective_broad_employer'), ('intuit','Intuit','selective_broad_employer'),
  ('iqvia','IQVIA','selective_broad_employer'), ('wipro','Wipro','selective_broad_employer'),
  ('vf-corporation','VF Corporation','selective_broad_employer'), ('whirlpool','Whirlpool','selective_broad_employer'),
  ('cbre','CBRE','selective_broad_employer'), ('driven-brands','Driven Brands','selective_broad_employer'),
  ('agero','Agero','selective_broad_employer'), ('u-haul','U-Haul','selective_broad_employer'),
  ('momentus-technologies','Momentus Technologies','selective_broad_employer'), ('encoura','Encoura','selective_broad_employer'),
  ('notifymd','notifyMD','selective_broad_employer'), ('amerit-fleet-solutions','Amerit Fleet Solutions','selective_broad_employer'),
  ('nexrep','NexRep','contractor_staffing_flexible'), ('modsquad','ModSquad','contractor_staffing_flexible'),
  ('working-solutions','Working Solutions','contractor_staffing_flexible'), ('vipdesk-connect','VIPdesk Connect','contractor_staffing_flexible'),
  ('kelly-services','Kelly Services','contractor_staffing_flexible'), ('teksystems','TEKsystems','contractor_staffing_flexible'),
  ('five-star-call-centers','Five Star Call Centers','contractor_staffing_flexible');

insert into public.employer_aliases(alias_normalized, alias_display_name, canonical_employer_id, status) values
  ('sitel group','Sitel Group','foundever','redirect'),
  ('sitel','Sitel','foundever','redirect'),
  ('sykes','SYKES','foundever','redirect'),
  ('teleperformance','Teleperformance','tp','redirect'),
  ('aetna','Aetna','cvs-health','redirect'),
  ('turbotax','TurboTax','intuit','redirect'),
  ('discover','Discover','capital-one','redirect');

update public.employers e set aliases = coalesce((
  select array_agg(a.alias_display_name order by a.alias_display_name)
  from public.employer_aliases a where a.canonical_employer_id = e.id
), '{}');

insert into public.job_sources(
  id, canonical_employer_id, source_name, source_category, official_url, alternate_official_urls,
  adapter_kind, adapter_key, automation_status, is_official, is_direct_employer, priority,
  default_employment_type, default_w2_or_contractor, default_benefits_status, notes
) values
  ('concentrix','concentrix','Concentrix Careers','core_direct_employer','https://jobs.concentrix.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('foundever','foundever','Foundever Careers','core_direct_employer','https://jobs.foundever.com/','{"https://jobs.foundever.com/go/Work%40Home-Jobs/9237700/"}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('tp','tp','TP Careers','core_direct_employer','https://www.tp.com/en-us/locations/united-states/careers/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('alorica','alorica','Alorica Careers','core_direct_employer','https://www.alorica.com/careers','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('conduent','conduent','Conduent Careers','core_direct_employer','https://careers.conduent.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('ttec','ttec','TTEC Careers','core_direct_employer','https://www.ttecjobs.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('cvs-health','cvs-health','CVS Health Careers','core_direct_employer','https://jobs.cvshealth.com/us/en/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('unitedhealth-group','unitedhealth-group','UnitedHealth Group Careers','core_direct_employer','https://careers.unitedhealthgroup.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('humana','humana','Humana Careers','core_direct_employer','https://careers.humana.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('cigna-evernorth','cigna-evernorth','Cigna and Evernorth Careers','core_direct_employer','https://jobs.thecignagroup.com/us/en','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('progressive','progressive','Progressive Careers','core_direct_employer','https://careers.progressive.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('geico','geico','GEICO Careers','core_direct_employer','https://careers.geico.com/us/en','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('liberty-mutual','liberty-mutual','Liberty Mutual Careers','core_direct_employer','https://jobs.libertymutualgroup.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('allstate','allstate','Allstate Careers','core_direct_employer','https://www.allstate.jobs/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('state-farm','state-farm','State Farm Careers','core_direct_employer','https://jobs.statefarm.com/main0','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('broadpath','broadpath','BroadPath Careers','core_direct_employer','https://broad-path.com/careers/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('sedgwick','sedgwick','Sedgwick Careers','core_direct_employer','https://www.sedgwick.com/careers/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('american-express','american-express','American Express Careers','core_direct_employer','https://www.americanexpress.com/en-us/careers/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('capital-one','capital-one','Capital One Careers','core_direct_employer','https://www.capitalonecareers.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('chewy','chewy','Chewy Careers','core_direct_employer','https://careers.chewy.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('pearson','pearson','Pearson Careers','core_direct_employer','https://pearson.jobs/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('stride','stride','Stride Inc. Careers','core_direct_employer','https://stridelearning.com/careers/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('transcom','transcom','Transcom Careers','core_direct_employer','https://careers.transcom.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('asurion','asurion','Asurion Careers','core_direct_employer','https://careers.asurion.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('carenet-health','carenet-health','Carenet Health Careers','core_direct_employer','https://talent.carenethealthcare.com/jobs/categories','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('quest-diagnostics','quest-diagnostics','Quest Diagnostics Careers','core_direct_employer','https://careers.questdiagnostics.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('fidelity-investments','fidelity-investments','Fidelity Investments Careers','core_direct_employer','https://jobs.fidelity.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('first-citizens-bank','first-citizens-bank','First Citizens Bank Careers','core_direct_employer','https://jobs.firstcitizens.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('abc-legal-services','abc-legal-services','ABC Legal Services Careers','core_direct_employer','https://www.abclegal.com/careers','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('labcorp','labcorp','Labcorp Careers','core_direct_employer','https://careers.labcorp.com/','{}','official_link_only',null,'official_link_only',true,true,100,null,null,null,null),
  ('gitlab','gitlab','GitLab Careers','remote_first_employer','https://about.gitlab.com/jobs/','{}','official_link_only',null,'official_link_only',true,true,80,null,null,null,'Remote-first; do not imply entry-level or easy.'),
  ('zapier','zapier','Zapier Careers','remote_first_employer','https://zapier.com/jobs','{}','official_link_only',null,'official_link_only',true,true,80,null,null,null,'Remote-first; do not imply entry-level or easy.'),
  ('automattic','automattic','Automattic Careers','remote_first_employer','https://automattic.com/work-with-us/','{}','official_link_only',null,'official_link_only',true,true,80,null,null,null,'Remote-first; do not imply entry-level or easy.'),
  ('amazon','amazon','Amazon Careers','selective_broad_employer','https://www.amazon.jobs/en/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('apple','apple','Apple Careers','selective_broad_employer','https://jobs.apple.com/en-us/search','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('dell-technologies','dell-technologies','Dell Technologies Careers','selective_broad_employer','https://jobs.dell.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('hp','hp','HP Careers','selective_broad_employer','https://jobs.hp.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('salesforce','salesforce','Salesforce Careers','selective_broad_employer','https://careers.salesforce.com/en/jobs/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('hubspot','hubspot','HubSpot Careers','selective_broad_employer','https://www.hubspot.com/careers/jobs','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('wells-fargo','wells-fargo','Wells Fargo Careers','selective_broad_employer','https://www.wellsfargojobs.com/en/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('us-bank','us-bank','U.S. Bank Careers','selective_broad_employer','https://careers.usbank.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('pnc-bank','pnc-bank','PNC Bank Careers','selective_broad_employer','https://careers.pnc.com/global/en','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('xerox','xerox','Xerox Careers','selective_broad_employer','https://www.xerox.com/en-us/jobs','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('wayfair','wayfair','Wayfair Careers','selective_broad_employer','https://www.wayfair.com/careers/jobs','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('nordstrom','nordstrom','Nordstrom Careers','selective_broad_employer','https://careers.nordstrom.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('williams-sonoma','williams-sonoma','Williams-Sonoma Careers','selective_broad_employer','https://www.williams-sonomainc.com/careers/jobs/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('intuit','intuit','Intuit Careers','selective_broad_employer','https://jobs.intuit.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('iqvia','iqvia','IQVIA Careers','selective_broad_employer','https://jobs.iqvia.com/en','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('wipro','wipro','Wipro Careers','selective_broad_employer','https://careers.wipro.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('vf-corporation','vf-corporation','VF Corporation Careers','selective_broad_employer','https://www.vfc.com/careers','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('whirlpool','whirlpool','Whirlpool Careers','selective_broad_employer','https://jobs.whirlpool.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('cbre','cbre','CBRE Careers','selective_broad_employer','https://www.cbre.com/careers','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('driven-brands','driven-brands','Driven Brands Careers','selective_broad_employer','https://careers.drivenbrands.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('agero','agero','Agero Careers','selective_broad_employer','https://www.agero.com/careers','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('u-haul','u-haul','U-Haul Careers','selective_broad_employer','https://jobs.uhaul.com/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('momentus-technologies','momentus-technologies','Momentus Technologies Careers','selective_broad_employer','https://gomomentus.com/careers/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('encoura','encoura','Encoura Careers','selective_broad_employer','https://www.encoura.org/about-encoura/join-us/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('notifymd','notifymd','notifyMD Careers','selective_broad_employer',null,'{}','official_link_only',null,'pending_verification',true,true,60,null,null,null,'Employer identity is known, but no current official careers or supported ATS endpoint was verified. Pending official-source verification.'),
  ('amerit-fleet-solutions','amerit-fleet-solutions','Amerit Fleet Solutions Careers','selective_broad_employer','https://www.ameritfleetsolutions.com/careers/','{}','official_link_only',null,'official_link_only',true,true,60,null,null,null,null),
  ('nexrep','nexrep','NexRep Careers','contractor_staffing_flexible','https://nexrep.com/agents/opportunities/','{}','official_link_only',null,'official_link_only',true,true,30,'independent_contractor','contractor','not_provided',null),
  ('modsquad','modsquad','ModSquad Careers','contractor_staffing_flexible','https://modsquad.wd5.myworkdayjobs.com/ModSquad_Contractor','{"https://join.modsquad.com/careers/"}','official_link_only',null,'official_link_only',true,true,30,'independent_contractor','contractor','varies',null),
  ('working-solutions','working-solutions','Working Solutions Careers','contractor_staffing_flexible','https://jobs.workingsolutions.com/','{}','official_link_only',null,'official_link_only',true,true,30,'independent_contractor','contractor','not_provided',null),
  ('vipdesk-connect','vipdesk-connect','VIPdesk Connect Careers','contractor_staffing_flexible','https://jobs.lever.co/vipdesk','{}','lever','vipdesk','automated',true,true,30,'unknown','unknown','varies',null),
  ('kelly-services','kelly-services','Kelly Services Careers','contractor_staffing_flexible','https://www.mykelly.com/','{}','official_link_only',null,'official_link_only',true,true,30,'staffing_assignment','staffing','varies',null),
  ('teksystems','teksystems','TEKsystems Careers','contractor_staffing_flexible','https://www.teksystems.com/en/careers','{}','official_link_only',null,'official_link_only',true,true,30,'staffing_assignment','staffing','varies',null),
  ('five-star-call-centers','five-star-call-centers','Five Star Call Centers Careers','contractor_staffing_flexible','https://jobs.lever.co/getfivestar','{}','lever','getfivestar','automated',true,true,30,'unknown','unknown','unknown',null),
  ('manual-reviewed',null,'Manual reviewed source','third_party_aggregator',null,'{}','existing_import',null,'existing_import',false,false,20,null,null,null,'Existing exact-10 manual delivery compatibility source.'),
  ('indeed',null,'Indeed','third_party_aggregator','https://www.indeed.com/','{}','existing_import',null,'existing_import',false,false,10,null,null,null,'Compatibility source; direct employer references are preferred.'),
  ('hiringcafe',null,'HiringCafe','third_party_aggregator','https://hiring.cafe/','{}','existing_import',null,'existing_import',false,false,10,null,null,null,'Compatibility source; direct employer references are preferred.');

insert into public.affiliate_source_directories(id, directory_name, official_url, notes) values
  ('bcbs-affiliate-directory','Blue Cross Blue Shield affiliate career directory','https://www.bcbs.com/about-us/jobs-careers','Directory only; create an employer only for a verified affiliate.'),
  ('aaa-affiliate-directory','AAA affiliate career directory','https://careers.aaa.com/','Directory only; create an employer only for a verified club or affiliate.');

insert into public.job_source_exclusions(normalized_name, exclusion_status, reason) values
  ('liveops','hard_excluded','Permanent hard exclusion across employers, sources, URLs, imports, recommendations, and results.'),
  ('join liveops','hard_excluded','Liveops alias.'),
  ('dice','held','Technology-board focus does not serve the default search.'),
  ('demand.com','held','Demand-generation employer, not a general job board.'),
  ('sunrun','held','Remote work is heavily sales-oriented.'),
  ('jerry','held','Available work is often insurance and sales-oriented.'),
  ('centerfield','held','Lead-generation and sales orientation.'),
  ('datalot','held','Lead-generation and sales orientation.'),
  ('healthcare business services','held','Canonical employer identity is ambiguous.'),
  ('destination knot','held','Employer identity and official career source are unverified.'),
  ('nogigiddy','held','Employer identity, freshness, and application process are unverified.');

-- Backfill compatibility projections without pretending old records were normalized.
update public.jobs set
  employer_display_name = company,
  raw_title = title,
  normalized_title = lower(trim(regexp_replace(title, '[^[:alnum:]]+', ' ', 'g'))),
  source_id = case
    when lower(source_url) like '%indeed.%' then 'indeed'
    when lower(source_url) like '%hiring.cafe%' then 'hiringcafe'
    else 'manual-reviewed'
  end,
  source_name = case
    when lower(source_url) like '%indeed.%' then 'Indeed'
    when lower(source_url) like '%hiring.cafe%' then 'HiringCafe'
    else 'Manual reviewed source'
  end,
  source_category = 'third_party_aggregator',
  source_job_url = source_url,
  normalized_source_url = source_url,
  last_verified_at = checked_at,
  source_freshness_status = case when checked_at >= now() - interval '24 hours' then 'fresh' when checked_at >= now() - interval '72 hours' then 'aging' else 'stale' end,
  is_active = listing_status = 'open' and checked_at >= now() - interval '72 hours',
  review_status = 'needs_review';

-- The permanent exclusion is fail-closed for future matching, while preserving
-- the original employer, title, and URL as immutable historical evidence.
update public.jobs set
  is_active = false,
  listing_status = 'excluded',
  review_status = 'rejected',
  rejection_reason = 'hard_exclusion'
where regexp_replace(lower(concat_ws(' ', company, employer_display_name, source_name, source_url, source_job_url, official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%';

insert into public.job_source_references(job_id, source_id, source_name, source_job_url, normalized_source_url, is_official, is_direct_employer, last_verified_at, is_active)
select id, source_id, source_name, source_job_url, normalized_source_url, false, false, coalesce(last_verified_at, checked_at), is_active
from public.jobs
where rejection_reason is distinct from 'hard_exclusion';

create unique index jobs_employer_external_id_unique on public.jobs(canonical_employer_id, external_job_id) where canonical_employer_id is not null and external_job_id is not null;
create unique index jobs_employer_source_url_unique on public.jobs(canonical_employer_id, normalized_source_url) where canonical_employer_id is not null and normalized_source_url is not null;
create unique index jobs_employer_dedup_key_unique on public.jobs(canonical_employer_id, deduplication_key) where canonical_employer_id is not null and deduplication_key is not null;
create index jobs_default_search_idx on public.jobs(is_active, source_freshness_status, w2_or_contractor, sales_flag, marketing_flag, phone_intensity);
create index jobs_remote_state_idx on public.jobs using gin(eligible_states);
create index job_source_refs_source_idx on public.job_source_references(source_id, last_verified_at desc);
create index job_source_runs_source_idx on public.job_source_runs(source_id, started_at desc);

alter table public.jobs add constraint jobs_source_category_valid check (
  source_category is null or source_category in ('core_direct_employer','remote_first_employer','selective_broad_employer','contractor_staffing_flexible','local_affiliate_directory','third_party_aggregator')
);
alter table public.jobs add constraint jobs_source_job_url_http check (source_job_url is null or source_job_url ~ '^https?://');
alter table public.jobs add constraint jobs_official_application_url_https check (official_application_url is null or official_application_url ~ '^https://');

create or replace function public.reject_prohibited_job_source()
returns trigger language plpgsql set search_path = ''
as $$
declare
  combined text;
begin
  combined := lower(concat_ws(' ', new.company, new.employer_display_name, new.source_name, new.source_url, new.source_job_url, new.official_application_url));
  if regexp_replace(combined, '[^a-z0-9]+', '', 'g') like '%liveops%' then
    raise exception 'prohibited job source';
  end if;
  return new;
end;
$$;

create trigger reject_prohibited_job_source_before_write
before insert or update on public.jobs
for each row execute function public.reject_prohibited_job_source();

create or replace function public.reject_prohibited_job_reference()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if regexp_replace(lower(concat_ws(' ', new.source_name, new.source_job_url, new.official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%' then
    raise exception 'prohibited job source';
  end if;
  return new;
end;
$$;

create trigger reject_prohibited_job_reference_before_write
before insert or update on public.job_source_references
for each row execute function public.reject_prohibited_job_reference();

create or replace function public.mark_stale_jobs_inactive(p_stale_hours integer default 72)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  changed integer;
begin
  if p_stale_hours < 24 or p_stale_hours > 720 then raise exception 'invalid stale window'; end if;
  update public.jobs
  set source_freshness_status = 'stale', is_active = false, listing_status = 'stale'
  where is_active = true and coalesce(last_verified_at, checked_at) < now() - make_interval(hours => p_stale_hours);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.mark_stale_jobs_inactive(integer) from public, anon, authenticated;
grant execute on function public.mark_stale_jobs_inactive(integer) to service_role;

alter table public.employers enable row level security;
alter table public.employer_aliases enable row level security;
alter table public.job_sources enable row level security;
alter table public.affiliate_source_directories enable row level security;
alter table public.job_source_exclusions enable row level security;
alter table public.job_source_runs enable row level security;
alter table public.job_source_references enable row level security;
alter table public.job_deduplication_reviews enable row level security;

create policy employers_authenticated_select on public.employers for select to authenticated using (true);
create policy aliases_authenticated_select on public.employer_aliases for select to authenticated using (true);
create policy sources_authenticated_select on public.job_sources for select to authenticated using (is_active = true);
create policy directories_authenticated_select on public.affiliate_source_directories for select to authenticated using (true);
create policy source_references_owner_select on public.job_source_references for select to authenticated using (
  exists(select 1 from public.job_matches m join public.orders o on o.id = m.search_order_id where m.job_id = job_source_references.job_id and o.status = 'delivered' and (o.customer_id = auth.uid() or public.is_admin()))
);

grant all privileges on public.employers, public.employer_aliases, public.job_sources, public.affiliate_source_directories, public.job_source_exclusions, public.job_source_runs, public.job_source_references, public.job_deduplication_reviews to service_role;
grant select on public.employers, public.employer_aliases, public.job_sources, public.affiliate_source_directories, public.job_source_references to authenticated;
revoke all on public.job_source_exclusions, public.job_source_runs, public.job_deduplication_reviews from anon, authenticated;
