// @vitest-environment node
import { describe, expect, it } from "vitest";
import { PdfcnJobMatchPacketRenderer } from "@/lib/documents/job-match-packet/renderer";
import {
  JobMatchPacketError,
  JobMatchPacketService,
  type JobMatchPacketRepository,
  type PacketArtifact,
  type PacketAuditSink,
} from "@/lib/documents/job-match-packet/service";
import { JOB_MATCH_PACKET_RENDERER_VERSION, JOB_MATCH_PACKET_TEMPLATE_VERSION } from "@/lib/documents/job-match-packet/versions";
import { jobMatchPacketFixture } from "../fixtures/job-match-packet";

class FakeRepository implements JobMatchPacketRepository {
  content: unknown = jobMatchPacketFixture();
  artifacts: PacketArtifact[] = [];
  storedBytes = new Map<string, Uint8Array>();
  lastTtl = 0;
  currentArtifactId: string | null = null;
  orderStatus = "delivery_processing";
  contentRevision = 1;

  async loadOrder(orderId: string) {
    return orderId === "fixture-order-001"
      ? { customerId: "fixture-customer-001", status: this.orderStatus, currentArtifactId: this.currentArtifactId, contentRevision: this.contentRevision }
      : null;
  }
  async loadApprovedContent() { return structuredClone(this.content); }
  async findCurrentApproved() {
    return this.artifacts.find((item) => item.id === this.currentArtifactId && item.status === "APPROVED") ?? null;
  }
  async findByIdentity(orderId: string, identity: string, revision: number) {
    return this.artifacts.find((item) => item.orderId === orderId && item.contentIdentity === identity && item.contentRevision === revision && item.status !== "FAILED") ?? null;
  }
  async beginRender(input: Parameters<JobMatchPacketRepository["beginRender"]>[0]) {
    const existing = this.artifacts.find((item) => item.orderId === input.orderId && item.contentIdentity === input.contentIdentity && item.status !== "FAILED") ?? null;
    if (existing) return { artifact: existing, acquired: false };
    const artifact: PacketArtifact = {
      id: `artifact-${this.artifacts.length + 1}`,
      orderId: input.orderId,
      customerId: input.customerId,
      contentIdentity: input.contentIdentity,
      contentSnapshotSha256: input.contentSnapshotSha256,
      contentRevision: input.contentRevision,
      renderGeneration: "40000000-0000-4000-8000-000000000001",
      status: "RENDERING",
      checksumSha256: null,
      customerFilename: null,
      rendererVersion: JOB_MATCH_PACKET_RENDERER_VERSION,
      templateVersion: JOB_MATCH_PACKET_TEMPLATE_VERSION,
      createdAt: "2026-09-04T16:30:00.000Z",
      approvedAt: null,
    };
    this.artifacts.push(artifact);
    return { artifact, acquired: true };
  }
  async completeRender(id: string, _renderGeneration: string, output: Awaited<ReturnType<PdfcnJobMatchPacketRenderer["render"]>>) {
    const artifact = this.must(id);
    artifact.status = "PREVIEW_READY";
    artifact.checksumSha256 = output.checksumSha256;
    artifact.customerFilename = output.customerFilename;
    this.storedBytes.set(id, output.bytes);
    return artifact;
  }
  async failRender(id: string) { this.must(id).status = "FAILED"; }
  async approve(id: string, checksum: string) {
    const artifact = this.must(id);
    if (artifact.checksumSha256 !== checksum || artifact.status !== "PREVIEW_READY") throw new Error("approval_conflict");
    for (const current of this.artifacts) {
      if (current.orderId === artifact.orderId && current.status === "APPROVED") current.status = "SUPERSEDED";
    }
    artifact.status = "APPROVED";
    artifact.approvedAt = "2026-09-04T17:00:00.000Z";
    this.currentArtifactId = artifact.id;
    this.orderStatus = "delivered";
    return artifact;
  }
  async getArtifact(id: string) { return this.artifacts.find((item) => item.id === id) ?? null; }
  async createSignedDownload(id: string, expiresInSeconds: number) {
    if (!this.storedBytes.has(id)) throw new Error("missing_private_object");
    this.lastTtl = expiresInSeconds;
    return `https://private.example.invalid/signed/${id}?expires=${expiresInSeconds}`;
  }
  private must(id: string) {
    const artifact = this.artifacts.find((item) => item.id === id);
    if (!artifact) throw new Error("missing_artifact");
    return artifact;
  }
}

