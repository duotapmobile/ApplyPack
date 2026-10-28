import { createHash } from "node:crypto";
import { chmod, chown, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { SIGNING_HELPER } from "./lib/aws-roles-anywhere.mjs";

const output = process.argv[2];
if (process.platform !== "linux" || process.arch !== "x64" || process.getuid() !== 0
  || !output || !isAbsolute(output) || output !== "/usr/local/bin/aws_signing_helper") {
  throw new Error("aws_signing_helper_install_requires_linux_x64_root_and_fixed_output");
}
// Only the pinned source-build stage can supply this artifact. There is no network fallback.
const input = "/opt/applypack-helper-input/aws_signing_helper";
const metadata = await lstat(input);
if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== 0 || metadata.gid !== 0
  || (metadata.mode & 0o022) !== 0 || metadata.size <= 0 || metadata.size > 50 * 1024 * 1024) {
  throw new Error("aws_signing_helper_input_invalid");
}
const bytes = await readFile(input);
if (bytes.length !== metadata.size || createHash("sha256").update(bytes).digest("hex") !== SIGNING_HELPER.sha256) {
  throw new Error("aws_signing_helper_checksum_mismatch");
}
await mkdir(dirname(output), { recursive: true, mode: 0o755 });
await writeFile(output, bytes, { mode: 0o755, flag: "wx" });
await chown(output, 0, 0);
await chmod(output, 0o755);
console.log(JSON.stringify({ installed: true, version: SIGNING_HELPER.version, sha256: SIGNING_HELPER.sha256,
  input: "pinned-local-security-rebuild", executed: false, networkUsed: false }));
