import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const executablePaths = {
  APP_LIBREOFFICE_EXECUTABLE: "/usr/bin/soffice",
  APP_PDFINFO_EXECUTABLE: "/usr/bin/pdfinfo",
  APP_PDFFONTS_EXECUTABLE: "/usr/bin/pdffonts",
  APP_PDFTOTEXT_EXECUTABLE: "/usr/bin/pdftotext",
  APP_PDFTOPPM_EXECUTABLE: "/usr/bin/pdftoppm",
};

// Discovery identifies installed inputs only. It grants no rendering/commerce approval.
export function configureRendererRuntime(environment = process.env, dependencies = {}) {
  if (environment.APP_RENDERER_RUNTIME_DISCOVERY !== "true") return environment;
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "linux") throw new Error("renderer_discovery_requires_linux");
  const read = dependencies.readFileSync ?? readFileSync;
  const stat = dependencies.statSync ?? statSync;
  const run = dependencies.execFileSync ?? execFileSync;
  const configured = { ...environment };
  const pins = [];
  function pin(name, discoveredPath) {
    const path = configured[name]?.trim() || discoveredPath;
    if (!isAbsolute(path)) throw new Error(`renderer_path_invalid:${name}`);
    const info = stat(path);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error(`renderer_file_invalid:${name}`);
    const actual = createHash("sha256").update(read(path)).digest("hex");
    const expected = configured[`${name}_SHA256`]?.trim().toLowerCase();
    if (expected && expected !== actual) throw new Error(`renderer_pin_mismatch:${name}`);
    configured[name] = path;
    configured[`${name}_SHA256`] = expected || actual;
    pins.push([name, actual]);
  }
  for (const [name, path] of Object.entries(executablePaths)) pin(name, path);
  const match = run("/usr/bin/fc-match", ["--format=%{family}\n%{file}\n", "Liberation Sans:style=Regular"], {
    encoding: "utf8", timeout: 5_000, maxBuffer: 4_096, windowsHide: true,
  }).trim().split("\n");
  if (match.length !== 2 || !match[0].split(",").map((value) => value.trim()).includes("Liberation Sans")
    || !isAbsolute(match[1])) throw new Error("renderer_liberation_sans_unavailable");
  pin("APP_DOCUMENT_FONT_FILE", match[1]);
  const resolvedFontHash = createHash("sha256").update(read(match[1])).digest("hex");
  if (configured.APP_DOCUMENT_FONT_FILE_SHA256 !== resolvedFontHash) throw new Error("renderer_configured_font_differs_from_resolved_font");
  configured.APP_DOCUMENT_RENDERER_IDENTITY ||= `applypack-linux-renderer-${createHash("sha256").update(JSON.stringify(pins)).digest("hex").slice(0, 20)}`;
  Object.assign(environment, configured);
  return environment;
}
