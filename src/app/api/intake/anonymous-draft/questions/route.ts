import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext } from "@/lib/drafts/anonymous-server";
import { isSameOriginRequest } from "@/lib/security/origin";
const headers={"Cache-Control":"private, no-store"};
export async function GET(){
 const c=await anonymousDraftContext();if(!c)return NextResponse.json({error:"Draft unavailable"},{status:404,headers});
 const draft=await c.admin.from("ap_anonymous_drafts").select("finalized_snapshot_id").eq("id",c.capability.draftId).eq("capability_secret_hash",c.secretHash).gt("expires_at",new Date().toISOString()).maybeSingle();
 if(draft.error||!draft.data?.finalized_snapshot_id)return NextResponse.json({questions:[]},{headers});
 const contextAdmin=c.admin;
 const from=contextAdmin.from.bind(contextAdmin) as unknown as (table:string)=>ReturnType<typeof contextAdmin.from>;
 const result=await from("ap_candidate_questions").select("id,prompt,created_at").eq("snapshot_id",draft.data.finalized_snapshot_id);
 return NextResponse.json(result.error?{error:"Questions unavailable"}:{questions:result.data},{status:result.error?503:200,headers});
}
export async function POST(request:Request){
 if(!isSameOriginRequest(request))return NextResponse.json({error:"Origin rejected"},{status:403,headers});
 const c=await anonymousDraftContext();if(!c)return NextResponse.json({error:"Draft unavailable"},{status:404,headers});
 const input=z.object({questionId:z.string().uuid(),answer:z.string().trim().min(1).max(5000),confirmed:z.literal(true)}).strict().safeParse(await request.json().catch(()=>null));
 if(!input.success)return NextResponse.json({error:"Confirm your factual answer."},{status:400,headers});
 const rpc=c.admin.rpc.bind(c.admin) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
 const result=await rpc("ap_answer_candidate_question",{p_question_id:input.data.questionId,p_draft_id:c.capability.draftId,p_secret_hash:c.secretHash,p_answer:input.data.answer});
 return NextResponse.json(result.error?{error:"Answer unavailable or already recorded. Contact support for a correction."}:{factId:result.data,state:"REVIEW_REQUIRED"},{status:result.error?409:201,headers});
}
