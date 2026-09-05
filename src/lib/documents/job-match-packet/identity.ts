import { createHash } from "node:crypto";
import type { JobMatchPacketContent } from "./schema";
import {
  JOB_MATCH_PACKET_RENDERER_VERSION,
  JOB_MATCH_PACKET_TEMPLATE_VERSION,
} from "./versions";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function canonicalContentJson(content: JobMatchPacketContent): string {
  return JSON.stringify(stable(content));
}

export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function jobMatchPacketIdentity(content: JobMatchPacketContent): string {
  return sha256(JSON.stringify({
    content: JSON.parse(canonicalContentJson(content)),
    rendererVersion: JOB_MATCH_PACKET_RENDERER_VERSION,
    templateVersion: JOB_MATCH_PACKET_TEMPLATE_VERSION,
  }));
}

export function jobMatchPacketFilename(customerDisplayName: string): string {
  const safe = customerDisplayName
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
    .replace(/[. ]+$/gu, "")
    .replace(/\s+/gu, "_")
    .slice(0, 120) || "Customer";
  return `${safe}_ApplyPack_Job_Matches.pdf`;
}
