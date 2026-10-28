import { createHash } from "node:crypto";
import { buildDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { validateDraftOutput } from "@/lib/documents/draft-output";
import { buildDraftRenderSource } from "@/lib/documents/draft-render-source";
import type { DraftReferenceInput } from "@/lib/documents/draft-reference-source";
import { draftDocumentFixture, draftFixtureNow } from "./draft-document";

const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Fictional local-only reference records. Never use these as hosted evidence. */
export function draftReferenceFixture(count: 1 | 2 | 3 = 1, approvedContext = true, filenameInstruction: string | null = null) {
  const fixture = draftDocumentFixture("VOLUNTEER", "Completed", false, "YEAR", "OMIT_ENTRY", "https://portfolio.example.test/casey"), r = fixture.r;
  r.line.selected_reference_sheet = true; r.rule.reference_timing = "REQUIRED_NOW"; r.rule.reference_count = count;
  r.referenceFilenameInstruction = filenameInstruction;
  r.referenceMetadata = { permissions: [], versions: [], records: [], payloads: [] };
  const references: DraftReferenceInput[] = [], referencePayloads = [];
  for (let index = 0; index < count; index += 1) {
    const permissionId = id(100 + index), recordId = id(200 + index), recordVersionId = id(300 + index), payloadId = id(400 + index);
    const payload = { schemaVersion: "chunk5-reference-record-v1", name: `Morgan Reference ${index + 1}`, title: "Program coordinator", organization: "Example volunteer center",
      relationship: "Volunteer supervisor", email: `reference${index + 1}@example.test`, phone: `212-555-010${index}`,
      sharedWorkContext: "Private internal context that must not be rendered or sent to a model", capabilitiesCanVerify: ["Private capability notes"],
      approvedContextLine: approvedContext ? "Supervised community event scheduling." : null };
    const plaintext = Buffer.from(JSON.stringify(payload)), contentSha256 = hash(plaintext), permission = { id: permissionId, customer_id: r.purchase.customer_id,
      delivered_release_id: r.intent.delivered_release_id, job_snapshot_id: r.job.id, job_snapshot_hash: r.job.content_sha256,
      reference_record_version_id: recordVersionId, revoked_at: null, contact_version_changed_at: null };
    r.referencePermissionIds.push(permissionId); r.referencePermissions.push(permission);
    r.referenceMetadata.permissions.push({ ...permission, attested_at: "2026-10-25T10:00:00.000Z" });
    r.referenceMetadata.versions.push({ id: recordVersionId, reference_record_id: recordId, version: 1, encrypted_payload_id: payloadId,
      payload_sha256: contentSha256, payload_schema_version: "chunk5-reference-record-v1", permission_status: "CONFIRMED",
      permission_last_confirmed_at: "2026-10-25T10:00:00.000Z", superseded_at: null });
    r.referenceMetadata.records.push({ id: recordId, customer_id: r.purchase.customer_id, current_version: 1, removed_at: null, retention_state: "ACTIVE" });
    r.referenceMetadata.payloads.push({ id: payloadId, customer_id: r.purchase.customer_id, content_sha256: contentSha256, retention_state: "ACTIVE", encryption_context_hash: "d".repeat(64) });
    references.push({ permissionId, recordVersionId, payloadId, plaintext }); referencePayloads.push(payload);
  }
  const packet = buildDraftingEvidencePacket(r, fixture.input.packet.expected, draftFixtureNow);
  const proposal = validateDraftOutput(fixture.draft, packet, draftFixtureNow);
  const input = { ...fixture.input, packet, proposal, references };
  return { input, r, draft: fixture.draft, references, referencePayloads, referenceBindings: packet.ownerEvidence.referenceBindings!,
    build: () => buildDraftRenderSource(input, draftFixtureNow) };
}
