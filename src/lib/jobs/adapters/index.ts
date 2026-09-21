import { getSource, sourceMayBeAccessedAutomatically } from "../source-registry";
import type { JobSourceAdapter } from "./types";
import { LeverAdapter } from "./lever";
import { GreenhouseAdapter } from "./greenhouse";
import { AshbyAdapter } from "./ashby";
import { RecruiteeAdapter } from "./recruitee";
import { TeamtailorAdapter } from "./teamtailor";
import { OfficialLinkAdapter } from "./official-link";
import type { RuntimeSourceAuthorization } from "./types";

export function createSourceAdapter(sourceId: string, runtimeAuthorization?: RuntimeSourceAuthorization): JobSourceAdapter {
  const registeredSource = getSource(sourceId);
  if (!registeredSource || !registeredSource.isActive) throw new Error("Unknown or inactive job source.");
  const supportsStructuredEnumeration = ["lever", "greenhouse", "ashby", "recruitee", "teamtailor"].includes(registeredSource.adapterKind);
  let source = registeredSource;
  if (supportsStructuredEnumeration) {
    if (runtimeAuthorization) {
      if (
        runtimeAuthorization.sourceId !== registeredSource.id
        || runtimeAuthorization.state !== "AUTHORIZED_AUTOMATED"
        || runtimeAuthorization.accessMethod !== "AUTOMATED"
        || !runtimeAuthorization.allowedActions.includes("ENUMERATE_JOBS")
        || runtimeAuthorization.allowedHosts.length === 0
      ) throw new Error("Current employer source authorization does not permit automated enumeration.");
      source = {
        ...registeredSource,
        authorizationStatus: "AUTHORIZED_AUTOMATED",
        authorizationEvidenceId: runtimeAuthorization.id,
        authorizationVersion: runtimeAuthorization.authorizationVersion,
        authorizationAllowedHosts: runtimeAuthorization.allowedHosts,
      };
    } else if (!sourceMayBeAccessedAutomatically(registeredSource)) {
      throw new Error("Source automation is not documentarily authorized.");
    }
    if (source.adapterKind === "lever") return new LeverAdapter(source);
    if (source.adapterKind === "greenhouse") return new GreenhouseAdapter(source);
    if (source.adapterKind === "ashby") return new AshbyAdapter(source);
    if (source.adapterKind === "recruitee") return new RecruiteeAdapter(source);
    if (source.adapterKind === "teamtailor") return new TeamtailorAdapter(source);
  }
  return new OfficialLinkAdapter(source);
}

export type { JobEnumerationOptions, JobEnumerationResult, JobSourceAdapter, RuntimeSourceAuthorization, SourceHealth } from "./types";
