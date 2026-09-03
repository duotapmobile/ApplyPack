import type { AffiliateDirectory, SourceDefinition } from "./types";

const direct = (
  id: string,
  employerDisplayName: string,
  category: SourceDefinition["category"],
  officialUrl: string | null,
  priority: number,
  extra: Partial<SourceDefinition> = {},
): SourceDefinition => ({
  id,
  canonicalEmployerId: id,
  employerDisplayName,
  sourceName: employerDisplayName + " Careers",
  category,
  officialUrl,
  adapterKind: "official_link_only",
  automationStatus: officialUrl ? "official_link_only" : "pending_verification",
  isOfficial: true,
  isDirectEmployer: true,
  isActive: true,
  priority,
  ...extra,
});

export const jobSources: readonly SourceDefinition[] = [
  direct("concentrix", "Concentrix", "core_direct_employer", "https://jobs.concentrix.com/", 100),
  direct("foundever", "Foundever", "core_direct_employer", "https://jobs.foundever.com/", 100, { alternateOfficialUrls: ["https://jobs.foundever.com/go/Work%40Home-Jobs/9237700/"] }),
  direct("tp", "TP", "core_direct_employer", "https://www.tp.com/en-us/locations/united-states/careers/", 100),
  direct("alorica", "Alorica", "core_direct_employer", "https://www.alorica.com/careers", 100),
  direct("conduent", "Conduent", "core_direct_employer", "https://careers.conduent.com/", 100),
  direct("ttec", "TTEC", "core_direct_employer", "https://www.ttecjobs.com/", 100),
  direct("cvs-health", "CVS Health", "core_direct_employer", "https://jobs.cvshealth.com/us/en/", 100),
  direct("unitedhealth-group", "UnitedHealth Group", "core_direct_employer", "https://careers.unitedhealthgroup.com/", 100),
  direct("humana", "Humana", "core_direct_employer", "https://careers.humana.com/", 100),
  direct("cigna-evernorth", "Cigna and Evernorth", "core_direct_employer", "https://jobs.thecignagroup.com/us/en", 100),
  direct("progressive", "Progressive", "core_direct_employer", "https://careers.progressive.com/", 100),
  direct("geico", "GEICO", "core_direct_employer", "https://careers.geico.com/us/en", 100),
  direct("liberty-mutual", "Liberty Mutual", "core_direct_employer", "https://jobs.libertymutualgroup.com/", 100),
  direct("allstate", "Allstate", "core_direct_employer", "https://www.allstate.jobs/", 100),
  direct("state-farm", "State Farm", "core_direct_employer", "https://jobs.statefarm.com/main0", 100),
  direct("broadpath", "BroadPath", "core_direct_employer", "https://broad-path.com/careers/", 100),
  direct("sedgwick", "Sedgwick", "core_direct_employer", "https://www.sedgwick.com/careers/", 100),
  direct("american-express", "American Express", "core_direct_employer", "https://www.americanexpress.com/en-us/careers/", 100),
  direct("capital-one", "Capital One", "core_direct_employer", "https://www.capitalonecareers.com/", 100),
  direct("chewy", "Chewy", "core_direct_employer", "https://careers.chewy.com/", 100),
  direct("pearson", "Pearson", "core_direct_employer", "https://pearson.jobs/", 100),
  direct("stride", "Stride Inc.", "core_direct_employer", "https://stridelearning.com/careers/", 100),
  direct("transcom", "Transcom", "core_direct_employer", "https://careers.transcom.com/", 100),
  direct("asurion", "Asurion", "core_direct_employer", "https://careers.asurion.com/", 100),
  direct("carenet-health", "Carenet Health", "core_direct_employer", "https://talent.carenethealthcare.com/jobs/categories", 100),
  direct("quest-diagnostics", "Quest Diagnostics", "core_direct_employer", "https://careers.questdiagnostics.com/", 100),
  direct("fidelity-investments", "Fidelity Investments", "core_direct_employer", "https://jobs.fidelity.com/", 100),
  direct("first-citizens-bank", "First Citizens Bank", "core_direct_employer", "https://jobs.firstcitizens.com/", 100),
  direct("abc-legal-services", "ABC Legal Services", "core_direct_employer", "https://www.abclegal.com/careers", 100),
  direct("labcorp", "Labcorp", "core_direct_employer", "https://careers.labcorp.com/", 100),

  direct("gitlab", "GitLab", "remote_first_employer", "https://about.gitlab.com/jobs/", 80, { notes: "Remote-first, but openings may be specialized and highly competitive." }),
  direct("zapier", "Zapier", "remote_first_employer", "https://zapier.com/jobs", 80, { notes: "Remote-first, but openings may be specialized and highly competitive." }),
  direct("automattic", "Automattic", "remote_first_employer", "https://automattic.com/work-with-us/", 80, { notes: "Remote-first, but openings may be specialized and highly competitive." }),

  direct("amazon", "Amazon", "selective_broad_employer", "https://www.amazon.jobs/en/", 60),
  direct("apple", "Apple", "selective_broad_employer", "https://jobs.apple.com/en-us/search", 60),
  direct("dell-technologies", "Dell Technologies", "selective_broad_employer", "https://jobs.dell.com/", 60),
  direct("hp", "HP", "selective_broad_employer", "https://jobs.hp.com/", 60),
  direct("salesforce", "Salesforce", "selective_broad_employer", "https://careers.salesforce.com/en/jobs/", 60),
  direct("hubspot", "HubSpot", "selective_broad_employer", "https://www.hubspot.com/careers/jobs", 60),
  direct("wells-fargo", "Wells Fargo", "selective_broad_employer", "https://www.wellsfargojobs.com/en/", 60),
  direct("us-bank", "U.S. Bank", "selective_broad_employer", "https://careers.usbank.com/", 60),
  direct("pnc-bank", "PNC Bank", "selective_broad_employer", "https://careers.pnc.com/global/en", 60),
  direct("xerox", "Xerox", "selective_broad_employer", "https://www.xerox.com/en-us/jobs", 60),
  direct("wayfair", "Wayfair", "selective_broad_employer", "https://www.wayfair.com/careers/jobs", 60),
  direct("nordstrom", "Nordstrom", "selective_broad_employer", "https://careers.nordstrom.com/", 60),
  direct("williams-sonoma", "Williams-Sonoma", "selective_broad_employer", "https://www.williams-sonomainc.com/careers/jobs/", 60),
  direct("intuit", "Intuit", "selective_broad_employer", "https://jobs.intuit.com/", 60),
  direct("iqvia", "IQVIA", "selective_broad_employer", "https://jobs.iqvia.com/en", 60),
  direct("wipro", "Wipro", "selective_broad_employer", "https://careers.wipro.com/", 60),
  direct("vf-corporation", "VF Corporation", "selective_broad_employer", "https://www.vfc.com/careers", 60),
  direct("whirlpool", "Whirlpool", "selective_broad_employer", "https://jobs.whirlpool.com/", 60),
  direct("cbre", "CBRE", "selective_broad_employer", "https://www.cbre.com/careers", 60),
  direct("driven-brands", "Driven Brands", "selective_broad_employer", "https://careers.drivenbrands.com/", 60),
  direct("agero", "Agero", "selective_broad_employer", "https://www.agero.com/careers", 60),
  direct("u-haul", "U-Haul", "selective_broad_employer", "https://jobs.uhaul.com/", 60),
  direct("momentus-technologies", "Momentus Technologies", "selective_broad_employer", "https://gomomentus.com/careers/", 60),
  direct("encoura", "Encoura", "selective_broad_employer", "https://www.encoura.org/about-encoura/join-us/", 60),
  direct("notifymd", "notifyMD", "selective_broad_employer", null, 60, { notes: "Employer identity is known, but no current official careers or supported ATS endpoint was verified. Pending official-source verification." }),
  direct("amerit-fleet-solutions", "Amerit Fleet Solutions", "selective_broad_employer", "https://www.ameritfleetsolutions.com/careers/", 60),

  direct("nexrep", "NexRep", "contractor_staffing_flexible", "https://nexrep.com/agents/opportunities/", 30, { defaultWorkerRelationship: "contractor", defaultEmploymentType: "independent_contractor", defaultBenefitsStatus: "not_provided" }),
  direct("modsquad", "ModSquad", "contractor_staffing_flexible", "https://modsquad.wd5.myworkdayjobs.com/ModSquad_Contractor", 30, { alternateOfficialUrls: ["https://join.modsquad.com/careers/"], defaultWorkerRelationship: "contractor", defaultEmploymentType: "independent_contractor", defaultBenefitsStatus: "varies" }),
  direct("working-solutions", "Working Solutions", "contractor_staffing_flexible", "https://jobs.workingsolutions.com/", 30, { defaultWorkerRelationship: "contractor", defaultEmploymentType: "independent_contractor", defaultBenefitsStatus: "not_provided" }),
  direct("vipdesk-connect", "VIPdesk Connect", "contractor_staffing_flexible", "https://jobs.lever.co/vipdesk", 30, { adapterKind: "lever", adapterKey: "vipdesk", automationStatus: "automated", defaultWorkerRelationship: "unknown", defaultEmploymentType: "unknown", defaultBenefitsStatus: "varies" }),
  direct("kelly-services", "Kelly Services", "contractor_staffing_flexible", "https://www.mykelly.com/", 30, { defaultWorkerRelationship: "staffing", defaultEmploymentType: "staffing_assignment", defaultBenefitsStatus: "varies" }),
  direct("teksystems", "TEKsystems", "contractor_staffing_flexible", "https://www.teksystems.com/en/careers", 30, { defaultWorkerRelationship: "staffing", defaultEmploymentType: "staffing_assignment", defaultBenefitsStatus: "varies" }),
  direct("five-star-call-centers", "Five Star Call Centers", "contractor_staffing_flexible", "https://jobs.lever.co/getfivestar", 30, { adapterKind: "lever", adapterKey: "getfivestar", automationStatus: "automated", defaultWorkerRelationship: "unknown", defaultEmploymentType: "unknown", defaultBenefitsStatus: "unknown" }),

  {
    id: "manual-reviewed",
    canonicalEmployerId: null,
    employerDisplayName: null,
    sourceName: "Manual reviewed source",
    category: "third_party_aggregator",
    officialUrl: null,
    adapterKind: "existing_import",
    automationStatus: "existing_import",
    isOfficial: false,
    isDirectEmployer: false,
    isActive: true,
    priority: 20,
    notes: "Compatibility source for human-reviewed jobs entered through the existing exact-10 delivery contract.",
  },
  {
    id: "indeed",
    canonicalEmployerId: null,
    employerDisplayName: null,
    sourceName: "Indeed",
    category: "third_party_aggregator",
    officialUrl: "https://www.indeed.com/",
    adapterKind: "existing_import",
    automationStatus: "existing_import",
    isOfficial: false,
    isDirectEmployer: false,
    isActive: true,
    priority: 10,
    notes: "Compatibility record for externally supplied Indeed results. Direct employer links outrank duplicates.",
  },
  {
    id: "hiringcafe",
    canonicalEmployerId: null,
    employerDisplayName: null,
    sourceName: "HiringCafe",
    category: "third_party_aggregator",
    officialUrl: "https://hiring.cafe/",
    adapterKind: "existing_import",
    automationStatus: "existing_import",
    isOfficial: false,
    isDirectEmployer: false,
    isActive: true,
    priority: 10,
    notes: "Compatibility record for externally supplied HiringCafe results. Direct employer links outrank duplicates.",
  },
];

