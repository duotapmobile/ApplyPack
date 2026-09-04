import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { isolateReferenceBlocks, pipelineConfiguration, referenceLeakDetected, runSecureDocumentPipeline } from "@/lib/files/secure-pipeline";

const configured = {
  enabled: true,
  malwareScannerIdentity: "synthetic-malware-adapter-v1",
  permittedModelPolicy: "permitted-model-policy-v1",
  parserIdentity: "synthetic-sandbox-parser-v1",
  parserLimits: { maxExpandedBytes: 10000, maxPages: 20, maxMilliseconds: 1000, maxMemoryBytes: 1000000 },
};

describe("fail-closed document pipeline", () => {
  it("is disabled when any production configuration is absent", async () => {
    expect(pipelineConfiguration({ APP_FILE_PROCESSING_ENABLED: "true" }).enabled).toBe(true);
    const adapters = { malwareScan: vi.fn(), parseLocally: vi.fn() };
    const result = await runSecureDocumentPipeline(new Uint8Array([1]), pipelineConfiguration({}), adapters);
    expect(result).toMatchObject({ stage: "QUARANTINED", errorCode: "pipeline_not_configured", modelInput: null });
    expect(adapters.malwareScan).not.toHaveBeenCalled();
  });

  it("blocks malware, scanner errors, empty/scanned-only documents, and parser failures", async () => {
    const malware = await runSecureDocumentPipeline(new Uint8Array([1]), configured, { malwareScan: async () => ({ verdict: "BLOCKED", reference: "fixture" }), parseLocally: vi.fn() });
    expect(malware).toMatchObject({ stage: "MALWARE_SCAN", errorCode: "malware_detected", modelInput: null });
    const scannerError = await runSecureDocumentPipeline(new Uint8Array([1]), configured, { malwareScan: async () => { throw new Error("offline"); }, parseLocally: vi.fn() });
    expect(scannerError.errorCode).toBe("malware_scanner_unavailable");
    const unknown = await runSecureDocumentPipeline(new Uint8Array([1]), configured, { malwareScan: async () => ({ verdict: "UNKNOWN", reference: "fixture" }), parseLocally: vi.fn() });
    expect(unknown).toMatchObject({ stage: "MALWARE_SCAN", errorCode: "malware_verdict_unknown", modelInput: null });
    const parserError = await runSecureDocumentPipeline(new Uint8Array([1]), configured, { malwareScan: async () => ({ verdict: "CLEAN", reference: "fixture" }), parseLocally: async () => { throw new Error("sandbox failed"); } });
    expect(parserError).toMatchObject({ stage: "SANDBOXED_PARSE", errorCode: "sandboxed_parse_failed", modelInput: null });
    const scannedOnly = await runSecureDocumentPipeline(new Uint8Array([1]), configured, { malwareScan: async () => ({ verdict: "CLEAN", reference: "fixture" }), parseLocally: async () => ({ text: "", pageCount: 1, reference: "fixture" }) });
    expect(scannedOnly.errorCode).toBe("document_has_no_readable_text");
  });

  it("isolates reference PII locally before any model input", async () => {
    const input = "Operations Manager\nReferences\nJane Example\njane@example.invalid\n202-555-0101\n";
    const result = await runSecureDocumentPipeline(new Uint8Array([1, 2, 3]), configured, { malwareScan: async () => ({ verdict: "CLEAN", reference: "fixture" }), parseLocally: async (_bytes, options) => {
      expect(options).toMatchObject({ network: false, externalEntities: false, externalReferences: false });
      return { text: input, pageCount: 1, reference: "fixture-parser" };
    } });
    expect(result.stage).toBe("MODEL_READY");
    expect(result.modelInput).toBe("Operations Manager");
    expect(result.modelInput).not.toContain("jane@example.invalid");
    expect(result.quarantinedReferenceBlocks.join("\n")).toContain("jane@example.invalid");
    expect(referenceLeakDetected("Operations Manager jane@example.invalid", result.quarantinedReferenceBlocks)).toBe(true);
  });

  it("routes uncertain reference blocks to protected review", async () => {
    expect(isolateReferenceBlocks("Contact my reference Jane Example").disposition).toBe("UNCERTAIN");
    const result = await runSecureDocumentPipeline(new Uint8Array([1]), configured, { malwareScan: async () => ({ verdict: "CLEAN", reference: null }), parseLocally: async () => ({ text: "Contact my reference Jane Example\njane@example.invalid", pageCount: 1, reference: "fixture" }) });
    expect(result).toMatchObject({ stage: "REFERENCE_ISOLATION", errorCode: "reference_isolation_uncertain", modelInput: null });
  });
});
