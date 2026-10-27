// Test-only transport: actual Supabase SDK requests execute against the owned
// disposable native PostgreSQL cluster. This is not hosted PostgREST proof.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { researchLocalSql } from "./research-local-postgres";
import { researchFixtureIdentity } from "../../scripts/lib/research-fixture-identity.mjs";
const tables = new Set(["profiles", "ap_intake_snapshots", "ap_candidate_facts", "ap_feasibility_requests", "ap_research_preparations",
  "ap_research_preparation_sources", "ap_research_preparation_configuration", "ap_source_authorization_heads", "ap_source_authorizations",
  "ap_feasibility_source_configurations", "ap_feasibility_coverage_plans", "ap_feasibility_coverage_cells", "ap_inventory_versions", "ap_inventory_members",
  "ap_requirement_nodes", "ap_human_review_records", "ap_match_evaluations", "ap_job_snapshots", "ap_source_verifications", "ap_research_cell_reviews",
  "ap_manual_research_reviews", "job_source_schedules", "job_source_runs", "job_source_run_listings", "job_source_listing_projections", "job_sources", "ap_scheduled_jobs",
  "ap_anonymous_drafts", "ap_fact_presentations", "ap_commerce_configuration", "ap_search_services", "ap_refund_operations",
  "ap_material_lines", "ap_criteria_amendments", "ap_reference_regenerations",
  "operational_heartbeats", "ap_operational_alerts", "storage_cleanup_queue", "ap_aws_temporary_cleanup",
  "ap_checkout_mode_configuration", "ap_staging_rehearsal_authorizations", "ap_checkout_initiations", "ap_sensitive_payloads",
  "ap_checkout_attempts", "ap_quotes", "webhook_events", "orders", "search_candidates", "workflow_tasks"]);
const rpcNames = new Set(["ap_claim_research_preparation", "ap_prepare_automatic_research", "ap_bind_prepared_research_run", "ap_finish_research_preparation_check",
  "ap_research_snapshot_current", "ap_promote_prepared_research_observation", "ap_complete_prepared_research_review", "ap_research_preparation_ready",
  "ap_enqueue_due_job_source_syncs", "ap_claim_job_source_syncs", "ap_renew_job_source_sync_lease", "ap_archive_source_attempt", "ap_finalize_job_source_run",
  "ap_complete_job_source_sync", "ap_retry_job_source_sync", "ap_project_source_observation", "ap_record_matching_review", "ap_persist_match_evaluation",
  "ap_current_verified_job_snapshots", "ap_current_commute_evaluation_ids", "ap_claim_feasibility_request", "ap_persist_derived_feasibility_assessment",
  "ap_complete_feasibility_request", "ap_defer_feasibility_request", "ap_stale_feasibility_request", "ap_fail_feasibility_request", "ap_issue_search_checkout_invitation",
  "ap_issue_candidate_question", "ap_material_clarification_answer_context", "ap_material_clarification_questions", "ap_answer_material_clarification",
  "ap_read_four_step_draft", "ap_save_four_step_draft", "ap_effective_intake_documents", "ap_intake_source_lineage", "ap_intake_confirmation_source",
  "ap_prepare_intake_confirmation", "ap_read_intake_confirmation", "ap_finalize_four_step_intake_with_legal_acceptance_v3",
  "ap_has_current_content_bound_legal_acceptance", "ap_record_fact_presentation"]);