class FakeAudit implements PacketAuditSink {
  events: Parameters<PacketAuditSink["record"]>[0][] = [];
  async record(event: Parameters<PacketAuditSink["record"]>[0]) { this.events.push(event); }
}

function harness(options: { fail?: boolean; delay?: boolean } = {}) {
  const repo = new FakeRepository();
  const audit = new FakeAudit();
  let renderCount = 0;
  const renderer = new PdfcnJobMatchPacketRenderer(async () => async () => {
    renderCount += 1;
    if (options.delay) await new Promise((resolve) => setTimeout(resolve, 5));
    if (options.fail) throw new Error("wasm_runtime_failed");
    return Uint8Array.from(Buffer.from("%PDF-1.7\nsynthetic fixture bytes"));
  });
  return { repo, audit, service: new JobMatchPacketService(repo, renderer, audit, 30), renderer, renderCount: () => renderCount };
}

const operator = { id: "operator-001", role: "operator" as const };
const customer = { id: "fixture-customer-001", role: "customer" as const };

describe("protected job-match packet service", () => {
  it("fails closed for unauthenticated, customer-on-operator, and cross-customer access", async () => {
    const { service } = harness();
    await expect(service.generatePreview({ id: "", role: null } as never, "fixture-order-001")).rejects.toMatchObject({ code: "operator_access_required", status: 401 });
    await expect(service.generatePreview(customer, "fixture-order-001")).rejects.toMatchObject({ code: "operator_access_required", status: 403 });
    await expect(service.customerDownload({ id: "different-customer", role: "customer" }, "fixture-order-001")).rejects.toMatchObject({ code: "packet_not_found", status: 404 });
  });

  it("creates one private, idempotent preview under concurrent retries without logging content", async () => {
    const { service, repo, audit, renderCount } = harness({ delay: true });
    const [first, second] = await Promise.all([service.generatePreview(operator, "fixture-order-001"), service.generatePreview(operator, "fixture-order-001")]);
    expect(first.artifact.id).toBe(second.artifact.id);
    expect(repo.artifacts).toHaveLength(1);
    expect(renderCount()).toBe(1);
    expect(repo.storedBytes.size).toBe(1);
    expect(JSON.stringify(audit.events)).not.toContain("Synthetic Customer");
    expect(JSON.stringify(audit.events)).not.toContain("documentation and coordination");
  });

  it("requires the current checksum for approval and gives owner/operator signed links a 60-second TTL", async () => {
    const { service, repo } = harness();
    const { artifact } = await service.generatePreview(operator, "fixture-order-001");
    await expect(service.approve(operator, artifact.id, "0".repeat(64))).rejects.toBeInstanceOf(JobMatchPacketError);
    const previewUrl = await service.previewDownload(operator, artifact.id);
    expect(previewUrl).toContain("expires=60");
    const approved = await service.approve(operator, artifact.id, artifact.checksumSha256!);
    expect(approved.status).toBe("APPROVED");
    const customerUrl = await service.customerDownload(customer, "fixture-order-001");
    expect(customerUrl).toContain(artifact.id);
    expect(repo.lastTtl).toBe(60);
  });

  it("fails closed without an approved artifact-retention duration", async () => {
    const { repo, renderer, audit } = harness();
    const service = new JobMatchPacketService(repo, renderer, audit, null);
    await expect(service.generatePreview(operator, "fixture-order-001")).rejects.toMatchObject({ code: "packet_retention_policy_unconfigured", status: 503 });
    expect(repo.artifacts).toHaveLength(0);
  });

  it("rejects invalid final content before creating an artifact and leaves no partial deliverable after render failure", async () => {
    const invalid = harness();
    const fixture = jobMatchPacketFixture();
    invalid.repo.content = { ...fixture, jobs: fixture.jobs.slice(0, 9) };
    await expect(invalid.service.generatePreview(operator, "fixture-order-001")).rejects.toBeTruthy();
    expect(invalid.repo.artifacts).toHaveLength(0);

    const failed = harness({ fail: true });
    await expect(failed.service.generatePreview(operator, "fixture-order-001")).rejects.toMatchObject({ code: "packet_render_failed" });
    expect(failed.repo.artifacts).toHaveLength(1);
    expect(failed.repo.artifacts[0].status).toBe("FAILED");
    expect(failed.repo.storedBytes.size).toBe(0);
  });
});
