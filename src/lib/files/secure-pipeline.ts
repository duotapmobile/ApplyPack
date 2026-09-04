import "server-only";

import { createHash } from "node:crypto";

export const pipelineStages = [
  "QUARANTINED",
  "MALWARE_SCAN",
  "SANDBOXED_PARSE",
  "REFERENCE_ISOLATION",
  "LEAK_SCAN",
  "MODEL_READY",
] as const;

export type PipelineStage = (typeof pipelineStages)[number];

export type ParserLimits = {
  maxExpandedBytes: number;
  maxPages: number;
  maxMilliseconds: number;
  maxMemoryBytes: number;
};

export type PipelineConfiguration = {
  enabled: boolean;
  malwareScannerIdentity: string | null;
  permittedModelPolicy: string | null;
  parserIdentity: string | null;
  parserLimits: ParserLimits | null;
};

export type MalwareVerdict = "CLEAN" | "BLOCKED" | "UNKNOWN";

export type SecurePipelineAdapters = {
  malwareScan(bytes: Uint8Array): Promise<{ verdict: MalwareVerdict; reference: string | null }>;
  parseLocally(bytes: Uint8Array, options: ParserLimits & { externalEntities: false; externalReferences: false; network: false }): Promise<{ text: string; pageCount: number; reference: string }>;
};

export type ReferenceIsolation = {
  cleanText: string;
  disposition: "CLEAR" | "DETECTED" | "UNCERTAIN";
  quarantinedBlocks: string[];
};

export type PipelineResult = {
  errorCode: string | null;
  modelInput: string | null;
  parserReference: string | null;
  quarantinedReferenceBlocks: string[];
  sha256: string;
  stage: PipelineStage;
  stageHistory: PipelineStage[];
};

export function pipelineConfiguration(environment: Partial<NodeJS.ProcessEnv> = process.env): PipelineConfiguration {
  const integer = (name: string) => {
    const value = environment[name];
    if (!value || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const maxExpandedBytes = integer("APP_PARSER_MAX_EXPANDED_BYTES");
  const maxPages = integer("APP_PARSER_MAX_PAGES");
  const maxMilliseconds = integer("APP_PARSER_MAX_MILLISECONDS");
  const maxMemoryBytes = integer("APP_PARSER_MAX_MEMORY_BYTES");
  const parserLimits = [maxExpandedBytes, maxPages, maxMilliseconds, maxMemoryBytes].every((value) => value !== null)
    ? { maxExpandedBytes: maxExpandedBytes!, maxPages: maxPages!, maxMilliseconds: maxMilliseconds!, maxMemoryBytes: maxMemoryBytes! }
    : null;
  return {
    enabled: environment.APP_FILE_PROCESSING_ENABLED === "true",
    malwareScannerIdentity: environment.APP_MALWARE_SCANNER_IDENTITY?.trim() || null,
    permittedModelPolicy: environment.APP_PERMITTED_MODEL_POLICY?.trim() || null,
    parserIdentity: environment.APP_SANDBOXED_PARSER_IDENTITY?.trim() || null,
    parserLimits,
  };
}

export function pipelineReady(configuration: PipelineConfiguration) {
  return configuration.enabled
    && Boolean(configuration.malwareScannerIdentity)
    && Boolean(configuration.parserIdentity)
    && Boolean(configuration.permittedModelPolicy)
    && configuration.parserLimits !== null;
}

const referenceHeading = /^\s*(professional\s+)?references?\s*:?[\s]*$/iu;
const possibleReference = /\b(reference|referee|recommender|supervisor contact|permission to contact)\b/iu;

export function isolateReferenceBlocks(text: string): ReferenceIsolation {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const withheld = new Set<number>();
  let disposition: ReferenceIsolation["disposition"] = "CLEAR";
  for (let index = 0; index < lines.length; index += 1) {
    if (referenceHeading.test(lines[index])) {
      disposition = "DETECTED";
      for (let cursor = index; cursor < Math.min(lines.length, index + 8); cursor += 1) withheld.add(cursor);
    } else if (possibleReference.test(lines[index])) {
      if (disposition !== "DETECTED") disposition = "UNCERTAIN";
      withheld.add(index);
      if (index + 1 < lines.length) withheld.add(index + 1);
    }
  }
  const blocks: string[] = [];
  let current: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (withheld.has(index)) current.push(lines[index]);
    else if (current.length) { blocks.push(current.join("\n")); current = []; }
  }
  if (current.length) blocks.push(current.join("\n"));
  return {
    cleanText: lines.filter((_, index) => !withheld.has(index)).join("\n").replace(/\n{3,}/gu, "\n\n").trim(),
    disposition,
    quarantinedBlocks: blocks,
  };
}

export function referenceLeakDetected(cleanText: string, quarantinedBlocks: readonly string[]) {
  const normalizedClean = cleanText.normalize("NFC").toLowerCase();
  const sensitiveTokens = quarantinedBlocks.flatMap((block) => [
    ...(block.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []),
    ...(block.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/gu) ?? []),
  ]).map((token) => token.normalize("NFC").toLowerCase());
  return sensitiveTokens.some((token) => normalizedClean.includes(token));
}

