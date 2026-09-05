import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobMatchPacketRender } from "./renderer";
import type { JobMatchPacketContent } from "./schema";
import type { JobMatchPacketRepository, PacketArtifact, PacketAuditSink } from "./service";
import { privateObjectMatchesChecksum } from "./storage-recovery";
import {
  JOB_MATCH_PACKET_RENDERER_VERSION,
  JOB_MATCH_PACKET_SCHEMA_VERSION,
  JOB_MATCH_PACKET_TEMPLATE_VERSION,
  PDFCN_UPSTREAM_COMMIT,
  TAKUMI_VERSION,
} from "./versions";

type Row = Record<string, unknown>;

export class SupabaseJobMatchPacketRepository implements JobMatchPacketRepository {
  constructor(private readonly admin: SupabaseClient) {}

  async loadOrder(orderId: string) {
    const { data, error } = await this.admin.from("orders").select("customer_id,product_kind,status,job_match_packet_artifact_id,job_match_packet_content_revision").eq("id", orderId).maybeSingle();
    if (error) throw new Error("packet_order_lookup_failed");
    return data?.product_kind === "job_search" ? {
      customerId: String(data.customer_id),
      status: String(data.status),
      currentArtifactId: data.job_match_packet_artifact_id ? String(data.job_match_packet_artifact_id) : null,
      contentRevision: Number(data.job_match_packet_content_revision),
    } : null;
  }

  async findCurrentApproved(orderId: string) {
    const order = await this.loadOrder(orderId);
    if (!order?.currentArtifactId) return null;
    const current = await this.getArtifact(order.currentArtifactId);
    return current?.orderId === orderId && current.status === "APPROVED" ? current : null;
  }

  async loadApprovedContent(orderId: string): Promise<JobMatchPacketContent> {
    const { data: order, error: orderError } = await this.admin.from("orders")
      .select("id,customer_id,product_kind,status,delivered_at,human_reviewed_at,human_reviewed_by")
      .eq("id", orderId).maybeSingle();
    if (orderError || !order || order.product_kind !== "job_search" || !["delivery_processing", "delivered"].includes(String(order.status)) || !order.human_reviewed_by) {
      throw new Error("approved_search_order_required");
    }
    const [{ data: profile, error: profileError }, { data: matches, error: matchError }] = await Promise.all([
      this.admin.from("profiles").select("display_name").eq("id", order.customer_id).maybeSingle(),
      this.admin.from("job_matches").select("id,position,fit_summary,criteria_checks,reviewed_by,reviewed_at,match_category,packet_strong_connections,packet_things_to_consider,packet_unknown_warnings,job:jobs(id,raw_title,title,employer_display_name,company,location_text,work_mode,employment_type,salary_text,benefits_status,schedule_type,timezone_requirement,remote_scope,eligible_states,eligible_countries,official_application_url,source_name,checked_at)").eq("search_order_id", orderId).order("position"),
    ]);
    if (profileError || matchError || !profile?.display_name || !matches || matches.length !== 10) {
      throw new Error("approved_packet_content_unavailable");
    }

    const jobs = matches.map((raw, index) => {
      const match = raw as Row;
      const job = relation(match.job);
      const criteria = object(match.criteria_checks);
      if (!match.reviewed_by || !match.reviewed_at || criteria.nonNegotiablesSatisfied !== true) throw new Error("approved_packet_content_unavailable");
      return {
        jobId: String(match.id),
        approval: {
          disposition: "APPROVED" as const,
          reviewId: `job-match-review:${String(match.id)}`,
          reviewerId: String(match.reviewed_by),
          reviewedAt: String(match.reviewed_at),
        },
        eligibilityDisposition: array(match.packet_unknown_warnings).length ? "ELIGIBLE_WITH_ALLOWED_UNKNOWNS" as const : "ELIGIBLE" as const,
        nonNegotiableDisposition: "PASS" as const,
        positionTitle: string(job.raw_title ?? job.title),
        employerName: string(job.employer_display_name ?? job.company),
        locationDisplay: string(job.location_text, "Location not stated"),
        workArrangement: optional(job.work_mode),
        employmentType: optional(job.employment_type),
        compensationDisplay: optional(job.salary_text),
        benefitsDisplay: optional(job.benefits_status),
        travelRequirements: undefined,
        scheduleDisplay: optional(job.schedule_type) ?? optional(job.timezone_requirement),
        geographicEligibility: geographic(job),
        directApplicationUrl: string(job.official_application_url),
        sourceDisplay: string(job.source_name, "Reviewed source"),
        verifiedAt: string(job.checked_at),
        matchCategory: String(match.match_category) as "DIRECT" | "TRANSFERABLE" | "DIRECT_AND_TRANSFERABLE",
        whyMatched: string(match.fit_summary),
        strongConnections: array(match.packet_strong_connections),
        thingsToConsider: array(match.packet_things_to_consider),
        unknownWarnings: array(match.packet_unknown_warnings),
        _position: Number(match.position ?? index + 1),
      };
    }).sort((a, b) => a._position - b._position).map(({ _position, ...job }) => {
      if (!Number.isInteger(_position)) throw new Error("approved_packet_position_invalid");
      return job;
    });

    return {
      schemaVersion: JOB_MATCH_PACKET_SCHEMA_VERSION,
      orderId,
      customerId: String(order.customer_id),
      customerDisplayName: String(profile.display_name),
      generatedAt: String(order.human_reviewed_at ?? order.delivered_at),
      policyVersions: {
        matching: "applypack-approved-match-record-v1",
        review: "applypack-human-release-review-v1",
        unknowns: "applypack-explicit-unknowns-v1",
      },
      jobs,
      disclosures: [
        "Job listings can change quickly. Always review the employer's current posting before applying.",
        "ApplyPack does not guarantee interviews, offers, compensation, or employment.",
      ],
    };
  }

