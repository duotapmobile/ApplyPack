import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { clarificationSuccessorCapability } from "@/lib/intake/clarification-capability";
import { createDraftCapability, draftSecretMatches } from "@/lib/security/draft-capability";

describe("clarification successor capability", () => {
  it("recovers the same successor secret after a lost response without reusing the original secret", () => {
    const original = createDraftCapability();
    const first = clarificationSuccessorCapability(original, { sourceDraftId: original.draftId, successorDraftId: null });
    const replay = clarificationSuccessorCapability(original, { sourceDraftId: original.draftId, successorDraftId: first.draftId });
    expect(replay).toEqual(first);
    expect(first.secret).not.toBe(original.secret);
    expect(draftSecretMatches(first.secret, first.secretHash)).toBe(true);
    expect(draftSecretMatches(original.secret, first.secretHash)).toBe(false);
  });
  it("preserves the authenticated successor cookie for further answers", () => {
    const original = createDraftCapability();
    const child = clarificationSuccessorCapability(original, { sourceDraftId: original.draftId, successorDraftId: null });
    expect(clarificationSuccessorCapability(child, { sourceDraftId: original.draftId, successorDraftId: child.draftId })).toEqual(child);
  });
  it("binds the derived secret to both the original cookie and original draft", () => {
    const a = createDraftCapability(); const b = createDraftCapability();
    const derive = (current: typeof a) => clarificationSuccessorCapability(current, { sourceDraftId: current.draftId, successorDraftId: null });
    expect(derive(a).secret).not.toBe(derive({ ...a, draftId: b.draftId }).secret);
    expect(derive(a).secret).not.toBe(derive({ ...a, secret: b.secret }).secret);
  });
  it("rejects unrelated, cyclic, malformed and extra-field lineage", () => {
    const a = createDraftCapability(); const b = createDraftCapability();
    expect(() => clarificationSuccessorCapability(a, { sourceDraftId: b.draftId, successorDraftId: null })).toThrow();
    expect(() => clarificationSuccessorCapability(a, { sourceDraftId: a.draftId, successorDraftId: a.draftId })).toThrow();
    expect(() => clarificationSuccessorCapability({ ...a, secret: "bad" }, { sourceDraftId: a.draftId, successorDraftId: null })).toThrow();
    expect(() => clarificationSuccessorCapability(a, { sourceDraftId: a.draftId, successorDraftId: null, secret: a.secret } as never)).toThrow();
  });
});
