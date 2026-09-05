export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      affiliate_source_directories: {
        Row: {
          directory_name: string
          id: string
          is_employer: boolean
          notes: string
          official_url: string
        }
        Insert: {
          directory_name: string
          id: string
          is_employer?: boolean
          notes: string
          official_url: string
        }
        Update: {
          directory_name?: string
          id?: string
          is_employer?: boolean
          notes?: string
          official_url?: string
        }
        Relationships: []
      }
      ap_anonymous_drafts: {
        Row: {
          access_email_normalized: string | null
          answers: Json
          capability_rotated_at: string | null
          capability_secret_hash: string
          capability_version: number
          checkout_attempt_id: string | null
          converted_customer_id: string | null
          converted_intake_id: string | null
          created_at: string
          current_step: number
          expires_at: string
          finalized_snapshot_id: string | null
          flow_version: string | null
          id: string
          retention_due_at: string | null
          retention_state: Database["public"]["Enums"]["ap_retention_state"]
          state: Database["public"]["Enums"]["ap_draft_state"]
          updated_at: string
          version: number
        }
        Insert: {
          access_email_normalized?: string | null
          answers?: Json
          capability_rotated_at?: string | null
          capability_secret_hash: string
          capability_version?: number
          checkout_attempt_id?: string | null
          converted_customer_id?: string | null
          converted_intake_id?: string | null
          created_at?: string
          current_step?: number
          expires_at: string
          finalized_snapshot_id?: string | null
          flow_version?: string | null
          id: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          state?: Database["public"]["Enums"]["ap_draft_state"]
          updated_at?: string
          version?: number
        }
        Update: {
          access_email_normalized?: string | null
          answers?: Json
          capability_rotated_at?: string | null
          capability_secret_hash?: string
          capability_version?: number
          checkout_attempt_id?: string | null
          converted_customer_id?: string | null
          converted_intake_id?: string | null
          created_at?: string
          current_step?: number
          expires_at?: string
          finalized_snapshot_id?: string | null
          flow_version?: string | null
          id?: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          state?: Database["public"]["Enums"]["ap_draft_state"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_anonymous_drafts_checkout_attempt_id_fkey"
            columns: ["checkout_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_checkout_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_anonymous_drafts_converted_customer_id_fkey"
            columns: ["converted_customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_anonymous_drafts_converted_intake_id_fkey"
            columns: ["converted_intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_anonymous_drafts_finalized_snapshot_id_fkey"
            columns: ["finalized_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_audit_events: {
        Row: {
          action: string
          actor_id: string | null
          audit_version: string
          customer_id: string | null
          entity_id: string | null
          entity_type: string
          id: number
          non_sensitive_details: Json
          occurred_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          audit_version: string
          customer_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: never
          non_sensitive_details?: Json
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          audit_version?: string
          customer_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          non_sensitive_details?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_audit_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_candidate_fact_conflicts: {
        Row: {
          conflicting_fact_id: string
          created_at: string
          fact_id: string
          id: string
          resolution: string
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          conflicting_fact_id: string
          created_at?: string
          fact_id: string
          id?: string
          resolution: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          conflicting_fact_id?: string
          created_at?: string
          fact_id?: string
          id?: string
          resolution?: string
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_candidate_fact_conflicts_conflicting_fact_id_fkey"
            columns: ["conflicting_fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_fact_conflicts_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_fact_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_candidate_facts: {
        Row: {
          assertion_control_id: string | null
          calendar_duration_days: number | null
          capability_status: string | null
          catalog_version: string
          confirmed_or_corrected_at: string | null
          created_at: string
          customer_assertion_snapshot_id: string | null
          customer_display_label: string | null
          customer_display_value: Json | null
          customer_id: string | null
          document_version_id: string | null
          draft_id: string | null
          ends_on: string | null
          extraction_confidence: number | null
          fact_tier: Database["public"]["Enums"]["ap_fact_tier"]
          human_reviewer_id: string | null
          id: string
          intensity_percent: number | null
          schema_version: string
          semantic_key: string
          snapshot_id: string | null
          source_kind: Database["public"]["Enums"]["ap_candidate_fact_source"]
          source_locator: string
          starts_on: string | null
          superseded_at: string | null
          supersedes_fact_id: string | null
          supplied_source_id: string | null
          typed_value: Json
          value_kind: string
          verification: Database["public"]["Enums"]["ap_evidence_verification"]
        }
        Insert: {
          assertion_control_id?: string | null
          calendar_duration_days?: number | null
          capability_status?: string | null
          catalog_version: string
          confirmed_or_corrected_at?: string | null
          created_at?: string
          customer_assertion_snapshot_id?: string | null
          customer_display_label?: string | null
          customer_display_value?: Json | null
          customer_id?: string | null
          document_version_id?: string | null
          draft_id?: string | null
          ends_on?: string | null
          extraction_confidence?: number | null
          fact_tier?: Database["public"]["Enums"]["ap_fact_tier"]
          human_reviewer_id?: string | null
          id?: string
          intensity_percent?: number | null
          schema_version: string
          semantic_key: string
          snapshot_id?: string | null
          source_kind: Database["public"]["Enums"]["ap_candidate_fact_source"]
          source_locator: string
          starts_on?: string | null
          superseded_at?: string | null
          supersedes_fact_id?: string | null
          supplied_source_id?: string | null
          typed_value: Json
          value_kind: string
          verification: Database["public"]["Enums"]["ap_evidence_verification"]
        }
        Update: {
          assertion_control_id?: string | null
          calendar_duration_days?: number | null
          capability_status?: string | null
          catalog_version?: string
          confirmed_or_corrected_at?: string | null
          created_at?: string
          customer_assertion_snapshot_id?: string | null
          customer_display_label?: string | null
          customer_display_value?: Json | null
          customer_id?: string | null
          document_version_id?: string | null
          draft_id?: string | null
          ends_on?: string | null
          extraction_confidence?: number | null
          fact_tier?: Database["public"]["Enums"]["ap_fact_tier"]
          human_reviewer_id?: string | null
          id?: string
          intensity_percent?: number | null
          schema_version?: string
          semantic_key?: string
          snapshot_id?: string | null
          source_kind?: Database["public"]["Enums"]["ap_candidate_fact_source"]
          source_locator?: string
          starts_on?: string | null
          superseded_at?: string | null
          supersedes_fact_id?: string | null
          supplied_source_id?: string | null
          typed_value?: Json
          value_kind?: string
          verification?: Database["public"]["Enums"]["ap_evidence_verification"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_candidate_facts_customer_assertion_snapshot_id_fkey"
            columns: ["customer_assertion_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_document_version_id_fkey"
            columns: ["document_version_id"]
            isOneToOne: false
            referencedRelation: "ap_document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_human_reviewer_id_fkey"
            columns: ["human_reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_supersedes_fact_id_fkey"
            columns: ["supersedes_fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_candidate_facts_supplied_source_id_fkey"
            columns: ["supplied_source_id"]
            isOneToOne: false
            referencedRelation: "ap_independent_verification_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_capacity_allocation_members: {
        Row: {
          allocation_id: string
          id: string
          material_line_id: string | null
          revision_id: string | null
          units: number
        }
        Insert: {
          allocation_id: string
          id?: string
          material_line_id?: string | null
          revision_id?: string | null
          units?: number
        }
        Update: {
          allocation_id?: string
          id?: string
          material_line_id?: string | null
          revision_id?: string | null
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_capacity_allocation_members_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_member_line_fk"
            columns: ["material_line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_member_revision_fk"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "ap_material_line_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_capacity_allocations: {
        Row: {
          audit_version: string
          bucket_id: string
          consumed_at: string | null
          created_at: string
          criteria_revision_id: string | null
          customer_id: string | null
          debit_disposition: Database["public"]["Enums"]["ap_capacity_debit"]
          draft_id: string | null
          expires_at: string | null
          id: string
          lifecycle: Database["public"]["Enums"]["ap_capacity_lifecycle"]
          material_line_id: string | null
          order_id: string | null
          request_key: string
          reserved_at: string | null
          returned_at: string | null
          staffing_version: string
          units: number
          updated_at: string
        }
        Insert: {
          audit_version: string
          bucket_id: string
          consumed_at?: string | null
          created_at?: string
          criteria_revision_id?: string | null
          customer_id?: string | null
          debit_disposition: Database["public"]["Enums"]["ap_capacity_debit"]
          draft_id?: string | null
          expires_at?: string | null
          id?: string
          lifecycle: Database["public"]["Enums"]["ap_capacity_lifecycle"]
          material_line_id?: string | null
          order_id?: string | null
          request_key: string
          reserved_at?: string | null
          returned_at?: string | null
          staffing_version: string
          units: number
          updated_at?: string
        }
        Update: {
          audit_version?: string
          bucket_id?: string
          consumed_at?: string | null
          created_at?: string
          criteria_revision_id?: string | null
          customer_id?: string | null
          debit_disposition?: Database["public"]["Enums"]["ap_capacity_debit"]
          draft_id?: string | null
          expires_at?: string | null
          id?: string
          lifecycle?: Database["public"]["Enums"]["ap_capacity_lifecycle"]
          material_line_id?: string | null
          order_id?: string | null
          request_key?: string
          reserved_at?: string | null
          returned_at?: string | null
          staffing_version?: string
          units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_capacity_allocations_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_allocations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_allocations_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_allocations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_material_line_fk"
            columns: ["material_line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_capacity_audit: {
        Row: {
          actor_id: string | null
          allocation_id: string
          from_debit: Database["public"]["Enums"]["ap_capacity_debit"] | null
          from_lifecycle:
            | Database["public"]["Enums"]["ap_capacity_lifecycle"]
            | null
          id: number
          occurred_at: string
          reason_code: string
          to_debit: Database["public"]["Enums"]["ap_capacity_debit"]
          to_lifecycle: Database["public"]["Enums"]["ap_capacity_lifecycle"]
        }
        Insert: {
          actor_id?: string | null
          allocation_id: string
          from_debit?: Database["public"]["Enums"]["ap_capacity_debit"] | null
          from_lifecycle?:
            | Database["public"]["Enums"]["ap_capacity_lifecycle"]
            | null
          id?: never
          occurred_at?: string
          reason_code: string
          to_debit: Database["public"]["Enums"]["ap_capacity_debit"]
          to_lifecycle: Database["public"]["Enums"]["ap_capacity_lifecycle"]
        }
        Update: {
          actor_id?: string | null
          allocation_id?: string
          from_debit?: Database["public"]["Enums"]["ap_capacity_debit"] | null
          from_lifecycle?:
            | Database["public"]["Enums"]["ap_capacity_lifecycle"]
            | null
          id?: never
          occurred_at?: string
          reason_code?: string
          to_debit?: Database["public"]["Enums"]["ap_capacity_debit"]
          to_lifecycle?: Database["public"]["Enums"]["ap_capacity_lifecycle"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_capacity_audit_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_capacity_audit_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_allocations"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_capacity_buckets: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          pool_id: string
          staffing_version: string
          starts_at: string
          total_units: number
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          pool_id: string
          staffing_version: string
          starts_at: string
          total_units: number
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          pool_id?: string
          staffing_version?: string
          starts_at?: string
          total_units?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_capacity_buckets_pool_id_fkey"
            columns: ["pool_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_pools"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_capacity_pools: {
        Row: {
          configuration_version: string
          created_at: string
          enabled: boolean
          id: string
          resource: Database["public"]["Enums"]["ap_capacity_resource"]
          updated_at: string
        }
        Insert: {
          configuration_version: string
          created_at?: string
          enabled?: boolean
          id?: string
          resource: Database["public"]["Enums"]["ap_capacity_resource"]
          updated_at?: string
        }
        Update: {
          configuration_version?: string
          created_at?: string
          enabled?: boolean
          id?: string
          resource?: Database["public"]["Enums"]["ap_capacity_resource"]
          updated_at?: string
        }
        Relationships: []
      }
      ap_catalog_versions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          catalog_kind: string
          content_sha256: string
          created_at: string
          id: string
          version: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          catalog_kind: string
          content_sha256: string
          created_at?: string
          id?: string
          version: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          catalog_kind?: string
          content_sha256?: string
          created_at?: string
          id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_catalog_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_checkout_attempts: {
        Row: {
          capacity_allocation_id: string | null
          command_id: string
          created_at: string
          customer_id: string | null
          draft_id: string | null
          expires_at: string | null
          id: string
          provider_checkout_session_id: string | null
          quote_id: string | null
          state: Database["public"]["Enums"]["ap_checkout_state"]
          updated_at: string
        }
        Insert: {
          capacity_allocation_id?: string | null
          command_id: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          expires_at?: string | null
          id?: string
          provider_checkout_session_id?: string | null
          quote_id?: string | null
          state?: Database["public"]["Enums"]["ap_checkout_state"]
          updated_at?: string
        }
        Update: {
          capacity_allocation_id?: string | null
          command_id?: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          expires_at?: string | null
          id?: string
          provider_checkout_session_id?: string | null
          quote_id?: string | null
          state?: Database["public"]["Enums"]["ap_checkout_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_checkout_attempts_capacity_allocation_id_fkey"
            columns: ["capacity_allocation_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_checkout_attempts_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: true
            referencedRelation: "ap_external_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_checkout_attempts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_checkout_attempts_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_checkout_attempts_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "ap_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_commerce_configuration: {
        Row: {
          checkout_enabled: boolean | null
          currency: string
          material_line_price_cents: number
          search_price_cents: number
          singleton: boolean
          tax_approval_reference: string | null
          tax_configuration_approved: boolean
          tax_inclusive: boolean
          updated_at: string
        }
        Insert: {
          checkout_enabled?: boolean | null
          currency?: string
          material_line_price_cents?: number
          search_price_cents?: number
          singleton?: boolean
          tax_approval_reference?: string | null
          tax_configuration_approved?: boolean
          tax_inclusive?: boolean
          updated_at?: string
        }
        Update: {
          checkout_enabled?: boolean | null
          currency?: string
          material_line_price_cents?: number
          search_price_cents?: number
          singleton?: boolean
          tax_approval_reference?: string | null
          tax_configuration_approved?: boolean
          tax_inclusive?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ap_criteria_amendments: {
        Row: {
          accepted_at: string | null
          child_snapshot_id: string | null
          created_at: string
          criteria_diff: Json
          id: string
          idempotency_key: string
          parent_snapshot_id: string
          proposal_expires_at: string
          revised_capacity_allocation_id: string | null
          revision_due_at: string | null
          revision_started_at: string | null
          search_service_id: string
          state: Database["public"]["Enums"]["ap_adjustment_state"]
        }
        Insert: {
          accepted_at?: string | null
          child_snapshot_id?: string | null
          created_at?: string
          criteria_diff: Json
          id?: string
          idempotency_key: string
          parent_snapshot_id: string
          proposal_expires_at: string
          revised_capacity_allocation_id?: string | null
          revision_due_at?: string | null
          revision_started_at?: string | null
          search_service_id: string
          state?: Database["public"]["Enums"]["ap_adjustment_state"]
        }
        Update: {
          accepted_at?: string | null
          child_snapshot_id?: string | null
          created_at?: string
          criteria_diff?: Json
          id?: string
          idempotency_key?: string
          parent_snapshot_id?: string
          proposal_expires_at?: string
          revised_capacity_allocation_id?: string | null
          revision_due_at?: string | null
          revision_started_at?: string | null
          search_service_id?: string
          state?: Database["public"]["Enums"]["ap_adjustment_state"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_criteria_amendments_child_snapshot_id_fkey"
            columns: ["child_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_criteria_amendments_parent_snapshot_id_fkey"
            columns: ["parent_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_criteria_amendments_revised_capacity_allocation_id_fkey"
            columns: ["revised_capacity_allocation_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_criteria_amendments_search_service_id_fkey"
            columns: ["search_service_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["corrected_search_service_id"]
          },
          {
            foreignKeyName: "ap_criteria_amendments_search_service_id_fkey"
            columns: ["search_service_id"]
            isOneToOne: false
            referencedRelation: "ap_search_services"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_document_versions: {
        Row: {
          claimed_mime_type: string
          created_at: string
          customer_id: string | null
          draft_id: string | null
          failure_code: string | null
          id: string
          intake_id: string | null
          is_current: boolean
          kind: Database["public"]["Enums"]["ap_document_kind"]
          leak_scan_status: string
          malware_provider_ref: string | null
          malware_status: string
          model_ready_at: string | null
          parse_status: string
          parser_identity: string | null
          parser_limits: Json | null
          permitted_model_policy: string | null
          processing_state: Database["public"]["Enums"]["ap_document_processing_state"]
          reference_isolation_status: string
          retention_due_at: string | null
          retention_state: Database["public"]["Enums"]["ap_retention_state"]
          safe_display_name: string
          sha256: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          supersedes_id: string | null
          updated_at: string
          verified_mime_type: string
          version: number
        }
        Insert: {
          claimed_mime_type: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          failure_code?: string | null
          id?: string
          intake_id?: string | null
          is_current?: boolean
          kind: Database["public"]["Enums"]["ap_document_kind"]
          leak_scan_status?: string
          malware_provider_ref?: string | null
          malware_status?: string
          model_ready_at?: string | null
          parse_status?: string
          parser_identity?: string | null
          parser_limits?: Json | null
          permitted_model_policy?: string | null
          processing_state?: Database["public"]["Enums"]["ap_document_processing_state"]
          reference_isolation_status?: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          safe_display_name: string
          sha256: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          supersedes_id?: string | null
          updated_at?: string
          verified_mime_type: string
          version: number
        }
        Update: {
          claimed_mime_type?: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          failure_code?: string | null
          id?: string
          intake_id?: string | null
          is_current?: boolean
          kind?: Database["public"]["Enums"]["ap_document_kind"]
          leak_scan_status?: string
          malware_provider_ref?: string | null
          malware_status?: string
          model_ready_at?: string | null
          parse_status?: string
          parser_identity?: string | null
          parser_limits?: Json | null
          permitted_model_policy?: string | null
          processing_state?: Database["public"]["Enums"]["ap_document_processing_state"]
          reference_isolation_status?: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          safe_display_name?: string
          sha256?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          supersedes_id?: string | null
          updated_at?: string
          verified_mime_type?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_document_versions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_document_versions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_document_versions_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_document_versions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "ap_document_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_experience_identities: {
        Row: {
          calendar_duration_days: number | null
          created_at: string
          customer_id: string | null
          draft_id: string | null
          ends_on: string | null
          id: string
          intensity_percent: number | null
          kind: Database["public"]["Enums"]["ap_experience_kind"]
          label: string
          occupational_credit_eligible: boolean
          source_fact_id: string
          starts_on: string | null
        }
        Insert: {
          calendar_duration_days?: number | null
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          ends_on?: string | null
          id?: string
          intensity_percent?: number | null
          kind: Database["public"]["Enums"]["ap_experience_kind"]
          label: string
          occupational_credit_eligible: boolean
          source_fact_id: string
          starts_on?: string | null
        }
        Update: {
          calendar_duration_days?: number | null
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          ends_on?: string | null
          id?: string
          intensity_percent?: number | null
          kind?: Database["public"]["Enums"]["ap_experience_kind"]
          label?: string
          occupational_credit_eligible?: boolean
          source_fact_id?: string
          starts_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_experience_identities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_experience_identities_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_experience_identities_source_fact_id_fkey"
            columns: ["source_fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_external_commands: {
        Row: {
          command_kind: string
          created_at: string
          customer_id: string | null
          draft_id: string | null
          failure_code: string | null
          id: string
          immutable_input_sha256: string
          provider: string
          provider_idempotency_key: string
          provider_object_id: string | null
          reconciliation_state: string
          state: Database["public"]["Enums"]["ap_command_state"]
          updated_at: string
        }
        Insert: {
          command_kind: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          failure_code?: string | null
          id?: string
          immutable_input_sha256: string
          provider: string
          provider_idempotency_key: string
          provider_object_id?: string | null
          reconciliation_state?: string
          state?: Database["public"]["Enums"]["ap_command_state"]
          updated_at?: string
        }
        Update: {
          command_kind?: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          failure_code?: string | null
          id?: string
          immutable_input_sha256?: string
          provider?: string
          provider_idempotency_key?: string
          provider_object_id?: string | null
          reconciliation_state?: string
          state?: Database["public"]["Enums"]["ap_command_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_external_commands_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_external_commands_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_fact_presentations: {
        Row: {
          control_id: string
          draft_id: string
          draft_version: number
          fact_id: string
          id: number
          presented_at: string
        }
        Insert: {
          control_id: string
          draft_id: string
          draft_version: number
          fact_id: string
          id?: never
          presented_at?: string
        }
        Update: {
          control_id?: string
          draft_id?: string
          draft_version?: number
          fact_id?: string
          id?: never
          presented_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_fact_presentations_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_fact_presentations_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_fact_review_history: {
        Row: {
          correction_fact_id: string | null
          decision: Database["public"]["Enums"]["ap_fact_review_decision"]
          draft_id: string
          fact_id: string
          id: number
          reviewed_at: string
          snapshot_id: string
        }
        Insert: {
          correction_fact_id?: string | null
          decision: Database["public"]["Enums"]["ap_fact_review_decision"]
          draft_id: string
          fact_id: string
          id?: never
          reviewed_at?: string
          snapshot_id: string
        }
        Update: {
          correction_fact_id?: string | null
          decision?: Database["public"]["Enums"]["ap_fact_review_decision"]
          draft_id?: string
          fact_id?: string
          id?: never
          reviewed_at?: string
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_fact_review_history_correction_fact_id_fkey"
            columns: ["correction_fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_fact_review_history_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_fact_review_history_fact_id_fkey"
            columns: ["fact_id"]
            isOneToOne: false
            referencedRelation: "ap_candidate_facts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_fact_review_history_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_feasibility_assessments: {
        Row: {
          coverage_plan_id: string
          created_at: string
          excluded_count: number | null
          expires_at: string | null
          id: string
          invalidated_at: string | null
          outcome: Database["public"]["Enums"]["ap_feasibility_outcome"] | null
          preliminarily_deliverable_count: number | null
          primary_reason:
            | Database["public"]["Enums"]["ap_feasibility_reason"]
            | null
          reasons: Database["public"]["Enums"]["ap_feasibility_reason"][]
          resolution_blocker: Database["public"]["Enums"]["ap_resolution_blocker"]
          reviewable_count: number | null
          rules_version: string
          snapshot_id: string
          state: Database["public"]["Enums"]["ap_feasibility_run_state"]
        }
        Insert: {
          coverage_plan_id: string
          created_at?: string
          excluded_count?: number | null
          expires_at?: string | null
          id?: string
          invalidated_at?: string | null
          outcome?: Database["public"]["Enums"]["ap_feasibility_outcome"] | null
          preliminarily_deliverable_count?: number | null
          primary_reason?:
            | Database["public"]["Enums"]["ap_feasibility_reason"]
            | null
          reasons?: Database["public"]["Enums"]["ap_feasibility_reason"][]
          resolution_blocker?: Database["public"]["Enums"]["ap_resolution_blocker"]
          reviewable_count?: number | null
          rules_version: string
          snapshot_id: string
          state?: Database["public"]["Enums"]["ap_feasibility_run_state"]
        }
        Update: {
          coverage_plan_id?: string
          created_at?: string
          excluded_count?: number | null
          expires_at?: string | null
          id?: string
          invalidated_at?: string | null
          outcome?: Database["public"]["Enums"]["ap_feasibility_outcome"] | null
          preliminarily_deliverable_count?: number | null
          primary_reason?:
            | Database["public"]["Enums"]["ap_feasibility_reason"]
            | null
          reasons?: Database["public"]["Enums"]["ap_feasibility_reason"][]
          resolution_blocker?: Database["public"]["Enums"]["ap_resolution_blocker"]
          reviewable_count?: number | null
          rules_version?: string
          snapshot_id?: string
          state?: Database["public"]["Enums"]["ap_feasibility_run_state"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_feasibility_assessments_coverage_plan_id_fkey"
            columns: ["coverage_plan_id"]
            isOneToOne: false
            referencedRelation: "ap_feasibility_coverage_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_feasibility_assessments_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_feasibility_coverage_cells: {
        Row: {
          authorization_mode: string
          completed_at: string | null
          cursor_or_stop_reason: string | null
          execution_path: string
          id: string
          lookback_bound: string
          pagination_bound: number
          parser_result: Json | null
          plan_id: string
          query_fingerprint: string
          result_bound: number
          result_count: number | null
          source_id: string
          started_at: string | null
          terminal_outcome: string | null
        }
        Insert: {
          authorization_mode: string
          completed_at?: string | null
          cursor_or_stop_reason?: string | null
          execution_path: string
          id?: string
          lookback_bound: string
          pagination_bound: number
          parser_result?: Json | null
          plan_id: string
          query_fingerprint: string
          result_bound: number
          result_count?: number | null
          source_id: string
          started_at?: string | null
          terminal_outcome?: string | null
        }
        Update: {
          authorization_mode?: string
          completed_at?: string | null
          cursor_or_stop_reason?: string | null
          execution_path?: string
          id?: string
          lookback_bound?: string
          pagination_bound?: number
          parser_result?: Json | null
          plan_id?: string
          query_fingerprint?: string
          result_bound?: number
          result_count?: number | null
          source_id?: string
          started_at?: string | null
          terminal_outcome?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_feasibility_coverage_cells_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ap_feasibility_coverage_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_feasibility_coverage_plans: {
        Row: {
          constraint_proof: Json | null
          content_sha256: string
          coverage_disposition: string
          created_at: string
          id: string
          inventory_version_id: string
          plan_version: string
          snapshot_id: string
          typed_inputs: Json
        }
        Insert: {
          constraint_proof?: Json | null
          content_sha256: string
          coverage_disposition: string
          created_at?: string
          id?: string
          inventory_version_id: string
          plan_version: string
          snapshot_id: string
          typed_inputs: Json
        }
        Update: {
          constraint_proof?: Json | null
          content_sha256?: string
          coverage_disposition?: string
          created_at?: string
          id?: string
          inventory_version_id?: string
          plan_version?: string
          snapshot_id?: string
          typed_inputs?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ap_feasibility_coverage_plans_inventory_version_id_fkey"
            columns: ["inventory_version_id"]
            isOneToOne: false
            referencedRelation: "ap_inventory_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_feasibility_coverage_plans_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_feasibility_requests: {
        Row: {
          claimed_at: string | null
          claimed_by: string | null
          completed_assessment_id: string | null
          created_at: string
          draft_id: string
          error_code: string | null
          id: string
          idempotency_key: string
          request_version: string
          snapshot_id: string
          stale_reason: string | null
          state: Database["public"]["Enums"]["ap_feasibility_request_state"]
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_by?: string | null
          completed_assessment_id?: string | null
          created_at?: string
          draft_id: string
          error_code?: string | null
          id?: string
          idempotency_key: string
          request_version: string
          snapshot_id: string
          stale_reason?: string | null
          state?: Database["public"]["Enums"]["ap_feasibility_request_state"]
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_by?: string | null
          completed_assessment_id?: string | null
          created_at?: string
          draft_id?: string
          error_code?: string | null
          id?: string
          idempotency_key?: string
          request_version?: string
          snapshot_id?: string
          stale_reason?: string | null
          state?: Database["public"]["Enums"]["ap_feasibility_request_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_feasibility_requests_completed_assessment_id_fkey"
            columns: ["completed_assessment_id"]
            isOneToOne: false
            referencedRelation: "ap_feasibility_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_feasibility_requests_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_feasibility_requests_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: true
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_feature_flags: {
        Row: {
          approval_reference: string | null
          enabled: boolean
          flag: string
          updated_at: string
        }
        Insert: {
          approval_reference?: string | null
          enabled?: boolean
          flag: string
          updated_at?: string
        }
        Update: {
          approval_reference?: string | null
          enabled?: boolean
          flag?: string
          updated_at?: string
        }
        Relationships: []
      }
      ap_generated_artifacts: {
        Row: {
          artifact_type: Database["public"]["Enums"]["ap_artifact_type"]
          claim_provenance: Json
          created_at: string
          current_file_version: number
          customer_id: string
          generator_version: string
          id: string
          job_snapshot_id: string | null
          material_line_id: string | null
          order_id: string
          reference_permission_id: string | null
          retention_due_at: string | null
          retention_state: Database["public"]["Enums"]["ap_retention_state"]
          source_line_revision_id: string | null
          source_snapshot_id: string
        }
        Insert: {
          artifact_type: Database["public"]["Enums"]["ap_artifact_type"]
          claim_provenance: Json
          created_at?: string
          current_file_version?: number
          customer_id: string
          generator_version: string
          id?: string
          job_snapshot_id?: string | null
          material_line_id?: string | null
          order_id: string
          reference_permission_id?: string | null
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          source_line_revision_id?: string | null
          source_snapshot_id: string
        }
        Update: {
          artifact_type?: Database["public"]["Enums"]["ap_artifact_type"]
          claim_provenance?: Json
          created_at?: string
          current_file_version?: number
          customer_id?: string
          generator_version?: string
          id?: string
          job_snapshot_id?: string | null
          material_line_id?: string | null
          order_id?: string
          reference_permission_id?: string | null
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          source_line_revision_id?: string | null
          source_snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_generated_artifacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_job_snapshot_id_fkey"
            columns: ["job_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_job_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_material_line_id_fkey"
            columns: ["material_line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_reference_permission_id_fkey"
            columns: ["reference_permission_id"]
            isOneToOne: false
            referencedRelation: "ap_reference_permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_source_line_revision_id_fkey"
            columns: ["source_line_revision_id"]
            isOneToOne: false
            referencedRelation: "ap_material_line_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_artifacts_source_snapshot_id_fkey"
            columns: ["source_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_generated_file_versions: {
        Row: {
          artifact_id: string
          checksum_sha256: string
          created_at: string
          downloads_revoked_at: string | null
          human_content_approved_at: string | null
          human_content_approved_by: string | null
          human_visual_approved_at: string | null
          human_visual_approved_by: string | null
          id: string
          mime_type: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          superseded_at: string | null
          version: number
        }
        Insert: {
          artifact_id: string
          checksum_sha256: string
          created_at?: string
          downloads_revoked_at?: string | null
          human_content_approved_at?: string | null
          human_content_approved_by?: string | null
          human_visual_approved_at?: string | null
          human_visual_approved_by?: string | null
          id?: string
          mime_type: string
          size_bytes: number
          storage_bucket: string
          storage_path: string
          superseded_at?: string | null
          version: number
        }
        Update: {
          artifact_id?: string
          checksum_sha256?: string
          created_at?: string
          downloads_revoked_at?: string | null
          human_content_approved_at?: string | null
          human_content_approved_by?: string | null
          human_visual_approved_at?: string | null
          human_visual_approved_by?: string | null
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_bucket?: string
          storage_path?: string
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_generated_file_versions_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "ap_generated_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_file_versions_human_content_approved_by_fkey"
            columns: ["human_content_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_generated_file_versions_human_visual_approved_by_fkey"
            columns: ["human_visual_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_human_review_records: {
        Row: {
          autonomy: string | null
          catalog_version: string
          compared_tasks: Json | null
          complexity: string | null
          created_at: string
          customer_id: string
          decision: Json
          domain_context: string | null
          duration_and_intensity: Json | null
          essential_tools: Json | null
          id: string
          invalidated_at: string | null
          rationale: string
          review_kind: string
          reviewer_id: string
          scope: string | null
          snapshot_id: string
          task_similarity: string | null
        }
        Insert: {
          autonomy?: string | null
          catalog_version: string
          compared_tasks?: Json | null
          complexity?: string | null
          created_at?: string
          customer_id: string
          decision: Json
          domain_context?: string | null
          duration_and_intensity?: Json | null
          essential_tools?: Json | null
          id?: string
          invalidated_at?: string | null
          rationale: string
          review_kind: string
          reviewer_id: string
          scope?: string | null
          snapshot_id: string
          task_similarity?: string | null
        }
        Update: {
          autonomy?: string | null
          catalog_version?: string
          compared_tasks?: Json | null
          complexity?: string | null
          created_at?: string
          customer_id?: string
          decision?: Json
          domain_context?: string | null
          duration_and_intensity?: Json | null
          essential_tools?: Json | null
          id?: string
          invalidated_at?: string | null
          rationale?: string
          review_kind?: string
          reviewer_id?: string
          scope?: string | null
          snapshot_id?: string
          task_similarity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_human_review_records_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_human_review_records_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_human_review_records_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_independent_verification_sources: {
        Row: {
          content_sha256: string
          created_at: string
          customer_id: string
          encrypted_payload_id: string
          id: string
          retention_due_at: string | null
          retention_state: Database["public"]["Enums"]["ap_retention_state"]
          reviewer_id: string
          source_locator: string
          source_type: string
          verified_at: string
        }
        Insert: {
          content_sha256: string
          created_at?: string
          customer_id: string
          encrypted_payload_id: string
          id?: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          reviewer_id: string
          source_locator: string
          source_type: string
          verified_at: string
        }
        Update: {
          content_sha256?: string
          created_at?: string
          customer_id?: string
          encrypted_payload_id?: string
          id?: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
          reviewer_id?: string
          source_locator?: string
          source_type?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_independent_verification_sources_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_independent_verification_sources_encrypted_payload_id_fkey"
            columns: ["encrypted_payload_id"]
            isOneToOne: false
            referencedRelation: "ap_sensitive_payloads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_independent_verification_sources_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_intake_event_counts: {
        Row: {
          count: number
          event_day: string
          event_name: string
          step: number
        }
        Insert: {
          count?: number
          event_day: string
          event_name: string
          step: number
        }
        Update: {
          count?: number
          event_day?: string
          event_name?: string
          step?: number
        }
        Relationships: []
      }
      ap_intake_snapshots: {
        Row: {
          access_email_normalized: string
          avoided_activities: Json
          benefits: Json
          blocked_industries: Json
          canonicalization_version: string
          confirmed_title_restriction: Json | null
          content_sha256: string
          created_at: string
          currency: string
          customer_id: string | null
          dealbreakers: Json
          desired_activities: Json
          document_contact_email: string | null
          draft_id: string | null
          employer_unknown_policy: Json
          employment_types: Json
          finalized_at: string
          guidance_requested: boolean
          id: string
          intake_id: string | null
          optional_industries: Json
          optional_titles: Json
          parent_snapshot_id: string | null
          payer_receipt_email: string | null
          prior_cover_letter_use: string
          salary_basis: string | null
          salary_hard_minimum_cents: number | null
          salary_minimum_flexible: boolean
          salary_noncomparable_policy: string
          salary_overlap_policy: string
          salary_period: string | null
          salary_target_cents: number | null
          salary_unpublished_policy: string
          salary_variable_pay_policy: string
          schedules: Json
          schema_version: string
          search_breadth: string
          sensitive_payload_id: string | null
          snapshot_kind: string
          targeted_authorization_answers: Json
          travel: Json
          us_state_or_dc: string | null
          version: number
          work_modes: Json
        }
        Insert: {
          access_email_normalized: string
          avoided_activities: Json
          benefits: Json
          blocked_industries: Json
          canonicalization_version: string
          confirmed_title_restriction?: Json | null
          content_sha256: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          dealbreakers: Json
          desired_activities: Json
          document_contact_email?: string | null
          draft_id?: string | null
          employer_unknown_policy: Json
          employment_types: Json
          finalized_at: string
          guidance_requested: boolean
          id?: string
          intake_id?: string | null
          optional_industries: Json
          optional_titles: Json
          parent_snapshot_id?: string | null
          payer_receipt_email?: string | null
          prior_cover_letter_use: string
          salary_basis?: string | null
          salary_hard_minimum_cents?: number | null
          salary_minimum_flexible: boolean
          salary_noncomparable_policy: string
          salary_overlap_policy: string
          salary_period?: string | null
          salary_target_cents?: number | null
          salary_unpublished_policy: string
          salary_variable_pay_policy: string
          schedules: Json
          schema_version: string
          search_breadth: string
          sensitive_payload_id?: string | null
          snapshot_kind: string
          targeted_authorization_answers: Json
          travel: Json
          us_state_or_dc?: string | null
          version: number
          work_modes: Json
        }
        Update: {
          access_email_normalized?: string
          avoided_activities?: Json
          benefits?: Json
          blocked_industries?: Json
          canonicalization_version?: string
          confirmed_title_restriction?: Json | null
          content_sha256?: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          dealbreakers?: Json
          desired_activities?: Json
          document_contact_email?: string | null
          draft_id?: string | null
          employer_unknown_policy?: Json
          employment_types?: Json
          finalized_at?: string
          guidance_requested?: boolean
          id?: string
          intake_id?: string | null
          optional_industries?: Json
          optional_titles?: Json
          parent_snapshot_id?: string | null
          payer_receipt_email?: string | null
          prior_cover_letter_use?: string
          salary_basis?: string | null
          salary_hard_minimum_cents?: number | null
          salary_minimum_flexible?: boolean
          salary_noncomparable_policy?: string
          salary_overlap_policy?: string
          salary_period?: string | null
          salary_target_cents?: number | null
          salary_unpublished_policy?: string
          salary_variable_pay_policy?: string
          schedules?: Json
          schema_version?: string
          search_breadth?: string
          sensitive_payload_id?: string | null
          snapshot_kind?: string
          targeted_authorization_answers?: Json
          travel?: Json
          us_state_or_dc?: string | null
          version?: number
          work_modes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ap_intake_snapshots_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_intake_snapshots_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_intake_snapshots_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_intake_snapshots_parent_snapshot_id_fkey"
            columns: ["parent_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_intake_snapshots_sensitive_payload_id_fkey"
            columns: ["sensitive_payload_id"]
            isOneToOne: false
            referencedRelation: "ap_sensitive_payloads"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_inventory_versions: {
        Row: {
          content_sha256: string
          created_at: string
          cutoff_at: string
          id: string
          parser_version: string
          query_version: string
          source_registry_version: string
        }
        Insert: {
          content_sha256: string
          created_at?: string
          cutoff_at: string
          id?: string
          parser_version: string
          query_version: string
          source_registry_version: string
        }
        Update: {
          content_sha256?: string
          created_at?: string
          cutoff_at?: string
          id?: string
          parser_version?: string
          query_version?: string
          source_registry_version?: string
        }
        Relationships: []
      }
      ap_job_snapshots: {
        Row: {
          application_host_type: string
          canonical_application_url: string
          canonical_employer_listing_url: string | null
          captured_listing: Json
          company: string
          compensation_source: string | null
          compensation_text: string | null
          content_sha256: string
          created_at: string
          discovery_source: string
          exact_title: string
          external_job_id: string | null
          id: string
          legacy_job_id: string | null
          live_verified_at: string
          location_and_work_mode: Json
          normalized_fingerprint: string
          origin: Database["public"]["Enums"]["ap_job_origin"]
          parser_version: string
          posted_date_unknown: boolean
          posted_on: string | null
          retrieved_at: string
          source_url: string
        }
        Insert: {
          application_host_type: string
          canonical_application_url: string
          canonical_employer_listing_url?: string | null
          captured_listing: Json
          company: string
          compensation_source?: string | null
          compensation_text?: string | null
          content_sha256: string
          created_at?: string
          discovery_source: string
          exact_title: string
          external_job_id?: string | null
          id?: string
          legacy_job_id?: string | null
          live_verified_at: string
          location_and_work_mode: Json
          normalized_fingerprint: string
          origin: Database["public"]["Enums"]["ap_job_origin"]
          parser_version: string
          posted_date_unknown: boolean
          posted_on?: string | null
          retrieved_at: string
          source_url: string
        }
        Update: {
          application_host_type?: string
          canonical_application_url?: string
          canonical_employer_listing_url?: string | null
          captured_listing?: Json
          company?: string
          compensation_source?: string | null
          compensation_text?: string | null
          content_sha256?: string
          created_at?: string
          discovery_source?: string
          exact_title?: string
          external_job_id?: string | null
          id?: string
          legacy_job_id?: string | null
          live_verified_at?: string
          location_and_work_mode?: Json
          normalized_fingerprint?: string
          origin?: Database["public"]["Enums"]["ap_job_origin"]
          parser_version?: string
          posted_date_unknown?: boolean
          posted_on?: string | null
          retrieved_at?: string
          source_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_job_snapshots_legacy_job_id_fkey"
            columns: ["legacy_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_match_evaluations: {
        Row: {
          application_readiness: Database["public"]["Enums"]["ap_application_readiness"]
          candidate_fact_ids: string[]
          categorical_evidence_sufficient: boolean
          confidence_components: Json
          created_at: string
          customer_id: string
          eligibility: Database["public"]["Enums"]["ap_eligibility_disposition"]
          evidence_confidence: number | null
          fit_components: Json
          fit_score: number | null
          human_review_id: string | null
          id: string
          invalidated_at: string | null
          job_evidence: Json
          job_snapshot_id: string
          leaf_results: Json
          presentation_risk: Database["public"]["Enums"]["ap_presentation_risk"]
          presentation_risk_reasons: Json
          resolution_issues: Database["public"]["Enums"]["ap_resolution_issue"][]
          root_result: Database["public"]["Enums"]["ap_criterion_result"]
          salary_disposition: Database["public"]["Enums"]["ap_salary_gate_disposition"]
          salary_status: Database["public"]["Enums"]["ap_salary_status"]
          satisfaction_paths: Json
          snapshot_id: string
          soft_preferences: Json
          unknown_treatments: Database["public"]["Enums"]["ap_unknown_treatment"][]
          version_bundle: Json
          warnings: Json
        }
        Insert: {
          application_readiness: Database["public"]["Enums"]["ap_application_readiness"]
          candidate_fact_ids: string[]
          categorical_evidence_sufficient: boolean
          confidence_components: Json
          created_at?: string
          customer_id: string
          eligibility: Database["public"]["Enums"]["ap_eligibility_disposition"]
          evidence_confidence?: number | null
          fit_components: Json
          fit_score?: number | null
          human_review_id?: string | null
          id?: string
          invalidated_at?: string | null
          job_evidence: Json
          job_snapshot_id: string
          leaf_results: Json
          presentation_risk: Database["public"]["Enums"]["ap_presentation_risk"]
          presentation_risk_reasons: Json
          resolution_issues: Database["public"]["Enums"]["ap_resolution_issue"][]
          root_result: Database["public"]["Enums"]["ap_criterion_result"]
          salary_disposition: Database["public"]["Enums"]["ap_salary_gate_disposition"]
          salary_status: Database["public"]["Enums"]["ap_salary_status"]
          satisfaction_paths: Json
          snapshot_id: string
          soft_preferences: Json
          unknown_treatments: Database["public"]["Enums"]["ap_unknown_treatment"][]
          version_bundle: Json
          warnings: Json
        }
        Update: {
          application_readiness?: Database["public"]["Enums"]["ap_application_readiness"]
          candidate_fact_ids?: string[]
          categorical_evidence_sufficient?: boolean
          confidence_components?: Json
          created_at?: string
          customer_id?: string
          eligibility?: Database["public"]["Enums"]["ap_eligibility_disposition"]
          evidence_confidence?: number | null
          fit_components?: Json
          fit_score?: number | null
          human_review_id?: string | null
          id?: string
          invalidated_at?: string | null
          job_evidence?: Json
          job_snapshot_id?: string
          leaf_results?: Json
          presentation_risk?: Database["public"]["Enums"]["ap_presentation_risk"]
          presentation_risk_reasons?: Json
          resolution_issues?: Database["public"]["Enums"]["ap_resolution_issue"][]
          root_result?: Database["public"]["Enums"]["ap_criterion_result"]
          salary_disposition?: Database["public"]["Enums"]["ap_salary_gate_disposition"]
          salary_status?: Database["public"]["Enums"]["ap_salary_status"]
          satisfaction_paths?: Json
          snapshot_id?: string
          soft_preferences?: Json
          unknown_treatments?: Database["public"]["Enums"]["ap_unknown_treatment"][]
          version_bundle?: Json
          warnings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ap_match_evaluations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_match_evaluations_human_review_id_fkey"
            columns: ["human_review_id"]
            isOneToOne: false
            referencedRelation: "ap_human_review_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_match_evaluations_job_snapshot_id_fkey"
            columns: ["job_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_job_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_match_evaluations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_material_entitlement_claims: {
        Row: {
          claimed_at: string
          delivered_match_id: string
          delivered_order_id: string
          entitlement_history_id: string
          released_at: string | null
        }
        Insert: {
          claimed_at?: string
          delivered_match_id: string
          delivered_order_id: string
          entitlement_history_id: string
          released_at?: string | null
        }
        Update: {
          claimed_at?: string
          delivered_match_id?: string
          delivered_order_id?: string
          entitlement_history_id?: string
          released_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_material_entitlement_claims_delivered_match_id_fkey"
            columns: ["delivered_match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_claims_delivered_order_id_fkey"
            columns: ["delivered_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_claims_delivered_order_id_fkey"
            columns: ["delivered_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_claims_entitlement_history_id_fkey"
            columns: ["entitlement_history_id"]
            isOneToOne: true
            referencedRelation: "ap_material_entitlement_history"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_material_entitlement_history: {
        Row: {
          created_at: string
          delivered_match_id: string
          delivered_order_id: string
          id: string
          line_id: string
          revision_id: string | null
          state: string
          supersedes_id: string | null
        }
        Insert: {
          created_at?: string
          delivered_match_id: string
          delivered_order_id: string
          id?: string
          line_id: string
          revision_id?: string | null
          state: string
          supersedes_id?: string | null
        }
        Update: {
          created_at?: string
          delivered_match_id?: string
          delivered_order_id?: string
          id?: string
          line_id?: string
          revision_id?: string | null
          state?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_material_entitlement_history_delivered_match_id_fkey"
            columns: ["delivered_match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_history_delivered_order_id_fkey"
            columns: ["delivered_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_history_delivered_order_id_fkey"
            columns: ["delivered_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_history_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_history_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "ap_material_line_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_entitlement_history_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "ap_material_entitlement_history"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_material_line_revisions: {
        Row: {
          accepted_at: string | null
          capacity_allocation_id: string | null
          created_at: string
          due_at: string | null
          fact_diff: Json | null
          id: string
          job_snapshot_id: string | null
          line_id: string
          parent_revision_id: string | null
          reference_scope: Json | null
          revision_kind: string
          started_at: string | null
          superseded_at: string | null
          version: number
        }
        Insert: {
          accepted_at?: string | null
          capacity_allocation_id?: string | null
          created_at?: string
          due_at?: string | null
          fact_diff?: Json | null
          id?: string
          job_snapshot_id?: string | null
          line_id: string
          parent_revision_id?: string | null
          reference_scope?: Json | null
          revision_kind: string
          started_at?: string | null
          superseded_at?: string | null
          version: number
        }
        Update: {
          accepted_at?: string | null
          capacity_allocation_id?: string | null
          created_at?: string
          due_at?: string | null
          fact_diff?: Json | null
          id?: string
          job_snapshot_id?: string | null
          line_id?: string
          parent_revision_id?: string | null
          reference_scope?: Json | null
          revision_kind?: string
          started_at?: string | null
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_material_line_revisions_capacity_allocation_id_fkey"
            columns: ["capacity_allocation_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_line_revisions_job_snapshot_id_fkey"
            columns: ["job_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_job_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_line_revisions_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_line_revisions_parent_revision_id_fkey"
            columns: ["parent_revision_id"]
            isOneToOne: false
            referencedRelation: "ap_material_line_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_material_lines: {
        Row: {
          active_revision: number
          allocated_amount_cents: number
          created_at: string
          delivered_match_id: string
          delivered_order_id: string
          earned_revenue_at: string | null
          fulfillment: Database["public"]["Enums"]["ap_material_fulfillment"]
          id: string
          materials_capacity_confirmed_at: string | null
          materials_due_at: string | null
          materials_payment_verified_at: string | null
          materials_started_at: string | null
          payment_allocation_key: string
          payment_attempt_id: string
          purchase_id: string
          readiness: Database["public"]["Enums"]["ap_material_readiness"]
          selected_reference_sheet: boolean
          selection_confirmed_at: string | null
          substitution: Database["public"]["Enums"]["ap_material_substitution"]
        }
        Insert: {
          active_revision?: number
          allocated_amount_cents: number
          created_at?: string
          delivered_match_id: string
          delivered_order_id: string
          earned_revenue_at?: string | null
          fulfillment?: Database["public"]["Enums"]["ap_material_fulfillment"]
          id?: string
          materials_capacity_confirmed_at?: string | null
          materials_due_at?: string | null
          materials_payment_verified_at?: string | null
          materials_started_at?: string | null
          payment_allocation_key: string
          payment_attempt_id: string
          purchase_id: string
          readiness?: Database["public"]["Enums"]["ap_material_readiness"]
          selected_reference_sheet?: boolean
          selection_confirmed_at?: string | null
          substitution?: Database["public"]["Enums"]["ap_material_substitution"]
        }
        Update: {
          active_revision?: number
          allocated_amount_cents?: number
          created_at?: string
          delivered_match_id?: string
          delivered_order_id?: string
          earned_revenue_at?: string | null
          fulfillment?: Database["public"]["Enums"]["ap_material_fulfillment"]
          id?: string
          materials_capacity_confirmed_at?: string | null
          materials_due_at?: string | null
          materials_payment_verified_at?: string | null
          materials_started_at?: string | null
          payment_allocation_key?: string
          payment_attempt_id?: string
          purchase_id?: string
          readiness?: Database["public"]["Enums"]["ap_material_readiness"]
          selected_reference_sheet?: boolean
          selection_confirmed_at?: string | null
          substitution?: Database["public"]["Enums"]["ap_material_substitution"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_material_lines_delivered_match_id_fkey"
            columns: ["delivered_match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_lines_delivered_order_id_fkey"
            columns: ["delivered_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_lines_delivered_order_id_fkey"
            columns: ["delivered_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_lines_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["corrected_payment_attempt_id"]
          },
          {
            foreignKeyName: "ap_material_lines_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_lines_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_payment_refund_aggregates"
            referencedColumns: ["payment_attempt_id"]
          },
          {
            foreignKeyName: "ap_material_lines_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "ap_material_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_material_purchases: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          customer_id: string
          id: string
          legacy_cart_id: string | null
          payment_attempt_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency: string
          customer_id: string
          id?: string
          legacy_cart_id?: string | null
          payment_attempt_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          legacy_cart_id?: string | null
          payment_attempt_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_material_purchases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_purchases_legacy_cart_id_fkey"
            columns: ["legacy_cart_id"]
            isOneToOne: true
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_purchases_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["corrected_payment_attempt_id"]
          },
          {
            foreignKeyName: "ap_material_purchases_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_material_purchases_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_payment_refund_aggregates"
            referencedColumns: ["payment_attempt_id"]
          },
        ]
      }
      ap_migration_checkpoints: {
        Row: {
          checkpoint: string
          completed_at: string | null
          content_sha256: string | null
          migration_id: string
          rows_processed: number
        }
        Insert: {
          checkpoint: string
          completed_at?: string | null
          content_sha256?: string | null
          migration_id: string
          rows_processed?: number
        }
        Update: {
          checkpoint?: string
          completed_at?: string | null
          content_sha256?: string | null
          migration_id?: string
          rows_processed?: number
        }
        Relationships: []
      }
      ap_outbox_messages: {
        Row: {
          attempts: number
          created_at: string
          customer_id: string | null
          deduplication_key: string
          id: string
          last_error_code: string | null
          message_kind: string
          next_attempt_at: string | null
          order_id: string | null
          payload_ref: string | null
          provider_idempotency_key: string
          provider_message_id: string | null
          recipient_ref: string
          reconciliation_state: string
          state: Database["public"]["Enums"]["ap_outbox_state"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          customer_id?: string | null
          deduplication_key: string
          id?: string
          last_error_code?: string | null
          message_kind: string
          next_attempt_at?: string | null
          order_id?: string | null
          payload_ref?: string | null
          provider_idempotency_key: string
          provider_message_id?: string | null
          recipient_ref: string
          reconciliation_state?: string
          state?: Database["public"]["Enums"]["ap_outbox_state"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          customer_id?: string | null
          deduplication_key?: string
          id?: string
          last_error_code?: string | null
          message_kind?: string
          next_attempt_at?: string | null
          order_id?: string | null
          payload_ref?: string | null
          provider_idempotency_key?: string
          provider_message_id?: string | null
          recipient_ref?: string
          reconciliation_state?: string
          state?: Database["public"]["Enums"]["ap_outbox_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_outbox_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_outbox_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_outbox_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_outbox_messages_payload_ref_fkey"
            columns: ["payload_ref"]
            isOneToOne: false
            referencedRelation: "ap_sensitive_payloads"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_payment_attempts: {
        Row: {
          amount_cents: number
          checkout_attempt_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          dispute: Database["public"]["Enums"]["ap_payment_dispute"]
          dispute_opened_at: string | null
          dispute_resolved_at: string | null
          draft_id: string | null
          funds_reversed_at: string | null
          funds_secured_at: string | null
          id: string
          legacy_payment_id: string | null
          payment_verified_at: string | null
          provider: string
          provider_payment_id: string | null
          settlement: Database["public"]["Enums"]["ap_payment_settlement"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          checkout_attempt_id?: string | null
          created_at?: string
          currency: string
          customer_id?: string | null
          dispute?: Database["public"]["Enums"]["ap_payment_dispute"]
          dispute_opened_at?: string | null
          dispute_resolved_at?: string | null
          draft_id?: string | null
          funds_reversed_at?: string | null
          funds_secured_at?: string | null
          id?: string
          legacy_payment_id?: string | null
          payment_verified_at?: string | null
          provider: string
          provider_payment_id?: string | null
          settlement?: Database["public"]["Enums"]["ap_payment_settlement"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          checkout_attempt_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          dispute?: Database["public"]["Enums"]["ap_payment_dispute"]
          dispute_opened_at?: string | null
          dispute_resolved_at?: string | null
          draft_id?: string | null
          funds_reversed_at?: string | null
          funds_secured_at?: string | null
          id?: string
          legacy_payment_id?: string | null
          payment_verified_at?: string | null
          provider?: string
          provider_payment_id?: string | null
          settlement?: Database["public"]["Enums"]["ap_payment_settlement"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_payment_attempts_checkout_attempt_id_fkey"
            columns: ["checkout_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_checkout_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_payment_attempts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_payment_attempts_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_payment_attempts_legacy_payment_id_fkey"
            columns: ["legacy_payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_provider_events: {
        Row: {
          applied_at: string | null
          event_type: string
          failure_code: string | null
          id: string
          payload_sha256: string
          provider: string
          provider_event_id: string
          received_at: string
          signature_verified_at: string
        }
        Insert: {
          applied_at?: string | null
          event_type: string
          failure_code?: string | null
          id?: string
          payload_sha256: string
          provider: string
          provider_event_id: string
          received_at?: string
          signature_verified_at: string
        }
        Update: {
          applied_at?: string | null
          event_type?: string
          failure_code?: string | null
          id?: string
          payload_sha256?: string
          provider?: string
          provider_event_id?: string
          received_at?: string
          signature_verified_at?: string
        }
        Relationships: []
      }
      ap_quotes: {
        Row: {
          content_sha256: string
          created_at: string
          currency: string
          customer_id: string | null
          draft_id: string | null
          expires_at: string
          feasibility_assessment_id: string
          id: string
          invalidated_at: string | null
          price_cents: number
          snapshot_id: string
          tax_inclusive: boolean
        }
        Insert: {
          content_sha256: string
          created_at?: string
          currency: string
          customer_id?: string | null
          draft_id?: string | null
          expires_at: string
          feasibility_assessment_id: string
          id?: string
          invalidated_at?: string | null
          price_cents: number
          snapshot_id: string
          tax_inclusive: boolean
        }
        Update: {
          content_sha256?: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          draft_id?: string | null
          expires_at?: string
          feasibility_assessment_id?: string
          id?: string
          invalidated_at?: string | null
          price_cents?: number
          snapshot_id?: string
          tax_inclusive?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ap_quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_quotes_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_quotes_feasibility_assessment_id_fkey"
            columns: ["feasibility_assessment_id"]
            isOneToOne: false
            referencedRelation: "ap_feasibility_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_quotes_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_reference_permissions: {
        Row: {
          attested_at: string
          contact_version_changed_at: string | null
          created_at: string
          customer_id: string
          delivered_release_id: string
          employer_snapshot: string
          exact_position_snapshot: string
          id: string
          job_snapshot_hash: string
          job_snapshot_id: string
          permission_text_version: string
          reference_record_version_id: string
          revoked_at: string | null
        }
        Insert: {
          attested_at: string
          contact_version_changed_at?: string | null
          created_at?: string
          customer_id: string
          delivered_release_id: string
          employer_snapshot: string
          exact_position_snapshot: string
          id?: string
          job_snapshot_hash: string
          job_snapshot_id: string
          permission_text_version: string
          reference_record_version_id: string
          revoked_at?: string | null
        }
        Update: {
          attested_at?: string
          contact_version_changed_at?: string | null
          created_at?: string
          customer_id?: string
          delivered_release_id?: string
          employer_snapshot?: string
          exact_position_snapshot?: string
          id?: string
          job_snapshot_hash?: string
          job_snapshot_id?: string
          permission_text_version?: string
          reference_record_version_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_reference_permissions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_reference_permissions_delivered_release_id_fkey"
            columns: ["delivered_release_id"]
            isOneToOne: false
            referencedRelation: "ap_releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_reference_permissions_job_snapshot_id_fkey"
            columns: ["job_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_job_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_reference_permissions_reference_record_version_id_fkey"
            columns: ["reference_record_version_id"]
            isOneToOne: false
            referencedRelation: "ap_reference_record_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_reference_record_versions: {
        Row: {
          created_at: string
          encrypted_payload_id: string
          id: string
          payload_schema_version: string
          payload_sha256: string
          permission_last_confirmed_at: string | null
          permission_status: Database["public"]["Enums"]["ap_reference_permission"]
          reference_record_id: string
          superseded_at: string | null
          version: number
        }
        Insert: {
          created_at?: string
          encrypted_payload_id: string
          id?: string
          payload_schema_version: string
          payload_sha256: string
          permission_last_confirmed_at?: string | null
          permission_status?: Database["public"]["Enums"]["ap_reference_permission"]
          reference_record_id: string
          superseded_at?: string | null
          version: number
        }
        Update: {
          created_at?: string
          encrypted_payload_id?: string
          id?: string
          payload_schema_version?: string
          payload_sha256?: string
          permission_last_confirmed_at?: string | null
          permission_status?: Database["public"]["Enums"]["ap_reference_permission"]
          reference_record_id?: string
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ap_reference_record_versions_encrypted_payload_id_fkey"
            columns: ["encrypted_payload_id"]
            isOneToOne: false
            referencedRelation: "ap_sensitive_payloads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_reference_record_versions_reference_record_id_fkey"
            columns: ["reference_record_id"]
            isOneToOne: false
            referencedRelation: "ap_reference_records"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_reference_records: {
        Row: {
          created_at: string
          current_version: number
          customer_id: string
          id: string
          opaque_client_id: string
          removed_at: string | null
          retention_due_at: string | null
          retention_state: Database["public"]["Enums"]["ap_retention_state"]
        }
        Insert: {
          created_at?: string
          current_version?: number
          customer_id: string
          id?: string
          opaque_client_id?: string
          removed_at?: string | null
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
        }
        Update: {
          created_at?: string
          current_version?: number
          customer_id?: string
          id?: string
          opaque_client_id?: string
          removed_at?: string | null
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_reference_records_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_reference_staff_access: {
        Row: {
          accessed_at: string
          id: number
          purpose: string
          reference_record_id: string
          staff_id: string
        }
        Insert: {
          accessed_at?: string
          id?: never
          purpose: string
          reference_record_id: string
          staff_id: string
        }
        Update: {
          accessed_at?: string
          id?: never
          purpose?: string
          reference_record_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_reference_staff_access_reference_record_id_fkey"
            columns: ["reference_record_id"]
            isOneToOne: false
            referencedRelation: "ap_reference_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_reference_staff_access_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_refund_operations: {
        Row: {
          amount_cents: number
          completed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          id: string
          idempotency_key: string
          material_line_id: string | null
          payment_attempt_id: string
          provider_command_id: string | null
          provider_refund_id: string | null
          required: boolean
          scope: Database["public"]["Enums"]["ap_refund_scope"]
          state: Database["public"]["Enums"]["ap_refund_state"]
          superseded_at: string | null
        }
        Insert: {
          amount_cents: number
          completed_at?: string | null
          created_at?: string
          currency: string
          customer_id: string
          id?: string
          idempotency_key: string
          material_line_id?: string | null
          payment_attempt_id: string
          provider_command_id?: string | null
          provider_refund_id?: string | null
          required?: boolean
          scope: Database["public"]["Enums"]["ap_refund_scope"]
          state?: Database["public"]["Enums"]["ap_refund_state"]
          superseded_at?: string | null
        }
        Update: {
          amount_cents?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          idempotency_key?: string
          material_line_id?: string | null
          payment_attempt_id?: string
          provider_command_id?: string | null
          provider_refund_id?: string | null
          required?: boolean
          scope?: Database["public"]["Enums"]["ap_refund_scope"]
          state?: Database["public"]["Enums"]["ap_refund_state"]
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_refund_operations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_refund_operations_material_line_id_fkey"
            columns: ["material_line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_refund_operations_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["corrected_payment_attempt_id"]
          },
          {
            foreignKeyName: "ap_refund_operations_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_refund_operations_payment_attempt_id_fkey"
            columns: ["payment_attempt_id"]
            isOneToOne: false
            referencedRelation: "ap_payment_refund_aggregates"
            referencedColumns: ["payment_attempt_id"]
          },
          {
            foreignKeyName: "ap_refund_operations_provider_command_id_fkey"
            columns: ["provider_command_id"]
            isOneToOne: true
            referencedRelation: "ap_external_commands"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_release_members: {
        Row: {
          created_at: string
          id: string
          member_id: string
          member_type: string
          position: number | null
          release_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          member_type: string
          position?: number | null
          release_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          member_type?: string
          position?: number | null
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_release_members_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "ap_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_releases: {
        Row: {
          active_due_at: string
          committed_at: string
          created_at: string
          customer_id: string
          human_approved_by: string
          id: string
          material_line_id: string | null
          order_id: string
          release_kind: string
          version_bundle: Json
        }
        Insert: {
          active_due_at: string
          committed_at: string
          created_at?: string
          customer_id: string
          human_approved_by: string
          id?: string
          material_line_id?: string | null
          order_id: string
          release_kind: string
          version_bundle: Json
        }
        Update: {
          active_due_at?: string
          committed_at?: string
          created_at?: string
          customer_id?: string
          human_approved_by?: string
          id?: string
          material_line_id?: string | null
          order_id?: string
          release_kind?: string
          version_bundle?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ap_releases_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_releases_human_approved_by_fkey"
            columns: ["human_approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_releases_material_line_id_fkey"
            columns: ["material_line_id"]
            isOneToOne: false
            referencedRelation: "ap_material_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_releases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_releases_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_requirement_nodes: {
        Row: {
          created_at: string
          criterion_type:
            | Database["public"]["Enums"]["ap_criterion_type"]
            | null
          criterion_version: string | null
          id: string
          job_snapshot_id: string
          node_kind: Database["public"]["Enums"]["ap_requirement_node_kind"]
          parent_id: string | null
          parser_certainty: number | null
          position: number
          requirement_strength: string | null
          semantic_key: string | null
          source_locator: string | null
          stable_criterion_id: string | null
          typed_value: Json | null
        }
        Insert: {
          created_at?: string
          criterion_type?:
            | Database["public"]["Enums"]["ap_criterion_type"]
            | null
          criterion_version?: string | null
          id?: string
          job_snapshot_id: string
          node_kind: Database["public"]["Enums"]["ap_requirement_node_kind"]
          parent_id?: string | null
          parser_certainty?: number | null
          position: number
          requirement_strength?: string | null
          semantic_key?: string | null
          source_locator?: string | null
          stable_criterion_id?: string | null
          typed_value?: Json | null
        }
        Update: {
          created_at?: string
          criterion_type?:
            | Database["public"]["Enums"]["ap_criterion_type"]
            | null
          criterion_version?: string | null
          id?: string
          job_snapshot_id?: string
          node_kind?: Database["public"]["Enums"]["ap_requirement_node_kind"]
          parent_id?: string | null
          parser_certainty?: number | null
          position?: number
          requirement_strength?: string | null
          semantic_key?: string | null
          source_locator?: string | null
          stable_criterion_id?: string | null
          typed_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_requirement_nodes_job_snapshot_id_fkey"
            columns: ["job_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_job_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_requirement_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ap_requirement_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_retention_configuration: {
        Row: {
          approved: boolean
          cleanup_enabled: boolean | null
          privacy_policy_approval_reference: string | null
          singleton: boolean
          unpaid_draft_seconds: number | null
          unpaid_file_seconds: number | null
          updated_at: string
        }
        Insert: {
          approved?: boolean
          cleanup_enabled?: boolean | null
          privacy_policy_approval_reference?: string | null
          singleton?: boolean
          unpaid_draft_seconds?: number | null
          unpaid_file_seconds?: number | null
          updated_at?: string
        }
        Update: {
          approved?: boolean
          cleanup_enabled?: boolean | null
          privacy_policy_approval_reference?: string | null
          singleton?: boolean
          unpaid_draft_seconds?: number | null
          unpaid_file_seconds?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ap_scheduled_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string
          job_kind: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          reference_id: string
          run_at: string
          state: Database["public"]["Enums"]["ap_scheduled_job_state"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key: string
          job_kind: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          reference_id: string
          run_at: string
          state?: Database["public"]["Enums"]["ap_scheduled_job_state"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          job_kind?: string
          last_error_code?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          reference_id?: string
          run_at?: string
          state?: Database["public"]["Enums"]["ap_scheduled_job_state"]
          updated_at?: string
        }
        Relationships: []
      }
      ap_search_services: {
        Row: {
          active_snapshot_id: string | null
          adjustment: Database["public"]["Enums"]["ap_adjustment_state"]
          capacity_allocation_id: string | null
          capacity_confirmed_at: string | null
          created_at: string
          customer_id: string
          delivery_due_at: string | null
          fulfillment: Database["public"]["Enums"]["ap_search_fulfillment"]
          id: string
          intake_completed_at: string | null
          legacy_order_id: string
          legacy_record: boolean
          original_snapshot_id: string | null
          quote_id: string | null
          search_activated_at: string | null
          service_started_at: string | null
          updated_at: string
          version_bundle: Json
          winning_payment_attempt_id: string | null
        }
        Insert: {
          active_snapshot_id?: string | null
          adjustment?: Database["public"]["Enums"]["ap_adjustment_state"]
          capacity_allocation_id?: string | null
          capacity_confirmed_at?: string | null
          created_at?: string
          customer_id: string
          delivery_due_at?: string | null
          fulfillment?: Database["public"]["Enums"]["ap_search_fulfillment"]
          id?: string
          intake_completed_at?: string | null
          legacy_order_id: string
          legacy_record?: boolean
          original_snapshot_id?: string | null
          quote_id?: string | null
          search_activated_at?: string | null
          service_started_at?: string | null
          updated_at?: string
          version_bundle?: Json
          winning_payment_attempt_id?: string | null
        }
        Update: {
          active_snapshot_id?: string | null
          adjustment?: Database["public"]["Enums"]["ap_adjustment_state"]
          capacity_allocation_id?: string | null
          capacity_confirmed_at?: string | null
          created_at?: string
          customer_id?: string
          delivery_due_at?: string | null
          fulfillment?: Database["public"]["Enums"]["ap_search_fulfillment"]
          id?: string
          intake_completed_at?: string | null
          legacy_order_id?: string
          legacy_record?: boolean
          original_snapshot_id?: string | null
          quote_id?: string | null
          search_activated_at?: string | null
          service_started_at?: string | null
          updated_at?: string
          version_bundle?: Json
          winning_payment_attempt_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ap_search_services_active_snapshot_id_fkey"
            columns: ["active_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_capacity_allocation_id_fkey"
            columns: ["capacity_allocation_id"]
            isOneToOne: false
            referencedRelation: "ap_capacity_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_legacy_order_id_fkey"
            columns: ["legacy_order_id"]
            isOneToOne: true
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_legacy_order_id_fkey"
            columns: ["legacy_order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_original_snapshot_id_fkey"
            columns: ["original_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_intake_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "ap_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_winning_payment_attempt_id_fkey"
            columns: ["winning_payment_attempt_id"]
            isOneToOne: true
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["corrected_payment_attempt_id"]
          },
          {
            foreignKeyName: "ap_search_services_winning_payment_attempt_id_fkey"
            columns: ["winning_payment_attempt_id"]
            isOneToOne: true
            referencedRelation: "ap_payment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_search_services_winning_payment_attempt_id_fkey"
            columns: ["winning_payment_attempt_id"]
            isOneToOne: true
            referencedRelation: "ap_payment_refund_aggregates"
            referencedColumns: ["payment_attempt_id"]
          },
        ]
      }
      ap_sensitive_payloads: {
        Row: {
          authentication_tag: string
          ciphertext: string
          content_sha256: string
          created_at: string
          customer_id: string | null
          draft_id: string | null
          encrypted_data_key: string
          encryption_algorithm: string
          encryption_context_hash: string
          id: string
          kms_key_identity: string
          kms_key_version: string
          nonce: string
          retention_due_at: string | null
          retention_state: Database["public"]["Enums"]["ap_retention_state"]
        }
        Insert: {
          authentication_tag: string
          ciphertext: string
          content_sha256: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          encrypted_data_key: string
          encryption_algorithm: string
          encryption_context_hash: string
          id?: string
          kms_key_identity: string
          kms_key_version: string
          nonce: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
        }
        Update: {
          authentication_tag?: string
          ciphertext?: string
          content_sha256?: string
          created_at?: string
          customer_id?: string | null
          draft_id?: string | null
          encrypted_data_key?: string
          encryption_algorithm?: string
          encryption_context_hash?: string
          id?: string
          kms_key_identity?: string
          kms_key_version?: string
          nonce?: string
          retention_due_at?: string | null
          retention_state?: Database["public"]["Enums"]["ap_retention_state"]
        }
        Relationships: [
          {
            foreignKeyName: "ap_sensitive_payloads_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_sensitive_payloads_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_targeted_intake_questions: {
        Row: {
          answer_sensitive_payload_id: string | null
          answer_sha256: string | null
          answered_at: string | null
          created_at: string
          draft_id: string
          id: string
          job_snapshot_id: string
          prompt_version: string
          question_kind: string
          stable_criterion_id: string
          state: string
        }
        Insert: {
          answer_sensitive_payload_id?: string | null
          answer_sha256?: string | null
          answered_at?: string | null
          created_at?: string
          draft_id: string
          id?: string
          job_snapshot_id: string
          prompt_version: string
          question_kind: string
          stable_criterion_id: string
          state?: string
        }
        Update: {
          answer_sensitive_payload_id?: string | null
          answer_sha256?: string | null
          answered_at?: string | null
          created_at?: string
          draft_id?: string
          id?: string
          job_snapshot_id?: string
          prompt_version?: string
          question_kind?: string
          stable_criterion_id?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "ap_targeted_intake_questions_answer_sensitive_payload_id_fkey"
            columns: ["answer_sensitive_payload_id"]
            isOneToOne: false
            referencedRelation: "ap_sensitive_payloads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_targeted_intake_questions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ap_anonymous_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ap_targeted_intake_questions_job_snapshot_id_fkey"
            columns: ["job_snapshot_id"]
            isOneToOne: false
            referencedRelation: "ap_job_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limits: {
        Row: {
          key_hash: string
          request_count: number
          scope: string
          window_started_at: string
        }
        Insert: {
          key_hash: string
          request_count?: number
          scope: string
          window_started_at?: string
        }
        Update: {
          key_hash?: string
          request_count?: number
          scope?: string
          window_started_at?: string
        }
        Relationships: []
      }
      apply_pack_cart_items: {
        Row: {
          cart_id: string
          created_at: string
          do_not_mention_notes: string | null
          emphasis_notes: string | null
          id: string
          job_match_id: string
          unit_price_cents: number
        }
        Insert: {
          cart_id: string
          created_at?: string
          do_not_mention_notes?: string | null
          emphasis_notes?: string | null
          id?: string
          job_match_id: string
          unit_price_cents?: number
        }
        Update: {
          cart_id?: string
          created_at?: string
          do_not_mention_notes?: string | null
          emphasis_notes?: string | null
          id?: string
          job_match_id?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "apply_pack_cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_cart_items_job_match_id_fkey"
            columns: ["job_match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      apply_pack_carts: {
        Row: {
          capacity_reservation_id: string | null
          created_at: string
          customer_id: string
          customer_update_notes: string | null
          delivery_deadline: string | null
          expires_at: string | null
          id: string
          item_count: number
          outcomes_acknowledged: boolean
          paid_at: string | null
          search_order_id: string
          selection_confirmed: boolean
          status: string
          stripe_checkout_session_id: string | null
          submission_boundary_acknowledged: boolean
          total_cents: number
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          capacity_reservation_id?: string | null
          created_at?: string
          customer_id: string
          customer_update_notes?: string | null
          delivery_deadline?: string | null
          expires_at?: string | null
          id?: string
          item_count: number
          outcomes_acknowledged: boolean
          paid_at?: string | null
          search_order_id: string
          selection_confirmed: boolean
          status?: string
          stripe_checkout_session_id?: string | null
          submission_boundary_acknowledged: boolean
          total_cents: number
          unit_price_cents?: number
          updated_at?: string
        }
        Update: {
          capacity_reservation_id?: string | null
          created_at?: string
          customer_id?: string
          customer_update_notes?: string | null
          delivery_deadline?: string | null
          expires_at?: string | null
          id?: string
          item_count?: number
          outcomes_acknowledged?: boolean
          paid_at?: string | null
          search_order_id?: string
          selection_confirmed?: boolean
          status?: string
          stripe_checkout_session_id?: string | null
          submission_boundary_acknowledged?: boolean
          total_cents?: number
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "apply_pack_carts_capacity_reservation_id_fkey"
            columns: ["capacity_reservation_id"]
            isOneToOne: false
            referencedRelation: "capacity_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_carts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_carts_search_order_id_fkey"
            columns: ["search_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_carts_search_order_id_fkey"
            columns: ["search_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      apply_pack_delivery_revisions: {
        Row: {
          apply_pack_item_id: string
          correction_request_id: string | null
          cover_letter_path: string
          created_at: string
          delivered_at: string
          id: string
          resume_path: string
          review_note: string | null
          reviewed_by: string | null
          version: number
        }
        Insert: {
          apply_pack_item_id: string
          correction_request_id?: string | null
          cover_letter_path: string
          created_at?: string
          delivered_at: string
          id?: string
          resume_path: string
          review_note?: string | null
          reviewed_by?: string | null
          version: number
        }
        Update: {
          apply_pack_item_id?: string
          correction_request_id?: string | null
          cover_letter_path?: string
          created_at?: string
          delivered_at?: string
          id?: string
          resume_path?: string
          review_note?: string | null
          reviewed_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "apply_pack_delivery_revisions_apply_pack_item_id_fkey"
            columns: ["apply_pack_item_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_delivery_revisions_correction_request_id_fkey"
            columns: ["correction_request_id"]
            isOneToOne: true
            referencedRelation: "correction_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_delivery_revisions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      apply_pack_items: {
        Row: {
          cover_letter_path: string | null
          customer_update_notes: string | null
          delivered_at: string | null
          delivery_claimed_at: string | null
          do_not_mention_notes: string | null
          draft_cover_letter_path: string | null
          draft_generated_at: string | null
          draft_generator_version: string | null
          draft_resume_path: string | null
          emphasis_notes: string | null
          human_review_checklist: Json
          human_reviewed_at: string | null
          human_reviewed_by: string | null
          id: string
          job_match_id: string
          order_id: string
          resume_path: string | null
          status: string
        }
        Insert: {
          cover_letter_path?: string | null
          customer_update_notes?: string | null
          delivered_at?: string | null
          delivery_claimed_at?: string | null
          do_not_mention_notes?: string | null
          draft_cover_letter_path?: string | null
          draft_generated_at?: string | null
          draft_generator_version?: string | null
          draft_resume_path?: string | null
          emphasis_notes?: string | null
          human_review_checklist?: Json
          human_reviewed_at?: string | null
          human_reviewed_by?: string | null
          id?: string
          job_match_id: string
          order_id: string
          resume_path?: string | null
          status?: string
        }
        Update: {
          cover_letter_path?: string | null
          customer_update_notes?: string | null
          delivered_at?: string | null
          delivery_claimed_at?: string | null
          do_not_mention_notes?: string | null
          draft_cover_letter_path?: string | null
          draft_generated_at?: string | null
          draft_generator_version?: string | null
          draft_resume_path?: string | null
          emphasis_notes?: string | null
          human_review_checklist?: Json
          human_reviewed_at?: string | null
          human_reviewed_by?: string | null
          id?: string
          job_match_id?: string
          order_id?: string
          resume_path?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "apply_pack_items_human_reviewed_by_fkey"
            columns: ["human_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_items_job_match_id_fkey"
            columns: ["job_match_id"]
            isOneToOne: true
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apply_pack_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string
          entity_type: string
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id: string
          entity_type: string
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string
          entity_type?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_limits: {
        Row: {
          enabled: boolean
          kind: Database["public"]["Enums"]["product_kind"]
          units_per_24h: number
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          kind: Database["public"]["Enums"]["product_kind"]
          units_per_24h: number
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          kind?: Database["public"]["Enums"]["product_kind"]
          units_per_24h?: number
          updated_at?: string
        }
        Relationships: []
      }
      capacity_reservations: {
        Row: {
          confirmed_at: string | null
          customer_id: string
          expires_at: string
          id: string
          kind: Database["public"]["Enums"]["product_kind"]
          request_key: string
          reserved_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          units: number
        }
        Insert: {
          confirmed_at?: string | null
          customer_id: string
          expires_at: string
          id?: string
          kind: Database["public"]["Enums"]["product_kind"]
          request_key: string
          reserved_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          units: number
        }
        Update: {
          confirmed_at?: string | null
          customer_id?: string
          expires_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["product_kind"]
          request_key?: string
          reserved_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "capacity_reservations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conflict_reviews: {
        Row: {
          created_at: string
          criteria_version: number
          customer_id: string
          explanation: string
          id: string
          job_match_id: string
          resolution: string | null
          resolved_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          criteria_version: number
          customer_id: string
          explanation: string
          id?: string
          job_match_id: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          criteria_version?: number
          customer_id?: string
          explanation?: string
          id?: string
          job_match_id?: string
          resolution?: string | null
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "conflict_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conflict_reviews_job_match_id_fkey"
            columns: ["job_match_id"]
            isOneToOne: false
            referencedRelation: "job_matches"
            referencedColumns: ["id"]
          },
        ]
      }
      correction_requests: {
        Row: {
          admin_notes: string | null
          apply_pack_item_id: string
          correction_text: string
          created_at: string
          customer_id: string
          id: string
          resolved_at: string | null
          status: string
        }
        Insert: {
          admin_notes?: string | null
          apply_pack_item_id: string
          correction_text: string
          created_at?: string
          customer_id: string
          id?: string
          resolved_at?: string | null
          status?: string
        }
        Update: {
          admin_notes?: string | null
          apply_pack_item_id?: string
          correction_text?: string
          created_at?: string
          customer_id?: string
          id?: string
          resolved_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "correction_requests_apply_pack_item_id_fkey"
            columns: ["apply_pack_item_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "correction_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      criteria_versions: {
        Row: {
          approved_at: string
          approved_by: string
          id: string
          intake_id: string
          snapshot: Json
          version: number
        }
        Insert: {
          approved_at?: string
          approved_by: string
          id?: string
          intake_id: string
          snapshot: Json
          version: number
        }
        Update: {
          approved_at?: string
          approved_by?: string
          id?: string
          intake_id?: string
          snapshot?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "criteria_versions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "criteria_versions_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          apply_pack_cart_id: string | null
          attempt_count: number
          created_at: string
          id: string
          idempotency_key: string
          last_attempt_at: string | null
          last_error_code: string | null
          order_id: string | null
          provider_message_id: string | null
          recipient: string
          status: string
          template: string
          updated_at: string
        }
        Insert: {
          apply_pack_cart_id?: string | null
          attempt_count?: number
          created_at?: string
          id?: string
          idempotency_key: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          order_id?: string | null
          provider_message_id?: string | null
          recipient: string
          status: string
          template: string
          updated_at?: string
        }
        Update: {
          apply_pack_cart_id?: string | null
          attempt_count?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          last_attempt_at?: string | null
          last_error_code?: string | null
          order_id?: string | null
          provider_message_id?: string | null
          recipient?: string
          status?: string
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_events_apply_pack_cart_id_fkey"
            columns: ["apply_pack_cart_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_aliases: {
        Row: {
          alias_display_name: string
          alias_normalized: string
          canonical_employer_id: string
          created_at: string
          status: string
        }
        Insert: {
          alias_display_name: string
          alias_normalized: string
          canonical_employer_id: string
          created_at?: string
          status?: string
        }
        Update: {
          alias_display_name?: string
          alias_normalized?: string
          canonical_employer_id?: string
          created_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_aliases_canonical_employer_id_fkey"
            columns: ["canonical_employer_id"]
            isOneToOne: false
            referencedRelation: "employers"
            referencedColumns: ["id"]
          },
        ]
      }
      employers: {
        Row: {
          aliases: string[]
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          source_category: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          display_name: string
          id: string
          is_active?: boolean
          source_category: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          source_category?: string
          updated_at?: string
        }
        Relationships: []
      }
      intake_answers: {
        Row: {
          answers: Json
          created_at: string
          customer_id: string
          intake_id: string
          updated_at: string
        }
        Insert: {
          answers: Json
          created_at?: string
          customer_id: string
          intake_id: string
          updated_at?: string
        }
        Update: {
          answers?: Json
          created_at?: string
          customer_id?: string
          intake_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_answers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_answers_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: true
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_drafts: {
        Row: {
          answers: Json
          cover_letter_document: Json | null
          created_at: string
          current_step: number
          customer_id: string
          email: string
          expires_at: string
          id: string
          resume_document: Json | null
          updated_at: string
        }
        Insert: {
          answers?: Json
          cover_letter_document?: Json | null
          created_at?: string
          current_step?: number
          customer_id: string
          email: string
          expires_at?: string
          id?: string
          resume_document?: Json | null
          updated_at?: string
        }
        Update: {
          answers?: Json
          cover_letter_document?: Json | null
          created_at?: string
          current_step?: number
          customer_id?: string
          email?: string
          expires_at?: string
          id?: string
          resume_document?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_drafts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      intakes: {
        Row: {
          cover_letter_path: string | null
          created_at: string
          criteria_approved_at: string | null
          criteria_version: number
          customer_id: string
          dealbreakers: string
          direction: string
          email: string
          experience_summary: string
          id: string
          location_preference: string
          minimum_salary: string | null
          notes: string | null
          priorities: Json
          resume_path: string
          schedule_preference: string
          source_deleted_at: string | null
          source_retention_due_at: string | null
          source_scan_provider_ref: string | null
          source_scan_status: string
          source_scanned_at: string | null
          status: Database["public"]["Enums"]["intake_status"]
          updated_at: string
        }
        Insert: {
          cover_letter_path?: string | null
          created_at?: string
          criteria_approved_at?: string | null
          criteria_version?: number
          customer_id: string
          dealbreakers: string
          direction: string
          email: string
          experience_summary: string
          id?: string
          location_preference: string
          minimum_salary?: string | null
          notes?: string | null
          priorities?: Json
          resume_path: string
          schedule_preference: string
          source_deleted_at?: string | null
          source_retention_due_at?: string | null
          source_scan_provider_ref?: string | null
          source_scan_status?: string
          source_scanned_at?: string | null
          status?: Database["public"]["Enums"]["intake_status"]
          updated_at?: string
        }
        Update: {
          cover_letter_path?: string | null
          created_at?: string
          criteria_approved_at?: string | null
          criteria_version?: number
          customer_id?: string
          dealbreakers?: string
          direction?: string
          email?: string
          experience_summary?: string
          id?: string
          location_preference?: string
          minimum_salary?: string | null
          notes?: string | null
          priorities?: Json
          resume_path?: string
          schedule_preference?: string
          source_deleted_at?: string | null
          source_retention_due_at?: string | null
          source_scan_provider_ref?: string | null
          source_scan_status?: string
          source_scanned_at?: string | null
          status?: Database["public"]["Enums"]["intake_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intakes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_deduplication_reviews: {
        Row: {
          candidate_payload: Json
          created_at: string
          existing_job_id: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          similarity: number
          status: string
        }
        Insert: {
          candidate_payload: Json
          created_at?: string
          existing_job_id: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity: number
          status?: string
        }
        Update: {
          candidate_payload?: Json
          created_at?: string
          existing_job_id?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_deduplication_reviews_existing_job_id_fkey"
            columns: ["existing_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_deduplication_reviews_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_match_packet_artifacts: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          checksum_sha256: string | null
          content_identity: string
          content_revision: number
          content_snapshot: Json
          content_snapshot_sha256: string
          created_at: string
          customer_filename: string | null
          customer_id: string
          failure_code: string | null
          id: string
          order_id: string
          pdfcn_upstream_commit: string
          render_attempts: number
          render_generation: string
          render_lease_until: string | null
          rendered_at: string | null
          renderer_version: string
          requested_by: string
          retention_due_at: string
          schema_version: string
          size_bytes: number | null
          status: Database["public"]["Enums"]["job_match_packet_status"]
          storage_bucket: string | null
          storage_path: string | null
          supersedes_id: string | null
          takumi_version: string
          template_version: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          checksum_sha256?: string | null
          content_identity: string
          content_revision: number
          content_snapshot: Json
          content_snapshot_sha256: string
          created_at?: string
          customer_filename?: string | null
          customer_id: string
          failure_code?: string | null
          id?: string
          order_id: string
          pdfcn_upstream_commit: string
          render_attempts?: number
          render_generation?: string
          render_lease_until?: string | null
          rendered_at?: string | null
          renderer_version: string
          requested_by: string
          retention_due_at: string
          schema_version: string
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["job_match_packet_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          supersedes_id?: string | null
          takumi_version: string
          template_version: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          checksum_sha256?: string | null
          content_identity?: string
          content_revision?: number
          content_snapshot?: Json
          content_snapshot_sha256?: string
          created_at?: string
          customer_filename?: string | null
          customer_id?: string
          failure_code?: string | null
          id?: string
          order_id?: string
          pdfcn_upstream_commit?: string
          render_attempts?: number
          render_generation?: string
          render_lease_until?: string | null
          rendered_at?: string | null
          renderer_version?: string
          requested_by?: string
          retention_due_at?: string
          schema_version?: string
          size_bytes?: number | null
          status?: Database["public"]["Enums"]["job_match_packet_status"]
          storage_bucket?: string | null
          storage_path?: string | null
          supersedes_id?: string | null
          takumi_version?: string
          template_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_match_packet_artifacts_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_packet_artifacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_packet_artifacts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_packet_artifacts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_packet_artifacts_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_match_packet_artifacts_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "job_match_packet_artifacts"
            referencedColumns: ["id"]
          },
        ]
      }
      job_matches: {
        Row: {
          apply_pack_cart_id: string | null
          apply_pack_claim_expires_at: string | null
          concerns: Json
          core_responsibilities: Json
          created_at: string
          criteria_checks: Json
          customer_decision: string | null
          delivered_at: string | null
          fit_summary: string
          hidden_job_functions: Json
          id: string
          job_id: string
          match_category: string | null
          matching_experience: Json
          packet_strong_connections: Json | null
          packet_things_to_consider: Json | null
          packet_unknown_warnings: Json | null
          position: number
          primary_outcome: string | null
          ranking_reason_codes: Json
          ranking_score: number | null
          requirements: Json
          reviewed_at: string | null
          reviewed_by: string | null
          search_order_id: string
        }
        Insert: {
          apply_pack_cart_id?: string | null
          apply_pack_claim_expires_at?: string | null
          concerns?: Json
          core_responsibilities?: Json
          created_at?: string
          criteria_checks?: Json
          customer_decision?: string | null
          delivered_at?: string | null
          fit_summary: string
          hidden_job_functions?: Json
          id?: string
          job_id: string
          match_category?: string | null
          matching_experience?: Json
          packet_strong_connections?: Json | null
          packet_things_to_consider?: Json | null
          packet_unknown_warnings?: Json | null
          position: number
          primary_outcome?: string | null
          ranking_reason_codes?: Json
          ranking_score?: number | null
          requirements?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_order_id: string
        }
        Update: {
          apply_pack_cart_id?: string | null
          apply_pack_claim_expires_at?: string | null
          concerns?: Json
          core_responsibilities?: Json
          created_at?: string
          criteria_checks?: Json
          customer_decision?: string | null
          delivered_at?: string | null
          fit_summary?: string
          hidden_job_functions?: Json
          id?: string
          job_id?: string
          match_category?: string | null
          matching_experience?: Json
          packet_strong_connections?: Json | null
          packet_things_to_consider?: Json | null
          packet_unknown_warnings?: Json | null
          position?: number
          primary_outcome?: string | null
          ranking_reason_codes?: Json
          ranking_score?: number | null
          requirements?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_matches_apply_pack_cart_id_fkey"
            columns: ["apply_pack_cart_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_matches_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_matches_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_matches_search_order_id_fkey"
            columns: ["search_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_matches_search_order_id_fkey"
            columns: ["search_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      job_source_exclusions: {
        Row: {
          created_at: string
          exclusion_status: string
          normalized_name: string
          reason: string
        }
        Insert: {
          created_at?: string
          exclusion_status: string
          normalized_name: string
          reason: string
        }
        Update: {
          created_at?: string
          exclusion_status?: string
          normalized_name?: string
          reason?: string
        }
        Relationships: []
      }
      job_source_references: {
        Row: {
          external_job_id: string | null
          first_seen_at: string
          id: string
          is_active: boolean
          is_direct_employer: boolean
          is_official: boolean
          job_id: string
          last_verified_at: string
          normalized_source_url: string | null
          official_application_url: string | null
          source_id: string
          source_job_url: string | null
          source_name: string
        }
        Insert: {
          external_job_id?: string | null
          first_seen_at?: string
          id?: string
          is_active?: boolean
          is_direct_employer?: boolean
          is_official?: boolean
          job_id: string
          last_verified_at?: string
          normalized_source_url?: string | null
          official_application_url?: string | null
          source_id: string
          source_job_url?: string | null
          source_name: string
        }
        Update: {
          external_job_id?: string | null
          first_seen_at?: string
          id?: string
          is_active?: boolean
          is_direct_employer?: boolean
          is_official?: boolean
          job_id?: string
          last_verified_at?: string
          normalized_source_url?: string | null
          official_application_url?: string | null
          source_id?: string
          source_job_url?: string | null
          source_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_source_references_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_source_references_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      job_source_runs: {
        Row: {
          accepted_count: number
          completed_at: string | null
          error_code: string | null
          error_message: string | null
          fetched_count: number
          id: string
          rejected_count: number
          source_id: string
          started_at: string
          status: string
        }
        Insert: {
          accepted_count?: number
          completed_at?: string | null
          error_code?: string | null
          error_message?: string | null
          fetched_count?: number
          id?: string
          rejected_count?: number
          source_id: string
          started_at?: string
          status: string
        }
        Update: {
          accepted_count?: number
          completed_at?: string | null
          error_code?: string | null
          error_message?: string | null
          fetched_count?: number
          id?: string
          rejected_count?: number
          source_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_source_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          adapter_key: string | null
          adapter_kind: string
          alternate_official_urls: string[]
          automation_status: string
          canonical_employer_id: string | null
          created_at: string
          default_benefits_status: string | null
          default_employment_type: string | null
          default_w2_or_contractor: string | null
          health_status: string
          id: string
          is_active: boolean
          is_direct_employer: boolean
          is_official: boolean
          last_health_checked_at: string | null
          last_successful_sync_at: string | null
          notes: string | null
          official_url: string | null
          priority: number
          source_category: string
          source_name: string
          updated_at: string
        }
        Insert: {
          adapter_key?: string | null
          adapter_kind: string
          alternate_official_urls?: string[]
          automation_status: string
          canonical_employer_id?: string | null
          created_at?: string
          default_benefits_status?: string | null
          default_employment_type?: string | null
          default_w2_or_contractor?: string | null
          health_status?: string
          id: string
          is_active?: boolean
          is_direct_employer: boolean
          is_official: boolean
          last_health_checked_at?: string | null
          last_successful_sync_at?: string | null
          notes?: string | null
          official_url?: string | null
          priority?: number
          source_category: string
          source_name: string
          updated_at?: string
        }
        Update: {
          adapter_key?: string | null
          adapter_kind?: string
          alternate_official_urls?: string[]
          automation_status?: string
          canonical_employer_id?: string | null
          created_at?: string
          default_benefits_status?: string | null
          default_employment_type?: string | null
          default_w2_or_contractor?: string | null
          health_status?: string
          id?: string
          is_active?: boolean
          is_direct_employer?: boolean
          is_official?: boolean
          last_health_checked_at?: string | null
          last_successful_sync_at?: string | null
          notes?: string | null
          official_url?: string | null
          priority?: number
          source_category?: string
          source_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_sources_canonical_employer_id_fkey"
            columns: ["canonical_employer_id"]
            isOneToOne: false
            referencedRelation: "employers"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          applicant_cost: number | null
          benefits_status: string
          canonical_employer_id: string | null
          checked_at: string
          closing_at: string | null
          commission_flag: boolean
          company: string
          content_hash: string | null
          created_at: string
          deduplication_key: string | null
          degree_required: boolean | null
          department: string | null
          description: string | null
          eligible_countries: string[] | null
          eligible_states: string[] | null
          employer_aliases: string[]
          employer_display_name: string | null
          employment_type: string
          equipment_cost_responsibility: string
          equipment_requirement: string | null
          experience_level: string
          external_job_id: string | null
          high_volume_contact_center_flag: boolean
          id: string
          is_active: boolean
          is_direct_employer_source: boolean
          is_official_source: boolean
          language_requirements: string[] | null
          last_verified_at: string | null
          listing_status: string
          location_text: string | null
          marketing_flag: boolean
          normalized_source_url: string | null
          normalized_title: string | null
          official_application_url: string | null
          pay_model: string
          pay_period: string | null
          phone_intensity: string
          posted_at: string | null
          raw_title: string | null
          rejection_reason: string | null
          remote_scope: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          salary_currency: string | null
          salary_max: number | null
          salary_min: number | null
          salary_text: string | null
          sales_flag: boolean
          schedule_type: string | null
          source_category: string | null
          source_freshness_status: string
          source_id: string | null
          source_job_url: string | null
          source_name: string | null
          source_url: string
          timezone_requirement: string | null
          title: string
          w2_or_contractor: string
          work_mode: string
        }
        Insert: {
          applicant_cost?: number | null
          benefits_status?: string
          canonical_employer_id?: string | null
          checked_at: string
          closing_at?: string | null
          commission_flag?: boolean
          company: string
          content_hash?: string | null
          created_at?: string
          deduplication_key?: string | null
          degree_required?: boolean | null
          department?: string | null
          description?: string | null
          eligible_countries?: string[] | null
          eligible_states?: string[] | null
          employer_aliases?: string[]
          employer_display_name?: string | null
          employment_type?: string
          equipment_cost_responsibility?: string
          equipment_requirement?: string | null
          experience_level?: string
          external_job_id?: string | null
          high_volume_contact_center_flag?: boolean
          id?: string
          is_active?: boolean
          is_direct_employer_source?: boolean
          is_official_source?: boolean
          language_requirements?: string[] | null
          last_verified_at?: string | null
          listing_status?: string
          location_text?: string | null
          marketing_flag?: boolean
          normalized_source_url?: string | null
          normalized_title?: string | null
          official_application_url?: string | null
          pay_model?: string
          pay_period?: string | null
          phone_intensity?: string
          posted_at?: string | null
          raw_title?: string | null
          rejection_reason?: string | null
          remote_scope?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_text?: string | null
          sales_flag?: boolean
          schedule_type?: string | null
          source_category?: string | null
          source_freshness_status?: string
          source_id?: string | null
          source_job_url?: string | null
          source_name?: string | null
          source_url: string
          timezone_requirement?: string | null
          title: string
          w2_or_contractor?: string
          work_mode?: string
        }
        Update: {
          applicant_cost?: number | null
          benefits_status?: string
          canonical_employer_id?: string | null
          checked_at?: string
          closing_at?: string | null
          commission_flag?: boolean
          company?: string
          content_hash?: string | null
          created_at?: string
          deduplication_key?: string | null
          degree_required?: boolean | null
          department?: string | null
          description?: string | null
          eligible_countries?: string[] | null
          eligible_states?: string[] | null
          employer_aliases?: string[]
          employer_display_name?: string | null
          employment_type?: string
          equipment_cost_responsibility?: string
          equipment_requirement?: string | null
          experience_level?: string
          external_job_id?: string | null
          high_volume_contact_center_flag?: boolean
          id?: string
          is_active?: boolean
          is_direct_employer_source?: boolean
          is_official_source?: boolean
          language_requirements?: string[] | null
          last_verified_at?: string | null
          listing_status?: string
          location_text?: string | null
          marketing_flag?: boolean
          normalized_source_url?: string | null
          normalized_title?: string | null
          official_application_url?: string | null
          pay_model?: string
          pay_period?: string | null
          phone_intensity?: string
          posted_at?: string | null
          raw_title?: string | null
          rejection_reason?: string | null
          remote_scope?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          salary_currency?: string | null
          salary_max?: number | null
          salary_min?: number | null
          salary_text?: string | null
          sales_flag?: boolean
          schedule_type?: string | null
          source_category?: string | null
          source_freshness_status?: string
          source_id?: string | null
          source_job_url?: string | null
          source_name?: string | null
          source_url?: string
          timezone_requirement?: string | null
          title?: string
          w2_or_contractor?: string
          work_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_canonical_employer_id_fkey"
            columns: ["canonical_employer_id"]
            isOneToOne: false
            referencedRelation: "employers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "job_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_cents: number
          capacity_reservation_id: string | null
          checkout_expires_at: string | null
          created_at: string
          customer_id: string
          delivered_at: string | null
          delivery_deadline: string | null
          human_review_checklist: Json
          human_reviewed_at: string | null
          human_reviewed_by: string | null
          id: string
          intake_id: string | null
          job_match_packet_artifact_id: string | null
          job_match_packet_content_revision: number
          paid_at: string | null
          parent_order_id: string | null
          processing_previous_status:
            | Database["public"]["Enums"]["order_status"]
            | null
          processing_started_at: string | null
          product_kind: Database["public"]["Enums"]["product_kind"]
          source_cart_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          capacity_reservation_id?: string | null
          checkout_expires_at?: string | null
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          delivery_deadline?: string | null
          human_review_checklist?: Json
          human_reviewed_at?: string | null
          human_reviewed_by?: string | null
          id?: string
          intake_id?: string | null
          job_match_packet_artifact_id?: string | null
          job_match_packet_content_revision?: number
          paid_at?: string | null
          parent_order_id?: string | null
          processing_previous_status?:
            | Database["public"]["Enums"]["order_status"]
            | null
          processing_started_at?: string | null
          product_kind: Database["public"]["Enums"]["product_kind"]
          source_cart_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          capacity_reservation_id?: string | null
          checkout_expires_at?: string | null
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          delivery_deadline?: string | null
          human_review_checklist?: Json
          human_reviewed_at?: string | null
          human_reviewed_by?: string | null
          id?: string
          intake_id?: string | null
          job_match_packet_artifact_id?: string | null
          job_match_packet_content_revision?: number
          paid_at?: string | null
          parent_order_id?: string | null
          processing_previous_status?:
            | Database["public"]["Enums"]["order_status"]
            | null
          processing_started_at?: string | null
          product_kind?: Database["public"]["Enums"]["product_kind"]
          source_cart_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_capacity_reservation_id_fkey"
            columns: ["capacity_reservation_id"]
            isOneToOne: false
            referencedRelation: "capacity_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_human_reviewed_by_fkey"
            columns: ["human_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_job_match_packet_artifact_id_fkey"
            columns: ["job_match_packet_artifact_id"]
            isOneToOne: false
            referencedRelation: "job_match_packet_artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_source_cart_fk"
            columns: ["source_cart_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          apply_pack_cart_id: string | null
          created_at: string
          id: string
          order_id: string | null
          provider: string
          provider_checkout_id: string
          provider_payment_id: string
          status: string
        }
        Insert: {
          amount_cents: number
          apply_pack_cart_id?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          provider: string
          provider_checkout_id: string
          provider_payment_id: string
          status: string
        }
        Update: {
          amount_cents?: number
          apply_pack_cart_id?: string | null
          created_at?: string
          id?: string
          order_id?: string | null
          provider?: string
          provider_checkout_id?: string
          provider_payment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_apply_pack_cart_id_fkey"
            columns: ["apply_pack_cart_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          role: Database["public"]["Enums"]["profile_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          role?: Database["public"]["Enums"]["profile_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["profile_role"]
          updated_at?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          completed_at: string | null
          created_at: string
          customer_visible_reason: string
          id: string
          initiated_by: string
          last_error_code: string | null
          order_id: string
          payment_id: string
          previous_order_status:
            | Database["public"]["Enums"]["order_status"]
            | null
          provider_refund_id: string | null
          reason_code: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          completed_at?: string | null
          created_at?: string
          customer_visible_reason: string
          id?: string
          initiated_by: string
          last_error_code?: string | null
          order_id: string
          payment_id: string
          previous_order_status?:
            | Database["public"]["Enums"]["order_status"]
            | null
          provider_refund_id?: string | null
          reason_code: string
          status: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          completed_at?: string | null
          created_at?: string
          customer_visible_reason?: string
          id?: string
          initiated_by?: string
          last_error_code?: string | null
          order_id?: string
          payment_id?: string
          previous_order_status?:
            | Database["public"]["Enums"]["order_status"]
            | null
          provider_refund_id?: string | null
          reason_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      search_candidates: {
        Row: {
          concerns: Json
          created_at: string
          fit_summary: string
          id: string
          job_id: string
          ranking_reason_codes: Json
          ranking_score: number
          requirements: Json
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          search_order_id: string
        }
        Insert: {
          concerns?: Json
          created_at?: string
          fit_summary: string
          id?: string
          job_id: string
          ranking_reason_codes?: Json
          ranking_score: number
          requirements?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_order_id: string
        }
        Update: {
          concerns?: Json
          created_at?: string
          fit_summary?: string
          id?: string
          job_id?: string
          ranking_reason_codes?: Json
          ranking_score?: number
          requirements?: Json
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_candidates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_candidates_search_order_id_fkey"
            columns: ["search_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "search_candidates_search_order_id_fkey"
            columns: ["search_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      source_documents: {
        Row: {
          claimed_mime_type: string
          created_at: string
          customer_id: string
          deleted_at: string | null
          document_kind: string
          id: string
          intake_id: string
          scan_attempts: number
          scan_claimed_at: string | null
          scan_error_code: string | null
          scan_provider: string | null
          scan_provider_reference: string | null
          scan_status: string
          scanned_at: string | null
          sha256: string
          size_bytes: number
          storage_path: string
          updated_at: string
          verified_mime_type: string
        }
        Insert: {
          claimed_mime_type: string
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          document_kind: string
          id?: string
          intake_id: string
          scan_attempts?: number
          scan_claimed_at?: string | null
          scan_error_code?: string | null
          scan_provider?: string | null
          scan_provider_reference?: string | null
          scan_status?: string
          scanned_at?: string | null
          sha256: string
          size_bytes: number
          storage_path: string
          updated_at?: string
          verified_mime_type: string
        }
        Update: {
          claimed_mime_type?: string
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          document_kind?: string
          id?: string
          intake_id?: string
          scan_attempts?: number
          scan_claimed_at?: string | null
          scan_error_code?: string | null
          scan_provider?: string | null
          scan_provider_reference?: string | null
          scan_status?: string
          scanned_at?: string | null
          sha256?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          verified_mime_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_documents_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_cleanup_queue: {
        Row: {
          attempts: number
          bucket: string
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          reason: string
          storage_path: string
        }
        Insert: {
          attempts?: number
          bucket: string
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          reason: string
          storage_path: string
        }
        Update: {
          attempts?: number
          bucket?: string
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          reason?: string
          storage_path?: string
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          error_message: string | null
          event_type: string
          id: string
          last_error_code: string | null
          processed_at: string | null
          processing_status: string
          provider: string
          provider_event_id: string
          received_at: string
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          last_error_code?: string | null
          processed_at?: string | null
          processing_status?: string
          provider: string
          provider_event_id: string
          received_at?: string
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          last_error_code?: string | null
          processed_at?: string | null
          processing_status?: string
          provider?: string
          provider_event_id?: string
          received_at?: string
        }
        Relationships: []
      }
      workflow_tasks: {
        Row: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          last_error_code: string | null
          locked_at: string | null
          not_before: string
          order_id: string
          reference_id: string
          status: string
          summary: Json
          task_kind: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error_code?: string | null
          locked_at?: string | null
          not_before?: string
          order_id: string
          reference_id: string
          status?: string
          summary?: Json
          task_kind: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error_code?: string | null
          locked_at?: string | null
          not_before?: string
          order_id?: string
          reference_id?: string
          status?: string
          summary?: Json
          task_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ap_legacy_order_compatibility: {
        Row: {
          amount_cents: number | null
          capacity_reservation_id: string | null
          checkout_expires_at: string | null
          corrected_fulfillment:
            | Database["public"]["Enums"]["ap_search_fulfillment"]
            | null
          corrected_payment_attempt_id: string | null
          corrected_search_service_id: string | null
          corrected_settlement:
            | Database["public"]["Enums"]["ap_payment_settlement"]
            | null
          created_at: string | null
          customer_id: string | null
          delivered_at: string | null
          delivery_deadline: string | null
          human_review_checklist: Json | null
          human_reviewed_at: string | null
          human_reviewed_by: string | null
          id: string | null
          intake_id: string | null
          paid_at: string | null
          parent_order_id: string | null
          processing_previous_status:
            | Database["public"]["Enums"]["order_status"]
            | null
          processing_started_at: string | null
          product_kind: Database["public"]["Enums"]["product_kind"] | null
          source_cart_id: string | null
          status: Database["public"]["Enums"]["order_status"] | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_capacity_reservation_id_fkey"
            columns: ["capacity_reservation_id"]
            isOneToOne: false
            referencedRelation: "capacity_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_human_reviewed_by_fkey"
            columns: ["human_reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_intake_id_fkey"
            columns: ["intake_id"]
            isOneToOne: false
            referencedRelation: "intakes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "ap_legacy_order_compatibility"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_parent_order_id_fkey"
            columns: ["parent_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_source_cart_fk"
            columns: ["source_cart_id"]
            isOneToOne: false
            referencedRelation: "apply_pack_carts"
            referencedColumns: ["id"]
          },
        ]
      }
      ap_payment_refund_aggregates: {
        Row: {
          fully_refunded: boolean | null
          payment_attempt_id: string | null
          refund_aggregate: string | null
          refunded_amount_cents: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      ap_accept_criteria_amendment: {
        Args: { p_amendment_id: string; p_child_snapshot_id: string }
        Returns: boolean
      }
      ap_activate_material_line_revision: {
        Args: { p_line_id: string; p_new_revision_id: string }
        Returns: boolean
      }
      ap_apply_document_pipeline_result: {
        Args: {
          p_document_id: string
          p_expected_version: number
          p_failure_code: string
          p_leak_status: string
          p_malware_status: string
          p_model_policy: string
          p_parse_status: string
          p_parser_identity: string
          p_parser_limits: Json
          p_reference_status: string
          p_state: Database["public"]["Enums"]["ap_document_processing_state"]
        }
        Returns: boolean
      }
      ap_can_access_customer: {
        Args: { p_customer_id: string }
        Returns: boolean
      }
      ap_capacity_available: { Args: { p_bucket_id: string }; Returns: number }
      ap_claim_material_entitlement: {
        Args: { p_entitlement_history_id: string }
        Returns: boolean
      }
      ap_claim_retention_cleanup: {
        Args: { p_limit?: number; p_owner: string }
        Returns: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string
          job_kind: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          reference_id: string
          run_at: string
          state: Database["public"]["Enums"]["ap_scheduled_job_state"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ap_scheduled_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ap_claim_scheduled_jobs: {
        Args: { p_limit?: number; p_owner: string }
        Returns: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string
          job_kind: string
          last_error_code: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          reference_id: string
          run_at: string
          state: Database["public"]["Enums"]["ap_scheduled_job_state"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ap_scheduled_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ap_commit_release: {
        Args: {
          p_active_due_at: string
          p_committed_at: string
          p_customer_id: string
          p_human_approved_by: string
          p_material_line_id: string
          p_members: Json
          p_order_id: string
          p_release_id: string
          p_release_kind: string
          p_version_bundle: Json
        }
        Returns: string
      }
      ap_confirm_reference_version: {
        Args: { p_customer_id: string; p_reference_version_id: string }
        Returns: boolean
      }
      ap_create_anonymous_draft: {
        Args: {
          p_draft_id: string
          p_expires_at: string
          p_secret_hash: string
        }
        Returns: {
          expires_at: string
          id: string
          state: Database["public"]["Enums"]["ap_draft_state"]
          version: number
        }[]
      }
      ap_create_reference_record: {
        Args: {
          p_customer_id: string
          p_encrypted_payload_id: string
          p_payload_schema_version: string
          p_payload_sha256: string
        }
        Returns: string
      }
      ap_finalize_four_step_intake: {
        Args: {
          p_content_sha256: string
          p_draft_id: string
          p_expected_version: number
          p_fact_reviews: Json
          p_secret_hash: string
          p_sensitive_payload_id: string
          p_snapshot: Json
          p_snapshot_id: string
        }
        Returns: {
          draft_version: number
          feasibility_request_id: string
          snapshot_id: string
        }[]
      }
      ap_grant_reference_permission: {
        Args: {
          p_customer_id: string
          p_delivered_release_id: string
          p_employer_snapshot: string
          p_exact_position_snapshot: string
          p_job_snapshot_hash: string
          p_job_snapshot_id: string
          p_permission_text_version: string
          p_reference_version_id: string
        }
        Returns: string
      }
      ap_increment_intake_event: {
        Args: { p_event: string; p_step: number }
        Returns: boolean
      }
      ap_invalidate_pre_activation_snapshot: {
        Args: {
          p_customer_id: string
          p_new_snapshot_id: string
          p_prior_snapshot_id: string
          p_reason: string
        }
        Returns: boolean
      }
      ap_lock_anonymous_draft_to_checkout: {
        Args: {
          p_checkout_attempt_id: string
          p_draft_id: string
          p_secret_hash: string
        }
        Returns: boolean
      }
      ap_read_anonymous_draft: {
        Args: { p_draft_id: string; p_secret_hash: string }
        Returns: {
          answers: Json
          current_step: number
          expires_at: string
          id: string
          state: Database["public"]["Enums"]["ap_draft_state"]
          version: number
        }[]
      }
      ap_read_four_step_draft: {
        Args: { p_draft_id: string; p_secret_hash: string }
        Returns: {
          answers: Json
          current_step: number
          expires_at: string
          finalized_snapshot_id: string
          id: string
          state: Database["public"]["Enums"]["ap_draft_state"]
          version: number
        }[]
      }
      ap_record_fact_presentation: {
        Args: {
          p_control_id: string
          p_draft_id: string
          p_expected_version: number
          p_fact_id: string
          p_secret_hash: string
        }
        Returns: boolean
      }
      ap_record_reference_staff_access: {
        Args: {
          p_purpose: string
          p_reference_record_id: string
          p_staff_id: string
        }
        Returns: number
      }
      ap_register_anonymous_document: {
        Args: {
          p_claimed_mime: string
          p_document_id: string
          p_draft_id: string
          p_expected_draft_version: number
          p_kind: Database["public"]["Enums"]["ap_document_kind"]
          p_name: string
          p_path: string
          p_secret_hash: string
          p_sha256: string
          p_size: number
          p_verified_mime: string
        }
        Returns: {
          document_id: string
          document_version: number
          draft_version: number
        }[]
      }
      ap_release_fully_refunded_entitlement: {
        Args: { p_entitlement_history_id: string }
        Returns: boolean
      }
      ap_release_unconsumed_capacity: {
        Args: { p_allocation_id: string; p_reason: string }
        Returns: boolean
      }
      ap_remove_anonymous_document: {
        Args: {
          p_draft_id: string
          p_expected_draft_version: number
          p_kind: Database["public"]["Enums"]["ap_document_kind"]
          p_secret_hash: string
        }
        Returns: {
          document_id: string
          draft_version: number
          storage_bucket: string
          storage_path: string
        }[]
      }
      ap_remove_reference: {
        Args: {
          p_customer_id: string
          p_reason_code: string
          p_reference_record_id: string
        }
        Returns: boolean
      }
      ap_replace_reference: {
        Args: {
          p_customer_id: string
          p_encrypted_payload_id: string
          p_payload_schema_version: string
          p_payload_sha256: string
          p_reference_record_id: string
        }
        Returns: string
      }
      ap_reserve_capacity: {
        Args: {
          p_customer_id: string
          p_draft_id?: string
          p_expires_at: string
          p_members?: Json
          p_request_key: string
          p_resource: Database["public"]["Enums"]["ap_capacity_resource"]
          p_units: number
        }
        Returns: string
      }
      ap_retry_anonymous_document: {
        Args: {
          p_draft_id: string
          p_expected_draft_version: number
          p_kind: Database["public"]["Enums"]["ap_document_kind"]
          p_secret_hash: string
        }
        Returns: {
          document_id: string
          draft_version: number
        }[]
      }
      ap_return_anonymous_draft_after_checkout: {
        Args: { p_draft_id: string; p_secret_hash: string }
        Returns: boolean
      }
      ap_revoke_reference_permission: {
        Args: {
          p_customer_id: string
          p_permission_id: string
          p_reason_code: string
        }
        Returns: boolean
      }
      ap_rotate_anonymous_draft_capability: {
        Args: {
          p_customer_id: string
          p_draft_id: string
          p_intake_id: string
          p_new_secret_hash: string
          p_secret_hash: string
        }
        Returns: boolean
      }
      ap_save_anonymous_draft: {
        Args: {
          p_answers: Json
          p_current_step: number
          p_draft_id: string
          p_expected_version: number
          p_secret_hash: string
        }
        Returns: {
          answers: Json
          current_step: number
          expires_at: string
          id: string
          state: Database["public"]["Enums"]["ap_draft_state"]
          version: number
        }[]
      }
      ap_save_four_step_draft: {
        Args: {
          p_answers: Json
          p_current_step: number
          p_draft_id: string
          p_expected_version: number
          p_secret_hash: string
        }
        Returns: {
          answers: Json
          current_step: number
          expires_at: string
          finalized_snapshot_id: string
          id: string
          state: Database["public"]["Enums"]["ap_draft_state"]
          version: number
        }[]
      }
      approve_job_match_packet_artifact: {
        Args: {
          p_actor_id: string
          p_approved_at: string
          p_artifact_id: string
          p_checksum_sha256: string
        }
        Returns: string
      }
      available_capacity: {
        Args: { p_kind: Database["public"]["Enums"]["product_kind"] }
        Returns: number
      }
      begin_order_refund: {
        Args: {
          p_actor_id: string
          p_customer_visible_reason: string
          p_order_id: string
          p_reason_code: string
        }
        Returns: {
          amount_cents: number
          payment_id: string
          provider_payment_id: string
          refund_id: string
        }[]
      }
      can_view_delivered_job: { Args: { p_job_id: string }; Returns: boolean }
      can_view_delivered_job_match: {
        Args: { p_match_id: string }
        Returns: boolean
      }
      claim_order_delivery: {
        Args: {
          p_kind: Database["public"]["Enums"]["product_kind"]
          p_order_id: string
        }
        Returns: boolean
      }
      claim_source_document_scans: {
        Args: { p_limit?: number }
        Returns: {
          claimed_mime_type: string
          created_at: string
          customer_id: string
          deleted_at: string | null
          document_kind: string
          id: string
          intake_id: string
          scan_attempts: number
          scan_claimed_at: string | null
          scan_error_code: string | null
          scan_provider: string | null
          scan_provider_reference: string | null
          scan_status: string
          scanned_at: string | null
          sha256: string
          size_bytes: number
          storage_path: string
          updated_at: string
          verified_mime_type: string
        }[]
        SetofOptions: {
          from: "*"
          to: "source_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_stripe_webhook: {
        Args: { p_provider_event_id: string }
        Returns: boolean
      }
      claim_workflow_tasks: {
        Args: { p_limit?: number }
        Returns: {
          attempt_count: number
          completed_at: string | null
          created_at: string
          id: string
          last_error_code: string | null
          locked_at: string | null
          not_before: string
          order_id: string
          reference_id: string
          status: string
          summary: Json
          task_kind: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workflow_tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_apply_pack_cart: {
        Args: {
          p_amount_cents: number
          p_cart_id: string
          p_checkout_id: string
          p_deadline: string
          p_paid_at: string
          p_payment_id: string
          p_reservation_id: string
        }
        Returns: Json
      }
      complete_apply_pack_item_delivery: {
        Args: {
          p_actor_id: string
          p_cover_letter_path: string
          p_delivered_at: string
          p_item_id: string
          p_resume_path: string
          p_review_checklist: Json
        }
        Returns: boolean
      }
      complete_correction_delivery: {
        Args: {
          p_actor_id: string
          p_cover_letter_path: string
          p_request_id: string
          p_resolution: string
          p_resolved_at: string
          p_resume_path: string
        }
        Returns: boolean
      }
      complete_order_delivery: {
        Args: { p_delivered_at: string; p_order_id: string }
        Returns: boolean
      }
      complete_paid_checkout: {
        Args: {
          p_amount_cents: number
          p_checkout_id: string
          p_deadline: string
          p_order_id: string
          p_paid_at: string
          p_payment_id: string
          p_reservation_id: string
        }
        Returns: Json
      }
      complete_search_delivery: {
        Args: {
          p_actor_id: string
          p_delivered_at: string
          p_matches: Json
          p_order_id: string
          p_retention_due_at: string
          p_review_checklist: Json
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: {
          p_key_hash: string
          p_limit: number
          p_scope: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      create_completed_intake: {
        Args: {
          p_answers: Json
          p_customer_id: string
          p_display_name: string
          p_documents: Json
          p_draft_id?: string
          p_email: string
          p_intake: Json
          p_intake_id: string
        }
        Returns: string
      }
      expire_job_match_packet_artifact: {
        Args: { p_artifact_id: string; p_expired_at: string }
        Returns: boolean
      }
      finalize_intake_source_retention: {
        Args: {
          p_deleted_at: string
          p_document_count: number
          p_intake_id: string
        }
        Returns: boolean
      }
      finalize_order_refund: {
        Args: {
          p_error_code?: string
          p_provider_refund_id: string
          p_provider_status: string
          p_refund_id: string
        }
        Returns: string
      }
      finalize_order_refund_by_provider: {
        Args: {
          p_error_code?: string
          p_provider_refund_id: string
          p_provider_status: string
        }
        Returns: string
      }
      is_admin: { Args: never; Returns: boolean }
      mark_stale_jobs_inactive: {
        Args: { p_stale_hours?: number }
        Returns: number
      }
      packet_claims_have_valid_provenance: {
        Args: {
          p_claims: Json
          p_customer_id: string
          p_group: string
          p_intake_id: string
          p_job_id: string
          p_match_id: string
          p_require_candidate: boolean
        }
        Returns: boolean
      }
      packet_unknown_warnings_are_complete: {
        Args: { p_job_id: string; p_warnings: Json }
        Returns: boolean
      }
      packet_value_is_unknown: { Args: { p_value: string }; Returns: boolean }
      prepare_apply_pack_checkout: {
        Args: {
          p_customer_id: string
          p_customer_update_notes: string
          p_item_notes: Json
          p_job_match_ids: string[]
          p_search_order_id: string
        }
        Returns: {
          cart_id: string
          created: boolean
          reservation_id: string
        }[]
      }
      prepare_search_checkout: {
        Args: { p_customer_id: string; p_intake_id: string }
        Returns: {
          created: boolean
          order_id: string
          reservation_id: string
        }[]
      }
      refresh_intake_scan_status: {
        Args: { p_intake_id: string }
        Returns: string
      }
      release_order_delivery: { Args: { p_order_id: string }; Returns: boolean }
      reserve_capacity: {
        Args: {
          p_customer_id: string
          p_kind: Database["public"]["Enums"]["product_kind"]
          p_request_key: string
          p_units: number
        }
        Returns: string
      }
      resolve_conflict_review: {
        Args: {
          p_actor_id: string
          p_replacement?: Json
          p_replacement_job_id?: string
          p_resolution: string
          p_resolved_at?: string
          p_review_id: string
          p_status: string
        }
        Returns: boolean
      }
      stage_search_delivery: {
        Args: {
          p_actor_id: string
          p_delivered_at: string
          p_matches: Json
          p_order_id: string
          p_retention_due_at: string
          p_review_checklist: Json
        }
        Returns: boolean
      }
    }
    Enums: {
      ap_adjustment_state:
        | "NONE"
        | "PROPOSED"
        | "ACCEPTED"
        | "DECLINED"
        | "EXPIRED"
      ap_application_readiness: "READY" | "NEEDS_CUSTOMER_ACTION" | "BLOCKED"
      ap_artifact_type: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET"
      ap_candidate_fact_source:
        | "DOCUMENT"
        | "CUSTOMER_ASSERTION"
        | "HUMAN_VERIFICATION"
      ap_capacity_debit: "NONE" | "HELD" | "SPENT" | "RETURNED"
      ap_capacity_lifecycle:
        | "NONE"
        | "RESERVED"
        | "CONSUMED"
        | "COMPLETED"
        | "SUPERSEDED"
        | "RELEASED"
        | "EXPIRED"
      ap_capacity_resource: "SEARCH" | "MATERIALS" | "REFERENCE_REGENERATION"
      ap_checkout_state:
        | "NONE"
        | "OPEN"
        | "CANCELED"
        | "EXPIRED"
        | "COMPLETED"
        | "FAILED"
      ap_command_state:
        | "CREATING"
        | "CREATED"
        | "APPLYING"
        | "APPLIED"
        | "COMPENSATING"
        | "COMPENSATED"
        | "FAILED"
      ap_criterion_result: "PASS" | "FAIL" | "UNKNOWN"
      ap_criterion_type:
        | "WORK_MODE"
        | "GEOGRAPHY"
        | "COMMUTE"
        | "EMPLOYMENT_TYPE"
        | "COMPENSATION"
        | "SCHEDULE"
        | "TRAVEL_PHYSICAL"
        | "DUTY_EXCLUSION"
        | "AUTHORIZATION_SPONSORSHIP"
        | "EDUCATION"
        | "CERTIFICATION_LICENSE"
        | "EXPERIENCE"
        | "RESPONSIBILITY"
        | "TOOL_CAPABILITY"
        | "BENEFIT"
        | "INDUSTRY_DOMAIN"
        | "CUSTOMER_TITLE_RESTRICTION"
        | "CUSTOM_EXCLUSION"
        | "LISTING_APPLICATION_PATH"
      ap_document_kind: "RESUME" | "PRIOR_COVER_LETTER"
      ap_document_processing_state:
        | "UPLOADED"
        | "QUARANTINED"
        | "SCANNING"
        | "EXTRACTING"
        | "READY"
        | "FAILED"
        | "SUPERSEDED"
      ap_draft_state:
        | "IN_PROGRESS"
        | "COMPLETE"
        | "LOCKED_TO_CHECKOUT"
        | "CONVERTED"
        | "EXPIRED"
      ap_eligibility_disposition:
        | "ELIGIBLE"
        | "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"
        | "INELIGIBLE"
        | "NEEDS_CANDIDATE_INPUT"
        | "NEEDS_HUMAN_REVIEW"
        | "INVALID"
      ap_evidence_verification:
        | "EXTRACTED_UNCONFIRMED"
        | "CUSTOMER_CONFIRMED"
        | "HUMAN_VERIFIED"
        | "CUSTOMER_REJECTED"
        | "DISPUTED"
      ap_experience_kind:
        | "PAID_EMPLOYMENT"
        | "SELF_EMPLOYMENT_BUSINESS"
        | "CONTRACT_FREELANCE"
        | "VOLUNTEER"
        | "PROJECT"
        | "EDUCATION"
        | "CAREER_BREAK"
        | "CAREGIVING"
        | "OTHER_RELEVANT_LIFE_CONTEXT"
      ap_fact_review_decision: "CONFIRM" | "REJECT" | "SKIP" | "CORRECT"
      ap_fact_tier: "SEARCH_CRITICAL" | "MATCH_ENHANCING" | "DOCUMENT_ONLY"
      ap_feasibility_outcome: "LIKELY" | "LIMITED" | "INFEASIBLE"
      ap_feasibility_reason:
        | "INVENTORY_SHORTAGE"
        | "QUALIFICATION_GAP"
        | "EVIDENCE_GAP"
        | "CONSTRAINT_COLLISION"
        | "COMPENSATION_BELOW_MINIMUM"
        | "COMPENSATION_UNCONFIRMED"
      ap_feasibility_request_state:
        | "PENDING"
        | "CLAIMED"
        | "COMPLETED"
        | "STALE"
        | "ERROR"
      ap_feasibility_run_state:
        | "NOT_RUN"
        | "PENDING"
        | "COMPLETE"
        | "STALE"
        | "ERROR"
      ap_job_origin: "APPLYPACK_FOUND" | "CUSTOMER_SUPPLIED"
      ap_material_fulfillment:
        | "NOT_PURCHASED"
        | "PAID"
        | "GENERATING"
        | "HUMAN_REVIEW"
        | "READY_TO_RELEASE"
        | "DELIVERED"
        | "CANCELED"
      ap_material_readiness:
        | "PENDING"
        | "BLOCKED_ON_CUSTOMER_INPUT"
        | "CHECKOUT_ELIGIBLE"
      ap_material_substitution:
        | "NONE"
        | "REQUIRED"
        | "OFFERED"
        | "ACCEPTED"
        | "DECLINED"
        | "EXPIRED"
      ap_outbox_state: "QUEUED" | "SENDING" | "SENT" | "RETRY" | "DEAD_LETTER"
      ap_payment_dispute: "NONE" | "OPEN" | "WON" | "LOST"
      ap_payment_settlement: "UNPAID" | "PROCESSING" | "PAID" | "FAILED"
      ap_presentation_risk: "LOW" | "MEDIUM" | "HIGH" | "NOT_ASSESSED"
      ap_reference_permission: "UNCONFIRMED" | "CONFIRMED" | "REVOKED"
      ap_refund_scope:
        | "FULL_SEARCH"
        | "DUPLICATE_ATTEMPT"
        | "STALE_ATTEMPT"
        | "MATERIAL_LINE"
      ap_refund_state: "PENDING" | "SUCCEEDED" | "FAILED"
      ap_requirement_node_kind: "ALL_OF" | "ANY_OF" | "CRITERION"
      ap_resolution_blocker:
        | "NONE"
        | "NEEDS_CANDIDATE_INPUT"
        | "NEEDS_HUMAN_REVIEW"
      ap_resolution_issue:
        | "NONE"
        | "CANDIDATE_MISSING"
        | "EMPLOYER_OMITTED"
        | "PARSER_UNCERTAIN"
        | "EVIDENCE_CONFLICT"
      ap_retention_state:
        | "ACTIVE"
        | "EXPIRY_PENDING"
        | "DELETE_PENDING"
        | "DELETED"
        | "CRYPTO_SHREDDED"
        | "LEGAL_HOLD"
      ap_salary_gate_disposition:
        | "PASS"
        | "FAIL"
        | "ALLOWED_WITH_WARNING"
        | "NEEDS_HUMAN_REVIEW"
        | "NOT_APPLICABLE"
      ap_salary_status:
        | "PUBLISHED_MEETS_MINIMUM"
        | "PUBLISHED_OVERLAPS_MINIMUM"
        | "PUBLISHED_BELOW_MINIMUM"
        | "PUBLISHED_NONCOMPARABLE"
        | "UNPUBLISHED"
        | "ESTIMATE_ONLY"
      ap_scheduled_job_state:
        | "QUEUED"
        | "LEASED"
        | "RETRY"
        | "COMPLETED"
        | "DEAD_LETTER"
      ap_search_fulfillment:
        | "QUEUED"
        | "RESEARCHING"
        | "HUMAN_REVIEW"
        | "ADJUSTMENT_REQUIRED"
        | "READY_TO_RELEASE"
        | "DELIVERED"
        | "CANCELED"
      ap_unknown_treatment:
        | "BLOCK"
        | "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING"
        | "IMMATERIAL_ALTERNATIVE"
      intake_status:
        | "draft"
        | "ready_for_payment"
        | "paid"
        | "in_review"
        | "approved"
        | "cancelled"
      job_match_packet_status:
        | "RENDERING"
        | "PREVIEW_READY"
        | "APPROVED"
        | "FAILED"
        | "SUPERSEDED"
        | "EXPIRED"
      order_status:
        | "pending_payment"
        | "paid"
        | "in_fulfillment"
        | "delivered"
        | "payment_expired"
        | "cancelled"
        | "refunded"
        | "delivery_processing"
        | "refund_pending"
        | "delivered_refunded"
      product_kind: "job_search" | "apply_pack"
      profile_role: "customer" | "operator" | "admin"
      reservation_status: "reserved" | "confirmed" | "released" | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ap_adjustment_state: [
        "NONE",
        "PROPOSED",
        "ACCEPTED",
        "DECLINED",
        "EXPIRED",
      ],
      ap_application_readiness: ["READY", "NEEDS_CUSTOMER_ACTION", "BLOCKED"],
      ap_artifact_type: ["RESUME", "COVER_LETTER", "REFERENCE_SHEET"],
      ap_candidate_fact_source: [
        "DOCUMENT",
        "CUSTOMER_ASSERTION",
        "HUMAN_VERIFICATION",
      ],
      ap_capacity_debit: ["NONE", "HELD", "SPENT", "RETURNED"],
      ap_capacity_lifecycle: [
        "NONE",
        "RESERVED",
        "CONSUMED",
        "COMPLETED",
        "SUPERSEDED",
        "RELEASED",
        "EXPIRED",
      ],
      ap_capacity_resource: ["SEARCH", "MATERIALS", "REFERENCE_REGENERATION"],
      ap_checkout_state: [
        "NONE",
        "OPEN",
        "CANCELED",
        "EXPIRED",
        "COMPLETED",
        "FAILED",
      ],
      ap_command_state: [
        "CREATING",
        "CREATED",
        "APPLYING",
        "APPLIED",
        "COMPENSATING",
        "COMPENSATED",
        "FAILED",
      ],
      ap_criterion_result: ["PASS", "FAIL", "UNKNOWN"],
      ap_criterion_type: [
        "WORK_MODE",
        "GEOGRAPHY",
        "COMMUTE",
        "EMPLOYMENT_TYPE",
        "COMPENSATION",
        "SCHEDULE",
        "TRAVEL_PHYSICAL",
        "DUTY_EXCLUSION",
        "AUTHORIZATION_SPONSORSHIP",
        "EDUCATION",
        "CERTIFICATION_LICENSE",
        "EXPERIENCE",
        "RESPONSIBILITY",
        "TOOL_CAPABILITY",
        "BENEFIT",
        "INDUSTRY_DOMAIN",
        "CUSTOMER_TITLE_RESTRICTION",
        "CUSTOM_EXCLUSION",
        "LISTING_APPLICATION_PATH",
      ],
      ap_document_kind: ["RESUME", "PRIOR_COVER_LETTER"],
      ap_document_processing_state: [
        "UPLOADED",
        "QUARANTINED",
        "SCANNING",
        "EXTRACTING",
        "READY",
        "FAILED",
        "SUPERSEDED",
      ],
      ap_draft_state: [
        "IN_PROGRESS",
        "COMPLETE",
        "LOCKED_TO_CHECKOUT",
        "CONVERTED",
        "EXPIRED",
      ],
      ap_eligibility_disposition: [
        "ELIGIBLE",
        "ELIGIBLE_WITH_ALLOWED_UNKNOWNS",
        "INELIGIBLE",
        "NEEDS_CANDIDATE_INPUT",
        "NEEDS_HUMAN_REVIEW",
        "INVALID",
      ],
      ap_evidence_verification: [
        "EXTRACTED_UNCONFIRMED",
        "CUSTOMER_CONFIRMED",
        "HUMAN_VERIFIED",
        "CUSTOMER_REJECTED",
        "DISPUTED",
      ],
      ap_experience_kind: [
        "PAID_EMPLOYMENT",
        "SELF_EMPLOYMENT_BUSINESS",
        "CONTRACT_FREELANCE",
        "VOLUNTEER",
        "PROJECT",
        "EDUCATION",
        "CAREER_BREAK",
        "CAREGIVING",
        "OTHER_RELEVANT_LIFE_CONTEXT",
      ],
      ap_fact_review_decision: ["CONFIRM", "REJECT", "SKIP", "CORRECT"],
      ap_fact_tier: ["SEARCH_CRITICAL", "MATCH_ENHANCING", "DOCUMENT_ONLY"],
      ap_feasibility_outcome: ["LIKELY", "LIMITED", "INFEASIBLE"],
      ap_feasibility_reason: [
        "INVENTORY_SHORTAGE",
        "QUALIFICATION_GAP",
        "EVIDENCE_GAP",
        "CONSTRAINT_COLLISION",
        "COMPENSATION_BELOW_MINIMUM",
        "COMPENSATION_UNCONFIRMED",
      ],
      ap_feasibility_request_state: [
        "PENDING",
        "CLAIMED",
        "COMPLETED",
        "STALE",
        "ERROR",
      ],
      ap_feasibility_run_state: [
        "NOT_RUN",
        "PENDING",
        "COMPLETE",
        "STALE",
        "ERROR",
      ],
      ap_job_origin: ["APPLYPACK_FOUND", "CUSTOMER_SUPPLIED"],
      ap_material_fulfillment: [
        "NOT_PURCHASED",
        "PAID",
        "GENERATING",
        "HUMAN_REVIEW",
        "READY_TO_RELEASE",
        "DELIVERED",
        "CANCELED",
      ],
      ap_material_readiness: [
        "PENDING",
        "BLOCKED_ON_CUSTOMER_INPUT",
        "CHECKOUT_ELIGIBLE",
      ],
      ap_material_substitution: [
        "NONE",
        "REQUIRED",
        "OFFERED",
        "ACCEPTED",
        "DECLINED",
        "EXPIRED",
      ],
      ap_outbox_state: ["QUEUED", "SENDING", "SENT", "RETRY", "DEAD_LETTER"],
      ap_payment_dispute: ["NONE", "OPEN", "WON", "LOST"],
      ap_payment_settlement: ["UNPAID", "PROCESSING", "PAID", "FAILED"],
      ap_presentation_risk: ["LOW", "MEDIUM", "HIGH", "NOT_ASSESSED"],
      ap_reference_permission: ["UNCONFIRMED", "CONFIRMED", "REVOKED"],
      ap_refund_scope: [
        "FULL_SEARCH",
        "DUPLICATE_ATTEMPT",
        "STALE_ATTEMPT",
        "MATERIAL_LINE",
      ],
      ap_refund_state: ["PENDING", "SUCCEEDED", "FAILED"],
      ap_requirement_node_kind: ["ALL_OF", "ANY_OF", "CRITERION"],
      ap_resolution_blocker: [
        "NONE",
        "NEEDS_CANDIDATE_INPUT",
        "NEEDS_HUMAN_REVIEW",
      ],
      ap_resolution_issue: [
        "NONE",
        "CANDIDATE_MISSING",
        "EMPLOYER_OMITTED",
        "PARSER_UNCERTAIN",
        "EVIDENCE_CONFLICT",
      ],
      ap_retention_state: [
        "ACTIVE",
        "EXPIRY_PENDING",
        "DELETE_PENDING",
        "DELETED",
        "CRYPTO_SHREDDED",
        "LEGAL_HOLD",
      ],
      ap_salary_gate_disposition: [
        "PASS",
        "FAIL",
        "ALLOWED_WITH_WARNING",
        "NEEDS_HUMAN_REVIEW",
        "NOT_APPLICABLE",
      ],
      ap_salary_status: [
        "PUBLISHED_MEETS_MINIMUM",
        "PUBLISHED_OVERLAPS_MINIMUM",
        "PUBLISHED_BELOW_MINIMUM",
        "PUBLISHED_NONCOMPARABLE",
        "UNPUBLISHED",
        "ESTIMATE_ONLY",
      ],
      ap_scheduled_job_state: [
        "QUEUED",
        "LEASED",
        "RETRY",
        "COMPLETED",
        "DEAD_LETTER",
      ],
      ap_search_fulfillment: [
        "QUEUED",
        "RESEARCHING",
        "HUMAN_REVIEW",
        "ADJUSTMENT_REQUIRED",
        "READY_TO_RELEASE",
        "DELIVERED",
        "CANCELED",
      ],
      ap_unknown_treatment: [
        "BLOCK",
        "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING",
        "IMMATERIAL_ALTERNATIVE",
      ],
      intake_status: [
        "draft",
        "ready_for_payment",
        "paid",
        "in_review",
        "approved",
        "cancelled",
      ],
      job_match_packet_status: [
        "RENDERING",
        "PREVIEW_READY",
        "APPROVED",
        "FAILED",
        "SUPERSEDED",
        "EXPIRED",
      ],
      order_status: [
        "pending_payment",
        "paid",
        "in_fulfillment",
        "delivered",
        "payment_expired",
        "cancelled",
        "refunded",
        "delivery_processing",
        "refund_pending",
        "delivered_refunded",
      ],
      product_kind: ["job_search", "apply_pack"],
      profile_role: ["customer", "operator", "admin"],
      reservation_status: ["reserved", "confirmed", "released", "expired"],
    },
  },
} as const
