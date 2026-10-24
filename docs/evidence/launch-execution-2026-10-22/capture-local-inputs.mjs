import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const expectedRoot = "C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
const root = git("rev-parse", "--show-toplevel").trim().replaceAll("\\", "/");
const remote = git("remote", "get-url", "origin").trim();
if (root !== expectedRoot || remote !== "https://github.com/duotapmobile/ApplyPack.git") {
  throw new Error("Canonical checkout identity mismatch");
}
const outputRoot = path.resolve("docs/evidence/launch-execution-2026-10-22");
const output = path.resolve(process.argv[2] || "");
if (!output.startsWith(outputRoot + path.sep) || path.extname(output) !== ".json") {
  throw new Error("Receipt must be a JSON file inside the execution evidence directory");
}
const excludedPrefixes = ["docs/evidence/launch-execution-2026-10-22/", "evidence/", "test-results/", "playwright-report/"];
const files = [...new Set(git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0").filter(Boolean))]
  .filter((file) => !excludedPrefixes.some((prefix) => file.startsWith(prefix)))
  .sort()
  .map((file) => {
    const bytes = readFileSync(file);
    return { path: file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
const receipt = {
  observedAt: new Date().toISOString(),
  collectorSha256: createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex"),
  scope: "Tracked and nonignored untracked repository inputs; local working-tree evidence only",
  root,
  remote,
  baselineHead: git("rev-parse", "HEAD").trim(),
  branch: git("branch", "--show-current").trim(),
  excludedPrefixes,
  excludedScope: "Execution receipts and generated render/browser outputs. Ignored dependencies and external tool binaries require their separate lock/tool receipts.",
  files,
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
process.stdout.write(`Captured ${files.length} repository inputs in ${path.relative(root, output)}\n`);
