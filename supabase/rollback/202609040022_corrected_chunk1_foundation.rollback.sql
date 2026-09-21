-- Compensating rollback for an unactivated deployment only. Normal rollback is
-- code/traffic rollback with this additive schema left in place.
do $$
begin
  if exists(select 1 from public.ap_search_services where not legacy_record)
    or exists(select 1 from public.ap_anonymous_drafts)
    or exists(select 1 from public.ap_intake_snapshots)
    or exists(select 1 from public.ap_material_purchases)
    or exists(select 1 from public.ap_provider_events)
    or exists(select 1 from public.ap_payment_attempts where legacy_payment_id is null)
    or exists(select 1 from public.ap_capacity_allocations)
    or exists(select 1 from public.ap_reference_records)
    or exists(select 1 from public.ap_generated_artifacts)
    or exists(select 1 from public.ap_outbox_messages)
    or exists(select 1 from public.ap_audit_events)
  then raise exception 'chunk1_compensating_rollback_refused_operational_data_exists';
  end if;
end $$;

drop view if exists public.ap_legacy_order_compatibility;
drop view if exists public.ap_payment_refund_aggregates;

drop table if exists
  public.ap_reference_staff_access,
  public.ap_reference_permissions,
  public.ap_reference_record_versions,
  public.ap_reference_records,
  public.ap_generated_file_versions,
  public.ap_release_members,
  public.ap_releases,
  public.ap_generated_artifacts,
  public.ap_material_entitlement_claims,
  public.ap_material_entitlement_history,
  public.ap_refund_operations,
  public.ap_material_line_revisions,
  public.ap_capacity_allocation_members,
  public.ap_capacity_audit,
  public.ap_material_lines,
  public.ap_material_purchases,
  public.ap_criteria_amendments,
  public.ap_search_services,
  public.ap_provider_events,
  public.ap_payment_attempts,
  public.ap_checkout_attempts,
  public.ap_external_commands,
  public.ap_outbox_messages,
  public.ap_quotes,
  public.ap_match_evaluations,
  public.ap_human_review_records,
  public.ap_requirement_nodes,
  public.ap_job_snapshots,
  public.ap_feasibility_assessments,
  public.ap_feasibility_coverage_cells,
  public.ap_feasibility_coverage_plans,
  public.ap_inventory_versions,
  public.ap_catalog_versions,
  public.ap_experience_identities,
  public.ap_candidate_fact_conflicts,
  public.ap_candidate_facts,
  public.ap_independent_verification_sources,
  public.ap_intake_snapshots,
  public.ap_document_versions,
  public.ap_sensitive_payloads,
  public.ap_anonymous_drafts,
  public.ap_capacity_allocations,
  public.ap_capacity_buckets,
  public.ap_capacity_pools,
  public.ap_scheduled_jobs,
  public.ap_audit_events,
  public.ap_migration_checkpoints,
  public.ap_feature_flags,
  public.ap_commerce_configuration,
  public.ap_retention_configuration
cascade;

drop type if exists public.ap_scheduled_job_state cascade;
drop type if exists public.ap_reference_permission cascade;
drop type if exists public.ap_retention_state cascade;
drop type if exists public.ap_artifact_type cascade;
drop type if exists public.ap_command_state cascade;
drop type if exists public.ap_material_substitution cascade;
drop type if exists public.ap_material_fulfillment cascade;
drop type if exists public.ap_material_readiness cascade;
drop type if exists public.ap_outbox_state cascade;
drop type if exists public.ap_adjustment_state cascade;
drop type if exists public.ap_search_fulfillment cascade;
drop type if exists public.ap_refund_state cascade;
drop type if exists public.ap_refund_scope cascade;
drop type if exists public.ap_payment_dispute cascade;
drop type if exists public.ap_payment_settlement cascade;
drop type if exists public.ap_checkout_state cascade;
drop type if exists public.ap_capacity_debit cascade;
drop type if exists public.ap_capacity_lifecycle cascade;
drop type if exists public.ap_capacity_resource cascade;
drop type if exists public.ap_resolution_blocker cascade;
drop type if exists public.ap_feasibility_reason cascade;
drop type if exists public.ap_feasibility_outcome cascade;
drop type if exists public.ap_feasibility_run_state cascade;
drop type if exists public.ap_presentation_risk cascade;
drop type if exists public.ap_application_readiness cascade;
drop type if exists public.ap_salary_gate_disposition cascade;
drop type if exists public.ap_salary_status cascade;
drop type if exists public.ap_eligibility_disposition cascade;
drop type if exists public.ap_unknown_treatment cascade;
drop type if exists public.ap_resolution_issue cascade;
drop type if exists public.ap_criterion_result cascade;
drop type if exists public.ap_criterion_type cascade;
drop type if exists public.ap_requirement_node_kind cascade;
drop type if exists public.ap_job_origin cascade;
drop type if exists public.ap_experience_kind cascade;
drop type if exists public.ap_candidate_fact_source cascade;
drop type if exists public.ap_evidence_verification cascade;
drop type if exists public.ap_document_processing_state cascade;
drop type if exists public.ap_document_kind cascade;
drop type if exists public.ap_draft_state cascade;
