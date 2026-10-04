export const REQUIRED_LAUNCH_SCHEMA_VERSION = "202610040079";

export const REQUIRED_LAUNCH_MIGRATIONS = [
  "202610040077",
  "202610040078",
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
