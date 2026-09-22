import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { processUnpaidSourceRetention } from "@/lib/files/unpaid-retention";
function client(target: unknown, storageError: unknown = null) {
 const remove=vi.fn(async()=>({error:storageError}));
 const rpc=vi.fn(async(name:string)=>({data:name==='ap_claim_unpaid_source_cleanup'?[{document_id:'document',lease_token:'lease'}]:name==='ap_authorize_unpaid_source_delete'?target:true,error:null}));
 const admin={rpc,storage:{from:vi.fn(()=>({remove}))}};
 return {admin:admin as unknown as SupabaseClient,rpc,remove};
}
describe('approved unpaid retention worker',()=>{
 it('does not delete when current authorization rejects a stale claim or hold',async()=>{
  const c=client(null);expect(await processUnpaidSourceRetention(c.admin)).toMatchObject({deleted:0,skipped:1});expect(c.remove).not.toHaveBeenCalled();
 });
 it('records storage failure for durable retry and never reports deleted',async()=>{
  const c=client({bucket:'customer-source-documents',path:'anonymous/draft/resume/file.pdf'},{message:'private provider error'});
  expect(await processUnpaidSourceRetention(c.admin)).toMatchObject({deleted:0,failed:1});
  expect(c.rpc).toHaveBeenLastCalledWith('ap_finish_unpaid_source_delete',{p_document_id:'document',p_lease_token:'lease',p_succeeded:false});
 });
 it('finalizes the exact authorized object only after storage succeeds',async()=>{
  const c=client({bucket:'customer-source-documents',path:'anonymous/draft/resume/file.pdf'});
  expect(await processUnpaidSourceRetention(c.admin)).toMatchObject({deleted:1,failed:0});
  expect(c.remove).toHaveBeenCalledExactlyOnceWith(['anonymous/draft/resume/file.pdf']);
 });
 it('refuses an unexpected bucket or paid path',async()=>{
  const c=client({bucket:'customer-deliverables',path:'paid/customer/file.pdf'});
  expect(await processUnpaidSourceRetention(c.admin)).toMatchObject({deleted:0,failed:1});expect(c.remove).not.toHaveBeenCalled();
 });
});
