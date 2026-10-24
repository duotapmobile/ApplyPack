import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve, relative, sep } from "node:path";

// Read-only capture of this Dockerfile's explicit context allowlist, including
// the Dockerfile-specific ignore file that Docker sends as build control data.
// Unknown ignore syntax fails instead of silently omitting a new build input.
const root = resolve(process.cwd());
const ignore = "Dockerfile.launch.dockerignore";
const rules = readFileSync(resolve(root, ignore), "utf8").split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
assert.equal(rules.shift(), "**", "context must start denied");
const files = new Set([ignore]);
function inspect(path, recursive = false) {
  const absolute = resolve(root, path);
  assert.ok(absolute.startsWith(root + sep), "input escapes checkout");
  const metadata = lstatSync(absolute);
  assert.equal(metadata.isSymbolicLink(), false, "symlink build inputs require separate review");
  if (metadata.isDirectory()) {
    if (recursive) for (const child of readdirSync(absolute)) inspect(`${path}/${child}`, true);
  } else {
    assert.ok(metadata.isFile(), "unsupported build input type");
    files.add(relative(root, absolute).replaceAll(sep, "/"));
  }
}
for (const rule of rules) {
  assert.ok(rule.startsWith("!"), "only explicit allow rules supported");
  const path = rule.slice(1);
  assert.ok(/^[A-Za-z0-9._/-]+(?:\/\*\*)?$/.test(path), "unknown ignore syntax requires review");
  assert.ok(!path.split("/").includes("..") && !path.startsWith("/"));
  inspect(path.endsWith("/**") ? path.slice(0, -3) : path.replace(/\/$/, ""), path.endsWith("/**"));
}
assert.ok(files.has("Dockerfile.launch"));
assert.ok([...files].some((path) => path.startsWith("infra/aws/roles-anywhere-helper/")));
const inventory = [...files].sort().map((path) => {
  const bytes = readFileSync(resolve(root, path));
  return { path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
console.log(JSON.stringify({ schemaVersion: 2, capturedAt: new Date().toISOString(),
  scope: "complete-allowlisted-local-uncommitted-launch-image-context",
  commit: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"),
  controlFile: ignore, files: inventory,
  inventorySha256: createHash("sha256").update(JSON.stringify(inventory)).digest("hex"),
}, null, 2));
