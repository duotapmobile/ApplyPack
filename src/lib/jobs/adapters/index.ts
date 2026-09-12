import { getSource, sourceMayBeAccessedAutomatically } from "../source-registry";
import type { JobSourceAdapter } from "./types";
import { LeverAdapter } from "./lever";
import { GreenhouseAdapter } from "./greenhouse";
import { AshbyAdapter } from "./ashby";
import { OfficialLinkAdapter } from "./official-link";

export function createSourceAdapter(sourceId: string): JobSourceAdapter {
  const source = getSource(sourceId);
  if (!source || !source.isActive) throw new Error("Unknown or inactive job source.");
  if (["lever", "greenhouse", "ashby"].includes(source.adapterKind)) {
    if (!sourceMayBeAccessedAutomatically(source)) throw new Error("Source automation is not documentarily authorized.");
    if (source.adapterKind === "lever") return new LeverAdapter(source);
    if (source.adapterKind === "greenhouse") return new GreenhouseAdapter(source);
    if (source.adapterKind === "ashby") return new AshbyAdapter(source);
  }
  return new OfficialLinkAdapter(source);
}

export type { JobSourceAdapter, SourceHealth } from "./types";
