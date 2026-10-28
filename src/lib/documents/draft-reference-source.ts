import { createHash } from "node:crypto";
import { isUint8Array } from "node:util/types";
import { z } from "zod";
import { referencePayloadSchema } from "@/lib/materials/reference-contract";
import type { DraftRenderSource } from "./draft-render-source";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const draftReferenceBindingSchema = z.object({ permissionId: uuid, recordId: uuid, recordVersionId: uuid,
  recordVersion: z.number().int().positive(), payloadId: uuid, contentSha256: hash,
  permissionConfirmedAt: z.iso.datetime({ offset: true }), deliveredReleaseId: uuid, jobSnapshotId: uuid, jobSha256: hash }).strict();
export type DraftReferenceSourceBinding = z.infer<typeof draftReferenceBindingSchema>;
export const draftReferenceSourceBindingSchema = draftReferenceBindingSchema;
export type DraftReferenceInput = { permissionId: string; recordVersionId: string; payloadId: string; plaintext: Uint8Array };
export const DRAFT_REFERENCE_FIELDS = ["name", "title", "organization", "relationship", "email", "phone", "approvedContextLine"] as const;
export type DraftReferenceField = typeof DRAFT_REFERENCE_FIELDS[number];
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const ensure = (value: unknown): void => { if (!value) throw new Error("DRAFT_REFERENCE_SOURCE_INVALID"); };

/** Decode already-authorized private records locally. Only explicit public-on-
 * the-sheet fields leave this helper; work context and capability notes never
 * become source claims or model input. Callers retain ownership of input bytes. */
function decodeReferenceSources(rawBindings: readonly DraftReferenceSourceBinding[], inputs: readonly DraftReferenceInput[], now: Date) {
  const bindings = z.array(draftReferenceBindingSchema).min(1).max(3).parse(rawBindings);
  ensure(Number.isFinite(now.getTime()) && inputs.length === bindings.length
    && new Set(bindings.map((binding) => binding.permissionId)).size === bindings.length
    && new Set(bindings.map((binding) => binding.recordId)).size === bindings.length
    && new Set(bindings.map((binding) => binding.recordVersionId)).size === bindings.length
    && new Set(bindings.map((binding) => binding.payloadId)).size === bindings.length
    && new Set(inputs.map((input) => input.permissionId)).size === inputs.length);
  return bindings.map((binding) => {
    const input = inputs.find((candidate) => candidate.permissionId === binding.permissionId); let owned: Buffer | undefined;
    try {
      ensure(input && input.recordVersionId === binding.recordVersionId && input.payloadId === binding.payloadId
        && Date.parse(binding.permissionConfirmedAt) <= now.getTime() && isUint8Array(input.plaintext)
        && input.plaintext.byteLength > 0 && input.plaintext.byteLength <= 32_768);
      owned = Buffer.from(input!.plaintext); ensure(digest(owned) === binding.contentSha256);
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(owned)) as Record<string, unknown>;
      ensure(body.schemaVersion === "chunk5-reference-record-v1"); const { schemaVersion: _version, ...values } = body; void _version;
      const reference = referencePayloadSchema.parse(values);
      return { binding, fields: DRAFT_REFERENCE_FIELDS.flatMap((field) => {
        const value = reference[field]; return typeof value === "string" && value.length ? [{ field, value }] : [];
      }) };
    } finally { owned?.fill(0); }
  });
}

export function readDraftReferenceSources(rawBindings: readonly DraftReferenceSourceBinding[], inputs: readonly DraftReferenceInput[], now: Date) {
  try { return decodeReferenceSources(rawBindings, inputs, now); }
  catch { throw new Error("DRAFT_REFERENCE_SOURCE_INVALID"); }
}

/** Rebind saved visible reference text to freshly reread authorized payloads.
 * Contact header authorization is checked separately by the caller. */
export function validateDraftReferenceSource(sheet: DraftRenderSource["referenceSheet"], bindings: readonly DraftReferenceSourceBinding[] | undefined,
  inputs: readonly DraftReferenceInput[], now: Date): void {
  if (!sheet) { ensure(!bindings?.length && inputs.length === 0); return; }
  ensure(bindings && sheet.records.length === bindings.length);
  const decoded = readDraftReferenceSources(bindings!, inputs, now);
  ensure(new Set(sheet.records.map((row) => row.permissionId)).size === decoded.length);
  sheet.records.forEach((row, index) => {
    const expected = decoded.find((entry) => entry.binding.permissionId === row.permissionId);
    ensure(expected && row.recordVersionId === expected.binding.recordVersionId && row.payloadId === expected.binding.payloadId
      && row.contentSha256 === expected.binding.contentSha256 && row.fields.length === expected.fields.length);
    row.fields.forEach((claim, fieldIndex) => {
      const field = expected!.fields[fieldIndex], binding = claim.referenceBinding;
      ensure(field && claim.text === field.value && claim.wordingSha256 === digest(field.value)
        && claim.placement === `referenceSheet.records.${index}.${field.field}` && claim.kind === "REFERENCE_PERMISSION"
        && claim.origin === "LOCAL_REFERENCE" && claim.qualification === "EXACT" && claim.state === "OWNER_REVIEW_REQUIRED"
        && claim.factRefs.length === 0 && claim.jobEvidenceIds.length === 0 && claim.questionInsights.length === 0 && claim.contactBinding === null
        && claim.referencePermissionIds.length === 1 && claim.referencePermissionIds[0] === row.permissionId
        && binding?.permissionId === row.permissionId && binding.recordVersionId === row.recordVersionId
        && binding.payloadId === row.payloadId && binding.contentSha256 === row.contentSha256 && binding.field === field.field);
    });
  });
}
