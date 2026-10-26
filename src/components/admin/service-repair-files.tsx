"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { matchesRepairFileResult, readRepairFileView, repairFileRequestSchema,
  type RepairFileRequest, type RepairFileView } from "@/lib/materials/service-repair-file-client";
import { readRepairAuthoringJson } from "@/lib/materials/service-repair-authoring-client";
import styles from "./draft-owner-workspace.module.css";

type Props = { caseId: string; materialLineId: string; versionId: string; refreshKey?: string | number; onRegistered?: () => void };
type Pending = { request: RepairFileRequest; body: string };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function ServiceRepairFiles(props: Props) {
  return <RepairFiles key={`${props.caseId}:${props.materialLineId}:${props.versionId}:${props.refreshKey ?? ""}`} {...props} />;
}
function RepairFiles({ caseId, materialLineId, versionId, onRegistered }: Props) {
  const [view, setView] = useState<RepairFileView | null>(null), [busy, setBusy] = useState(false);
  const [pendingState, setPendingState] = useState<"NONE" | "UNKNOWN" | "RETRY" | "RECORDED">("NONE");
  const [message, setMessage] = useState("Checking whether the reviewed repair is ready to create files…");
  const pending = useRef<Pending | null>(null), active = useRef<AbortController | null>(null), latch = useRef(false), notice = useRef<HTMLParagraphElement | null>(null);
  const endpoint = `/api/admin/service-errors/${caseId}/repairs/${materialLineId}/render`;
  function say(value: string) { setMessage(value); queueMicrotask(() => notice.current?.focus()); }
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`${endpoint}?versionId=${versionId}`, { cache: "no-store", credentials: "same-origin", signal });
    const data = object(await readRepairAuthoringJson(response, signal));
    if (!response.ok || !data || signal.aborted) throw new Error("unavailable");
    return readRepairFileView(data.view, { caseId, materialLineId, versionId });
  }, [endpoint, caseId, materialLineId, versionId]);
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]);
    void load(signal).then(current => { if (!signal.aborted) { setView(current); setMessage(""); } })
      .catch(() => { if (!controller.signal.aborted) setMessage("File preparation status could not be loaded. Refresh after checking administrator access."); });
    return () => controller.abort();
  }, [load]);
  async function refresh() {
    if (latch.current || pending.current || !active.current || active.current.signal.aborted) return;
    latch.current = true; setBusy(true); const controller = active.current;
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]), current = await load(signal);
      if (!signal.aborted) { setView(current); setMessage(""); }
    }
    catch { if (!controller.signal.aborted) { setView(null); say("File preparation status is unavailable. Refresh before continuing."); } }
    finally { latch.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function act(operation: "RENDER" | "CHECK", retry = false) {
    if (latch.current || !active.current || active.current.signal.aborted || pendingState === "RECORDED") return;
    if (operation === "RENDER" && !retry) {
      if (pending.current || view?.status !== "READY" || !view.expected) return;
      const request = repairFileRequestSchema.parse({ requestId: crypto.randomUUID(), expected: view.expected });
      pending.current = { request, body: JSON.stringify(request) };
    } else if (!pending.current || (operation === "RENDER" && pendingState !== "RETRY")) return;
    const attempt = pending.current!, parent = active.current;
    const signal = AbortSignal.any([parent.signal, AbortSignal.timeout(240_000)]);
    latch.current = true; setBusy(true); setPendingState("UNKNOWN");
    setMessage(operation === "CHECK" ? "Checking this exact file request…" : "Creating the accepted repair files for your review…");
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", signal,
        headers: { "Content-Type": "application/json" }, body: `{"operation":"${operation}","request":${attempt.body}}` });
      const data = object(await readRepairAuthoringJson(response, signal));
      if (signal.aborted || !response.ok || !data || !matchesRepairFileResult(data.result, attempt.request)) throw new Error("unconfirmed");
      const result = data.result;
      if (result.status === "REVIEW_READY") {
        pending.current = null; setPendingState("RECORDED");
        say("The exact repair files were saved. Open their previews and complete the separate approval and Send steps.");
        try { onRegistered?.(); } catch { /* A parent refresh cannot invalidate the recorded file result. */ }
      } else if (result.retryAllowed) {
        setPendingState("RETRY");
        say(result.status === "BUSY" ? `Another preparation is still active until ${new Date(result.busyUntil!).toLocaleString()}. This request did not start; you may retry the identical request after it finishes.`
          : "File preparation is disabled. This request did not start. Retry the identical request only after the service is available.");
      } else {
        setPendingState("UNKNOWN");
        say("No completed file registration is confirmed. Some files may already be stored. Check this exact request; creating another set is not enabled.");
      }
    } catch { if (!parent.signal.aborted) { setPendingState("UNKNOWN"); say("The file result is not confirmed. Check this exact request before continuing. No files were approved or sent."); } }
    finally { latch.current = false; if (!parent.signal.aborted) setBusy(false); }
  }
  return <section className={styles.section} aria-label="Create accepted repair files"><h3>Create accepted repair files</h3>
    <p role="status" aria-live="polite" tabIndex={-1} ref={notice}>{message}</p>
    <p>Only the accepted affected files will be prepared from the reviewed wording. You must inspect the finished files before approval and separate Send.</p>
    {pendingState === "NONE" && <>
      {view?.status === "WORDING_REQUIRED" && <p>Save the correction and complete its wording review before creating files.</p>}
      {view?.status === "DISABLED" && <p>File preparation is disabled. Check the service configuration before continuing.</p>}
      {view?.status === "BUSY" && <p>Another preparation is active until {new Date(view.busyUntil!).toLocaleString()}. Refresh after it finishes.</p>}
      {view?.status === "REVIEW_READY" && <p>The repaired files are ready for the separate preview and approval checks.</p>}
      {view?.status === "READY" && <button type="button" disabled={busy} onClick={() => void act("RENDER")}>Create reviewed repair files</button>}{" "}
      <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh file preparation status</button>
    </>}
    {["UNKNOWN", "RETRY"].includes(pendingState) && <div><button type="button" disabled={busy} onClick={() => void act("CHECK")}>Check file preparation request</button>{" "}
      <button type="button" disabled={busy || pendingState !== "RETRY"} onClick={() => void act("RENDER", true)}>Retry identical file request</button></div>}
  </section>;
}