  async findByIdentity(orderId: string, contentIdentity: string, contentRevision: number) {
    const { data, error } = await this.admin.from("job_match_packet_artifacts").select("*").eq("order_id", orderId).eq("content_identity", contentIdentity).eq("content_revision", contentRevision).maybeSingle();
    if (error) throw new Error("packet_artifact_lookup_failed");
    return data ? artifact(data as Row) : null;
  }

  async beginRender(input: Parameters<JobMatchPacketRepository["beginRender"]>[0]) {
    const row = {
      order_id: input.orderId,
      customer_id: input.customerId,
      content_identity: input.contentIdentity,
      content_snapshot_sha256: input.contentSnapshotSha256,
      content_revision: input.contentRevision,
      content_snapshot: input.contentSnapshot,
      schema_version: JOB_MATCH_PACKET_SCHEMA_VERSION,
      template_version: JOB_MATCH_PACKET_TEMPLATE_VERSION,
      renderer_version: JOB_MATCH_PACKET_RENDERER_VERSION,
      pdfcn_upstream_commit: PDFCN_UPSTREAM_COMMIT,
      takumi_version: TAKUMI_VERSION,
      requested_by: input.requestedBy,
      retention_due_at: input.retentionDueAt,
      render_lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
      render_generation: randomUUID(),
    };
    const inserted = await this.admin.from("job_match_packet_artifacts").insert(row).select("*").maybeSingle();
    if (!inserted.error && inserted.data) return { artifact: artifact(inserted.data as Row), acquired: true };
    if (inserted.error?.code !== "23505") throw new Error("packet_render_claim_failed");
    const existing = await this.findByIdentity(input.orderId, input.contentIdentity, input.contentRevision);
    if (!existing) throw new Error("packet_render_claim_failed");
    const existingRow = await this.raw(existing.id);
    const leaseExpired = existing.status === "RENDERING" && (!existingRow.render_lease_until || new Date(String(existingRow.render_lease_until)).getTime() < Date.now());
    if (existing.status !== "FAILED" && !leaseExpired) return { artifact: existing, acquired: false };
    let restart = this.admin.from("job_match_packet_artifacts").update({
      status: "RENDERING",
      failure_code: null,
      render_attempts: Number(existingRow.render_attempts ?? 1) + 1,
      render_lease_until: new Date(Date.now() + 5 * 60_000).toISOString(),
      render_generation: randomUUID(),
    }).eq("id", existing.id).eq("status", existing.status);
    if (leaseExpired && existingRow.render_lease_until) restart = restart.eq("render_lease_until", String(existingRow.render_lease_until));
    const restarted = await restart.select("*").maybeSingle();
    if (restarted.error) throw new Error("packet_render_retry_failed");
    return restarted.data ? { artifact: artifact(restarted.data as Row), acquired: true } : { artifact: (await this.getArtifact(existing.id))!, acquired: false };
  }

  async completeRender(artifactId: string, renderGeneration: string, output: JobMatchPacketRender) {
    const row = await this.raw(artifactId);
    const storagePath = `${row.customer_id}/${row.order_id}/job-match-packets/${row.content_identity}-r${row.content_revision}.pdf`;
    const upload = await this.admin.storage.from("customer-deliveries").upload(storagePath, output.bytes, { contentType: output.mediaType, upsert: false });
    if (upload.error) {
      const existing = await this.admin.storage.from("customer-deliveries").download(storagePath);
      if (existing.error || !existing.data || !(await privateObjectMatchesChecksum(existing.data, output.checksumSha256))) {
        throw new Error("packet_private_upload_conflict");
      }
    }
    const completed = await this.admin.from("job_match_packet_artifacts").update({
      status: "PREVIEW_READY",
      storage_bucket: "customer-deliveries",
      storage_path: storagePath,
      customer_filename: output.customerFilename,
      checksum_sha256: output.checksumSha256,
      size_bytes: output.bytes.byteLength,
      rendered_at: output.metadata.renderedAt,
      failure_code: null,
      render_lease_until: null,
    }).eq("id", artifactId).eq("status", "RENDERING").eq("render_generation", renderGeneration).eq("content_identity", output.contentIdentity).select("*").maybeSingle();
    if (completed.error || !completed.data) {
      throw new Error("packet_artifact_commit_failed");
    }
    return artifact(completed.data as Row);
  }