for (const name of ["ap_owned_intake_draft_context", "ap_owned_intake_drafts", "ap_create_owned_intake_draft", "ap_claim_intake_draft",
  "ap_resume_owned_intake_draft", "ap_resume_material_clarification", "consume_rate_limit", "ap_prepare_intake_clarification_notification",
  "ap_pin_intake_clarification_delivery", "ap_prepare_claimed_payment_notification", "ap_pin_claimed_payment_delivery", "ap_claim_outbox_messages",
  "ap_renew_outbox_lease", "ap_complete_outbox_message", "ap_fail_outbox_message", "ap_queue_search_refund",
  "ap_intake_payment_identity", "ap_read_current_feasibility", "ap_manual_launch_capacity_readiness", "ap_manual_launch_schema_readiness",
  "ap_current_source_readiness", "ap_begin_authorized_search_checkout", "ap_bind_checkout_initiation", "ap_reconcile_checkout_initiation",
  "claim_stripe_webhook", "ap_apply_verified_search_payment", "claim_workflow_tasks", "ap_persist_match_selection", "ap_commit_exact_ten_release",
  "ap_employer_rule_review_basis", "ap_prepare_employer_rule_source_evidence", "ap_confirm_employer_submission_rules", "ap_employer_rule_review_receipt"]) rpcNames.add(name);
