import {describe,it,expect,vi} from "vitest";
import {createSupabaseFeasibilityStore} from "@/lib/matching/supabase-feasibility-store";
function fixture(){
 const tables:Record<string,Record<string,unknown>[]>={
 ap_intake_snapshots:[{id:"criteria",content_sha256:"hash"}],
 ap_feasibility_coverage_plans:[{id:"plan",snapshot_id:"criteria",inventory_version_id:"inventory",typed_inputs:{breadth:"CLOSE_TO_PREVIOUS_WORK",requiredFamilyIds:["family"]},coverage_disposition:"REQUIRED"}],
 ap_inventory_versions:[{source_registry_version:"s",query_version:"q",parser_version:"p",cutoff_at:new Date().toISOString(),content_sha256:"hash"}],
 ap_feasibility_coverage_cells:[{id:"cell",source_id:"source",source_authorization_id:"auth",configuration_id:"config",query_family_id:"family",authorization_mode:"AUTHORIZED_MANUAL_ONLY",execution_path:"MANUAL",authorization:{state:"AUTHORIZED_MANUAL_ONLY"},terminal_outcome:"SUCCEEDED_WITH_RESULTS",pagination_bound:2,result_bound:10,lookback_bound:"1 day",result_count:1,manual_checklist_complete:true,normalized_and_deduplicated:true,parser_result:{status:"COMPLETE"}}],
 ap_source_authorization_heads:[{source_id:"source",current_authorization_id:"auth",revision:3}],
 ap_feasibility_source_configurations:[{id:"config",source_authorization_id:"auth",pagination_bound:2,result_bound:10,lookback_bound:"1 day"}],
 ap_manual_research_reviews:[{cell_id:"cell",source_authorization_id:"auth",authorization_head_revision:3,reviewed_at:new Date(Date.now()-1000).toISOString()}],
 ap_research_cell_reviews:[],ap_inventory_members:[{id:"member",inventory_version_id:"inventory",job_snapshot_id:"job-snapshot"}],
 ap_match_evaluations:[{id:"evaluation",snapshot_id:"criteria",inventory_member_id:"member",inventory_version_id:"inventory",job_snapshot_id:"job-snapshot",eligibility:"ELIGIBLE",categorical_evidence_sufficient:true,usefulness_result:"PASS",salary_disposition:"PASS",application_readiness:"READY",job_snapshot:{legacy_job_id:"job",legitimacy_result:"PASS",listing_activity_result:"PASS",application_path_result:"PASS"}}],
 };
 const rpc=vi.fn().mockResolvedValue({data:[{id:"job-snapshot"}],error:null});
 const admin={rpc,from:(table:string)=>{const query={select:()=>query,eq:()=>query,in:()=>query,is:()=>query,order:()=>query,limit:()=>query,
 maybeSingle:async()=>({data:tables[table]?.[0]||null,error:null}),then:(resolve:(v:unknown)=>unknown,reject?:(e:unknown)=>unknown)=>Promise.resolve({data:tables[table]||[],error:null}).then(resolve,reject)};return query;}};
 const store=createSupabaseFeasibilityStore(admin as unknown as Parameters<typeof createSupabaseFeasibilityStore>[0]);
 return {tables,rpc,load:()=>store.load({requestId:"request",snapshotId:"criteria",draftId:"draft",workerId:"worker"})};
}
describe("persisted feasibility source connection",()=>{
 it("loads only inventory returned by the current verification RPC",async()=>{const f=fixture();const result=await f.load();expect(result.inventory[0].classification).toBe("PRELIMINARILY_DELIVERABLE");expect(f.rpc).toHaveBeenCalledWith("ap_current_verified_job_snapshots",{p_job_ids:["job"]});});
 it("rejects a revoked source before reading optimistic evaluation counts",async()=>{const f=fixture();f.tables.ap_source_authorization_heads[0].current_authorization_id="revoked";await expect(f.load()).rejects.toThrow("feasibility_current_source_policy_required");expect(f.rpc).not.toHaveBeenCalled();});
 it("rejects outdated receipt revision for a reauthorized source",async()=>{const f=fixture();f.tables.ap_source_authorization_heads[0].revision=4;await expect(f.load()).rejects.toThrow("feasibility_current_source_receipt_required");});
 it("rejects invalidated or superseded snapshot even if old evaluation passes",async()=>{const f=fixture();f.rpc.mockResolvedValue({data:[],error:null});await expect(f.load()).rejects.toThrow("feasibility_inventory_verification_stale");});
});
