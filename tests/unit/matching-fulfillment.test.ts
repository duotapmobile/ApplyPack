import {describe,it,expect} from "vitest";
import {researchFamilies} from "@/lib/matching/research";
import {deriveBoardRequirementGate,type PersistedIntakeForMatching,type PersistedRequirementRow,type PersistedCandidateFact} from "@/lib/matching/evidence-derived";
import {parseListingRequirements,requirementPersistenceRows} from "@/lib/matching/listing-parser";
const snapshot={id:"a0000000-0000-4000-8000-000000000001",content_sha256:"a".repeat(64),search_breadth:"BROADEST_SUPPORTED_SCOPE",desired_activities:["coordinate records"],blocked_industries:["gambling"],dealbreakers:["NO_COMMISSION"],work_modes:["REMOTE"],us_state_or_dc:"VA",employment_types:["FULL_TIME"]};
describe("runtime matching fulfillment",()=>{
 it("preserves hard restrictions through bounded responsibility-first expansion",()=>{
  const fact={id:"f",snapshot_id:snapshot.id,value_kind:"RESPONSIBILITY",semantic_key:"coordinate records",verification:"CUSTOMER_CONFIRMED",typed_value:{nearbyRoleFamilies:["administration"],relatedRoleFamilies:["operations"],broadRoleFamilies:["program coordination"]}};
  const close=researchFamilies(snapshot,[fact],1),broad=researchFamilies(snapshot,[fact],3);
  expect(close.families[0].roleFamilies).toEqual(["administration"]);
  expect(broad.families[0].roleFamilies).toContain("program coordination");
  expect(broad.families[0].hardFilters).toEqual(close.families[0].hardFilters);
  expect(()=>researchFamilies(snapshot,[fact],4)).toThrow();
 });
 it("never expands beyond chosen close breadth or uses unconfirmed evidence",()=>{
  const result=researchFamilies({...snapshot,search_breadth:"CLOSE_TO_PREVIOUS_WORK"},[{id:"f",value_kind:"RESPONSIBILITY",verification:"EXTRACTED_UNCONFIRMED",typed_value:{broadRoleFamilies:["surgeon"]}}],3);
  expect(result.families[0].roleFamilies).toEqual([]);
 });
 it("typed board gate rejects missing required education despite keyword matches",()=>{
  const text="Required: Bachelor's degree in accounting.";
  const parsed=parseListingRequirements({jobSnapshotId:"b0000000-0000-4000-8000-000000000001",listingText:text});
  const nodes=requirementPersistenceRows(parsed,text) as unknown as PersistedRequirementRow[];
  const result=deriveBoardRequirementGate(snapshot as unknown as PersistedIntakeForMatching,nodes,[]);
  expect(result.result).not.toBe("PASS");
  expect(result.outcomeDeterminativeUnknownNodeIds.length).toBeGreaterThan(0);
 });
 it("rejects unconfirmed or cross-customer facts for board requirements",()=>{
  const text="Required: Bachelor's degree in accounting.";
  const nodes=requirementPersistenceRows(parseListingRequirements({jobSnapshotId:"b0000000-0000-4000-8000-000000000001",listingText:text}),text) as unknown as PersistedRequirementRow[];
  const fact={id:"f",snapshot_id:"other",semantic_key:"accounting education",value_kind:"EDUCATION",typed_value:{degree:"bachelor accounting"},verification:"CUSTOMER_CONFIRMED",source_kind:"CUSTOMER_ASSERTION",superseded_at:null} as PersistedCandidateFact;
  expect(deriveBoardRequirementGate(snapshot as unknown as PersistedIntakeForMatching,nodes,[fact]).result).toBe("UNKNOWN");
 });
});
