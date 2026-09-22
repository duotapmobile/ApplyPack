"use client";
import { useState } from "react";
type Row=Record<string,unknown>;
export function MatchingGuidedControls({snapshotId,packet,onPrepare}:{snapshotId:string;packet:unknown;onPrepare:(endpoint:string,payload:unknown)=>void}){
 const data=(packet||{}) as Record<string,Row[]>;
 const [action,setAction]=useState("QUESTION");const [memberId,setMemberId]=useState("");const [nodeId,setNodeId]=useState("");const [factIds,setFactIds]=useState<string[]>([]);const [text,setText]=useState("");const [changes,setChanges]=useState("");const [disposition,setDisposition]=useState("REQUIRES_MORE_EVIDENCE");const [configId,setConfigId]=useState("");const [round,setRound]=useState(1);
 const members=data.inventoryMembers||[];const member=members.find(m=>m.id===memberId);
 const nodes=(data.requirementNodes||[]).filter(n=>n.job_snapshot_id===member?.job_snapshot_id&&n.node_kind==="CRITERION");
 const facts=(data.ap_candidate_facts||[]).filter(f=>!f.superseded_at&&["CUSTOMER_CONFIRMED","HUMAN_VERIFIED"].includes(String(f.verification)));
 const node=nodes.find(n=>n.id===nodeId);
 function prepare(){
  if(action==="BEGIN"){onPrepare("matching-research",{action,snapshotId,configurationIds:[configId],round});return;}
  if(action==="QUESTION"){onPrepare("matching-research",{action,snapshotId,jobSnapshotId:member?.job_snapshot_id,nodeId,prompt:text});return;}
  onPrepare("matching-reviews",{snapshotId,jobSnapshotId:member?.job_snapshot_id,reviewKind:"MATCH_EVIDENCE",stableCriterionId:node?.stable_criterion_id,
   sourceEvidenceNodeIds:[nodeId],candidateFactIds:factIds,candidateFactVersionIds:factIds,disposition,
   evidenceRelation:disposition==="RESOLVED_PASS"?"DIRECT":"UNSUPPORTED",evidenceChanges:changes.split("\n").map(s=>s.trim()).filter(Boolean),rationale:text});
 }
 return <fieldset><legend>Prepare a review operation</legend>
 <label>Action<select value={action} onChange={e=>setAction(e.target.value)}><option value="QUESTION">Ask for a missing candidate fact</option><option value="MATCH_EVIDENCE">Review direct evidence</option><option value="BEGIN">Start a research round</option></select></label>
 {action==="BEGIN"?<><label>Approved source configuration<select value={configId} onChange={e=>setConfigId(e.target.value)}><option value="">Select a current configuration</option>{(data.sourceConfigurations||[]).map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.config_version)} — maximum {String(c.result_bound)} results</option>)}</select></label><label>Round<select value={round} onChange={e=>setRound(Number(e.target.value))}>{[1,2,3].map(n=><option key={n} value={n}>{n}</option>)}</select></label><p>Expansion preserves the customer&apos;s breadth and hard restrictions. Later rounds require prior insufficient research evidence.</p></>:<>
 <label>Verified inventory job<select value={memberId} onChange={e=>{setMemberId(e.target.value);setNodeId("");}}><option value="">Select a job</option>{members.map(m=>{const job=m.job_snapshot as Row|undefined;return <option key={String(m.id)} value={String(m.id)}>{String(job?.company||"")} — {String(job?.exact_title||m.job_snapshot_id)}</option>;})}</select></label>
 <label>Employer requirement<select value={nodeId} onChange={e=>setNodeId(e.target.value)}><option value="">Select cited requirement</option>{nodes.map(n=><option key={String(n.id)} value={String(n.id)}>{String(n.source_excerpt||n.semantic_key)}</option>)}</select></label>
 {action==="MATCH_EVIDENCE"&&<><fieldset><legend>Confirmed candidate facts</legend>{facts.map(f=><label key={String(f.id)}><input type="checkbox" checked={factIds.includes(String(f.id))} onChange={e=>setFactIds(e.target.checked?[...factIds,String(f.id)]:factIds.filter(id=>id!==f.id))}/>{String((f.customer_display_value as Row)?.summary||f.semantic_key)}</label>)}</fieldset><label>Disposition<select value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="REQUIRES_MORE_EVIDENCE">Unresolved</option><option value="RESOLVED_FAIL">Confirmed gap</option><option value="RESOLVED_PASS">Supported by direct evidence</option></select></label><p>Direct evidence must support the exact employer requirement. Transferable experience requires the separate equivalence review.</p><label>Evidence changes, one per line<textarea value={changes} onChange={e=>setChanges(e.target.value)}/></label></>}
 <label>{action==="QUESTION"?"Question for the candidate":"Evidence rationale"}<textarea value={text} onChange={e=>setText(e.target.value)}/></label></>}
 <button type="button" disabled={action==="BEGIN"?!configId:!memberId||!nodeId||text.trim().length<10} onClick={prepare}>Prepare for validation below</button></fieldset>;
}
