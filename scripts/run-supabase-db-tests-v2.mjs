import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { materialDraftStageContractFixture } from "./lib/material-draft-stage-fixture.mjs";
import { verifiedIntakeOwnershipContractFixture } from "./lib/verified-intake-ownership-fixture.mjs";

const historical085 = process.argv.length === 3 && process.argv[2] === "--historical-085";
const historical086 = process.argv.length === 3 && process.argv[2] === "--historical-086";
const historical087 = process.argv.length === 3 && process.argv[2] === "--historical-087";
const historical091 = process.argv.length === 3 && process.argv[2] === "--historical-091";
const historical092 = process.argv.length === 3 && process.argv[2] === "--historical-092";
const historical093 = process.argv.length === 3 && process.argv[2] === "--historical-093";
const historical094 = process.argv.length === 3 && process.argv[2] === "--historical-094";
const historical095 = process.argv.length === 3 && process.argv[2] === "--historical-095";
const historical096 = process.argv.length === 3 && process.argv[2] === "--historical-096";
const historical097 = process.argv.length === 3 && process.argv[2] === "--historical-097";
const historical098 = process.argv.length === 3 && process.argv[2] === "--historical-098";
const historical099 = process.argv.length === 3 && process.argv[2] === "--historical-099";
const historical100 = process.argv.length === 3 && process.argv[2] === "--historical-100";
const historical101 = process.argv.length === 3 && process.argv[2] === "--historical-101";
const historical102 = process.argv.length === 3 && process.argv[2] === "--historical-102";
const historical103 = process.argv.length === 3 && process.argv[2] === "--historical-103";
if (process.argv.length > 3 || (process.argv.length === 3 && !historical085 && !historical086 && !historical087 && !historical091 && !historical092 && !historical093 && !historical094 && !historical095 && !historical096 && !historical097 && !historical098 && !historical099 && !historical100 && !historical101 && !historical102 && !historical103)) {
  throw new Error("DATABASE_FIXTURE_PHASE_INVALID");
}
const requiredSchemaVersion = historical085 ? "202610220085" : historical086 ? "202610230086" : historical087 ? "202610240087" : historical091 ? "202610250091" : historical092 ? "202610250092" : historical093 ? "202610250093" : historical094 ? "202610250094" : historical095 ? "202610250095" : historical096 ? "202610250096" : historical097 ? "202610250097" : historical098 ? "202610250098" : historical099 ? "202610250099" : historical100 ? "202610250100" : historical101 ? "202610250101" : historical102 ? "202610260102" : historical103 ? "202610260103" : "202610270104";
const phaseProbe = spawnSync("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
  encoding: "utf8", input: `do $$ begin
    if public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion' is distinct from '${requiredSchemaVersion}'
      then raise exception 'database_fixture_schema_phase_mismatch'; end if;
    end $$;`, stdio: ["pipe", "pipe", "pipe"], timeout: 60_000,
});
if (phaseProbe.error || phaseProbe.status !== 0) throw new Error("DATABASE_FIXTURE_SCHEMA_PHASE_MISMATCH");
const fixtures = !historical085 && !historical086 ? [
  "../tests/integration/one-off-service-retention.sql",
  ...(requiredSchemaVersion >= "202610250091" ? ["../tests/integration/service-retention-cleanup.sql", "../tests/integration/confirmed-intake.sql", "../tests/integration/reviewed-commute.sql", "../tests/integration/material-draft-pair-workflow.sql", "../tests/integration/chunk5-materials-delivery.sql"] : []),
  ...(requiredSchemaVersion >= "202610250092" ? ["../tests/integration/material-rule-revalidation.sql"] : []),
  ...(requiredSchemaVersion >= "202610250093" ? ["../tests/integration/source-aware-document-acceptance.sql"] : []),
  ...(requiredSchemaVersion >= "202610250094" ? ["../tests/integration/material-draft-stage-claiming.sql"] : []),
  ...(requiredSchemaVersion >= "202610250095" ? ["../tests/integration/reference-aware-draft-delivery.sql"] : []),
  ...(requiredSchemaVersion >= "202610250096" ? ["../tests/integration/service-error-contract-and-triage.sql"] : []),
  ...(requiredSchemaVersion >= "202610250097" ? ["../tests/integration/material-draft-change-requests.sql"] : []),
  ...(requiredSchemaVersion >= "202610250098" ? ["../tests/integration/protected-archive-lifecycle.sql"] : []),
  ...(requiredSchemaVersion >= "202610250099" ? ["../tests/integration/scoped-service-error-repairs.sql"] : []),
  ...(requiredSchemaVersion >= "202610250100" ? ["../tests/integration/automatic-research-preparation.sql"] : []),
  ...(requiredSchemaVersion >= "202610250101" ? ["../tests/integration/material-clarification-confirmation.sql"] : []),
  ...(requiredSchemaVersion >= "202610260102" ? ["../tests/integration/service-repair-case-state.sql"] : []),
  ...(requiredSchemaVersion >= "202610260103" ? ["../tests/integration/material-clarification-resume.sql", "../tests/integration/verified-intake-ownership.sql", "../tests/integration/verified-intake-payment.sql"] : []),
  ...(requiredSchemaVersion >= "202610270104" ? ["../tests/integration/employer-rule-review-confirmation.sql"] : []),
] : [
  "../tests/integration/unpaid-source-retention.sql",
  "../tests/integration/chunk1-foundation.sql",
  "../tests/integration/chunk2-four-step.sql",
  "../tests/integration/chunk3-matching-engine.sql",
  "../tests/integration/chunk4-commerce-release.sql",
  "../tests/integration/chunk5-materials-delivery.sql",
  "../tests/integration/chunk6-final-integration.sql",
  "../tests/integration/employer-first-aggregation.sql",
  "../tests/integration/matching-fulfillment.sql",
  "../tests/integration/manual-launch-hardening.sql",
  ...(!historical085 ? ["../tests/integration/sandbox-validation-launch-activation.sql"] : []),
  "../tests/integration/atomic-intake-legal-acceptance.sql",
  "../tests/integration/document-standard-compatibility.sql",
  "../tests/integration/source-upload-cleanup.sql",
  "../tests/integration/material-filename-cleanup-compatibility.sql",
  "../tests/integration/aws-temporary-cleanup.sql",
  "../tests/integration/open-font-document-contract.sql",
  "../tests/integration/legacy-board-read-only-archive.sql",
  "../tests/integration/legacy-board-terminal-event-ordering.sql",
];
for (const fixture of fixtures) {
  const sqlPath = fileURLToPath(new URL(fixture, import.meta.url));
  // stdin-fed psql cannot resolve repository-relative includes inside Docker.
  // Expand only these reviewed local helpers; no arbitrary include paths.
  let sql = readFileSync(sqlPath, "utf8").replace(/^\\ir (reviewed-source-fixture|rehearsal-checkout-attempts|rehearsal-material-checkout|service-repair-case-state-fixture|employer-rule-review-fixture)\.sql\r?$/gm,
    (_line, helper) => readFileSync(fileURLToPath(new URL(`../tests/integration/${helper}.sql`, import.meta.url)), "utf8"));
  sql = sql.replace(/^\\ir reviewed-source-fixture\.sql\r?$/gm, () => readFileSync(new URL("../tests/integration/reviewed-source-fixture.sql", import.meta.url), "utf8"));
  if (/^\s*\\/mu.test(sql)) throw new Error("DATABASE_FIXTURE_INCLUDE_FORBIDDEN");
  if (fixture.endsWith("/material-draft-stage-claiming.sql")) sql = materialDraftStageContractFixture(sql);
  if (fixture.endsWith("/verified-intake-ownership.sql")) sql = verifiedIntakeOwnershipContractFixture(sql);
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_applypack", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], {
    encoding: "utf8", input: sql, stdio: ["pipe", "pipe", "pipe"], timeout: 60_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Database contract fixtures passed: ${fixtures.length}. Schema phase: ${requiredSchemaVersion}.`);
