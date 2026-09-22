import { request } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const origin = "https://applypack-staging-staging.up.railway.app";
if (process.env.APPLYPACK_CONFIRM_STAGING_UPLOAD !== origin) throw new Error("Explicit staging upload confirmation required");
const directory = resolve("evidence/soft-opening/private");
await mkdir(directory, { recursive: true });
const report = { origin, startedAt: new Date().toISOString(), synthetic: true, signedInCustomers: 0,
  requests: 0, uploadAttempts: 0, checks: [], cleanup: [], passed: false,
  limitations: ["Anonymous capability isolation only; not three authenticated customer release flows.",
    "QUARANTINED upload acceptance is not malware clearance or successful isolated extraction.",
    "Two concurrent maximum-size valid files not verified; fixtures are ordinary genuine documents.",
    "Soft deletion retains audit history and bytes until configured retention cleanup; draft capabilities expire normally."] };
const sessions = [];
let lastRequest = 0;
async function send(context, path, options = {}) {
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 250 - (Date.now() - lastRequest))));
  lastRequest = Date.now(); report.requests++;
  return context.fetch(path, { timeout: 45_000, maxRedirects: 0, ...options });
}
async function check(name, response, allowed) {
  const status = response.status(); report.checks.push({ name, status, passed: allowed.includes(status) });
  assert.ok(allowed.includes(status), `${name}: unexpected HTTP ${status}`);
}
async function readDraft(session) {
  const response = await send(session.context, "/api/intake/anonymous-draft");
  await check(`draft-${session.index}-read`, response, [200]);
  const body = await response.json(); assert.equal(body.draft.id, session.id); session.version = body.draft.version;
  return body.draft;
}
async function upload(session, name, mimeType, buffer, kind = "resume", expected = [201]) {
  report.uploadAttempts++; session.attempts++;
  assert.ok(report.uploadAttempts <= 20 && session.attempts <= 12);
  const response = await send(session.context, "/api/intake/anonymous-draft/document", { method: "POST",
    multipart: { kind, expectedVersion: String(session.version), file: { name, mimeType, buffer } } });
  await check(`draft-${session.index}-${name}`, response, expected);
  if (response.status() === 201) {
    const body = await response.json(); assert.equal(body.document.processingState, "QUARANTINED");
    session.version = body.draftVersion; session.documents.push({ ...body.document, fieldKind: kind });
    report.checks.push({ name: `draft-${session.index}-accepted-state`, state: body.document.processingState, passed: true });
  }
}
async function independentChecks() {
  for (const session of sessions.filter(item => item.id && item.documents.length)) {
   try {
    const other = sessions.find(item => item.id && item.documents.length && item !== session);
    const state = await readDraft(session);
    assert.deepEqual(state.documents.map(item => item.id).sort(), session.documents.map(item => item.id).sort());
    if (other) {
    const selected = await send(session.context, `/api/intake/anonymous-draft?draftId=${other.id}&documentId=${other.documents[0]?.id || session.documents[0].id}`);
    await check(`draft-${session.index}-foreign-query-selector`, selected, [200]);
    assert.equal((await selected.json()).draft.id, session.id);
    const forged = await send(session.context, "/api/intake/anonymous-draft/document/retry", { method: "POST",
      data: { expectedVersion: session.version, kind: "resume", draftId: other.id, documentId: other.documents[0]?.id || session.documents[0].id } });
    await check(`draft-${session.index}-foreign-document-retry`, forged, [400]);
    const stateCookies = (await session.context.storageState()).cookies;
    const capability = stateCookies.find(cookie => cookie.name === "__Host-applypack_draft"); assert.ok(capability);
    const tampered = await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin,
      cookie: `${capability.name}=${other.id}.${capability.value.split(".")[1]}` } });
    try {
      const denied = await send(tampered, "/api/intake/anonymous-draft");
      await check(`draft-${session.index}-swapped-capability-id`, denied, [200, 404]);
      if (denied.status() === 200) assert.equal((await denied.json()).draft, null);
      report.checks.push({ name: `draft-${session.index}-swapped-capability-exposes-no-draft`, passed: true });
    } finally { await tampered.dispose(); }
    }
    const publicContext = await request.newContext();
    try {
      const doc = session.documents[0];
      const path = `anonymous/${session.id}/resume/${doc.id}.pdf`;
      const publicRead = await send(publicContext, `https://fmugizadzdnqfckujqlw.supabase.co/storage/v1/object/public/customer-source-documents/${path}`);
      await check(`draft-${session.index}-private-bucket-public-read`, publicRead, [400, 401, 403, 404]);
      const adminRead = await send(session.context, `/api/admin/intakes/${other?.id || session.id}/source?kind=resume`);
      await check(`draft-${session.index}-anonymous-admin-url-denied`, adminRead, [401, 403]);
    } finally { await publicContext.dispose(); }
   } catch { report.passed = false; process.exitCode = 1; report.checks.push({name: `draft-${session.index}-independent-check-incomplete`, passed: false}); }
  }
}
try {
  for (const [index, person] of ["avery", "jordan", "casey"].entries()) {
    const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { origin, "sec-fetch-site": "same-origin" } });
    const session = { index, context, documents: [], attempts: 0 }; sessions.push(session);
    const created = await send(context, "/api/intake/anonymous-draft", { method: "POST" });
    await check(`draft-${index}-create`, created, [201]);
    const { draft } = await created.json(); session.id = draft.id; session.version = draft.version;
    assert.ok(!sessions.some(other => other !== session && other.id === session.id));
    await upload(session, `synthetic-${person}-resume.pdf`, "application/pdf", await readFile(resolve(`evidence/soft-opening/fixtures/${person}-resume.pdf`)));
    await upload(session, `synthetic-${person}-reference.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      await readFile(resolve(`evidence/soft-opening/fixtures/${person}-resume.docx`)), "prior_cover_letter");
  }
  const first = sessions[0];
  await upload(first, "synthetic-invalid-signature.pdf", "application/pdf", Buffer.from("Clearly synthetic non-PDF data."), "resume", [400]);
  await upload(first, "synthetic-disallowed.txt", "text/plain", Buffer.from("Clearly synthetic plain text."), "resume", [400]);
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 32); oversized.write("%PDF-1.7\n"); oversized.write("\n%%EOF", oversized.length - 6);
  await upload(first, "synthetic-oversize.pdf", "application/pdf", oversized, "resume", [400, 413]);
  await upload(first, "synthetic-malformed-archive.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), "resume", [400]);

  report.passed = true;
} catch (error) {
  report.failure = error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "REQUEST_OR_FIXTURE_FAILED";
  process.exitCode = 1;
} finally {
  await independentChecks();
  for (const session of sessions) {
    if (session.id) {
      try {
        await readDraft(session);
        for (const document of session.documents) {
          const response = await send(session.context, `/api/intake/anonymous-draft/document?kind=${document.fieldKind}&expectedVersion=${session.version}`, { method: "DELETE" });
          report.cleanup.push({ draft: session.index, kind: document.fieldKind, status: response.status() });
          if (response.ok()) session.version = (await response.json()).draftVersion;
          else { report.passed = false; process.exitCode = 1; }
        }
      } catch { report.cleanup.push({ draft: session.index, status: "CLEANUP_FAILED" }); report.passed = false; process.exitCode = 1; }
    }
    await session.context.dispose();
  }
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(directory, `upload-smoke-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
