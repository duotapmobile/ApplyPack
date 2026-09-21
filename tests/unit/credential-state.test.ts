import { describe, expect, it } from "vitest";
import { credentialState, combineCredentialStates } from "@/lib/matching/credential-state";

describe("mandatory credential evidence", () => {
  it.each(["inactive", "invalid", "not current", "not active", "expired", "revoked", { isActive: false }, { status: "invalid", isCurrent: true }])("never promotes negative evidence %j", (value) => {
    expect(credentialState(value)).toBe("FAIL");
  });
  it.each(["active", "current", "valid", { isActive: true }, { status: "current" }])("accepts explicit current state %j", (value) => {
    expect(credentialState(value)).toBe("PASS");
  });
  it.each(["completed", "unknown", { description: "active license required" }, { isActive: "false" }, null])("preserves uncertainty %j", (value) => {
    expect(credentialState(value)).toBe("UNKNOWN");
  });
  it("does not let contradictory positives override a negative", () => {
    expect(combineCredentialStates(["PASS", "FAIL"])).toBe("FAIL");
  });
});
