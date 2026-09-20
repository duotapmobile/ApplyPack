import { afterEach, describe, expect, it, vi } from "vitest";
import { captureRawSourceEvidence, validRawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { normalizeJob } from "@/lib/jobs/normalize";
import { getSource } from "@/lib/jobs/source-registry";
import { GreenhouseAdapter } from "@/lib/jobs/adapters/greenhouse";
import { LeverAdapter } from "@/lib/jobs/adapters/lever";
import { AshbyAdapter } from "@/lib/jobs/adapters/ashby";
import { RecruiteeAdapter } from "@/lib/jobs/adapters/recruitee";
import { TeamtailorAdapter } from "@/lib/jobs/adapters/teamtailor";
import type { SourceDefinition } from "@/lib/jobs/types";

afterEach(() => vi.unstubAllGlobals());
const unused = { providerExtension: { untouched: ["  original  ", 7, false] } };
const source = (id: string): SourceDefinition => ({ ...getSource(id)!, isActive: true, authorizationStatus: "AUTHORIZED_AUTOMATED", authorizationEvidenceId: "fixture-only" });
const custom = (kind: "recruitee" | "teamtailor"): SourceDefinition => ({ ...source("vipdesk-connect"),
  adapterKind: kind, adapterKey: "fixture", officialUrl: `https://fixture.${kind}.com`,
  alternateOfficialUrls: [], authorizationAllowedHosts: [`fixture.${kind}.com`] });

describe("raw provider record evidence", () => {
  it("uses deterministic object ordering without normalizing original text or aliasing input", () => {
    const payload = { z: ["  original  "], a: "A" };
    const evidence = captureRawSourceEvidence("fixture-v1", payload);
    expect(evidence.payloadSha256).toBe(captureRawSourceEvidence("fixture-v1", { a: "A", z: ["  original  "] }).payloadSha256);
    payload.z[0] = "changed";
    expect(evidence.payload).toEqual({ a: "A", z: ["  original  "] });
    expect(validRawSourceEvidence(evidence, "fixture-v1")).toBe(true);
    expect(validRawSourceEvidence({ ...evidence, payload: { a: "tampered" } }, "fixture-v1")).toBe(false);
    expect(validRawSourceEvidence(evidence, "fixture-v2")).toBe(false);
    expect(validRawSourceEvidence(undefined, "fixture-v1")).toBe(false);
    expect(() => captureRawSourceEvidence("fixture-v1", { missing: undefined })).toThrow("raw_source_evidence_not_json");
  });

  const greenhouse = { id: 1, title: "Operations Coordinator", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/1", content: "<p>Keep original HTML</p>", ...unused };
  const lever = { id: "1", text: "Operations Coordinator", hostedUrl: "https://jobs.lever.co/vipdesk/1", descriptionPlain: "Coordinate operations", ...unused };
  const ashby = { title: "Operations Coordinator", jobUrl: "https://jobs.ashbyhq.com/brightwheel/1", descriptionPlain: "Coordinate operations", ...unused };
  const recruitee = { id: 1, title: "Operations Coordinator", careers_url: "https://fixture.recruitee.com/o/1", description: "<p>Original</p>", ...unused };
  const rssItem = '<item custom="preserve"><title>Operations Coordinator</title><link>https://fixture.teamtailor.com/jobs/1</link><description><![CDATA[<p>Original</p>]]></description><unused>untouched</unused></item>';

  it.each([
    ["greenhouse", () => new GreenhouseAdapter(source("duolingo")), { jobs: [greenhouse] }, greenhouse],
    ["lever", () => new LeverAdapter(source("vipdesk-connect")), [lever], lever],
    ["ashby", () => new AshbyAdapter(source("brightwheel")), { jobs: [ashby] }, ashby],
    ["recruitee", () => new RecruiteeAdapter(custom("recruitee")), { offers: [recruitee] }, recruitee],
    ["teamtailor", () => new TeamtailorAdapter({ ...custom("teamtailor"), adapterKey: "https://fixture.teamtailor.com/jobs.rss" }), `<rss><channel>${rssItem}</channel></rss>`, rssItem],
  ] as const)("%s retains the complete provider record including unused fields", async (_name, build, response, original) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(typeof response === "string" ? response : JSON.stringify(response), { status: 200 })));
    const result = await build().enumerateJobs({ resultBound: 10 });
    expect(result.completion).toBe("complete");
    expect(result.jobs).toHaveLength(1);
    const evidence = result.jobs[0].rawSourceEvidence;
    expect(evidence?.payload).toEqual(original);
    expect(validRawSourceEvidence(evidence, result.adapterVersion)).toBe(true);
    const before = JSON.stringify(result.jobs[0]);
    normalizeJob(result.jobs[0]);
    expect(JSON.stringify(result.jobs[0])).toBe(before);
  });
});
