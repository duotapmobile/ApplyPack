import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { postgresBytea } from "@/lib/commerce/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  artifactId: z.uuid(),
  field: z.string().trim().min(1).max(100),
  documentText: z.string().trim().min(1).max(500),
  correctFact: z.string().trim().min(1).max(500),
}).strict();

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This request was rejected." }, 403);
  const lineId = z.uuid().safeParse((await route.params).id);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!lineId.success || !input.success) return response({ error: "Describe the document text and the correct fact." }, 400);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return response({ error: "Support intake is not configured." }, 503);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return response({ error: "Authentication required." }, 401);
  const rate = await consumeRateLimit({ request, scope: "chunk5_material_support", identity: authData.user.id, limit: 10, windowSeconds: 60 * 60 });
  if (!rate.configured) return response({ error: "Secure support controls are unavailable." }, 503);
  if (!rate.allowed) return response({ error: "Too many support submissions. Try again later." }, 429);
  const { data: line } = await admin.from("ap_material_lines").select("id,purchase_id").eq("id", lineId.data).maybeSingle();
  const { data: purchase } = line ? await admin.from("ap_material_purchases").select("customer_id").eq("id", line.purchase_id).maybeSingle() : { data: null };
  if (!line || purchase?.customer_id !== authData.user.id) return response({ error: "Materials line not found." }, 404);
  const { data: artifact } = await admin.from("ap_generated_artifacts").select("id")
    .eq("id", input.data.artifactId).eq("material_line_id", line.id).eq("customer_id", authData.user.id).maybeSingle();
  if (!artifact) return response({ error: "Artifact not found." }, 404);
  const payloadId = randomUUID();
  const plaintext = Buffer.from(JSON.stringify({
    schemaVersion: "chunk5-material-false-claim-v1",
    field: input.data.field,
    documentText: input.data.documentText,
    correctFact: input.data.correctFact,
  }), "utf8");
  try {
    const configuration = sensitivePayloadConfiguration();
    if (!sensitivePayloadEncryptionReady(configuration)) return response({ error: "Protected support intake is unavailable." }, 503);
    const envelope = await encryptSensitivePayload({
      plaintext,
      context: { customerId: authData.user.id, payloadId, purpose: "MATERIAL_FALSE_CLAIM_SUPPORT" },
      configuration,
      kms: remoteKmsAdapter(),
    });
    const stored = await admin.from("ap_sensitive_payloads").insert({
      id: payloadId,
      customer_id: authData.user.id,
      ciphertext: postgresBytea(envelope.ciphertext),
      encryption_algorithm: envelope.algorithm,
      encrypted_data_key: postgresBytea(envelope.encryptedDataKey),
      nonce: postgresBytea(envelope.nonce),
      authentication_tag: postgresBytea(envelope.authenticationTag),
      content_sha256: envelope.contentSha256,
      kms_key_identity: envelope.keyIdentity,
      kms_key_version: envelope.keyVersion,
      encryption_context_hash: envelope.encryptionContextHash,
    });
    if (stored.error) throw stored.error;
    const opened = await admin.rpc("ap_open_postdelivery_false_claim_case", {
      p_customer_id: authData.user.id,
      p_material_line_id: line.id,
      p_artifact_id: input.data.artifactId,
      p_sensitive_payload_id: payloadId,
      p_non_sensitive_report: {
        reportSha256: createHash("sha256").update(plaintext).digest("hex"),
        fieldLength: input.data.field.length,
        documentTextLength: input.data.documentText.length,
        correctFactLength: input.data.correctFact.length,
      },
    });
    if (opened.error || typeof opened.data !== "string") throw opened.error || new Error("support_case_insert_failed");
    return response({ supportCaseId: opened.data, downloadsRevoked: true }, 201);
  } catch {
    await admin.from("ap_sensitive_payloads").delete().eq("id", payloadId).eq("customer_id", authData.user.id);
    return response({ error: "The protected support case could not be opened." }, 503);
  } finally {
    plaintext.fill(0);
  }
}
