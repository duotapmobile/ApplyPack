// Test-only transport: actual Supabase SDK requests execute against the owned
// disposable native PostgreSQL cluster. This is not hosted PostgREST proof.
import { createClient } from "@supabase/supabase-js";
import { researchLocalSql } from "./research-local-postgres";
import { researchFixtureIdentity } from "../../scripts/lib/research-fixture-identity.mjs";
const tables = new Set(["profiles", "ap_intake_snapshots", "ap_candidate_facts", "ap_feasibility_requests", "ap_research_preparations",
  "ap_research_preparation_sources", "ap_research_preparation_configuration", "ap_source_authorization_heads", "ap_source_authorizations",
  "ap_feasibility_source_configurations", "ap_feasibility_coverage_plans", "ap_feasibility_coverage_cells", "ap_inventory_versions", "ap_inventory_members",
  "ap_requirement_nodes", "ap_human_review_records", "ap_match_evaluations", "ap_job_snapshots", "ap_source_verifications", "ap_research_cell_reviews",
  "ap_manual_research_reviews", "job_source_schedules", "job_source_runs", "job_source_run_listings", "job_source_listing_projections", "job_sources", "ap_scheduled_jobs"]);
const rpcNames = new Set(["ap_claim_research_preparation", "ap_prepare_automatic_research", "ap_bind_prepared_research_run", "ap_finish_research_preparation_check",
  "ap_research_snapshot_current", "ap_promote_prepared_research_observation", "ap_complete_prepared_research_review", "ap_research_preparation_ready",
  "ap_enqueue_due_job_source_syncs", "ap_claim_job_source_syncs", "ap_renew_job_source_sync_lease", "ap_archive_source_attempt", "ap_finalize_job_source_run",
  "ap_complete_job_source_sync", "ap_retry_job_source_sync", "ap_project_source_observation", "ap_record_matching_review", "ap_persist_match_evaluation",
  "ap_current_verified_job_snapshots", "ap_current_commute_evaluation_ids", "ap_claim_feasibility_request", "ap_persist_derived_feasibility_assessment",
  "ap_complete_feasibility_request", "ap_defer_feasibility_request", "ap_stale_feasibility_request", "ap_fail_feasibility_request", "ap_issue_search_checkout_invitation"]);
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
    } else { pairs.push(literal(entry), `${alias}.${ident(entry)}`); }
  }
  return pairs.length ? `${base}||jsonb_build_object(${pairs.join(",")})` : base;
}
function predicate(params: URLSearchParams) {
  const clauses: string[] = [];
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "columns"].includes(column)) continue;
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
    if (url.origin !== "http://127.0.0.1:1" || !url.pathname.startsWith("/rest/v1/")) throw new Error("local_research_transport_rejected");
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
        result = await sql(contract!.set ? `select coalesce(jsonb_agg(to_jsonb(row)),'[]') from ${call} row` : `select to_jsonb(${call})`);
      } else {
        if (!tables.has(name)) throw new Error(`local_table_rejected:${name}`);
        const params = url.searchParams, select = params.get("select") || "*", where = predicate(params);
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
          const mutation = request.method === "POST" ? `insert into ${source}(${columns}) select ${columns} from jsonb_populate_recordset(null::${source},${json(records)})`
            : `update ${source} set (${columns})=(select ${columns} from jsonb_populate_record(null::${source},${json(records[0])}))${where}`;
          prefix = `with changed as (${mutation} returning *) `; source = "changed";
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
    } catch (error) { failures.push(`${request.method} ${url.pathname}: ${String(error)}`); return Response.json({ code: "LOCAL_SQL_REJECTED", message: String(error) }, { status: 400 }); }
  }
  async function script(statement: string) {
    // Fixture setup emits composite rows; validate every protocol field while
    // discarding those setup results. Route receipts stay single-column strict.
    await researchLocalSql(Number(port), statement, true);
  }
  return { sql, script, failures, admin: createClient("http://127.0.0.1:1", "synthetic-local-test-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchDatabase } }) };
}
