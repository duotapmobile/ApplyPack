/** Fictional application receipts for local runner tests; never runtime code. */
export function fictionalArchiveLifecycle(releaseSha, kind, calls = []) {
  let row;
  return { releaseSha,
    async begin({ runId }) { calls.push("lifecycle.begin"); row = { id: runId, kind, release_sha: releaseSha, state: "OPEN", provider_dispatched: false }; return { ...row }; },
    async dispatch() { calls.push("lifecycle.dispatch"); row.provider_dispatched = true; return { ...row }; },
    async complete({ manifestSha256, manifestVersionId }) { calls.push("lifecycle.complete"); row = { ...row, state: "COMPLETE", result_sha256: "c".repeat(64),
      completion_receipt: { runId: row.id, kind, releaseSha, manifestSha256, manifestVersionId } }; return structuredClone(row); },
    async status() { calls.push("lifecycle.status"); return structuredClone(row); },
    async cancel() { calls.push("lifecycle.cancel"); row.state = "CANCELED"; return { ...row }; },
  };
}
