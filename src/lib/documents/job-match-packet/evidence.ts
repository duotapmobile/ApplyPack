export type PacketEvidenceGroup = "strong" | "consideration" | "unknown";

export const JOB_EVIDENCE_FIELDS = [
  "description", "requirements", "benefits_status", "salary_text", "work_mode",
  "employment_type", "location_text", "schedule_type", "timezone_requirement",
  "remote_scope", "eligible_states", "eligible_countries", "official_application_url",
  "title", "employer",
] as const;

export function packetEvidenceId(jobMatchId: string, group: PacketEvidenceGroup, index: number): string {
  return `job-match:${jobMatchId}:${group}:${index}`;
}

export function bindPacketEvidence<T extends { evidenceIds: string[] }>(
  jobMatchId: string,
  jobId: string,
  group: PacketEvidenceGroup,
  values: T[],
): Array<T & { claimId: string }> {
  return values.map((value, index) => ({
    ...value,
    claimId: packetEvidenceId(jobMatchId, group, index),
    evidenceIds: value.evidenceIds.map((evidenceId) => evidenceId.startsWith("job-field:")
      ? `job:${jobId}:${evidenceId.slice("job-field:".length)}`
      : evidenceId),
  }));
}
