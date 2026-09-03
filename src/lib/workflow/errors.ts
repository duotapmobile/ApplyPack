const knownWorkflowErrors = new Set([
  "apply_pack_item_missing",
  "apply_pack_order_link_missing",
  "search_intake_link_missing",
  "document_source_data_missing",
  "generated_draft_structure_invalid",
  "generated_draft_scan_failed",
]);

export function workflowErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown";
  return knownWorkflowErrors.has(message) ? `workflow_${message}` : "workflow_processing_failed";
}
