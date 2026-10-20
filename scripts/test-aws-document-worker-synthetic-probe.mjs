import { expectedCrossEnvironmentKmsDenial } from "./aws-document-worker-synthetic-probe.mjs";

function accepted(code) {
  const result = {
    status: 254,
    signal: null,
    error: undefined,
    stderr: `An error occurred (${code}) when calling the Decrypt operation: denied by the exact context boundary`,
  };
  if (expectedCrossEnvironmentKmsDenial(result) !== code) throw new Error(`expected denial rejected: ${code}`);
}

function rejected(result, label) {
  let didReject = false;
  try { expectedCrossEnvironmentKmsDenial(result); } catch { didReject = true; }
  if (!didReject) throw new Error(`unexpected KMS failure accepted: ${label}`);
}

accepted("AccessDeniedException");
accepted("InvalidCiphertextException");
rejected({ status: 0, signal: null, stderr: "" }, "successful cross-environment decrypt");
rejected({ status: 254, signal: null, stderr: "An error occurred (UnrecognizedClientException) when calling the Decrypt operation: credentials invalid" }, "credential failure");
rejected({ status: 255, signal: null, stderr: "Could not connect to the endpoint URL" }, "network failure");
rejected({ status: 254, signal: null, stderr: "An error occurred (ThrottlingException) when calling the Decrypt operation: retry later" }, "throttle failure");
rejected({ status: 254, signal: null, stderr: "An error occurred (ValidationException) when calling the Decrypt operation: malformed request" }, "malformed request");
rejected({ status: null, signal: "SIGTERM", stderr: "" }, "transient terminated process");
rejected({ status: null, signal: null, stderr: "An error occurred (AccessDeniedException) when calling the Decrypt operation: no exit status" }, "missing CLI exit status");
rejected({ status: null, signal: null, error: new Error("spawn failed"), stderr: "" }, "CLI execution failure");

console.log("AWS_DOCUMENT_WORKER_SYNTHETIC_PROBE_FIXTURES_OK");
