import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { documentRendererConfiguration } from "@/lib/documents/renderer";
import { documentWorkerConfiguration, probeDocumentWorker } from "@/lib/files/aws-document-worker";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type Renderer = ReturnType<typeof documentRendererConfiguration>;
type Approval = {
  materials_generation_approved: boolean; materials_generation_approval_reference: string | null;
  material_output_formats: string[]; document_renderer_identity: string | null;
  document_font_family: string | null; document_font_sha256: string | null; document_safety_policy: string | null;
  document_worker_network_attestation_sha256: string | null;
};

export function rendererApprovalMatches(approval: Approval | null, runtime: Renderer) {
  return Boolean(approval && runtime.ready && approval.materials_generation_approved
    && approval.materials_generation_approval_reference?.trim()
    && approval.document_renderer_identity === runtime.identity
    && approval.document_font_family === "Arial"
    && approval.document_font_sha256 === runtime.documentFont.sha256
    && approval.document_safety_policy === "generated-structural-v1"
    && ["DOCX", "PDF"].every(format => approval.material_output_formats.includes(format)));
}

let identityCache: { key: string; expires: number; pending: Promise<boolean> } | null = null;
export async function rendererFilesMatch(runtime: Renderer) {
  if (!runtime.ready) return false;
  const key = JSON.stringify(runtime);
  if (identityCache?.key === key && identityCache.expires > Date.now()) return identityCache.pending;
  const pending = (async () => {
    try {
      for (const tool of [...Object.values(runtime.tools), runtime.documentFont]) {
        const actual = createHash("sha256").update(await readFile(tool.path)).digest("hex");
        if (actual !== tool.sha256) return false;
      }
      return true;
    } catch { return false; }
  })();
  identityCache = { key, expires: Date.now() + 60_000, pending };
  return pending;
}

export async function checkDocumentRendererReadiness(admin: AdminClient) {
  if (process.env.APP_RENDERER_RUNTIME_DISCOVERY_FAILED === "true") return false;
  const runtime = documentRendererConfiguration();
  const result = await admin.from("ap_commerce_configuration")
    .select("materials_generation_approved,materials_generation_approval_reference,material_output_formats,document_renderer_identity,document_font_family,document_font_sha256,document_safety_policy,document_worker_network_attestation_sha256")
    .eq("singleton", true).maybeSingle();
  if (result.error) return false;
  const approval = result.data as Approval | null;
  if (process.env.APP_DEPLOYMENT_ENV === "production") {
    const worker = documentWorkerConfiguration();
    return Boolean(approval && worker.ready && approval.materials_generation_approved
      && approval.materials_generation_approval_reference?.trim()
      && approval.document_renderer_identity === worker.identity
      && approval.document_font_family === "Arial"
      && approval.document_font_sha256 === worker.fontSha256
      && approval.document_worker_network_attestation_sha256 === worker.networkAttestationSha256
      && approval.document_safety_policy === "generated-structural-v1"
      && ["DOCX", "PDF"].every((format) => approval.material_output_formats.includes(format))
      && await probeDocumentWorker());
  }
  // The approval is never cached: revocation takes effect on the next readiness read.
  return rendererApprovalMatches(approval, runtime) && await rendererFilesMatch(runtime);
}
