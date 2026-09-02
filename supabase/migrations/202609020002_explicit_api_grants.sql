-- The project disables automatic Data API exposure. Grant only the roles the
-- application uses, while RLS continues to filter authenticated reads.

grant usage on schema public to authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant select on table
  public.profiles,
  public.intakes,
  public.intake_answers,
  public.criteria_versions,
  public.orders,
  public.jobs,
  public.job_matches,
  public.apply_pack_carts,
  public.apply_pack_cart_items,
  public.apply_pack_items,
  public.correction_requests,
  public.conflict_reviews
to authenticated;

revoke all on table
  public.capacity_limits,
  public.capacity_reservations,
  public.payments,
  public.refunds,
  public.webhook_events,
  public.email_events,
  public.audit_logs,
  public.api_rate_limits
from anon, authenticated;
