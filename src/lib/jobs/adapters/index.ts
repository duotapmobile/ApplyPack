import { getSource, sourceMayBeAccessedAutomatically } from "../source-registry";
import type { JobSourceAdapter } from "./types";
import { LeverAdapter } from "./lever";
import { OfficialLinkAdapter } from "./official-link";

export function createSourceAdapter(sourceId: string): JobSourceAdapter {
  const source = getSource(sourceId);
  if (!source || !source.isActive) throw new Error("Unknown or inactive job source.");
  if (source.adapterKind === "lever") {
    if (!sourceMayBeAccessedAutomatically(source)) throw new Error("Source automation is not documentarily authorized.");
    return new LeverAdapter(source);
  }
  return new OfficialLinkAdapter(source);
}

export type { JobSourceAdapter, SourceHealth } from "./types";
