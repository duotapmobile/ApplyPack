import "server-only";

import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_JOB_SEARCH_PRICE_ID: z.string().optional(),
  STRIPE_APPLY_PACK_PRICE_ID: z.string().optional(),
  APP_PAYMENT_MODE: z.enum(["disabled", "test", "live"]).default("disabled"),
  APP_CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false"),
  APP_LIVE_PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().email().default("orders@applypack.work"),
  EMAIL_REPLY_TO: z.string().email().default("help@applypack.work"),
  APP_DISPLAY_TIMEZONE: z.string().default("America/New_York"),
  APP_SEARCH_CAPACITY_PER_ROLLING_24H: z.coerce.number().int().positive().default(1),
  APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H: z.coerce.number().int().positive().default(2),
  APP_SOURCE_DOCUMENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  APP_CORRECTION_WINDOW_DAYS: z.coerce.number().int().positive().default(3),
  APP_JOB_FRESHNESS_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  APP_JOB_STALE_AFTER_HOURS: z.coerce.number().int().min(24).max(720).default(72),
  APP_CAPACITY_RESERVATION_MINUTES: z.coerce.number().int().min(150).max(150).default(150),
  APP_LEGAL_ENTITY_NAME: z.string().default("DuoTap LLC d/b/a ApplyPack"),
  APP_ADMIN_ALERT_EMAIL: z.string().email().optional().or(z.literal("")),
  APP_ADMIN_EMAILS: z.string().optional(),
  APP_SAFE_TEST_EMAILS: z.string().optional(),
  APP_FILE_SCAN_MODE: z.enum(["disabled", "document_validation", "clamav"]).default("disabled"),
  APP_ANONYMOUS_DRAFT_SESSION_SECONDS: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().min(900).max(2_592_000).optional()),
  APP_FILE_PROCESSING_ENABLED: z.enum(["true", "false"]).default("false"),
  APP_MALWARE_SCANNER_IDENTITY: z.string().optional(),
  APP_SANDBOXED_PARSER_IDENTITY: z.string().optional(),
  APP_PARSER_MAX_EXPANDED_BYTES: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional()),
  APP_PARSER_MAX_PAGES: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional()),
  APP_PARSER_MAX_MILLISECONDS: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional()),
  APP_PARSER_MAX_MEMORY_BYTES: z.preprocess((value) => value === "" ? undefined : value, z.coerce.number().int().positive().optional()),
  APP_PERMITTED_MODEL_POLICY: z.string().optional(),
  APP_CUSTOMER_SUPPLIED_JOBS_ENABLED: z.enum(["true", "false"]).default("false"),
  APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED: z.enum(["true", "false"]).default("false"),
  APP_KMS_KEY_IDENTITY: z.string().optional(),
  APP_KMS_KEY_VERSION: z.string().optional(),
  APP_KMS_ENCRYPTION_CONTEXT_VERSION: z.string().optional(),
  APP_KMS_WRAP_URL: optionalUrl,
  APP_KMS_UNWRAP_URL: optionalUrl,
  APP_KMS_BEARER_TOKEN: z.string().optional(),
  APP_KMS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  APP_JOB_SOURCE_SYNC_ENABLED: z.enum(["true", "false"]).default("false"),
  APP_JOB_SOURCE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  APP_JOB_SOURCE_MIN_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1_500),
  APP_JOB_SOURCE_MAX_POSTINGS: z.coerce.number().int().min(1).max(500).default(250),
  APP_JOB_SOURCE_USER_AGENT: z.string().min(10).max(300).default("ApplyPackSourceMonitor/1.0 (+https://applypack.work/contact)"),
});

export const env = serverSchema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(
  key: K,
): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (!value) throw new Error(`Missing required server configuration: ${key}`);
  return value as NonNullable<(typeof env)[K]>;
}
