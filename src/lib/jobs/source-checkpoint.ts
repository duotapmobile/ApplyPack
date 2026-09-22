export function resumeSourceCheckpoint(prior: {
  scope_sha256: string | null; adapter_version: string | null;
  enumeration_status: string | null; response_classification: string | null;
  checkpoint_end: unknown;
} | null, scope: string, adapterVersion: string | null): string | null {
  if (!prior || !adapterVersion || prior.scope_sha256 !== scope || prior.adapter_version !== adapterVersion
    || prior.enumeration_status !== "partial" || prior.response_classification !== "bounded_partial") return null;
  const checkpoint = prior.checkpoint_end as { cursor?: unknown } | null;
  if (typeof checkpoint?.cursor !== "string" || !/^[1-9]\d*$/.test(checkpoint.cursor)) return null;
  const offset = Number(checkpoint.cursor);
  return Number.isSafeInteger(offset) && offset <= 100_000 ? checkpoint.cursor : null;
}
