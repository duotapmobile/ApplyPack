// @vitest-environment node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AWS document worker source template", () => {
  it("passes the offline CloudFormation and Docker security guard", () => {
    const output = execFileSync(process.execPath, [resolve(process.cwd(), "scripts/validate-aws-document-worker-template.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output.trim()).toBe("AWS_DOCUMENT_WORKER_TEMPLATE_OK");
  });
});
