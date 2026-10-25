export const REQUIRED_LAUNCH_SCHEMA_VERSION = "202610250093";

export const REQUIRED_LAUNCH_MIGRATIONS = [
  "202610040077",
  "202610040078",
  "202610040079",
  "202610040080",
  "202610190081",
  "202610190082",
  "202610190083",
  "202610190084",
  "202610220085",
  "202610230086",
  "202610240087",
  "202610250088",
  "202610250089",
  "202610250090",
  "202610250091",
  "202610250092",
  REQUIRED_LAUNCH_SCHEMA_VERSION,
] as const;

export function launchSchemaReadinessIsCurrent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const migrations = Array.isArray(record.requiredMigrations) ? record.requiredMigrations : [];
  return record.ready === true
    && record.requiredSchemaVersion === REQUIRED_LAUNCH_SCHEMA_VERSION
    && REQUIRED_LAUNCH_MIGRATIONS.every((migration) => migrations.includes(migration));
}
