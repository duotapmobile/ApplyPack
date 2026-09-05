import type { PdfcnJobMatchPacketRenderer, JobMatchPacketRender } from "./renderer";
import { canonicalContentJson, jobMatchPacketIdentity, sha256 } from "./identity";
import { parseFinalJobMatchPacketContent, type JobMatchPacketContent } from "./schema";

export type PacketActor = {
  id: string;
  role: "customer" | "operator" | "admin";
};

export type PacketArtifactStatus = "RENDERING" | "PREVIEW_READY" | "APPROVED" | "FAILED" | "SUPERSEDED" | "EXPIRED";
export const PRIVATE_DOWNLOAD_TTL_SECONDS = 60;

export type PacketOrder = {
  customerId: string;
  status: "delivery_processing" | "delivered" | string;
  currentArtifactId: string | null;
  contentRevision: number;
};

export type PacketArtifact = {
  id: string;
  orderId: string;
  customerId: string;
  contentIdentity: string;
  contentSnapshotSha256: string;
  contentRevision: number;
  renderGeneration: string;
  status: PacketArtifactStatus;
  checksumSha256: string | null;
  customerFilename: string | null;
  rendererVersion: string;
  templateVersion: string;
  createdAt: string;
  approvedAt: string | null;
};

export interface JobMatchPacketRepository {
  loadOrder(orderId: string): Promise<PacketOrder | null>;
  loadApprovedContent(orderId: string): Promise<unknown>;
  findByIdentity(orderId: string, contentIdentity: string, contentRevision: number): Promise<PacketArtifact | null>;
  findCurrentApproved(orderId: string): Promise<PacketArtifact | null>;
  beginRender(input: {
    orderId: string;
    customerId: string;
    contentIdentity: string;
    contentSnapshot: JobMatchPacketContent;
    contentSnapshotSha256: string;
    contentRevision: number;
    requestedBy: string;
    retentionDueAt: string;
  }): Promise<{ artifact: PacketArtifact; acquired: boolean }>;
  completeRender(artifactId: string, renderGeneration: string, output: JobMatchPacketRender): Promise<PacketArtifact>;
  failRender(artifactId: string, renderGeneration: string, failureCode: string): Promise<void>;
  approve(artifactId: string, checksumSha256: string, approvedBy: string): Promise<PacketArtifact>;
  getArtifact(artifactId: string): Promise<PacketArtifact | null>;
  createSignedDownload(artifactId: string, expiresInSeconds: number): Promise<string>;
}

export interface PacketAuditSink {
  record(event: {
    actorId: string;
    action: "PACKET_RENDER_REQUESTED" | "PACKET_PREVIEW_OPENED" | "PACKET_APPROVED" | "PACKET_DOWNLOADED" | "PACKET_RENDER_FAILED";
    orderId: string;
    artifactId: string;
    status: PacketArtifactStatus;
    contentIdentity?: string;
    failureCode?: string;
  }): Promise<void>;
}

export class JobMatchPacketError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

export class JobMatchPacketService {
  constructor(
    private readonly repository: JobMatchPacketRepository,
    private readonly renderer: PdfcnJobMatchPacketRenderer,
    private readonly audit: PacketAuditSink,
    private readonly retentionDays: number | null,
  ) {}

  async generatePreview(actor: PacketActor, orderId: string): Promise<{ artifact: PacketArtifact; reused: boolean }> {
    requireOperator(actor);
    if (!this.retentionDays) throw new JobMatchPacketError("packet_retention_policy_unconfigured", 503);
    const order = await this.repository.loadOrder(orderId);
    if (!order || !["delivery_processing", "delivered"].includes(order.status)) throw new JobMatchPacketError("order_not_found", 404);
    const customerId = order.customerId;

    const content = parseFinalJobMatchPacketContent(await this.repository.loadApprovedContent(orderId));
    if (content.orderId !== orderId || content.customerId !== customerId) {
      throw new JobMatchPacketError("content_order_boundary_mismatch", 409);
    }
    const contentIdentity = jobMatchPacketIdentity(content);
    const orderAfterContent = await this.repository.loadOrder(orderId);
    if (!orderAfterContent || orderAfterContent.contentRevision !== order.contentRevision || order.contentRevision < 1) {
      throw new JobMatchPacketError("packet_content_changed_during_snapshot", 409);
    }
    const existing = await this.repository.findByIdentity(orderId, contentIdentity, order.contentRevision);
    if (existing && ["PREVIEW_READY", "APPROVED"].includes(existing.status)) {
      return { artifact: existing, reused: true };
    }

    const contentSnapshotSha256 = sha256(canonicalContentJson(content));
    const claim = await this.repository.beginRender({
      orderId,
      customerId,
      contentIdentity,
      contentSnapshot: content,
      contentSnapshotSha256,
      requestedBy: actor.id,
      retentionDueAt: new Date(Date.now() + this.retentionDays * 86_400_000).toISOString(),
      contentRevision: order.contentRevision,
    });
    const started = claim.artifact;
    if (!claim.acquired) return { artifact: started, reused: true };
    await this.audit.record({ actorId: actor.id, action: "PACKET_RENDER_REQUESTED", orderId, artifactId: started.id, status: started.status, contentIdentity });

    try {
      const output = await this.renderer.render(content);
      return { artifact: await this.repository.completeRender(started.id, started.renderGeneration, output), reused: false };
    } catch (error) {
      const failureCode = safeFailureCode(error);
      await this.repository.failRender(started.id, started.renderGeneration, failureCode);
      await this.audit.record({ actorId: actor.id, action: "PACKET_RENDER_FAILED", orderId, artifactId: started.id, status: "FAILED", failureCode });
      throw new JobMatchPacketError("packet_render_failed", 502);
    }
  }

