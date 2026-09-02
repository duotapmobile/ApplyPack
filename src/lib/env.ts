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
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM_ADDRESS: z.string().email().default("orders@applypack.work"),
  EMAIL_REPLY_TO: z.string().email().default("help@applypack.work"),
  APP_DISPLAY_TIMEZONE: z.string().default("America/New_York"),
  APP_SEARCH_CAPACITY_PER_ROLLING_24H: z.coerce.number().int().positive().default(1),
  APP_APPLY_PACK_CAPACITY_PER_ROLLING_24H: z.coerce.number().int().positive().default(2),
  APP_SOURCE_DOCUMENT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  APP_CORRECTION_WINDOW_DAYS: z.coerce.number().int().positive().default(3),
  APP_CAPACITY_RESERVATION_MINUTES: z.coerce.number().int().min(15).max(30).default(20),
  APP_LEGAL_ENTITY_NAME: z.string().default("DuoTap LLC"),
  APP_ADMIN_ALERT_EMAIL: z.string().email().optional().or(z.literal("")),
  APP_ADMIN_EMAILS: z.string().optional(),
});

export const env = serverSchema.parse(process.env);

export function requireEnv<K extends keyof typeof env>(
  key: K,
): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (!value) throw new Error(`Missing required server configuration: ${key}`);
  return value as NonNullable<(typeof env)[K]>;
}
