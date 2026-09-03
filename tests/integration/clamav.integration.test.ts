import { describe, expect, it } from "vitest";
import { checkFileScannerHealth, scanFile } from "@/lib/files/scanner";

const integration = process.env.SCANNER_INTEGRATION === "true" ? describe : describe.skip;

integration("ClamAV integration", () => {
  it("answers a real health ping", async () => {
    await expect(checkFileScannerHealth()).resolves.toBe(true);
  });

  it("accepts harmless content and blocks the standard antivirus test signature", async () => {
    const clean = await scanFile(new File(["%PDF-1.4\nSynthetic ApplyPack scanner test."], "clean.pdf", { type: "application/pdf" }));
    expect(clean.status).toBe("clean");

    const antivirusTest = [
      "X5O!P%@AP[4\\PZX54(P^)",
      "7CC)7}$EICAR-STANDARD-",
      "ANTIVIRUS-TEST-FILE!$H+H*",
    ].join("");
    const detected = await scanFile(new File([antivirusTest], "scanner-test.txt", { type: "text/plain" }));
    expect(detected).toMatchObject({ status: "blocked", errorCode: "malware_detected" });
  });
});
