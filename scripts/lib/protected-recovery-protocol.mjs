import { createHash } from "node:crypto";
import { z } from "zod";

export const RECOVERY_PROJECT = "spjaaxndiduhrcleazwb";
export const RECOVERY_BUCKETS = ["customer-source-documents", "customer-deliveries", "operator-drafts", "operator-render-previews"];
export const RECOVERY_TABLES = ["ap_document_versions", "ap_generated_file_versions", "ap_generated_artifacts", "ap_artifact_quality_reviews", "source_documents", "intakes", "intake_drafts", "apply_pack_items", "apply_pack_delivery_revisions", "ap_unpaid_source_cleanup"];
export const RECOVERY_LIMITS = Object.freeze({ objects: 10000, references: 40000, inventoryBytes: 8 * 1024 * 1024, objectBytes: 32 * 1024 * 1024, runMilliseconds: 5 * 60 * 1000 });
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const timestamp = z.iso.datetime();
export const recoveryKeySchema = z.string().min(1).max(1024).refine((key) => !/[\\\x00-\x1f\x7f%?#]/u.test(key)
  && key.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."), "Invalid storage key");
const bucket = z.enum(RECOVERY_BUCKETS);
const referenceIdentity = {
  table: z.enum(RECOVERY_TABLES), id: z.uuid(), field: z.string().regex(/^[a-z_]{1,60}$/u), bucket, key: recoveryKeySchema,
};
export const recoveryObjectSchema = z.object({ bucket, key: recoveryKeySchema, sourceVersion: sha,
  size: z.number().int().min(1).max(RECOVERY_LIMITS.objectBytes), expectedSha256: sha.nullable(), retentionExpiresAt: timestamp.nullable() }).strict();
export const recoveryReferenceSchema = z.object({ ...referenceIdentity, expectedSha256: sha.nullable(), retentionExpiresAt: timestamp.nullable() }).strict();
export const recoveryTombstoneSchema = z.object({ ...referenceIdentity, kind: z.enum(["DELETED", "REVOKED"]), effectiveAt: timestamp }).strict();
export const recoveryInventorySchema = z.object({ schemaVersion: z.literal("applypack-protected-recovery-inventory-v1"),
  sourceEnvironment: z.literal("production"), sourceProjectRef: z.literal(RECOVERY_PROJECT), releaseSha: z.string().regex(/^[a-f0-9]{40}$/u),
  startedAt: timestamp, completedAt: timestamp, inventoryDigest: sha,
  buckets: z.tuple([z.literal("customer-source-documents"), z.literal("customer-deliveries"), z.literal("operator-drafts"), z.literal("operator-render-previews")]),
  objects: z.array(recoveryObjectSchema).max(RECOVERY_LIMITS.objects), references: z.array(recoveryReferenceSchema).max(RECOVERY_LIMITS.references),
  tombstones: z.array(recoveryTombstoneSchema).max(RECOVERY_LIMITS.references),
  counts: z.object({ objects: z.number().int().nonnegative(), references: z.number().int().nonnegative(), tombstones: z.number().int().nonnegative(),
    tables: z.object(Object.fromEntries(RECOVERY_TABLES.map((table) => [table, z.number().int().nonnegative()]))).strict() }).strict(),
  receipt: z.string().min(64).max(4096),
}).strict();
export const recoveryCompletionSchema = z.object({ schemaVersion: z.literal("applypack-protected-recovery-completion-v1"),
  firstReceipt: z.string().min(64).max(4096), secondReceipt: z.string().min(64).max(4096),
  manifestSha256: sha, manifestVersionId: z.string().min(1).max(1024).regex(/^[A-Za-z0-9._~+\/=:-]+$/u),
  objectCount: z.number().int().min(0).max(RECOVERY_LIMITS.objects), referenceCount: z.number().int().min(0).max(RECOVERY_LIMITS.references),
  tombstoneCount: z.number().int().min(0).max(RECOVERY_LIMITS.references),
}).strict();
export const recoveryRetentionCompletionSchema = z.object({ schemaVersion: z.literal("applypack-protected-recovery-retention-completion-v1"),
  firstReceipt: z.string().min(64).max(4096), secondReceipt: z.string().min(64).max(4096),
  planSha256: sha, providerVerificationSha256: sha, deletedVersionCount: z.number().int().min(0).max(100000),
  retainedVersionCount: z.number().int().min(0).max(100000),
}).strict();
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const recoverySha256 = (value) => createHash("sha256").update(value).digest("hex");
export const recoveryCanonicalSha256 = (value) => recoverySha256(JSON.stringify(canonical(value)));
export const recoveryInventoryDigest = (inventory) => recoveryCanonicalSha256({ buckets: inventory.buckets, objects: inventory.objects, references: inventory.references,
  tombstones: inventory.tombstones, counts: inventory.counts });
