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

export const liberationSansContract = Object.freeze({
  family: "Liberation Sans",
  version: "2.1.5",
  manifestSha256: "d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb",
  styles: Object.freeze({
    regular: Object.freeze({ query: "Liberation Sans:style=Regular", pathName: "APP_DOCUMENT_FONT_FILE", sha256: "76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8" }),
    bold: Object.freeze({ query: "Liberation Sans:style=Bold", pathName: "APP_DOCUMENT_FONT_BOLD_FILE", sha256: "788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173" }),
    italic: Object.freeze({ query: "Liberation Sans:style=Italic", pathName: "APP_DOCUMENT_FONT_ITALIC_FILE", sha256: "e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0" }),
    boldItalic: Object.freeze({ query: "Liberation Sans:style=Bold Italic", pathName: "APP_DOCUMENT_FONT_BOLD_ITALIC_FILE", sha256: "698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee" }),
  }),
});

// Discovery identifies installed inputs only. It grants no rendering/commerce approval.
export function configureRendererRuntime(environment = process.env, dependencies = {}) {
  if (environment.APP_RENDERER_RUNTIME_DISCOVERY !== "true") return environment;
  const platform = dependencies.platform ?? process.platform;
  if (platform !== "linux") throw new Error("renderer_discovery_requires_linux");
  const read = dependencies.readFileSync ?? readFileSync;
  const stat = dependencies.statSync ?? statSync;
  const run = dependencies.execFileSync ?? execFileSync;
  const fileSha256 = dependencies.fileSha256 ?? ((path) => createHash("sha256").update(read(path)).digest("hex"));
  const configured = { ...environment };
  const pins = [];
  function pin(name, discoveredPath) {
    const path = configured[name]?.trim() || discoveredPath;
    if (!isAbsolute(path)) throw new Error(`renderer_path_invalid:${name}`);
    const info = stat(path);
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error(`renderer_file_invalid:${name}`);
    const actual = fileSha256(path);
    const expected = configured[`${name}_SHA256`]?.trim().toLowerCase();
    if (expected && expected !== actual) throw new Error(`renderer_pin_mismatch:${name}`);
    configured[name] = path;
    configured[`${name}_SHA256`] = expected || actual;
    pins.push([name, actual]);
  }
  for (const [name, path] of Object.entries(executablePaths)) pin(name, path);
  for (const style of Object.values(liberationSansContract.styles)) {
    const match = run("/usr/bin/fc-match", ["--format=%{family}\n%{file}\n", style.query], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 4_096, windowsHide: true,
    }).trim().split("\n");
    if (match.length !== 2
      || !match[0].split(",").map((value) => value.trim()).includes(liberationSansContract.family)
      || !isAbsolute(match[1])) throw new Error("renderer_liberation_sans_unavailable");
    const configuredHashName = `${style.pathName}_SHA256`;
    if (configured[configuredHashName] && configured[configuredHashName]?.trim().toLowerCase() !== style.sha256) {
      throw new Error(`renderer_pin_mismatch:${style.pathName}`);
    }
    configured[configuredHashName] = style.sha256;
    pin(style.pathName, match[1]);
    if (configured[configuredHashName] !== style.sha256) {
      throw new Error("renderer_configured_font_differs_from_approved_font");
    }
  }
  if (configured.APP_DOCUMENT_FONT_MANIFEST_SHA256
    && configured.APP_DOCUMENT_FONT_MANIFEST_SHA256.trim().toLowerCase() !== liberationSansContract.manifestSha256) {
    throw new Error("renderer_font_manifest_mismatch");
  }
  configured.APP_DOCUMENT_FONT_MANIFEST_SHA256 = liberationSansContract.manifestSha256;
  configured.APP_DOCUMENT_RENDERER_IDENTITY ||= `applypack-linux-renderer-${createHash("sha256").update(JSON.stringify(pins)).digest("hex").slice(0, 20)}`;
  Object.assign(environment, configured);
  return environment;
}
