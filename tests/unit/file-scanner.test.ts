import { afterEach, describe, expect, it } from "vitest";
import { checkFileScannerHealth, fileScanConfiguration, parseClamAvResponse, scanBuffer } from "@/lib/files/scanner";

const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });

describe("private file scanner", () => {
  it("does not claim readiness when ClamAV is not configured", () => {
    delete process.env.APP_FILE_SCAN_MODE;
    delete process.env.CLAMAV_HOST;
    expect(fileScanConfiguration().ready).toBe(false);
  });

  it("requires a host for ClamAV mode", () => {
    process.env.APP_FILE_SCAN_MODE = "clamav";
    delete process.env.CLAMAV_HOST;
    expect(fileScanConfiguration().ready).toBe(false);
    process.env.CLAMAV_HOST = "127.0.0.1";
    expect(fileScanConfiguration().ready).toBe(true);
  });

  it("truthfully reports structural document validation without claiming ClamAV", async () => {
    process.env.APP_FILE_SCAN_MODE = "document_validation";
    expect(fileScanConfiguration()).toMatchObject({ mode: "document_validation", ready: true });
    await expect(checkFileScannerHealth()).resolves.toBe(true);
    await expect(scanBuffer(Buffer.from("passive"), { structureValidated: true })).resolves.toMatchObject({
      status: "clean",
      provider: "document_validation",
      errorCode: null,
    });
    await expect(scanBuffer(Buffer.from("not-validated"))).resolves.toMatchObject({
      status: "pending",
      provider: null,
      errorCode: "structure_validation_required",
    });
  });

  it("maps clean, detected, and unknown ClamAV responses fail-closed", () => {
    expect(parseClamAvResponse("stream: OK\0").status).toBe("clean");
    expect(parseClamAvResponse("stream: Eicar-Signature FOUND\0")).toMatchObject({ status: "blocked", errorCode: "malware_detected" });
    expect(parseClamAvResponse("stream: unexpected\0")).toMatchObject({ status: "scan_error", errorCode: "scanner_unknown_response" });
  });
});
