import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const base = "docs/evidence/launch-execution-2026-10-22/";
const inventory = JSON.parse(readFileSync(base + "preexisting-work.json", "utf8").replace(/^\uFEFF/, ""));
const paths = [
  "docs/runbooks/DEPLOYMENT.md",
  "docs/runbooks/LAUNCH_UNBLOCK_CLICKS.md",
  "docs/runbooks/MAINTENANCE_RUNNER.md",
];
const note = "> Historical record preserved from before the October 22 launch implementation. Use [Current launch operations](LAUNCH_OPERATIONS_INDEX.md) for execution. Provider facts and former credential, configuration, pricing and release directions below require current revalidation and do not override the governing amendments or revised launch plan.";
const patches = paths.map((file) => {
  const bytes = readFileSync(file);
  const expected = inventory.files.find((entry) => entry.path === file);
  if (!expected || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
    throw new Error(`Preserved source changed: ${file}`);
  }
  const lines = bytes.toString("utf8").replaceAll("\r\n", "\n").split("\n");
  if (!lines[0].startsWith("# ") || lines[1] !== "") throw new Error(`Unexpected heading: ${file}`);
  return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`,
    "@@ -1,3 +1,5 @@", ` ${lines[0]}`, " ", `+${note}`, "+", ` ${lines[2]}`, ""].join("\n");
});
const output = base + "HISTORICAL_RUNBOOKS.proposed.patch";
writeFileSync(output, patches.join(""), { flag: "wx" });
execFileSync("git", ["apply", "--check", output], { stdio: "inherit", windowsHide: true });
console.log(JSON.stringify({ status: "PASS", patch: output, protectedFilesUnchanged: paths.length, applied: false }));
