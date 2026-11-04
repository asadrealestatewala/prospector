-- Cost control (SRS screen 16 and 8.1). Every price, plan cap and budget lives here and is editable.
-- Nothing in the app hard-codes a price. A rate whose value is null is "not set" and blocks spend.

create table public.cost_plans (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- resend, botlinkd, contabo, domain_dns, social_api, email_verification, other
  kind text not null default 'plan' check (kind in ('plan', 'service_charge')),
  plan_name text not null,
  monthly_price numeric(14, 2) check (monthly_price is null or monthly_price >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'PKR')),
  usage_cap numeric(16, 0) check (usage_cap is null or usage_cap >= 0),
  usage_unit text, -- emails, messages, requests
  extra_usage_rate numeric(14, 6) check (extra_usage_rate is null or extra_usage_rate >= 0),
  extra_usage_per numeric(16, 0) default 1 check (extra_usage_per is null or extra_usage_per > 0),
  billing_day smallint check (billing_day between 1 and 31),
  next_renewal_date date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cost_plans_provider_idx on public.cost_plans (provider) where is_active;
create trigger cost_plans_updated_at before update on public.cost_plans
  for each row execute function public.set_updated_at();

create table public.cost_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null, -- meta_whatsapp, google_places, google_search, social_api, email_verification, fx
  item text not null, -- e.g. marketing, utility, text_search_pro, query, usd_to_pkr
  label text not null,
  whatsapp_category public.whatsapp_category,
  country text not null default 'PK', -- ISO country code, or '*' for any
  unit text not null, -- message, call, request, usd
  rate numeric(14, 6) check (rate is null or rate >= 0),
  currency text not null default 'PKR' check (currency in ('USD', 'PKR')),
  free_allowance numeric(16, 0) check (free_allowance is null or free_allowance >= 0),
  allowance_period text check (allowance_period in ('day', 'month')),
  effective_from date not null default ((now() at time zone 'Asia/Karachi')::date),
  notes text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, item, country, effective_from)
);
create index cost_rates_lookup_idx on public.cost_rates (provider, item, country, effective_from desc);
create trigger cost_rates_updated_at before update on public.cost_rates
  for each row execute function public.set_updated_at();

-- The rate that applied on a given day (Pakistan date). Old reports keep the old price.
create or replace function public.rate_on(
  p_provider text,
  p_item text,
  p_country text default 'PK',
  p_on date default ((now() at time zone 'Asia/Karachi')::date)
)
returns public.cost_rates
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public.cost_rates r
  where r.provider = p_provider
    and r.item = p_item
    and r.country in (p_country, '*')
    and r.effective_from <= p_on
  order by (r.country = p_country) desc, r.effective_from desc
  limit 1;
$$;
revoke all on function public.rate_on(text, text, text, date) from public;
grant execute on function public.rate_on(text, text, text, date) to authenticated, service_role;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  provider text, -- null = all providers
  product public.product, -- null = all products
  channel public.channel, -- null = all channels
  month date check (month is null or extract(day from month) = 1), -- null = every month
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'PKR' check (currency in ('USD', 'PKR')),
  warn_pct numeric(5, 2) not null default 80 check (warn_pct > 0 and warn_pct <= 100),
  stop_pct numeric(5, 2) not null default 100 check (stop_pct > 0 and stop_pct <= 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_warn_before_stop check (warn_pct <= stop_pct)
);
create trigger budgets_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();

-- Change history for plans, rates and budgets: who changed what and when.
create table public.cost_change_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid references public.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cost_change_log_row_idx on public.cost_change_log (table_name, row_id, changed_at desc);
create trigger cost_change_log_immutable before update or delete on public.cost_change_log
  for each row execute function public.append_only();

create or replace function public.log_cost_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cost_change_log (table_name, row_id, action, old_values, new_values, changed_by)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;
create trigger cost_plans_history after insert or update or delete on public.cost_plans
  for each row execute function public.log_cost_change();
create trigger cost_rates_history after insert or update or delete on public.cost_rates
  for each row execute function public.log_cost_change();
create trigger budgets_history after insert or update or delete on public.budgets
  for each row execute function public.log_cost_change();

create table public.api_usage (
  id uuid primary key default gen_random_uuid(),
  day date not null, -- Pakistan date
  provider text not null, -- google_places, google_search, social_api
  item text not null,
  calls integer not null default 0 check (calls >= 0),
  cost_pkr numeric(14, 4) not null default 0,
  rate_id uuid references public.cost_rates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, provider, item)
);
create trigger api_usage_updated_at before update on public.api_usage
  for each row execute function public.set_updated_at();

create table public.message_costs (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  channel public.channel not null check (channel in ('email', 'whatsapp')),
  category text not null, -- email, or a WhatsApp category
  product public.product not null,
  message_count integer not null default 0 check (message_count >= 0),
  cost_pkr numeric(14, 4) not null default 0,
  rate_id uuid references public.cost_rates (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day, channel, category, product)
);
create trigger message_costs_updated_at before update on public.message_costs
  for each row execute function public.set_updated_at();

create table public.usage_counters (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  metric text not null, -- emails_sent, whatsapp_marketing, google_calls, social_requests
  period_start date not null,
  period_end date not null,
  value numeric(16, 0) not null default 0 check (value >= 0),
  source text not null default 'internal' check (source in ('internal', 'webhook', 'provider_api', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, metric, period_start),
  check (period_end >= period_start)
);
create trigger usage_counters_updated_at before update on public.usage_counters
  for each row execute function public.set_updated_at();

create table public.invoice_reconciliation (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  month date not null check (extract(day from month) = 1),
  invoice_total numeric(14, 2) not null,
  currency text not null default 'PKR' check (currency in ('USD', 'PKR')),
  calculated_total numeric(14, 2),
  difference numeric(14, 2) generated always as (invoice_total - calculated_total) stored,
  notes text,
  entered_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, month)
);
create trigger invoice_reconciliation_updated_at before update on public.invoice_reconciliation
  for each row execute function public.set_updated_at();

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('resend', 'botlinkd', 'other')),
  event_type text,
  provider_event_id text,
  signature_valid boolean,
  payload jsonb not null,
  status public.webhook_status not null default 'pending',
  error text,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index webhook_events_dedupe_key on public.webhook_events (provider, provider_event_id)
  where provider_event_id is not null;
create index webhook_events_received_idx on public.webhook_events (received_at desc);
create trigger webhook_events_updated_at before update on public.webhook_events
  for each row execute function public.set_updated_at();
