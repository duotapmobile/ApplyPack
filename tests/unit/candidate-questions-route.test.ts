import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),origin:vi.fn(()=>true)}));
vi.mock("@/lib/supabase/server",()=>({createSupabaseServerClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock("@/lib/supabase/admin",()=>({createSupabaseAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/security/origin",()=>({isSameOriginRequest:mocks.origin}));
import {GET,POST} from "@/app/api/customer/candidate-questions/route";
describe("signed-in clarification boundaries",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.origin.mockReturnValue(true);mocks.getUser.mockResolvedValue({data:{user:{id:"verified-customer"}},error:null});mocks.rpc.mockResolvedValue({data:[],error:null});});
 it("requires authentication for private question reads",async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET()).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("derives ownership from verified session, never client customer id",async()=>{
  const response=await POST(new Request("https://applypack.work/api/customer/candidate-questions",{method:"POST",body:JSON.stringify({questionId:"45000000-0000-4000-8000-000000000009",answer:"I maintained records.",confirmed:true})}));
  expect(response.status).toBe(201);expect(mocks.rpc).toHaveBeenCalledWith("ap_answer_customer_question",{p_customer_id:"verified-customer",p_question_id:"45000000-0000-4000-8000-000000000009",p_answer:"I maintained records."});
  expect(response.headers.get("cache-control")).toContain("private");
 });
 it("rejects cross-origin writes before reading identity",async()=>{mocks.origin.mockReturnValue(false);expect((await POST(new Request("https://applypack.work/api/test",{method:"POST"}))).status).toBe(403);expect(mocks.getUser).not.toHaveBeenCalled();});
 it("returns conflict without exposing stale/cross-customer database details",async()=>{
  mocks.rpc.mockResolvedValue({error:{message:"private ownership data"}});
  const response=await POST(new Request("https://applypack.work/api/test",{method:"POST",body:JSON.stringify({questionId:"45000000-0000-4000-8000-000000000009",answer:"Factual answer",confirmed:true})}));
  expect(response.status).toBe(409);expect(await response.text()).not.toContain("private ownership data");
 });
});
