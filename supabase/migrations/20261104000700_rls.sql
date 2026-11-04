-- Row-level security. The server also checks roles (src/lib/auth), so both layers must agree.
-- Access follows SRS section 2:
--   admin        everything
--   manager      dashboard, leads, campaigns, templates, inbox, results, pipeline
--   lead_expert  searches, live progress, leads, lead detail
--   sales_agent  inbox, pipeline, lead detail
-- The service role (server and workers only) bypasses RLS.

-- Create the staff profile when Supabase creates an auth user (invites come from the server).
-- The role is read from app_metadata, which only the service role can set.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  begin
    v_role := coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'sales_agent');
  exception when invalid_text_representation then
    v_role := 'sales_agent';
  end;
  insert into public.users (id, email, full_name, role, status, invited_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    'invited',
    nullif(new.raw_app_meta_data ->> 'invited_by', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Turn RLS on everywhere and take all rights away from anonymous visitors.
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'audit_log', 'login_attempts', 'settings',
    'searches', 'search_cities', 'leads', 'lead_contacts', 'lead_social_links', 'crawl_jobs',
    'templates', 'campaigns', 'campaign_recipients', 'ab_tests',
    'conversations', 'messages', 'pipeline_events', 'tasks',
    'do_not_contact', 'consent_log',
    'cost_plans', 'cost_rates', 'budgets', 'cost_change_log', 'api_usage', 'message_costs',
    'usage_counters', 'invoice_reconciliation', 'webhook_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

-- users: every staff member can see colleagues (for owner and agent pickers); only admins change them.
create policy users_select on public.users for select to authenticated
  using ((select public.is_staff()) or id = (select auth.uid()));
create policy users_update_admin on public.users for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy users_update_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- audit_log: admins read it; anyone signed in may append their own entries.
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.has_role('admin')));
create policy audit_log_insert on public.audit_log for insert to authenticated
  with check ((select public.is_staff()) and actor_id = (select auth.uid()));

-- login_attempts: service role only (no policies).
revoke all on public.login_attempts from authenticated;

-- settings: admins read non-secret columns. Writes go through the server (service role).
create policy settings_select on public.settings for select to authenticated
  using ((select public.has_role('admin')));
revoke all on public.settings from authenticated;
grant select (key, category, value, is_secret, secret_last4, last_tested_at, last_test_ok,
  last_test_message, updated_by, created_at, updated_at) on public.settings to authenticated;

-- Lead engine.
create policy searches_select on public.searches for select to authenticated
  using ((select public.has_role('admin', 'manager', 'lead_expert')));
create policy searches_write on public.searches for all to authenticated
  using ((select public.has_role('admin', 'lead_expert'))) with check ((select public.has_role('admin', 'lead_expert')));

create policy search_cities_select on public.search_cities for select to authenticated
  using ((select public.has_role('admin', 'manager', 'lead_expert')));
create policy search_cities_write on public.search_cities for all to authenticated
  using ((select public.has_role('admin', 'lead_expert'))) with check ((select public.has_role('admin', 'lead_expert')));

create policy crawl_jobs_select on public.crawl_jobs for select to authenticated
  using ((select public.has_role('admin', 'manager', 'lead_expert')));
create policy crawl_jobs_write on public.crawl_jobs for all to authenticated
  using ((select public.has_role('admin', 'lead_expert'))) with check ((select public.has_role('admin', 'lead_expert')));

-- Lead detail is open to every role; sales agents can update status, owner, tags and notes.
create policy leads_select on public.leads for select to authenticated using ((select public.is_staff()));
create policy leads_insert on public.leads for insert to authenticated
  with check ((select public.has_role('admin', 'manager', 'lead_expert')));
create policy leads_update on public.leads for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy leads_delete on public.leads for delete to authenticated
  using ((select public.has_role('admin', 'manager', 'lead_expert')));

create policy lead_contacts_select on public.lead_contacts for select to authenticated using ((select public.is_staff()));
create policy lead_contacts_write on public.lead_contacts for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

