-- Outreach and growth: templates, campaigns, recipients, A/B tests, inbox, pipeline and tasks.

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  channel public.channel not null check (channel in ('email', 'whatsapp')),
  name text not null,
  product public.product not null,
  language public.template_language not null default 'en',
  subject text, -- email only
  body text not null default '',
  variables text[] not null default '{}',
  whatsapp_category public.whatsapp_category,
  header_type text check (header_type in ('none', 'image', 'video', 'document')),
  header_media_url text,
  buttons jsonb not null default '[]'::jsonb,
  approval_status public.template_approval not null default 'draft',
  rejection_reason text,
  provider_template_name text,
  is_starter boolean not null default false,
  parent_template_id uuid references public.templates (id) on delete set null, -- A/B variant source
  archived_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_whatsapp_category check (channel <> 'whatsapp' or whatsapp_category is not null)
);
create index templates_channel_product_idx on public.templates (channel, product);
create trigger templates_updated_at before update on public.templates
  for each row execute function public.set_updated_at();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  channel public.channel not null check (channel in ('email', 'whatsapp')),
  name text not null,
  product public.product not null,
  audience jsonb not null default '{}'::jsonb, -- saved filter or explicit lead ids
  audience_size integer not null default 0,
  template_id uuid references public.templates (id) on delete restrict,
  template_variables jsonb not null default '{}'::jsonb,
  language public.template_language not null default 'en',
  sender_name text,
  sending_domain text,
  from_address text,
  daily_limit integer check (daily_limit is null or daily_limit > 0),
  send_window_start time, -- Pakistan time
  send_window_end time,
  gap_seconds integer check (gap_seconds is null or gap_seconds >= 0),
  follow_up_after_days integer check (follow_up_after_days is null or follow_up_after_days > 0),
  max_follow_ups integer not null default 0 check (max_follow_ups between 0 and 3),
  bounce_limit_pct numeric(5, 2),
  complaint_limit_pct numeric(5, 2),
  status public.campaign_status not null default 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  paused_reason text,
  estimated_cost_pkr numeric(14, 2),
  created_by uuid references public.users (id) on delete set null,
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_status_idx on public.campaigns (channel, status);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  contact_id uuid references public.lead_contacts (id) on delete set null,
  address text not null,
  variant text check (variant in ('a', 'b')),
  status public.recipient_status not null default 'pending',
  follow_up_count integer not null default 0,
  next_follow_up_at timestamptz,
  provider_message_id text,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  failed_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  opted_out_at timestamptz,
  error text,
  attempts integer not null default 0,
  cost_pkr numeric(12, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index campaign_recipients_status_idx on public.campaign_recipients (campaign_id, status);
create index campaign_recipients_lead_idx on public.campaign_recipients (lead_id);
create index campaign_recipients_address_idx on public.campaign_recipients (address);
create unique index campaign_recipients_provider_idx on public.campaign_recipients (provider_message_id)
  where provider_message_id is not null;
create trigger campaign_recipients_updated_at before update on public.campaign_recipients
  for each row execute function public.set_updated_at();

create table public.ab_tests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  field text not null check (field in ('subject', 'body')),
  variant_a text not null,
  variant_b text not null,
  test_share_pct numeric(5, 2) not null check (test_share_pct > 0 and test_share_pct <= 100),
  window_hours integer not null default 24 check (window_hours > 0),
  winner_mode text not null default 'auto' check (winner_mode in ('auto', 'manual')),
  status public.ab_status not null default 'draft',
  winner text check (winner in ('a', 'b')),
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ab_tests_campaign_idx on public.ab_tests (campaign_id);
create trigger ab_tests_updated_at before update on public.ab_tests
  for each row execute function public.set_updated_at();

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel public.channel not null check (channel in ('email', 'whatsapp')),
  address text not null,
  assigned_to uuid references public.users (id) on delete set null,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_inbound_at timestamptz, -- drives the WhatsApp 24-hour rule
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, channel)
);
create index conversations_assigned_idx on public.conversations (assigned_to, last_message_at desc);
create index conversations_last_idx on public.conversations (last_message_at desc);
create index conversations_address_idx on public.conversations (address);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  channel public.channel not null check (channel in ('email', 'whatsapp')),
  direction public.message_direction not null,
  from_address text,
  to_address text,
  subject text,
  body text,
  template_id uuid references public.templates (id) on delete set null,
  whatsapp_category public.whatsapp_category,
  attachments jsonb not null default '[]'::jsonb,
  is_internal_note boolean not null default false,
  status public.message_status not null,
  provider_message_id text,
  error text,
  sent_by uuid references public.users (id) on delete set null,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_lead_idx on public.messages (lead_id, created_at);
create index messages_from_idx on public.messages (from_address);
create index messages_to_idx on public.messages (to_address);
create unique index messages_provider_idx on public.messages (channel, provider_message_id)
  where provider_message_id is not null;
create trigger messages_updated_at before update on public.messages
  for each row execute function public.set_updated_at();

create table public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_status public.lead_status,
  to_status public.lead_status not null,
  caused_by_user uuid references public.users (id) on delete set null,
  caused_by_system text, -- e.g. 'email-send', 'whatsapp-webhook'
  reason text, -- lost reason or note
  details jsonb not null default '{}'::jsonb, -- e.g. plan and student count on Won
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pipeline_events_lead_idx on public.pipeline_events (lead_id, created_at);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete cascade,
  title text not null,
  notes text,
  due_at timestamptz,
  remind_at timestamptz,
  owner_id uuid references public.users (id) on delete set null,
  done_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_owner_due_idx on public.tasks (owner_id, due_at) where done_at is null;
create index tasks_lead_idx on public.tasks (lead_id);
create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
