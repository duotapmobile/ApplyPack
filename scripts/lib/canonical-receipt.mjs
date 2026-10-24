import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sanitizedIdentity(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("identity_missing");
  return sha256(value.trim());
}

export function writeCanonicalReceipt(outputDirectory, stem, receipt) {
  if (!/^[a-z0-9-]+$/.test(stem)) throw new Error("receipt_stem_invalid");
  const directory = resolve(outputDirectory);
  mkdirSync(directory, { recursive: true });
  const filename = `${stem}.json`;
  const payload = `${canonicalJson(receipt)}\n`;
  const digest = sha256(payload);
  const receiptPath = resolve(directory, filename);
  const digestPath = resolve(directory, `${stem}.sha256`);
  writeFileSync(receiptPath, payload, { encoding: "utf8", flag: "wx" });
  writeFileSync(digestPath, `${digest}  ${basename(receiptPath)}\n`, { encoding: "utf8", flag: "wx" });
  return { digest, receiptPath, digestPath };
}
