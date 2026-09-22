"use client";
import {useState} from "react";
type Row=Record<string,unknown>;
export function ManualResearchControls({packet,onPrepare}:{packet:unknown;onPrepare:(payload:unknown)=>void}){
 const data=(packet||{}) as Record<string,Row[]>;const cells=(data.coverageCells||[]).filter(c=>c.execution_path==="MANUAL"&&c.terminal_outcome==="PENDING");
 const [cellId,setCellId]=useState("");const [selected,setSelected]=useState<string[]>([]);const [urls,setUrls]=useState("");const [notes,setNotes]=useState("");const [pages,setPages]=useState(1);const [confirmed,setConfirmed]=useState(false);const [stop,setStop]=useState("REVIEWED_CONFIGURED_SCOPE");
 const cell=cells.find(c=>c.id===cellId);const plan=(data.ap_feasibility_coverage_plans||[]).find(p=>p.id===cell?.plan_id);
 const members=(data.inventoryMembers||[]).filter(m=>m.inventory_version_id===plan?.inventory_version_id&&(m.job_snapshot as Row)?.source_authorization_id===cell?.source_authorization_id);
 if(!cells.length)return null;
 return <fieldset><legend>Complete bounded manual research</legend><p>This records an operator checklist for the configured query and source. It does not prove automated enumeration, close listings, waive requirements, or promise ten matches.</p>
 <label>Manual coverage cell<select value={cellId} onChange={e=>{setCellId(e.target.value);setSelected([]);setConfirmed(false);}}><option value="">Select source and query</option>{cells.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.source_id)} — {String(c.query_family_id)}</option>)}</select></label>
 {cell&&<p>Configured bound: {String(cell.pagination_bound)} pages, {String(cell.result_bound)} results, lookback {String(cell.lookback_bound)}.</p>}
 <label>Pages actually reviewed<input type="number" min={1} max={Number(cell?.pagination_bound||1)} value={pages} onChange={e=>setPages(Number(e.target.value))}/></label>
 <fieldset><legend>All encountered jobs with current verification and evaluation</legend>{members.map(m=>{const j=m.job_snapshot as Row;const id=String(m.job_snapshot_id);return <label key={id}><input type="checkbox" checked={selected.includes(id)} onChange={e=>setSelected(e.target.checked?[...selected,id]:selected.filter(v=>v!==id))}/>{String(j.company)} — {String(j.exact_title)}</label>;})}</fieldset>
 <label>Evidence URLs actually reviewed, one HTTPS URL per line<textarea value={urls} onChange={e=>setUrls(e.target.value)}/></label><label>Research observations and reason for stopping<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 <label>Stop reason<select value={stop} onChange={e=>setStop(e.target.value)}><option value="REVIEWED_CONFIGURED_SCOPE">Reviewed the configured scope</option><option value="CONFIGURED_BOUND_REACHED">Reached the configured bound</option></select></label>
 <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this query within the configured source/lookback bounds and accounted for every encountered listing. An empty selection means I encountered no listings, not that unresolved listings were discarded.</label>
 <button type="button" disabled={!cell||!confirmed||notes.trim().length<20||!urls.trim()} onClick={()=>onPrepare({action:"COMPLETE_MANUAL_CELL",cellId,reviewedAt:new Date().toISOString(),jobSnapshotIds:selected,evidenceUrls:urls.split("\n").map(u=>u.trim()).filter(Boolean),notes,checklist:{queryFingerprint:cell?.query_fingerprint,pagesReviewed:pages,allEncounteredListingsAccountedFor:true,stopReason:stop}})}>Prepare manual checklist for validation below</button></fieldset>;
}
