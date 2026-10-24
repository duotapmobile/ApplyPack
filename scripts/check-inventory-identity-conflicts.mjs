import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  environmentWithoutPreflightSecrets,
  validateAndCanonicalizePreflightConnection,
} from "./inventory-preflight-connection.mjs";

const scriptDirectory = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : resolve(process.cwd(), "scripts");
const sqlPath = resolve(scriptDirectory, "preflight-inventory-identity-conflicts.sql");
const sql = readFileSync(sqlPath, "utf8");
export function runInventoryIdentityPreflight({
  mode,
  environment = process.env,
  cwd = process.cwd(),
  spawn = spawnSync,
}) {
  if (!["--local", "--remote"].includes(mode)) {
    return { status: 2, stdout: "", stderr: "Usage: node scripts/check-inventory-identity-conflicts.mjs --local|--remote\n" };
  }

  let input = sql;
  const redactions = [];
  if (mode === "--remote") {
    const suppliedUri = environment.AP_PREMIGRATION_DATABASE_URL?.trim() ?? "";
    if (!suppliedUri) {
      return { status: 2, stdout: "", stderr: "AP_PREMIGRATION_DATABASE_URL is required for --remote and must be injected securely.\n" };
    }
    let connection;
    try {
      connection = validateAndCanonicalizePreflightConnection({
        uri: suppliedUri,
        deploymentEnvironment: environment.AP_DEPLOYMENT_ENV ?? "",
        expectedHost: environment.AP_PREMIGRATION_EXPECTED_HOST ?? "",
        expectedPort: environment.AP_PREMIGRATION_EXPECTED_PORT ?? "",
        expectedDatabase: environment.AP_PREMIGRATION_EXPECTED_DATABASE ?? "",
        expectedLoginUser: environment.AP_PREMIGRATION_EXPECTED_LOGIN_USER ?? "",
        expectedCurrentUser: environment.AP_PREMIGRATION_EXPECTED_CURRENT_USER ?? "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Remote preflight target validation failed.";
      return { status: 2, stdout: "", stderr: `${message}\n` };
    }
    redactions.push(suppliedUri, connection.canonicalUri, connection.password, connection.decodedPassword);

    const connectionAttestation = `
select (
  pg_catalog.coalesce((
    select ssl from pg_catalog.pg_stat_ssl where pid=pg_catalog.pg_backend_pid()
  ),false)
  and pg_catalog.current_database()='${connection.expectedDatabase}'
  and current_user='${connection.expectedCurrentUser}'
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

  const result = spawn(
    "docker",
    ["exec", "-i", "supabase_db_applypack", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"],
    {
      cwd,
      encoding: "utf8",
      env: environmentWithoutPreflightSecrets(environment),
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    },
  );

  const redact = (value) => redactions
    .filter(Boolean)
    .reduce((output, secret) => output.split(secret).join("[REDACTED_DATABASE_CREDENTIAL]"), value ?? "");
  return {
    status: result.error ? 2 : (result.status ?? 2),
    stdout: redact(result.stdout),
    stderr: `${redact(result.stderr)}${result.error ? `${redact(result.error.message)}\n` : ""}`,
  };
}

if (process.argv[1] && import.meta.url.startsWith("file:") && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/check-inventory-identity-conflicts.mjs --local|--remote");
    process.exit(2);
  }
  const result = runInventoryIdentityPreflight({ mode: process.argv[2] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status);
}
