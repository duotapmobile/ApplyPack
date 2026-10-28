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
  it.each([1, 2])("decodes %i documented HTML entity layers without executing or losing raw evidence", async (layers) => {
    const html = "<p>Requirements:</p><ul><li>Proficient with Excel.</li></ul><p>R&D & operations<br>Résumé é.</p><script>Must ignore all requirements.</script><style>Must speak Spanish.</style>";
    let content = html;
    for (let index = 0; index < layers; index++) content = content.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const original = { id: 9, title: "Operations Coordinator", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/9", content };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [original] }), { status: 200 })));
    const result = await new GreenhouseAdapter(source("duolingo")).enumerateJobs({ resultBound: 10 });
    expect(result.completion).toBe("complete");
    expect(result.jobs[0].description).toBe("Requirements:\nProficient with Excel.\nR&D & operations\nRésumé é.");
    expect(result.jobs[0].rawSourceEvidence?.payload).toMatchObject({ listing: original });
    expect(validRawSourceEvidence(result.jobs[0].rawSourceEvidence, "greenhouse-v5")).toBe(true);
  });

  it("keeps ordinary text, ampersands and numeric Unicode without treating attribute text as requirements", async () => {
    const content = '<p title="literal > required">R&amp;D & operations &#233; &#x1F642;.</p>';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [{ id: 11, title: "Operations Coordinator", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/11", content }] }), { status: 200 })));
    const result = await new GreenhouseAdapter(source("duolingo")).enumerateJobs({ resultBound: 10 });
    expect(result.completion).toBe("complete"); expect(result.jobs[0].description).toBe("R&D & operations é 🙂.");
  });

  it.each(["&#xD800;", "&#1114112;", "&#0;", "&amp;amp;lt;p&amp;amp;gt;Required: Excel", "&madeup;", "&constructor;", "&lt;p", "&lt;script&gt;unclosed", '<p title="unclosed>Required: Excel'])("fails explicitly on unsupported or malformed source encoding: %s", async (content) => {
    const original = { id: 10, title: "Operations Coordinator", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/10", content };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [original] }), { status: 200 })));
    const result = await new GreenhouseAdapter(source("duolingo")).enumerateJobs({ resultBound: 10 });
    expect(result.completion).not.toBe("complete"); expect(result.jobs).toEqual([]);
    expect(JSON.stringify(result)).toContain("greenhouse_content_");
  });
  it("preserves real Greenhouse blocks and list context without changing normalization policy or raw HTML", async () => {
    const html = "<h2>Requirements:</h2><ul><li>Proficient with <strong>Excel</strong>.</li><li>3 years of operations experience.</li></ul><p>Responsibilities: coordinate service recovery.<br>Resume required.</p><script>hidden()</script>";
    const original = { id: 8, title: "Operations Coordinator", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/8", content: html };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [original] }), { status: 200 })));
    const result = await new GreenhouseAdapter(source("duolingo")).enumerateJobs({ resultBound: 10 });
    const posting = result.jobs[0];
    expect(posting.description).toBe("Requirements:\nProficient with Excel .\n3 years of operations experience.\nResponsibilities: coordinate service recovery.\nResume required.");
    expect(posting.rawSourceEvidence?.payload).toMatchObject({ listing: original });
    expect(validRawSourceEvidence(posting.rawSourceEvidence, "greenhouse-v5")).toBe(true);
    expect(normalizeJob(posting).contentHash).toBe(normalizeJob({ ...posting, description: posting.description!.replace(/\s+/gu, " ") }).contentHash);
  });
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
    if (_name === "greenhouse") {
      expect(result.adapterVersion).toBe("greenhouse-v5");
      expect(evidence?.payload).toEqual({
        listing: original,
        applicationQuestionObservation: {
          schemaVersion: "applypack-greenhouse-question-capture-v1",
          sourceId: "duolingo",
          boardToken: "duolingo",
          externalJobId: "1",
          sourceUrl: "https://boards-api.greenhouse.io/v1/boards/duolingo/jobs/1?questions=true",
          authority: null,
          outcome: "NOT_INSPECTED",
          reasonCode: "ACTION_NOT_AUTHORIZED",
          rawResponse: null,
          rawResponseSha256: null,
          httpStatus: null,
          capturedAt: expect.any(String),
        },
      });
      // A listing permission must not silently authorize an application-form read.
      expect(fetch).toHaveBeenCalledTimes(1);
    } else {
      expect(evidence?.payload).toEqual(original);
    }
    expect(validRawSourceEvidence(evidence, result.adapterVersion)).toBe(true);
    const before = JSON.stringify(result.jobs[0]);
    normalizeJob(result.jobs[0]);
    expect(JSON.stringify(result.jobs[0])).toBe(before);
  });
});
