export type EvidenceValue = { value: string | number | boolean | null; certainty: "confirmed" | "unknown" };
export type BoardHardRule = { field: string; operator: "equals" | "not_equals" | "minimum"; value: string | number | boolean };

export type BoardCandidate = {
  confirmedCapabilities: readonly string[];
  transferableCapabilities: readonly string[];
  hardRules: readonly BoardHardRule[];
};

export type BoardJob = {
  id: string;
  requiredCapabilities: readonly string[];
  facts: Readonly<Record<string, EvidenceValue | undefined>>;
  postedAt: string | null;
  salaryMin: number | null;
};

export type AdmissionDecision = {
  admitted: boolean;
  connectionCodes: string[];
  exclusionCodes: string[];
  warnings: string[];
};

const key = (value: string) => value.trim().toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function evaluateBoardAdmission(candidate: BoardCandidate, job: BoardJob): AdmissionDecision {
  const exclusionCodes: string[] = [];
  const warnings: string[] = [];
  for (const rule of candidate.hardRules) {
    const fact = job.facts[rule.field];
    if (!fact || fact.certainty === "unknown" || fact.value === null) {
      warnings.push(`UNKNOWN_${key(rule.field).toUpperCase()}`);
      continue;
    }
    const violates = rule.operator === "equals" ? fact.value !== rule.value
      : rule.operator === "not_equals" ? fact.value === rule.value
        : typeof fact.value !== "number" || typeof rule.value !== "number" || fact.value < rule.value;
    if (violates) exclusionCodes.push(`CONFIRMED_DEALBREAKER_${key(rule.field).toUpperCase()}`);
  }

  const capabilities = new Set([...candidate.confirmedCapabilities, ...candidate.transferableCapabilities].map(key).filter(Boolean));
  const connections = [...new Set(job.requiredCapabilities.map(key).filter((capability) => capability && capabilities.has(capability)))];
  if (!connections.length) exclusionCodes.push("NO_DEFENSIBLE_CAPABILITY_CONNECTION");

  return {
    admitted: exclusionCodes.length === 0,
    connectionCodes: connections.map((connection) => `CAPABILITY_${connection.toUpperCase()}`),
    exclusionCodes,
    warnings,
  };
}

export type BoardSort = "newest" | "salary_high";

export function neutralSort(jobs: readonly BoardJob[], sort: BoardSort = "newest") {
  return [...jobs].sort((left, right) => {
    if (sort === "salary_high") {
      const salary = (right.salaryMin ?? Number.NEGATIVE_INFINITY) - (left.salaryMin ?? Number.NEGATIVE_INFINITY);
      if (salary) return salary;
    }
    const posted = Date.parse(right.postedAt || "") - Date.parse(left.postedAt || "");
    if (Number.isFinite(posted) && posted) return posted;
    return left.id.localeCompare(right.id);
  });
}
