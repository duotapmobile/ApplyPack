export const MATERIAL_RELEASE_CHECKS = [
  { key: "contentReviewed", label: "I checked the wording and customer details in every document." },
  { key: "visualReviewed", label: "I opened every rendered document and checked its layout." },
  { key: "listingRechecked", label: "I checked that this job is still open." },
  { key: "instructionsReparsed", label: "I reviewed the current employer instructions and application questions." },
  { key: "linksRechecked", label: "I checked the application and document links." },
  { key: "provenanceReviewed", label: "I checked that every factual claim is supported by the confirmed information." },
  { key: "secureFilesConfirmed", label: "I confirmed that these private files belong to this customer and job." },
] as const;

export type MaterialReleaseCheckKey = typeof MATERIAL_RELEASE_CHECKS[number]["key"];
export type MaterialReleaseChecklist = Partial<Record<MaterialReleaseCheckKey, boolean>>;

export type MaterialReleaseExpectedBinding = {
  revisionId: string;
  ruleSha256: string;
  releaseCheckId: string;
  releaseCheckAt: string;
  files: Array<{
    fileVersionId: string; version: number; checksumSha256: string;
    contentApprovedAt: string; contentApprovedBy: string;
    visualApprovedAt: string; visualApprovedBy: string;
  }>;
};

export function materialReleaseChecksComplete(checklist: MaterialReleaseChecklist) {
  return MATERIAL_RELEASE_CHECKS.every(({ key }) => checklist[key] === true);
}
