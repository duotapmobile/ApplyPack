import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { notifyCustomer } from "@/lib/email/notify";
import { PdfcnJobMatchPacketRenderer } from "@/lib/documents/job-match-packet/renderer";
import { JobMatchPacketError, JobMatchPacketService } from "@/lib/documents/job-match-packet/service";
import { SupabaseJobMatchPacketRepository, SupabasePacketAuditSink } from "@/lib/documents/job-match-packet/supabase-repository";
import { isSameOriginRequest } from "@/lib/security/origin";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }).strict(),
  z.object({ action: z.literal("approve"), artifactId: z.string().uuid(), checksumSha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This packet request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid packet action." }, { status: 400 });
  const orderId = (await context.params).id;
  const repository = new SupabaseJobMatchPacketRepository(auth.admin);
  const service = new JobMatchPacketService(
    repository,
    new PdfcnJobMatchPacketRenderer(),
    new SupabasePacketAuditSink(auth.admin),
    configuredRetentionDays(),
  );
  try {
    if (parsed.data.action === "generate") {
      const result = await service.generatePreview({ id: auth.user.id, role: "operator" }, orderId);
      return NextResponse.json({
        artifactId: result.artifact.id,
        status: result.artifact.status,
        checksumSha256: result.artifact.checksumSha256,
        rendererVersion: result.artifact.rendererVersion,
        templateVersion: result.artifact.templateVersion,
        reused: result.reused,
      }, { headers: { "Cache-Control": "no-store, private" } });
    }
    const orderBeforeApproval = await repository.loadOrder(orderId);
    const candidate = await repository.getArtifact(parsed.data.artifactId);
    if (!candidate || candidate.orderId !== orderId) return NextResponse.json({ error: "Packet not found." }, { status: 404 });
    const artifact = await service.approve({ id: auth.user.id, role: "operator" }, parsed.data.artifactId, parsed.data.checksumSha256);
    if (orderBeforeApproval?.status === "delivery_processing") {
      await notifyCustomer({
        customerId: artifact.customerId,
        orderId,
        template: "search_delivery",
        subject: "Your 10 ApplyPack job matches are ready",
        lines: ["Your researched job matches and approved PDF packet are ready in My ApplyPack.", "Review each employer listing before deciding whether to apply."],
      });
    }
    return NextResponse.json({ artifactId: artifact.id, status: artifact.status, checksumSha256: artifact.checksumSha256 }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return packetError(error);
  }
}

function configuredRetentionDays(): number | null {
  const value = Number(process.env.APP_GENERATED_ARTIFACT_RETENTION_DAYS);
  return Number.isInteger(value) && value > 0 && value <= 3650 ? value : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const artifactId = new URL(request.url).searchParams.get("artifactId");
  if (!artifactId || !z.string().uuid().safeParse(artifactId).success) return NextResponse.json({ error: "Packet not found." }, { status: 404 });
  const orderId = (await context.params).id;
  const repository = new SupabaseJobMatchPacketRepository(auth.admin);
  const artifact = await repository.getArtifact(artifactId);
  if (!artifact || artifact.orderId !== orderId) return NextResponse.json({ error: "Packet not found." }, { status: 404 });
  const service = new JobMatchPacketService(repository, new PdfcnJobMatchPacketRenderer(), new SupabasePacketAuditSink(auth.admin), configuredRetentionDays());
  try {
    const url = await service.previewDownload({ id: auth.user.id, role: "operator" }, artifactId);
    const response = NextResponse.redirect(url, { status: 303 });
    response.headers.set("Cache-Control", "no-store, private");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return packetError(error);
  }
}

function packetError(error: unknown) {
  if (error instanceof JobMatchPacketError) return NextResponse.json({ error: error.code }, { status: error.status });
  return NextResponse.json({ error: "Packet generation is unavailable." }, { status: 502 });
}