  async previewDownload(actor: PacketActor, artifactId: string): Promise<string> {
    requireOperator(actor);
    const artifact = await this.requireArtifact(artifactId);
    if (!(["PREVIEW_READY", "APPROVED"] as PacketArtifactStatus[]).includes(artifact.status)) {
      throw new JobMatchPacketError("packet_preview_not_ready", 409);
    }
    await this.audit.record({ actorId: actor.id, action: "PACKET_PREVIEW_OPENED", orderId: artifact.orderId, artifactId, status: artifact.status });
    return this.repository.createSignedDownload(artifactId, PRIVATE_DOWNLOAD_TTL_SECONDS);
  }

  async approve(actor: PacketActor, artifactId: string, expectedChecksum: string): Promise<PacketArtifact> {
    requireOperator(actor);
    if (!/^[a-f0-9]{64}$/u.test(expectedChecksum)) throw new JobMatchPacketError("invalid_expected_checksum", 400);
    const artifact = await this.requireArtifact(artifactId);
    if (artifact.status !== "PREVIEW_READY" || artifact.checksumSha256 !== expectedChecksum) {
      throw new JobMatchPacketError("packet_approval_conflict", 409);
    }
    const order = await this.repository.loadOrder(artifact.orderId);
    if (!order || order.customerId !== artifact.customerId || !["delivery_processing", "delivered"].includes(order.status)) {
      throw new JobMatchPacketError("packet_approval_conflict", 409);
    }
    const currentContent = parseFinalJobMatchPacketContent(await this.repository.loadApprovedContent(artifact.orderId));
    if (jobMatchPacketIdentity(currentContent) !== artifact.contentIdentity) {
      throw new JobMatchPacketError("packet_approval_stale_snapshot", 409);
    }
    const approved = await this.repository.approve(artifactId, expectedChecksum, actor.id);
    return approved;
  }

  async customerDownload(actor: PacketActor, orderId: string): Promise<string> {
    if (actor.role !== "customer") throw new JobMatchPacketError("customer_access_required", 403);
    const order = await this.repository.loadOrder(orderId);
    if (!order || order.status !== "delivered" || order.customerId !== actor.id) throw new JobMatchPacketError("packet_not_found", 404);
    const artifact = await this.repository.findCurrentApproved(orderId);
    if (!artifact || artifact.id !== order.currentArtifactId || artifact.status !== "APPROVED" || artifact.customerId !== actor.id) {
      throw new JobMatchPacketError("packet_not_found", 404);
    }
    await this.audit.record({ actorId: actor.id, action: "PACKET_DOWNLOADED", orderId, artifactId: artifact.id, status: artifact.status });
    return this.repository.createSignedDownload(artifact.id, PRIVATE_DOWNLOAD_TTL_SECONDS);
  }

  private async requireArtifact(artifactId: string): Promise<PacketArtifact> {
    const artifact = await this.repository.getArtifact(artifactId);
    if (!artifact) throw new JobMatchPacketError("packet_not_found", 404);
    return artifact;
  }
}

function requireOperator(actor: PacketActor) {
  if (actor.role !== "operator" && actor.role !== "admin") {
    throw new JobMatchPacketError("operator_access_required", actor.role === "customer" ? 403 : 401);
  }
}

function safeFailureCode(error: unknown): string {
  const value = error instanceof Error ? error.message : "unknown_renderer_failure";
  return /^[a-z0-9_:-]{1,100}$/u.test(value) ? value : "unknown_renderer_failure";
}