const ident = (value: string) => { if (!/^[a-z_][a-z0-9_]*$/u.test(value)) throw new Error("local_identifier_rejected"); return `"${value}"`; };
const literal = (value: unknown): string => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
function fields(value: string) {
  let depth = 0, start = 0; const parts: string[] = [];
  for (let i = 0; i < value.length; i++) { if (value[i] === "(") depth++; if (value[i] === ")") depth--; if (value[i] === "," && !depth) { parts.push(value.slice(start, i)); start = i + 1; } }
  if (depth !== 0) throw new Error("local_select_rejected"); parts.push(value.slice(start)); return parts;
}
const joins: Record<string, Record<string, string>> = {
  ap_inventory_members: { ap_job_snapshots: "job_snapshot_id" }, ap_job_snapshots: { ap_source_authorizations: "source_authorization_id" },
  ap_feasibility_coverage_cells: { ap_source_authorizations: "source_authorization_id" }, ap_match_evaluations: { ap_job_snapshots: "job_snapshot_id" },
};
function projection(table: string, selection: string, alias = "row", level = 0): string {
  const entries = fields(selection || "*"); const pairs: string[] = []; let base = "'{}'::jsonb";
  for (const entry of entries) {
    if (entry === "*") { base = `to_jsonb(${alias})`; continue; }
    const relation = /^([a-z_]+):([a-z_]+)(?:!inner)?\((.*)\)$/u.exec(entry);
    if (relation) {
      const [, name, target, nested] = relation, fk = joins[table]?.[target], next = `nested${level}`;
      if (!fk || level > 2) throw new Error("local_join_rejected");
      pairs.push(literal(name), `(select ${projection(target, nested, next, level + 1)} from public.${ident(target)} ${next} where ${next}.id=${alias}.${ident(fk)})`);
    } else { const [name, column = name] = entry.split(":"); pairs.push(literal(name), `${alias}.${ident(column)}`); }
  }
  return pairs.length ? `${base}||jsonb_build_object(${pairs.join(",")})` : base;
}
function predicate(params: URLSearchParams) {
  const clauses: string[] = [];
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(column)) continue;
    const key = ident(column); let value = expression, negate = false;
    if (value.startsWith("not.")) { value = value.slice(4); negate = true; }
    const dot = value.indexOf("."), operator = value.slice(0, dot), operand = value.slice(dot + 1);
    let clause: string;
    if (operator === "is" && ["null", "true", "false"].includes(operand)) clause = `${key} is ${operand}`;
    else if (operator === "in" && operand.startsWith("(") && operand.endsWith(")")) clause = `${key} in (${operand.slice(1, -1).split(",").map(v => literal(v.replace(/^"|"$/gu, ""))).join(",")})`;
    else {
      const op = ({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as Record<string, string>)[operator];
      if (!op) throw new Error("local_filter_rejected"); clause = `${key}${op}${literal(operand)}`;
    }
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses.length ? ` where ${clauses.join(" and ")}` : "";
}
export async function createResearchLocalDatabase() {
  const { port, marker } = researchFixtureIdentity(process.env, process.platform);
  async function sql(statement: string, privileged = false) {
    const command = `begin; set local statement_timeout='10s'; set local lock_timeout='2s'; ${privileged ? "" : "set local role service_role;"} ${statement}; commit;`;
    const rows = await researchLocalSql(Number(port), command);
    if (rows.length > 1) throw new Error("local_pg_ambiguous_receipt"); return rows.length ? JSON.parse(rows[0]) : null;
  }
  const identity = await sql("select jsonb_build_object('address',inet_server_addr()::text,'port',inet_server_port(),'marker',(select marker from public.ap_research_local_test_identity))", true);
  if (identity.address !== "127.0.0.1/32" && identity.address !== "127.0.0.1" || identity.port !== Number(port) || identity.marker !== marker) throw new Error("local_research_database_identity_rejected");
  const metadata = new Map<string, { args: Record<string, string>; set: boolean }>();
  const failures: string[] = [];
  async function fetchDatabase(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.origin !== "http://127.0.0.1:1") throw new Error("local_research_transport_rejected");
    const authUser = /^\/auth\/v1\/admin\/users\/([a-f0-9-]{36})$/u.exec(url.pathname);
    if (authUser && request.method === "GET" && !url.search) {
      const user = await sql(`select jsonb_build_object('id',id,'email',email,'email_confirmed_at',email_confirmed_at,'is_anonymous',is_anonymous,'aud',aud,'role',role,'created_at',created_at,'updated_at',updated_at,'app_metadata',raw_app_meta_data,'user_metadata',raw_user_meta_data) from auth.users where id=${literal(authUser[1])}::uuid`, true);
      return user ? Response.json({ user }) : Response.json({ message: "User not found" }, { status: 404 });
    }
    if (!url.pathname.startsWith("/rest/v1/")) throw new Error("local_research_transport_rejected");
    request.signal.throwIfAborted();
    try {
      const name = url.pathname.slice(9); let result: unknown;
      if (name.startsWith("rpc/")) {
        const fn = name.slice(4); if (!rpcNames.has(fn) || request.method !== "POST") throw new Error(`local_rpc_rejected:${fn}`);
        let contract = metadata.get(fn);
        if (!contract) {
          const found = await sql(`select jsonb_build_object('set',p.proretset,'args',coalesce((select jsonb_object_agg(p.proargnames[i+1],format_type(p.proargtypes[i],null)) from generate_series(0,p.pronargs-1)i),'{}'::jsonb)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=${literal(fn)}`, true);
          if (!found) throw new Error("local_rpc_missing"); contract = found; metadata.set(fn, found);
        }
        const body = await request.json(), typed = Object.entries(body).map(([key, value]) => {
          const type = contract!.args[key]; if (!type || !/^[a-z0-9_ .\[\]]+$/u.test(type)) throw new Error("local_rpc_argument_rejected");
          // PostgREST maps a top-level null RPC argument to SQL NULL; only
          // nested JSON null remains a JSON value inside a supplied document.
          const encoded = value === null ? "null" : type === "jsonb" || type === "json" ? json(value) : Array.isArray(value) ? `ARRAY[${value.map(literal).join(",")}]` : literal(value);
          return `${ident(key)}=>${encoded}::${type}`;
        });
        const call = `public.${ident(fn)}(${typed.join(",")})`;
        const selection = url.searchParams.get("select") || "*", maximum = url.searchParams.get("limit");
        if (maximum && !/^\d{1,5}$/u.test(maximum)) throw new Error("local_limit_rejected");
        if ([...url.searchParams.keys()].some(key => !["select", "limit"].includes(key))) throw new Error("local_rpc_query_rejected");
        result = await sql(contract!.set ? `select coalesce(jsonb_agg(value),'[]') from (select ${projection(fn, selection)} value from ${call} row${maximum ? ` limit ${maximum}` : ""}) selected` : `select to_jsonb(${call})`);
      } else {
        if (!tables.has(name)) throw new Error(`local_table_rejected:${name}`);
        const params = url.searchParams, select = params.get("select") || "*", where = predicate(params);
        const conflict = params.get("on_conflict");
        if (conflict && (name !== "search_candidates" || request.method !== "POST" || conflict !== "search_order_id,job_id"
          || !request.headers.get("prefer")?.split(",").includes("resolution=ignore-duplicates"))) throw new Error("local_upsert_rejected");
        if (request.method === "HEAD") {
          if (request.headers.get("prefer") !== "count=exact" || params.has("columns")) throw new Error("local_count_request_rejected");
          const count = await sql(`select count(*)::integer from public.${ident(name)}${where}`);
          return new Response(null, { headers: { "content-range": `*/${count}` } });
        }
        if (params.has("columns") && request.method !== "POST") throw new Error("local_columns_method_rejected");
        let source = `public.${ident(name)}`, prefix = "";
        if (["POST", "PATCH"].includes(request.method)) {
          const body = await request.json(), records = Array.isArray(body) ? body : [body];
          const keys = Object.keys(records[0]); if (!keys.length || records.some(row => Object.keys(row).join() !== keys.join())) throw new Error("local_mutation_shape");
          if (params.has("columns")) {
            const declared = JSON.parse(`[${params.get("columns")}]`);
            if (!Array.isArray(declared) || declared.length !== keys.length || declared.some((key, index) => key !== keys[index])) throw new Error("local_columns_shape_rejected");
          }
          const columns = keys.map(ident).join(",");
          const mutation = request.method === "POST" ? `insert into ${source}(${columns}) select ${columns} from jsonb_populate_recordset(null::${source},${json(records)})${conflict ? " on conflict(search_order_id,job_id) do nothing" : ""}`
            : `update ${source} set (${columns})=(select ${columns} from jsonb_populate_record(null::${source},${json(records[0])}))${where}`;
          prefix = `with changed as (${mutation} returning *) `; source = "changed";
        } else if (request.method === "DELETE" && name === "search_candidates" && params.get("search_order_id")?.startsWith("eq.")
          && params.get("review_status") === "eq.proposed") {
          prefix = `with changed as (delete from ${source}${where} returning *) `; source = "changed";
        } else if (request.method !== "GET") throw new Error("local_method_rejected");
        const ordering = params.get("order")?.split(",").map(value => { const [key, direction] = value.split("."); if (!["asc", "desc"].includes(direction)) throw new Error("local_order_rejected"); return `${ident(key)} ${direction}`; }).join(",");
        const maximum = params.get("limit"); if (maximum && !/^\d{1,5}$/u.test(maximum)) throw new Error("local_limit_rejected");
        result = await sql(`${prefix}select coalesce(jsonb_agg(value),'[]') from (select ${projection(name, select)} value from ${source} row${prefix ? "" : where}${ordering ? ` order by ${ordering}` : ""}${maximum ? ` limit ${maximum}` : ""}) selected`);
        if (request.headers.get("accept")?.includes("vnd.pgrst.object")) {
          if (!Array.isArray(result) || result.length !== 1) return Response.json({ code: "PGRST116", message: "single row required", details: "The result contains 0 rows" }, { status: 406 });
          result = result[0];
        }
      }
      request.signal.throwIfAborted(); return Response.json(result);
    } catch (error) {
      failures.push(`${request.method} ${url.pathname}: ${String(error)}`);
      const code = error instanceof Error && "code" in error && typeof error.code === "string" && /^[A-Z0-9]{5}$/u.test(error.code)
        ? error.code : "LOCAL_SQL_REJECTED";
      return Response.json({ code, message: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }
  async function script(statement: string) {
    // Fixture setup emits composite rows; validate every protocol field while
    // discarding those setup results. Route receipts stay single-column strict.
    await researchLocalSql(Number(port), statement, true);
  }
  return { sql, script, failures, admin: createClient<Database>("http://127.0.0.1:1", "synthetic-local-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDatabase } }) };
}
