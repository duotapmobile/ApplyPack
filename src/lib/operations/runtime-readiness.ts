import "server-only";
import { pipelineConfiguration, pipelineReady, type PipelineConfiguration } from "@/lib/files/secure-pipeline";
import { probeDocumentIsolation, STRUCTURAL_POLICY } from "@/lib/files/isolated-extraction";
import { checkFileScannerHealth, fileScanConfiguration } from "@/lib/files/scanner";

export async function checkRuntimeFileSafety() {
  const scan = fileScanConfiguration();
  if (scan.mode === "disabled") return false;
  const configuration = pipelineConfiguration();
  const effective: PipelineConfiguration = scan.mode === "document_validation" ? { ...configuration, safetyPolicy: STRUCTURAL_POLICY } : configuration;
  if (!pipelineReady(effective) || !await probeDocumentIsolation()) return false;
  // The v1 policy is explicitly NOT_SCANNED; it is not a successful malware scan.
  return scan.mode === "document_validation" || scan.liveReady && await checkFileScannerHealth();
}