create policy lead_social_links_select on public.lead_social_links for select to authenticated using ((select public.is_staff()));
create policy lead_social_links_write on public.lead_social_links for all to authenticated
  using ((select public.has_role('admin', 'manager', 'lead_expert')))
  with check ((select public.has_role('admin', 'manager', 'lead_expert')));

-- Outreach. Sales agents read templates for the inbox template picker.
create policy templates_select on public.templates for select to authenticated
  using ((select public.has_role('admin', 'manager', 'sales_agent')));
create policy templates_write on public.templates for all to authenticated
  using ((select public.has_role('admin', 'manager'))) with check ((select public.has_role('admin', 'manager')));

create policy campaigns_select on public.campaigns for select to authenticated
  using ((select public.has_role('admin', 'manager')));
create policy campaigns_write on public.campaigns for all to authenticated
  using ((select public.has_role('admin', 'manager'))) with check ((select public.has_role('admin', 'manager')));

create policy campaign_recipients_select on public.campaign_recipients for select to authenticated
  using ((select public.has_role('admin', 'manager')));
create policy campaign_recipients_write on public.campaign_recipients for all to authenticated
  using ((select public.has_role('admin', 'manager'))) with check ((select public.has_role('admin', 'manager')));

create policy ab_tests_select on public.ab_tests for select to authenticated
  using ((select public.has_role('admin', 'manager')));
create policy ab_tests_write on public.ab_tests for all to authenticated
  using ((select public.has_role('admin', 'manager'))) with check ((select public.has_role('admin', 'manager')));

-- Inbox.
create policy conversations_select on public.conversations for select to authenticated
  using ((select public.has_role('admin', 'manager', 'sales_agent')));
create policy conversations_write on public.conversations for all to authenticated
  using ((select public.has_role('admin', 'manager', 'sales_agent')))
  with check ((select public.has_role('admin', 'manager', 'sales_agent')));

-- Lead detail shows the message timeline to every role; only inbox roles write messages.
create policy messages_select on public.messages for select to authenticated using ((select public.is_staff()));
create policy messages_write on public.messages for all to authenticated
  using ((select public.has_role('admin', 'manager', 'sales_agent')))
  with check ((select public.has_role('admin', 'manager', 'sales_agent')));

-- Pipeline and tasks.
create policy pipeline_events_select on public.pipeline_events for select to authenticated using ((select public.is_staff()));
create policy pipeline_events_insert on public.pipeline_events for insert to authenticated
  with check ((select public.is_staff()) and (caused_by_user is null or caused_by_user = (select auth.uid())));

create policy tasks_select on public.tasks for select to authenticated using ((select public.is_staff()));
create policy tasks_write on public.tasks for all to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- Compliance: anyone may add to do-not-contact; only an admin may remove (soft) an entry.
create policy dnc_select on public.do_not_contact for select to authenticated using ((select public.is_staff()));
create policy dnc_insert on public.do_not_contact for insert to authenticated
  with check ((select public.is_staff()) and removed_at is null);
create policy dnc_update_admin on public.do_not_contact for update to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

create policy consent_log_select on public.consent_log for select to authenticated using ((select public.is_staff()));
create policy consent_log_insert on public.consent_log for insert to authenticated
  with check ((select public.is_staff()));

-- Costs and operations: Admin only.
create policy cost_plans_admin on public.cost_plans for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy cost_rates_admin on public.cost_rates for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy budgets_admin on public.budgets for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy cost_change_log_select on public.cost_change_log for select to authenticated
  using ((select public.has_role('admin')));
create policy api_usage_select on public.api_usage for select to authenticated
  using ((select public.has_role('admin')));
create policy message_costs_select on public.message_costs for select to authenticated
  using ((select public.has_role('admin')));
create policy usage_counters_select on public.usage_counters for select to authenticated
  using ((select public.has_role('admin')));
create policy invoice_reconciliation_admin on public.invoice_reconciliation for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy webhook_events_select on public.webhook_events for select to authenticated
  using ((select public.has_role('admin')));

-- Realtime: progress counters and the inbox update live (SRS 8.5).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.searches, public.search_cities, public.crawl_jobs, public.leads,
      public.conversations, public.messages, public.campaigns, public.usage_counters;
  end if;
end;
$$;
