import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { researchFamilies } from "@/lib/matching/research";
import { canonicalSha256 } from "@/lib/domain/foundation";
const headers = { "Cache-Control": "private, no-store" };
const body = z.discriminatedUnion("action", [
 z.object({action:z.literal("COMPLETE_MANUAL_CELL"),cellId:z.uuid(),reviewedAt:z.iso.datetime(),jobSnapshotIds:z.array(z.uuid()).max(500),evidenceUrls:z.array(z.url().startsWith("https://")).min(1).max(20),checklist:z.object({queryFingerprint:z.string().regex(/^[a-f0-9]{64}$/),pagesReviewed:z.number().int().min(1).max(999999),allEncounteredListingsAccountedFor:z.literal(true),stopReason:z.enum(["REVIEWED_CONFIGURED_SCOPE","CONFIGURED_BOUND_REACHED"])}).strict(),notes:z.string().trim().min(20).max(4000)}).strict(),
 z.object({action:z.literal("COMPLETE_CELL"),cellId:z.string().uuid(),runId:z.string().uuid(),notes:z.string().trim().min(20).max(4000)}).strict(),
 z.object({action:z.literal("QUESTION"),snapshotId:z.string().uuid(),jobSnapshotId:z.string().uuid(),nodeId:z.string().uuid(),prompt:z.string().trim().min(10).max(1000)}).strict(),
 z.object({ action: z.literal("BEGIN"), snapshotId: z.string().uuid(), configurationIds: z.array(z.string().uuid()).min(1).max(20), round: z.number().int().min(1).max(3) }).strict(),
 z.object({ action: z.literal("ADMIT"), snapshotId: z.string().uuid(), inventoryVersionId: z.string().uuid(), jobSnapshotId: z.string().uuid() }).strict(),
]);
export async function GET(request: Request) {
 const auth = await requireAdmin(); if (!auth.ok) return auth.response;
 const id = new URL(request.url).searchParams.get("snapshotId");
 if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Select a criteria snapshot." }, {status:400,headers});
 const tables = ["ap_intake_snapshots", "ap_candidate_facts", "ap_feasibility_coverage_plans", "ap_match_evaluations", "ap_human_review_records"] as const;
 const results = await Promise.all(tables.map(table => auth.admin.from(table).select("*").eq(table === "ap_intake_snapshots" ? "id" : "snapshot_id", id!).limit(501)));
 if (results.some(r=>r.error || (r.data?.length || 0)>500)) return NextResponse.json({error:"Review packet unavailable or exceeds its safe bound."},{status:503,headers});
 const plans=results[2].data || [];
 const inventoryIds=plans.map(p=>(p as unknown as {inventory_version_id:string}).inventory_version_id);
 const planIds=plans.map(p=>p.id);
 const [members,cells,configs]=await Promise.all([
  inventoryIds.length?auth.admin.from("ap_inventory_members").select("*,job_snapshot:ap_job_snapshots(*)").in("inventory_version_id",inventoryIds).limit(501):Promise.resolve({data:[],error:null}),
  planIds.length?auth.admin.from("ap_feasibility_coverage_cells").select("*").in("plan_id",planIds).limit(501):Promise.resolve({data:[],error:null}),
  auth.admin.from("ap_feasibility_source_configurations").select("id,source_authorization_id,config_version,pagination_bound,lookback_bound,result_bound,approved_at").limit(101),
 ]);
 if(members.error||cells.error||configs.error||(configs.data?.length||0)>100||(members.data?.length||0)>500||(cells.data?.length||0)>500) return NextResponse.json({error:"Packet exceeded its safe bound or evidence is unavailable. Narrow the research inventory."},{status:409,headers});
 const jobIds=(members.data||[]).map(m=>m.job_snapshot_id);
 const nodes=jobIds.length?await auth.admin.from("ap_requirement_nodes").select("*").in("job_snapshot_id",jobIds).limit(5001):{data:[],error:null};
 if(nodes.error||(nodes.data?.length||0)>5000)return NextResponse.json({error:"Requirement packet unavailable or exceeds review bound."},{status:409,headers});
 return NextResponse.json({...Object.fromEntries(tables.map((t,i)=>[t,results[i].data])),inventoryMembers:members.data,coverageCells:cells.data,requirementNodes:nodes.data,sourceConfigurations:configs.data},{headers});
}
export async function POST(request: Request) {
 if (!isSameOriginRequest(request)) return NextResponse.json({error:"Origin rejected."},{status:403,headers});
 const auth=await requireAdmin(); if(!auth.ok)return auth.response;
 const parsed=body.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"Invalid research request."},{status:400,headers});
 const input=parsed.data;
 const rpc=auth.admin.rpc.bind(auth.admin) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
 try {
  if(input.action==="COMPLETE_MANUAL_CELL") {
   const result=await rpc("ap_complete_manual_research_cell",{p_cell_id:input.cellId,p_actor_id:auth.user.id,p_reviewed_at:input.reviewedAt,p_job_snapshot_ids:input.jobSnapshotIds,p_evidence_urls:input.evidenceUrls,p_checklist:input.checklist,p_notes:input.notes});
   if(result.error)throw result.error;return NextResponse.json({state:"MANUAL_CHECKLIST_RECORDED",automatedEnumeration:false},{headers});
  }
  if(input.action==="COMPLETE_CELL") {
   const result=await rpc("ap_complete_research_cell",{p_cell_id:input.cellId,p_run_id:input.runId,p_actor_id:auth.user.id,p_notes:input.notes});
   if(result.error)throw result.error;return NextResponse.json({state:"COMPLETE"},{headers});
  }
  if(input.action==="QUESTION") {
   const result=await rpc("ap_issue_candidate_question",{p_snapshot_id:input.snapshotId,p_job_snapshot_id:input.jobSnapshotId,p_node_id:input.nodeId,p_actor_id:auth.user.id,p_prompt:input.prompt});
   if(result.error)throw result.error;return NextResponse.json({questionId:result.data},{status:201,headers});
  }
  if(input.action==="ADMIT") {
   const {data:job,error}=await auth.admin.from("ap_job_snapshots").select("canonical_application_url,normalized_fingerprint,canonical_employer_domain").eq("id",input.jobSnapshotId).single();
   if(error||!job)throw new Error("Verified snapshot unavailable");
   const result=await rpc("ap_admit_verified_inventory_snapshot",{p_snapshot_id:input.snapshotId,p_inventory_version_id:input.inventoryVersionId,p_job_snapshot_id:input.jobSnapshotId,p_stable_job_id:canonicalSha256(job)});
   if(result.error)throw result.error; return NextResponse.json({inventoryMemberId:result.data},{status:201,headers});
  }
  const [snapshot,facts]=await Promise.all([auth.admin.from("ap_intake_snapshots").select("*").eq("id",input.snapshotId).single(),auth.admin.from("ap_candidate_facts").select("*").eq("snapshot_id",input.snapshotId).is("superseded_at",null)]);
  if(snapshot.error||facts.error||!snapshot.data)throw new Error("Criteria unavailable");
  const built=researchFamilies(snapshot.data,facts.data||[],input.round);
  const result=await rpc("ap_begin_research_round",{p_snapshot_id:input.snapshotId,p_actor_id:auth.user.id,p_request_sha256:canonicalSha256({research:built.hash,configurations:[...input.configurationIds].sort()}),p_families:built.families,p_configuration_ids:input.configurationIds,p_round:input.round});
  if(result.error)throw result.error; return NextResponse.json({planId:result.data,state:"PENDING",families:built.families},{status:201,headers});
 }catch{return NextResponse.json({error:"Current criteria, source configurations and bounded research evidence are required."},{status:409,headers});}
}
