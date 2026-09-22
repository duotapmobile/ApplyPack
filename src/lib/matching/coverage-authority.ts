type Row=Record<string,unknown>;
/** Recheck persisted evidence against current policy; historical authorization
 * rows retain their old state and therefore cannot establish current permission. */
export function assertCurrentCoverageAuthority(input:{cells:Row[];heads:Row[];configurations:Row[];manualReviews:Row[];automatedReviews:Row[];runs:Row[];now?:number}) {
 const now=input.now??Date.now();
 for(const cell of input.cells){
  const head=input.heads.find(h=>h.source_id===cell.source_id);
  const config=input.configurations.find(c=>c.id===cell.configuration_id);
  const relation=Array.isArray(cell.authorization)?cell.authorization[0]:cell.authorization;
  const authorization=relation as Row|null;
  if(!head||head.current_authorization_id!==cell.source_authorization_id||!Number.isSafeInteger(Number(head.revision))||Number(head.revision)<1
   ||!config||config.source_authorization_id!==head.current_authorization_id||config.pagination_bound!==cell.pagination_bound
   ||config.result_bound!==cell.result_bound||config.lookback_bound!==cell.lookback_bound
   ||authorization?.state!==cell.authorization_mode
   ||(cell.execution_path==="MANUAL"?authorization?.state!=="AUTHORIZED_MANUAL_ONLY":authorization?.state!=="AUTHORIZED_AUTOMATED")) throw new Error("feasibility_current_source_policy_required");
  if(cell.terminal_outcome==="PENDING")continue;
  if(!["SUCCEEDED_WITH_RESULTS","SUCCEEDED_EMPTY"].includes(String(cell.terminal_outcome)))continue;
  let evidence:Row|undefined;let reviewedAt:unknown;
  if(cell.execution_path==="MANUAL"){
   evidence=input.manualReviews.find(r=>r.cell_id===cell.id);reviewedAt=evidence?.reviewed_at;
  }else{
   const receipt=input.automatedReviews.find(r=>r.cell_id===cell.id);
   evidence=input.runs.find(r=>r.id===receipt?.source_run_id);reviewedAt=evidence?.completed_at;
   if(!evidence||evidence.source_id!==cell.source_id||evidence.status!=="succeeded"||evidence.enumeration_status!=="complete"||evidence.checkpoint_start!=null)throw new Error("feasibility_complete_run_receipt_required");
  }
  const time=typeof reviewedAt==="string"?Date.parse(reviewedAt):NaN;
  if(!evidence||evidence.source_authorization_id!==head.current_authorization_id||Number(evidence.authorization_head_revision)!==Number(head.revision)
   ||!Number.isFinite(time)||time>now||time<now-86400000)throw new Error("feasibility_current_source_receipt_required");
 }
}
