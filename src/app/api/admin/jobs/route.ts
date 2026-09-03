import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { filterJobs } from "@/lib/jobs/filter";
import { fromJobDatabaseRow } from "@/lib/jobs/persistence";
import { rankJobs } from "@/lib/jobs/rank";
import { isLiveopsReference } from "@/lib/jobs/canonicalize";
import { employmentTypes, phoneIntensities, sourceCategories, workModes, workerRelationships } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";

const booleanParam = z.enum(["true", "false"]).transform((value) => value === "true").optional();
const schema = z.object({
  workerRelationship: z.enum([...workerRelationships, "all"]).optional(),
  remoteScope: z.enum(workModes).array().optional(),
  state: z.string().trim().length(2).transform((value) => value.toUpperCase()).optional(),
  timezone: z.string().trim().max(100).optional(),
  phoneIntensity: z.enum(phoneIntensities).array().optional(),
  includeSales: booleanParam,
  includeMarketing: booleanParam,
  entryLevelOnly: booleanParam,
  employmentType: z.enum(employmentTypes).array().optional(),
  scheduleType: z.string().trim().max(100).array().optional(),
  salaryMinimum: z.coerce.number().nonnegative().optional(),
  sourceCategory: z.enum(sourceCategories).array().optional(),
  directEmployerOnly: booleanParam,
  includeApplicantCost: booleanParam,
});

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const parsed = schema.safeParse({
    workerRelationship: params.get("workerRelationship") || undefined,
    remoteScope: params.getAll("remoteScope"),
    state: params.get("state") || undefined,
    timezone: params.get("timezone") || undefined,
    phoneIntensity: params.getAll("phoneIntensity"),
    includeSales: params.get("includeSales") || undefined,
    includeMarketing: params.get("includeMarketing") || undefined,
    entryLevelOnly: params.get("entryLevelOnly") || undefined,
    employmentType: params.getAll("employmentType"),
    scheduleType: params.getAll("scheduleType"),
    salaryMinimum: params.get("salaryMinimum") || undefined,
    sourceCategory: params.getAll("sourceCategory"),
    directEmployerOnly: params.get("directEmployerOnly") || undefined,
    includeApplicantCost: params.get("includeApplicantCost") || undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid job filters.", details: parsed.error.flatten() }, { status: 400 });

  const { data, error } = await auth.admin.from("jobs").select("*").eq("is_active", true).neq("review_status", "rejected").limit(500);
  if (error) return NextResponse.json({ error: "Jobs could not be loaded." }, { status: 502 });
  const idByJob = new WeakMap<object, string>();
  const jobs = (data || []).map((row) => {
    const job = fromJobDatabaseRow(row as Record<string, unknown>);
    idByJob.set(job, row.id);
    return job;
  }).filter((job) => !isLiveopsReference(job.employerDisplayName, job.sourceName, job.sourceJobUrl, job.officialApplicationUrl));
  const filters = {
    workerRelationship: parsed.data.workerRelationship,
    remoteScopes: parsed.data.remoteScope,
    state: parsed.data.state,
    timezone: parsed.data.timezone,
    phoneIntensities: parsed.data.phoneIntensity,
    includeSales: parsed.data.includeSales,
    includeMarketing: parsed.data.includeMarketing,
    entryLevelOnly: parsed.data.entryLevelOnly,
    employmentTypes: parsed.data.employmentType,
    scheduleTypes: parsed.data.scheduleType,
    salaryMinimum: parsed.data.salaryMinimum,
    sourceCategories: parsed.data.sourceCategory,
    directEmployerOnly: parsed.data.directEmployerOnly,
    includeApplicantCost: parsed.data.includeApplicantCost,
  };
  const ranked = rankJobs(filterJobs(jobs, filters), { state: parsed.data.state });
  return NextResponse.json({
    jobs: ranked.map(({ job, score, reasonCodes }) => ({
      id: idByJob.get(job),
      company: job.employerDisplayName,
      title: job.rawTitle,
      sourceUrl: job.officialApplicationUrl || job.sourceJobUrl,
      location: job.locationText,
      salary: { min: job.salaryMin, max: job.salaryMax, currency: job.salaryCurrency, period: job.payPeriod, model: job.payModel },
      metadata: job,
      ranking: { score, reasonCodes },
    })),
    filters,
  }, { headers: { "cache-control": "no-store, private" } });
}
