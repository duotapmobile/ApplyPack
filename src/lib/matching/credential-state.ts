export type CredentialState = "PASS" | "FAIL" | "UNKNOWN";

/** Read values, never JSON key names or positive substrings inside negatives. */
export function credentialState(value: unknown): CredentialState {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const signals: CredentialState[] = [];
    for (const key of ["isActive", "isCurrent", "isValid", "held"]) {
      if (typeof record[key] === "boolean") signals.push(record[key] ? "PASS" : "FAIL");
    }
    for (const key of ["status", "state", "validity", "credentialStatus"]) {
      if (typeof record[key] === "string") signals.push(credentialState(record[key]));
    }
    return combineCredentialStates(signals);
  }
  if (typeof value !== "string") return "UNKNOWN";
  const text = value.normalize("NFKC").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(?:inactive|invalid|expired|revoked|suspended|not (?:active|current|valid|held|completed)|never held)\b/u.test(text)) return "FAIL";
  // Completion alone does not establish that a time-limited credential is current.
  return /^(?:active|current|valid)$/.test(text) ? "PASS" : "UNKNOWN";
}

export function combineCredentialStates(states: CredentialState[]): CredentialState {
  if (states.includes("FAIL")) return "FAIL";
  return states.includes("PASS") ? "PASS" : "UNKNOWN";
}
