import { getSource } from "../source-registry";
import type { JobSourceAdapter } from "./types";
import { LeverAdapter } from "./lever";
import { OfficialLinkAdapter } from "./official-link";

export function createSourceAdapter(sourceId: string): JobSourceAdapter {
  const source = getSource(sourceId);
  if (!source || !source.isActive) throw new Error("Unknown or inactive job source.");
  if (source.adapterKind === "lever") return new LeverAdapter(source);
  return new OfficialLinkAdapter(source);
}

export type { JobSourceAdapter, SourceHealth } from "./types";
