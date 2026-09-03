import { createHash } from "node:crypto";
import { createConnection } from "node:net";

export type FileScanStatus = "pending" | "clean" | "blocked" | "scan_error";

export type FileScanResult = {
  status: FileScanStatus;
  sha256: string;
  provider: "clamav" | "document_validation" | null;
  providerReference: string | null;
  errorCode: string | null;
  scannedAt: string | null;
};

export function fileScanConfiguration() {
  const requestedMode = process.env.APP_FILE_SCAN_MODE;
  const mode = requestedMode === "clamav" || requestedMode === "document_validation" ? requestedMode : "disabled";
  const host = process.env.CLAMAV_HOST || "";
  const port = Number(process.env.CLAMAV_PORT || 3310);
  const timeoutMs = Number(process.env.CLAMAV_TIMEOUT_MS || 15_000);
  return {
    mode,
    host,
    port,
    timeoutMs,
    ready: mode === "document_validation" || (mode === "clamav" && Boolean(host) && Number.isInteger(port) && port > 0 && timeoutMs >= 1_000),
  } as const;
}

export async function checkFileScannerHealth(): Promise<boolean> {
  const configuration = fileScanConfiguration();
  if (!configuration.ready) return false;
  if (configuration.mode === "document_validation") return true;
  return new Promise((resolve) => {
    const socket = createConnection({ host: configuration.host, port: configuration.port });
    let response = "";
    let settled = false;
    const finish = (healthy: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(healthy);
    };
    socket.setTimeout(Math.min(configuration.timeoutMs, 3_000), () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("data", (chunk) => { response += chunk.toString("utf8"); });
    socket.on("end", () => finish(/PONG/i.test(response)));
    socket.on("connect", () => socket.write("zPING\0"));
  });
}

export function parseClamAvResponse(response: string): Pick<FileScanResult, "status" | "providerReference" | "errorCode"> {
  const normalized = response.replace(/\0/g, "").trim();
  if (/\bOK$/i.test(normalized)) return { status: "clean", providerReference: "clamav:ok", errorCode: null };
  const found = normalized.match(/:\s*(.+?)\s+FOUND$/i);
  if (found) return { status: "blocked", providerReference: `clamav:${found[1].slice(0, 200)}`, errorCode: "malware_detected" };
  return { status: "scan_error", providerReference: null, errorCode: "scanner_unknown_response" };
}

export async function scanFile(file: File, options: { structureValidated?: boolean } = {}): Promise<FileScanResult> {
  return scanBuffer(Buffer.from(await file.arrayBuffer()), options);
}

export async function scanBuffer(bytes: Buffer, options: { structureValidated?: boolean } = {}): Promise<FileScanResult> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const configuration = fileScanConfiguration();
  if (!configuration.ready) {
    return { status: "pending", sha256, provider: null, providerReference: null, errorCode: "scanner_not_configured", scannedAt: null };
  }
  if (configuration.mode === "document_validation") {
    return options.structureValidated
      ? {
          status: "clean",
          sha256,
          provider: "document_validation",
          providerReference: "document_validation:strict_container_checks",
          errorCode: null,
          scannedAt: new Date().toISOString(),
        }
      : {
          status: "pending",
          sha256,
          provider: null,
          providerReference: null,
          errorCode: "structure_validation_required",
          scannedAt: null,
        };
  }

  try {
    const response = await streamToClamAv(bytes, configuration);
    const verdict = parseClamAvResponse(response);
    return { ...verdict, sha256, provider: "clamav", scannedAt: new Date().toISOString() };
  } catch {
    return { status: "scan_error", sha256, provider: "clamav", providerReference: null, errorCode: "scanner_unavailable", scannedAt: new Date().toISOString() };
  }
}

async function streamToClamAv(bytes: Buffer, configuration: ReturnType<typeof fileScanConfiguration>): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: configuration.host, port: configuration.port });
    const response: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(Buffer.concat(response).toString("utf8"));
    };
    socket.setTimeout(configuration.timeoutMs, () => finish(new Error("scanner_timeout")));
    socket.on("error", () => finish(new Error("scanner_connection_failed")));
    socket.on("data", (chunk) => response.push(Buffer.from(chunk)));
    socket.on("end", () => finish());
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
