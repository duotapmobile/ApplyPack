import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({requireAdmin:vi.fn(),rpc:vi.fn(),origin:vi.fn(()=>true)}));
vi.mock("@/lib/auth/require-admin",()=>({requireAdmin:mocks.requireAdmin}));
vi.mock("@/lib/security/origin",()=>({isSameOriginRequest:mocks.origin}));
import {POST} from "@/app/api/admin/matching-research/route";
const input={action:"COMPLETE_MANUAL_CELL",cellId:"45000000-0000-4000-8000-000000000023",reviewedAt:"2026-09-22T12:00:00.000Z",jobSnapshotIds:[],evidenceUrls:["https://synthetic.invalid/careers"],notes:"Reviewed the bounded synthetic scope; no listings encountered.",checklist:{queryFingerprint:"c".repeat(64),pagesReviewed:1,allEncounteredListingsAccountedFor:true,stopReason:"REVIEWED_CONFIGURED_SCOPE"}};
describe("manual research route",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.origin.mockReturnValue(true);mocks.requireAdmin.mockResolvedValue({ok:true,user:{id:"verified-operator"},admin:{rpc:mocks.rpc}});mocks.rpc.mockResolvedValue({data:null,error:null});});
 it("records actor-attributed manual evidence without claiming enumeration",async()=>{const response=await POST(new Request("https://applypack.work/api/test",{method:"POST",body:JSON.stringify(input)}));expect(response.status).toBe(200);expect(await response.json()).toEqual({state:"MANUAL_CHECKLIST_RECORDED",automatedEnumeration:false});expect(mocks.rpc).toHaveBeenCalledWith("ap_complete_manual_research_cell",expect.objectContaining({p_actor_id:"verified-operator",p_job_snapshot_ids:[]}));});
 it("requires explicit all-results attestation",async()=>{const response=await POST(new Request("https://applypack.work/api/test",{method:"POST",body:JSON.stringify({...input,checklist:{...input.checklist,allEncounteredListingsAccountedFor:false}})}));expect(response.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("fails closed on stale source or missing evaluation evidence",async()=>{mocks.rpc.mockResolvedValue({error:{message:"private source policy"}});const response=await POST(new Request("https://applypack.work/api/test",{method:"POST",body:JSON.stringify(input)}));expect(response.status).toBe(409);expect(await response.text()).not.toContain("private source policy");expect(response.headers.get("cache-control")).toContain("private");});
});
