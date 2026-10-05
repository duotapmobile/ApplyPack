import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  environmentWithoutPreflightSecrets,
  validateAndCanonicalizePreflightConnection,
} from "./inventory-preflight-connection.mjs";

const sqlPath = fileURLToPath(new URL("./preflight-inventory-identity-conflicts.sql", import.meta.url));
const sql = readFileSync(sqlPath, "utf8");
const mode = process.argv[2];

if (!["--local", "--remote"].includes(mode) || process.argv.length !== 3) {
  console.error("Usage: node scripts/check-inventory-identity-conflicts.mjs --local|--remote");
  process.exit(2);
}

let input = sql;
const redactions = [];
if (mode === "--remote") {
  const suppliedUri = process.env.AP_PREMIGRATION_DATABASE_URL?.trim() ?? "";
  if (!suppliedUri) {
    console.error("AP_PREMIGRATION_DATABASE_URL is required for --remote and must be injected securely.");
    process.exit(2);
  }
  let connection;
  try {
    connection = validateAndCanonicalizePreflightConnection({
      uri: suppliedUri,
      expectedHost: process.env.AP_PREMIGRATION_EXPECTED_HOST ?? "",
      expectedPort: process.env.AP_PREMIGRATION_EXPECTED_PORT ?? "",
      expectedDatabase: process.env.AP_PREMIGRATION_EXPECTED_DATABASE ?? "",
      expectedUser: process.env.AP_PREMIGRATION_EXPECTED_USER ?? "",
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Remote preflight target validation failed.");
    process.exit(2);
  }
  redactions.push(suppliedUri, connection.canonicalUri, connection.password, connection.decodedPassword);

  const connectionAttestation = `
select (
  pg_catalog.coalesce((
    select ssl from pg_catalog.pg_stat_ssl where pid=pg_catalog.pg_backend_pid()
  ),false)
  and pg_catalog.current_database()='${connection.expectedDatabase}'
  and current_user='${connection.expectedUser}'
) as connection_attested
\\gset
\\if :connection_attested
  \\echo INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_ATTESTED
\\else
  \\echo INVENTORY_IDENTITY_PREFLIGHT_CONNECTION_REJECTED
  select 1/0;
\\endif
`;
  input = `\\connect '${connection.canonicalUri}'\n${connectionAttestation}\n${sql}`;
}

const result = spawnSync(
  "docker",
  ["exec", "-i", "supabase_db_applypack", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environmentWithoutPreflightSecrets(process.env),
    input,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 120_000,
  },
);

const redact = (value) => redactions
  .filter(Boolean)
  .reduce((output, secret) => output.split(secret).join("[REDACTED_DATABASE_CREDENTIAL]"), value ?? "");
if (result.stdout) process.stdout.write(redact(result.stdout));
if (result.stderr) process.stderr.write(redact(result.stderr));
if (result.error) {
  console.error(redact(result.error.message));
  process.exit(2);
}

process.exit(result.status ?? 2);
