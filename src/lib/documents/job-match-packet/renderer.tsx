import type { ReactNode } from "react";
import type { RenderOptions } from "takumi-pdf";
import type { DocumentRenderer } from "../renderer";
import { PageFooter, PageHeader, ThemeProvider } from "../pdfcn/components";
import { applyPackPdfTheme } from "../pdfcn/theme";
import { jobMatchPacketFilename, jobMatchPacketIdentity, sha256 } from "./identity";
import { parseFinalJobMatchPacketContent, type JobMatchPacketContent } from "./schema";
import { JobMatchPacketTemplate } from "./template";
import {
  JOB_MATCH_PACKET_RENDERER_VERSION,
  JOB_MATCH_PACKET_SCHEMA_VERSION,
  JOB_MATCH_PACKET_TEMPLATE_VERSION,
  PDFCN_COMPONENT_REVISION,
  PDFCN_UPSTREAM_COMMIT,
  TAKUMI_VERSION,
} from "./versions";

type TakumiRender = (node: ReactNode, options?: RenderOptions) => Promise<Uint8Array>;

export type JobMatchPacketRender = {
  bytes: Uint8Array;
  checksumSha256: string;
  contentIdentity: string;
  customerFilename: string;
  mediaType: "application/pdf";
  metadata: {
    schemaVersion: string;
    templateVersion: string;
    rendererVersion: string;
    pdfcnRevision: string;
    pdfcnUpstreamCommit: string;
    takumiVersion: string;
    renderedAt: string;
    durationMs: number;
  };
};

async function loadTakumiRender(): Promise<TakumiRender> {
  if (process.env.NEXT_RUNTIME) {
    return (await import("takumi-pdf/next")).render;
  }
  return (await import("takumi-pdf")).render;
}

export class PdfcnJobMatchPacketRenderer implements DocumentRenderer<unknown, JobMatchPacketRender> {
  constructor(
    private readonly renderPdf: () => Promise<TakumiRender> = loadTakumiRender,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async render(input: unknown): Promise<JobMatchPacketRender> {
    const content = parseFinalJobMatchPacketContent(input);
    const started = performance.now();
    const render = await this.renderPdf();
    const creationDate = content.generatedAt.replace(/\.\d{3}Z$/u, "").replace(/Z$/u, "");
    const bytes = await render(<JobMatchPacketTemplate content={content} />, {
      size: "letter",
      margin: { top: 58, right: 48, bottom: 58, left: 48 },
      header: <ThemeProvider theme={applyPackPdfTheme}><PageHeader left="APPLYPACK · JOB MATCHES" right={content.customerDisplayName} /></ThemeProvider>,
      footer: <ThemeProvider theme={applyPackPdfTheme}><PageFooter left="Private customer document" /></ThemeProvider>,
      fontFamilies: ["sans-serif"],
      lang: "en-US",
      tagged: true,
      outline: true,
      metadata: {
        title: `${content.customerDisplayName} — ApplyPack Job Matches`,
        description: "Ten human-reviewed ApplyPack job matches with evidence connections, considerations, and explicit unknowns.",
        authors: ["ApplyPack"],
        creator: JOB_MATCH_PACKET_RENDERER_VERSION,
        keywords: ["ApplyPack", "job matches", "human reviewed"],
        creationDate,
      },
      backgroundColor: applyPackPdfTheme.colors.canvas,
    });

    if (bytes.length < 8 || Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
      throw new Error("pdfcn_renderer_invalid_pdf_signature");
    }

    return {
      bytes,
      checksumSha256: sha256(bytes),
      contentIdentity: jobMatchPacketIdentity(content),
      customerFilename: jobMatchPacketFilename(content.customerDisplayName),
      mediaType: "application/pdf",
      metadata: {
        schemaVersion: JOB_MATCH_PACKET_SCHEMA_VERSION,
        templateVersion: JOB_MATCH_PACKET_TEMPLATE_VERSION,
        rendererVersion: JOB_MATCH_PACKET_RENDERER_VERSION,
        pdfcnRevision: PDFCN_COMPONENT_REVISION,
        pdfcnUpstreamCommit: PDFCN_UPSTREAM_COMMIT,
        takumiVersion: TAKUMI_VERSION,
        renderedAt: this.now().toISOString(),
        durationMs: Math.round(performance.now() - started),
      },
    };
  }
}

export type { JobMatchPacketContent };
