# Employer-first source decision register

Status: code-baseline register; runtime database state controls
Last updated: September 15, 2026

## How to read this register

Policy state and technical state are independent. `UNVERIFIED_DISABLED` means no automated access is authorized even if an adapter exists and its fixtures pass. Runtime authorization requires an immutable employer-specific record, the current authorization head, exact hosts/actions/bounds, and a disabled-by-default schedule. The database, not this document, records live operational state.

Required fields for any future decision are: source ID, subject/employer, source class, access method, policy state, technical state, evidence reference/hash, license/terms, attribution, retention, paid-display status, review date, owner, authorization version/head revision, schedule state, and activation evidence.

## Platform and discovery decisions

| Subject | Class | Technical state | Policy / activation decision |
| --- | --- | --- | --- |
| Greenhouse | ATS | Adapter v2 implemented; bounded single-response enumeration | Employer-specific authorization required; disabled |
| Lever | ATS | Adapter v2 implemented; bounded pagination/checkpoint | Employer-specific authorization required; disabled |
| Ashby | ATS | Adapter v2 implemented; bounded single-response enumeration | Employer-specific authorization required; disabled |
| Recruitee | ATS | Published JSON adapter v1 implemented | Capability only; no employer registered or activated |
| Teamtailor | ATS | Published RSS adapter v1 implemented with bounded XML parsing | Capability only; no employer registered or activated |
| SmartRecruiters | ATS | Not implemented | Deferred until verified candidates prove incremental value |
| Workable | ATS | Not implemented | Deferred until verified candidates prove incremental value |
| BambooHR | ATS | Not implemented | Separate adapter/policy review required |
| Workday | ATS | Not implemented | Separate adapter/policy review required; no workaround scraping |
| Latmay ATS URL dataset | Discovery dataset | Importer not implemented | Discovery-only; snapshot, checksum, license, attribution, and quarantine required |
| JobsPipe REST | Discovery provider | Pilot not implemented | Direct REST only; terms review and 250-result budget required; every result is a lead |
| Indeed | Compatibility import | Identity retained | Unverified/disabled; never relabel as employer-verified |
| HiringCafe | Compatibility import | Identity retained | Unverified/disabled; never relabel as employer-verified |
| Manual reviewed | Manual source | Existing path | Manual-only; human evidence and review required |
| Liveops | Excluded source | Rejection controls implemented | BLOCKED; zero active/customer-visible results required |

## Structured employer capabilities in code

| Employer | Source ID | Adapter | Runtime decision |
| --- | --- | --- | --- |
| Duolingo | duolingo | Greenhouse | UNVERIFIED_DISABLED; unscheduled |
| Ultimate Medical Academy | ultimate-medical-academy | Greenhouse | UNVERIFIED_DISABLED; unscheduled |
| Brightwheel | brightwheel | Ashby | UNVERIFIED_DISABLED; unscheduled |
| Outschool | outschool | Greenhouse | UNVERIFIED_DISABLED; unscheduled |
| Stripe | stripe | Greenhouse | UNVERIFIED_DISABLED; unscheduled |
| Block | block | Greenhouse | UNVERIFIED_DISABLED; unscheduled |
| Coinbase | coinbase | Greenhouse | UNVERIFIED_DISABLED; unscheduled |
| VIPdesk Connect | vipdesk-connect | Lever | UNVERIFIED_DISABLED; unscheduled |
| Five Star Call Centers | five-star-call-centers | Lever | UNVERIFIED_DISABLED; unscheduled |

## Employer baseline

Every named employer below has a distinct registry record. All are disabled for automated access in the current code baseline. Exact URLs, aliases, ATS hints, and notes remain in `src/lib/jobs/source-registry.ts`; any live decision must be recorded as a new immutable database authorization rather than changing this table in place.

| Source ID | Employer | Category | Policy | Activation |
| --- | --- | --- | --- | --- |
| concentrix | Concentrix | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| foundever | Foundever | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| tp | TP | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| alorica | Alorica | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| conduent | Conduent | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| ttec | TTEC | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| cvs-health | CVS Health | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| unitedhealth-group | UnitedHealth Group | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| humana | Humana | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| cigna-evernorth | Cigna and Evernorth | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| progressive | Progressive | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| geico | GEICO | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| liberty-mutual | Liberty Mutual | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| allstate | Allstate | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| state-farm | State Farm | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| broadpath | BroadPath | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| sedgwick | Sedgwick | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| american-express | American Express | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| capital-one | Capital One | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| chewy | Chewy | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| pearson | Pearson | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| stride | Stride Inc. | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| transcom | Transcom | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| asurion | Asurion | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| carenet-health | Carenet Health | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| quest-diagnostics | Quest Diagnostics | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| fidelity-investments | Fidelity Investments | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| first-citizens-bank | First Citizens Bank | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| abc-legal-services | ABC Legal Services | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| labcorp | Labcorp | core_direct_employer | UNVERIFIED_DISABLED | Disabled |
| duolingo | Duolingo | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| ultimate-medical-academy | Ultimate Medical Academy | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| brightwheel | Brightwheel | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| classdojo | ClassDojo | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| capella-university | Capella University | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| outschool | Outschool | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| stripe | Stripe | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| block | Block | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| coinbase | Coinbase | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| gitlab | GitLab | remote_first_employer | UNVERIFIED_DISABLED | Disabled |
| zapier | Zapier | remote_first_employer | UNVERIFIED_DISABLED | Disabled |
| automattic | Automattic | remote_first_employer | UNVERIFIED_DISABLED | Disabled |
| amazon | Amazon | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| apple | Apple | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| dell-technologies | Dell Technologies | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| hp | HP | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| salesforce | Salesforce | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| hubspot | HubSpot | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| wells-fargo | Wells Fargo | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| us-bank | U.S. Bank | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| pnc-bank | PNC Bank | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| xerox | Xerox | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| wayfair | Wayfair | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| nordstrom | Nordstrom | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| williams-sonoma | Williams-Sonoma | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| intuit | Intuit | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| iqvia | IQVIA | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| wipro | Wipro | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| vf-corporation | VF Corporation | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| whirlpool | Whirlpool | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| cbre | CBRE | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| driven-brands | Driven Brands | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| agero | Agero | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| u-haul | U-Haul | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| momentus-technologies | Momentus Technologies | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| encoura | Encoura | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| notifymd | notifyMD | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| amerit-fleet-solutions | Amerit Fleet Solutions | selective_broad_employer | UNVERIFIED_DISABLED | Disabled |
| nexrep | NexRep | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
| modsquad | ModSquad | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
| working-solutions | Working Solutions | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
| vipdesk-connect | VIPdesk Connect | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
| kelly-services | Kelly Services | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
| teksystems | TEKsystems | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
| five-star-call-centers | Five Star Call Centers | contractor_staffing_flexible | UNVERIFIED_DISABLED | Disabled |