export const affiliateDirectories: readonly AffiliateDirectory[] = [
  {
    id: "bcbs-affiliate-directory",
    name: "Blue Cross Blue Shield affiliate career directory",
    officialUrl: "https://www.bcbs.com/about-us/jobs-careers",
    notes: "Directory only. Create a source only for a verified local affiliate and store that affiliate as the employer.",
  },
  {
    id: "aaa-affiliate-directory",
    name: "AAA affiliate career directory",
    officialUrl: "https://careers.aaa.com/",
    notes: "Directory only. Create a source only for a verified club or affiliate and store that affiliate as the employer.",
  },
];

export const heldOrExcludedSources = [
  { name: "Liveops", status: "hard_excluded", reason: "Permanent hard exclusion across all sources, aliases, URLs, recommendations, and results." },
  { name: "Dice", status: "held", reason: "Technology-board focus does not serve the default search." },
  { name: "Demand.com", status: "held", reason: "B2B demand-generation employer, not a general job board." },
  { name: "Sunrun", status: "held", reason: "Available remote work is heavily sales-oriented." },
  { name: "Jerry", status: "held", reason: "Available work is often insurance and sales-oriented." },
  { name: "Centerfield", status: "held", reason: "Lead-generation and sales orientation." },
  { name: "Datalot", status: "held", reason: "Lead-generation and sales orientation." },
  { name: "Healthcare Business Services", status: "held", reason: "Canonical employer identity is ambiguous." },
  { name: "Destination Knot", status: "held", reason: "Employer identity and official career source are unverified." },
  { name: "NoGigiddy", status: "held", reason: "Employer identity, job freshness, and application process are unverified." },
] as const;

export function getSource(sourceId: string): SourceDefinition | undefined {
  return jobSources.find((source) => source.id === sourceId);
}

export function getEmployerSource(canonicalEmployerId: string): SourceDefinition | undefined {
  return jobSources.find((source) => source.canonicalEmployerId === canonicalEmployerId && source.isOfficial);
}

export function sourceUrlMatchesDefinition(source: SourceDefinition, value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const candidate = new URL(value);
    if (candidate.protocol !== "https:") return false;
    return [source.officialUrl, ...(source.alternateOfficialUrls || [])].some((officialUrl) => {
      if (!officialUrl) return false;
      const official = new URL(officialUrl);
      return candidate.hostname === official.hostname || candidate.hostname.endsWith(`.${official.hostname}`);
    });
  } catch {
    return false;
  }
}