export async function runSecureDocumentPipeline(
  bytes: Uint8Array,
  configuration: PipelineConfiguration,
  adapters: SecurePipelineAdapters,
): Promise<PipelineResult> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const history: PipelineStage[] = ["QUARANTINED"];
  const fail = (stage: PipelineStage, errorCode: string, parserReference: string | null = null, blocks: string[] = []): PipelineResult => ({
    errorCode, modelInput: null, parserReference, quarantinedReferenceBlocks: blocks, sha256, stage, stageHistory: history,
  });
  if (!pipelineReady(configuration)) return fail("QUARANTINED", "pipeline_not_configured");

  history.push("MALWARE_SCAN");
  let malware: Awaited<ReturnType<SecurePipelineAdapters["malwareScan"]>>;
  try { malware = await adapters.malwareScan(bytes); }
  catch { return fail("MALWARE_SCAN", "malware_scanner_unavailable"); }
  if (malware.verdict !== "CLEAN") return fail("MALWARE_SCAN", malware.verdict === "BLOCKED" ? "malware_detected" : "malware_verdict_unknown");

  history.push("SANDBOXED_PARSE");
  let parsed: Awaited<ReturnType<SecurePipelineAdapters["parseLocally"]>>;
  try {
    parsed = await adapters.parseLocally(bytes, { ...configuration.parserLimits!, externalEntities: false, externalReferences: false, network: false });
  } catch {
    return fail("SANDBOXED_PARSE", "sandboxed_parse_failed");
  }
  if (!parsed.text.trim()) return fail("SANDBOXED_PARSE", "document_has_no_readable_text", parsed.reference);
  if (parsed.pageCount < 1 || parsed.pageCount > configuration.parserLimits!.maxPages) return fail("SANDBOXED_PARSE", "document_page_limit", parsed.reference);
  if (Buffer.byteLength(parsed.text, "utf8") > configuration.parserLimits!.maxExpandedBytes) return fail("SANDBOXED_PARSE", "document_expansion_limit", parsed.reference);

  history.push("REFERENCE_ISOLATION");
  const isolated = isolateReferenceBlocks(parsed.text);
  if (isolated.disposition === "UNCERTAIN") return fail("REFERENCE_ISOLATION", "reference_isolation_uncertain", parsed.reference, isolated.quarantinedBlocks);

  history.push("LEAK_SCAN");
  if (referenceLeakDetected(isolated.cleanText, isolated.quarantinedBlocks)) {
    return fail("LEAK_SCAN", "reference_pii_leak_detected", parsed.reference, isolated.quarantinedBlocks);
  }

  history.push("MODEL_READY");
  return {
    errorCode: null,
    modelInput: isolated.cleanText,
    parserReference: parsed.reference,
    quarantinedReferenceBlocks: isolated.quarantinedBlocks,
    sha256,
    stage: "MODEL_READY",
    stageHistory: history,
  };
}
