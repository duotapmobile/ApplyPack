import type { GateResult } from "@/lib/matching/evaluation-engine";

/** Preparatory policy only. No checkout, release or evaluation path calls this helper. */
export function proposedSalaryReleasePolicy(input: {
  snapshot: { id: string; schemaVersion: string; contentHash: string; unpublishedSalaryPolicy: string };
  evaluation: {
    snapshotId: string; rootResult: string; eligibility: string; activeRootKeys: string[];
    roots: GateResult[]; activeUnknownTreatments: string[]; salaryStatus: string; salaryDisposition: string; customerWarnings: string[];
  };
}) {
  const { snapshot, evaluation: e } = input;
  const expected = [...new Set(e.activeRootKeys)].sort();
  const actual = [...new Set(e.roots.map((root) => root.rootKey))].sort();
  if (e.snapshotId !== snapshot.id || !/^[a-f0-9]{64}$/u.test(snapshot.contentHash)
    || !snapshot.schemaVersion || !expected.length || expected.length !== e.activeRootKeys.length
    || actual.length !== e.roots.length || expected.join("|") !== actual.join("|")) return false;
  if (e.rootResult === "PASS") return e.eligibility === "ELIGIBLE" && !e.activeUnknownTreatments.length && e.roots.every((root) => root.result === "PASS");
  if (e.rootResult !== "UNKNOWN" || e.eligibility !== "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"
    || e.activeUnknownTreatments.length !== 1 || e.activeUnknownTreatments[0] !== "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING"
    || e.salaryStatus !== "UNPUBLISHED" || e.salaryDisposition !== "ALLOWED_WITH_WARNING"
    || snapshot.unpublishedSalaryPolicy !== "ALLOW_WITH_WARNING") return false;
  const unknowns = e.roots.filter((root) => root.result === "UNKNOWN");
  return unknowns.length === 1 && unknowns[0].rootKey === "universal:salary"
    && unknowns[0].resolutionIssue === "EMPLOYER_OMITTED"
    && unknowns[0].unknownTreatment === "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" && !unknowns[0].unwaivable
    && unknowns[0].consentVersion === `${snapshot.schemaVersion}:${snapshot.contentHash}`
    && Boolean(unknowns[0].warning?.trim())
    && e.customerWarnings.includes(unknowns[0].warning!)
    && e.roots.every((root) => root.result === "PASS" || root === unknowns[0]);
}
