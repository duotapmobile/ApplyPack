import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient(options: { signal?: AbortSignal } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const requestSignal = options.signal;

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    // A fresh client may bind all of its requests, including Storage uploads,
    // to a worker's deadline. Never mutate a shared client's fetch or headers.
    ...(requestSignal ? { global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal.throwIfAborted();
      const signals = [requestSignal, init?.signal, input instanceof Request ? input.signal : undefined]
        .filter((signal): signal is AbortSignal => signal !== undefined && signal !== null);
      return fetch(input, { ...init, signal: AbortSignal.any(signals), redirect: "error" });
    } } } : {}),
  });
}