  async failRender(artifactId: string, renderGeneration: string, failureCode: string) {
    await this.admin.from("job_match_packet_artifacts").update({ status: "FAILED", failure_code: failureCode, render_lease_until: null }).eq("id", artifactId).eq("status", "RENDERING").eq("render_generation", renderGeneration);
  }

  async approve(artifactId: string, checksumSha256: string, approvedBy: string) {
    const approved = await this.admin.rpc("approve_job_match_packet_artifact", {
      p_artifact_id: artifactId,
      p_checksum_sha256: checksumSha256,
      p_actor_id: approvedBy,
      p_approved_at: new Date().toISOString(),
    });
    if (approved.error || !approved.data) throw new Error("packet_approval_conflict");
    const row = await this.getArtifact(String(approved.data));
    if (!row) throw new Error("packet_approval_conflict");
    return row;
  }

  async getArtifact(artifactId: string) {
    const { data, error } = await this.admin.from("job_match_packet_artifacts").select("*").eq("id", artifactId).maybeSingle();
    if (error) throw new Error("packet_artifact_lookup_failed");
    return data ? artifact(data as Row) : null;
  }

  async createSignedDownload(artifactId: string, expiresInSeconds: number) {
    const row = await this.raw(artifactId);
    if (!row.storage_path || !row.customer_filename) throw new Error("packet_private_object_unavailable");
    const { data, error } = await this.admin.storage.from("customer-deliveries").createSignedUrl(String(row.storage_path), expiresInSeconds, { download: String(row.customer_filename) });
    if (error || !data.signedUrl) throw new Error("packet_signed_url_failed");
    return data.signedUrl;
  }

  private async raw(id: string): Promise<Row> {
    const { data, error } = await this.admin.from("job_match_packet_artifacts").select("*").eq("id", id).maybeSingle();
    if (error || !data) throw new Error("packet_artifact_not_found");
    return data as Row;
  }
}

export class SupabasePacketAuditSink implements PacketAuditSink {
  constructor(private readonly admin: SupabaseClient) {}
  async record(event: Parameters<PacketAuditSink["record"]>[0]) {
    const { error } = await this.admin.from("audit_logs").insert({
      actor_id: event.actorId,
      action: event.action.toLowerCase(),
      entity_type: "job_match_packet_artifact",
      entity_id: event.artifactId,
      details: {
        order_id: event.orderId,
        status: event.status,
        content_identity: event.contentIdentity,
        failure_code: event.failureCode,
      },
    });
    if (error) throw new Error("packet_audit_write_failed");
  }
}

function artifact(row: Row): PacketArtifact {
  return {
    id: String(row.id), orderId: String(row.order_id), customerId: String(row.customer_id),
    contentIdentity: String(row.content_identity), contentSnapshotSha256: String(row.content_snapshot_sha256),
    status: String(row.status) as PacketArtifact["status"], checksumSha256: row.checksum_sha256 ? String(row.checksum_sha256) : null,
    customerFilename: row.customer_filename ? String(row.customer_filename) : null,
    rendererVersion: String(row.renderer_version), templateVersion: String(row.template_version),
    contentRevision: Number(row.content_revision), renderGeneration: String(row.render_generation),
    createdAt: String(row.created_at), approvedAt: row.approved_at ? String(row.approved_at) : null,
  };
}

function relation(value: unknown): Row {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") throw new Error("approved_job_record_unavailable");
  return row as Row;
}
function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function array(value: unknown): never[] { return Array.isArray(value) ? value as never[] : []; }
function string(value: unknown, fallback = ""): string { return typeof value === "string" && value.trim() ? value : fallback; }
function optional(value: unknown): string | undefined { const result = string(value); return !result || ["unknown", "not listed", "not confirmed", "not stated"].includes(result.trim().toLowerCase()) ? undefined : result; }
function geographic(job: Row): string | undefined {
  const states = Array.isArray(job.eligible_states) ? job.eligible_states.map(String).filter(Boolean) : [];
  const countries = Array.isArray(job.eligible_countries) ? job.eligible_countries.map(String).filter(Boolean) : [];
  return optional(job.remote_scope) ?? (states.length ? `Eligible states: ${states.join(", ")}` : undefined) ?? (countries.length ? `Eligible countries: ${countries.join(", ")}` : undefined);
}
