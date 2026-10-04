import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sqlPath = fileURLToPath(new URL("./preflight-inventory-identity-conflicts.sql", import.meta.url));
const sql = readFileSync(sqlPath, "utf8");
const mode = process.argv[2];

if (!["--local", "--remote"].includes(mode) || process.argv.length !== 3) {
  console.error("Usage: node scripts/check-inventory-identity-conflicts.mjs --local|--remote");
  process.exit(2);
}

let input = sql;
let secret = "";
if (mode === "--remote") {
  secret = process.env.AP_PREMIGRATION_DATABASE_URL?.trim() ?? "";
  if (!secret) {
    console.error("AP_PREMIGRATION_DATABASE_URL is required for --remote and must be injected securely.");
    process.exit(2);
  }
  let parsed;
  try {
    parsed = new URL(secret);
  } catch {
    parsed = null;
  }
  const sslModes = parsed?.searchParams.getAll("sslmode").map((value) => value.toLowerCase()) ?? [];
  if (
    !parsed
    || !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !parsed.hostname
    || /[\r\n']/.test(secret)
    || sslModes.length !== 1
    || sslModes[0] !== "verify-full"
  ) {
    console.error("AP_PREMIGRATION_DATABASE_URL must be a single-line PostgreSQL URI using exactly sslmode=verify-full; reserved characters must be percent-encoded.");
    process.exit(2);
  }
  input = `\\connect '${secret}'\n${sql}`;
}

const result = spawnSync(
  "docker",
  ["exec", "-i", "supabase_db_applypack", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  { cwd: process.cwd(), encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 },
);

const redact = (value) => secret ? (value ?? "").split(secret).join("[REDACTED_DATABASE_URL]") : (value ?? "");
if (result.stdout) process.stdout.write(redact(result.stdout));
if (result.stderr) process.stderr.write(redact(result.stderr));
if (result.error) {
  console.error(result.error.message);
  process.exit(2);
}

process.exit(result.status ?? 2);
