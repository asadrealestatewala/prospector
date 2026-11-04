-- Step 5: email (SRS screens 7 and 9, the email-send queue in 8.3, Resend webhooks in 8.2).

-- 1. Where an opt-out came from: the unsubscribe link, or a bounce or complaint reported by Resend.
--    The new values are only used inside plpgsql bodies, which are checked when they run.
alter type public.consent_source add value if not exists 'unsubscribe_link';
alter type public.consent_source add value if not exists 'email_provider';

-- 2. Sender identities (Settings, Sender identities). Each address must be on a domain verified in Resend.
create table public.email_senders (
  id uuid primary key default gen_random_uuid(),
  from_name text not null check (length(trim(from_name)) between 1 and 80),
  from_email text not null check (from_email ~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$'),
  domain text generated always as (lower(split_part(from_email, '@', 2))) stored,
  reply_to text check (reply_to is null or reply_to ~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$'),
  is_active boolean not null default true,
  -- First day this domain sent; the warm-up schedule counts from here.
  warmup_started_on date,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index email_senders_email_key on public.email_senders (lower(from_email));
create trigger email_senders_updated_at before update on public.email_senders
  for each row execute function public.set_updated_at();
alter table public.email_senders enable row level security;
alter table public.email_senders force row level security;
revoke all on public.email_senders from anon;
create policy email_senders_select on public.email_senders for select to authenticated
  using ((select public.has_role('admin', 'manager')));
create policy email_senders_write on public.email_senders for all to authenticated
  using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

-- 3. Campaign fields for sending. The subject and body are copied when the campaign is scheduled,
--    so editing the template later does not change a campaign that is already running.
alter table public.campaigns
  add column sender_id uuid references public.email_senders (id) on delete restrict,
  add column subject_snapshot text,
  add column body_snapshot text,
  add column recent_contact_days integer not null default 0 check (recent_contact_days between 0 and 365),
  add column next_send_at timestamptz;

alter table public.campaign_recipients
  add column job_id text,
  add column message_id uuid references public.messages (id) on delete set null;
create index campaign_recipients_queued_idx on public.campaign_recipients (campaign_id, queued_at) where queued_at is not null;
create index campaign_recipients_address_lower_idx on public.campaign_recipients (campaign_id, lower(address));

-- One-off emails from Lead Detail are queued as a message row.
alter table public.messages
  add column job_id text,
  add column sender_id uuid references public.email_senders (id) on delete set null,
  add column language public.template_language;
create index messages_outbound_email_idx on public.messages (created_at) where channel = 'email' and direction = 'outbound';

-- 4. Settings. Limits are editable in Settings, Sending limits; these are cautious starting values.
insert into public.settings (key, category, value) values
  ('email.limits', 'limits', jsonb_build_object(
    'daily_cap', 300,
    'window_start', '09:00',
    'window_end', '18:00',
    'gap_seconds', 60,
    'recent_contact_days', 30,
    'bounce_limit_pct', 5,
    'complaint_limit_pct', 0.3,
    'min_sample', 50,
    'warmup', jsonb_build_array(
      jsonb_build_object('from_day', 1, 'limit', 20),
      jsonb_build_object('from_day', 4, 'limit', 40),
      jsonb_build_object('from_day', 8, 'limit', 80),
      jsonb_build_object('from_day', 15, 'limit', 150),
      jsonb_build_object('from_day', 22, 'limit', 300)
    )
  )),
  -- {{product_price}} in templates. Classwell's line is from the SRS; the others are entered in Settings.
  ('products.price_lines', 'defaults', '{"classwell": "PKR 20 per student", "vetlin": "", "postwala": ""}')
on conflict (key) do nothing;
insert into public.settings (key, category, is_secret) values ('resend.webhook_secret', 'integrations', true)
on conflict (key) do nothing;

-- 5. Starter templates (Templates, Library). Variables are filled per lead when the email is sent.
insert into public.templates (channel, name, product, language, subject, body, variables, is_starter) values
  ('email', 'Classwell school introduction', 'classwell', 'en',
   'Fees, attendance and results for {{business_name}} in one place',
   '<p>Assalam-o-Alaikum {{contact_name|Principal Sahib}},</p>'
   '<p>I came across {{business_name}} in {{city}} and wanted to introduce Classwell, a school management system for schools in Pakistan. It keeps fee collection, attendance, exams and result cards, and messages to parents in one place.</p>'
   '<p>Pricing is simple: {{product_price}}.</p>'
   '<p>Would a short demo this week be useful? Reply to this email and I will set it up at a time that suits you.</p>'
   '<p>Regards,<br>{{sender_name}}</p>',
   array['business_name', 'city', 'contact_name', 'product_price', 'sender_name'], true),
  ('email', 'Vetlin clinic introduction', 'vetlin', 'en',
   'Appointments and patient records for {{business_name}}',
   '<p>Hello {{contact_name|Doctor}},</p>'
   '<p>I found {{business_name}} in {{city}} and wanted to introduce Vetlin, a management system for veterinary clinics. It handles appointments, patient and vaccination records, reminders to pet owners and billing.</p>'
   '<p>Would you like a short demo? Reply to this email and I will arrange a time.</p>'
   '<p>Regards,<br>{{sender_name}}</p>',
   array['business_name', 'city', 'contact_name', 'sender_name'], true),
  ('email', 'Postwala agency introduction', 'postwala', 'en',
   'Content and posting support for {{business_name}}',
   '<p>Hello {{contact_name|there}},</p>'
   '<p>I came across {{business_name}} in {{city}}. Postwala helps agencies plan, create and schedule social media content for their clients, so your team can take on more accounts without more hours.</p>'
   '<p>Would a short call to see if it fits your agency be useful? Reply to this email and I will set it up.</p>'
   '<p>Regards,<br>{{sender_name}}</p>',
   array['business_name', 'city', 'contact_name', 'sender_name'], true);

-- 6. Audience: adds leads to a draft campaign, picking each lead's best email and recording why
--    any are skipped (SRS screen 7 safeguards). Runs with the caller's rights, so RLS applies.
create or replace function public.build_campaign_audience(p_campaign uuid, p_lead_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_c public.campaigns;
  v_days integer;
  v_result jsonb;
begin
  if not public.has_role('admin', 'manager') then
    raise exception 'Only an Admin or Manager can build a campaign audience.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_lead_ids, 1), 0) > 10000 then
    raise exception 'Add at most 10,000 leads at a time.' using errcode = '22023';
  end if;
  select * into v_c from public.campaigns where id = p_campaign for update;
  if v_c.id is null or v_c.channel <> 'email' then
    raise exception 'Campaign not found.' using errcode = 'P0002';
  end if;
  if v_c.status <> 'draft' then
    raise exception 'Only a draft campaign can change its audience.' using errcode = '22023';
  end if;
  v_days := v_c.recent_contact_days;

  with best as (
    select distinct on (l.id) l.id as lead_id, l.product, l.last_contacted_at,
           c.id as contact_id, c.value, c.value_normalized, c.verification, c.consent_state
    from public.leads l
    join public.lead_contacts c on c.lead_id = l.id and c.kind = 'email'
    where l.id = any (p_lead_ids)
    order by l.id, (c.verification = 'valid') desc, (c.consent_state = 'opted_out'), c.is_primary desc, c.created_at
  ), judged as (
    select b.*,
      case
        when b.product <> v_c.product then 'Lead is for another product'
        when public.is_do_not_contact('email', b.value) then 'On the do-not-contact list'
        when b.consent_state = 'opted_out' then 'Opted out'
        when b.verification = 'invalid' then 'Email is invalid'
        when b.verification = 'risky' then 'Email is risky'
        when b.verification <> 'valid' then 'Email not verified'
        when v_days > 0 and b.last_contacted_at > now() - make_interval(days => v_days)
          then 'Contacted in the last ' || v_days || ' days'
        when exists (select 1 from public.campaign_recipients r
                     where r.campaign_id = p_campaign and lower(r.address) = b.value_normalized)
          or row_number() over (partition by b.value_normalized order by b.lead_id) > 1
          then 'Same address as another lead'
      end as skip
    from best b
  ), ins as (
    insert into public.campaign_recipients (campaign_id, lead_id, contact_id, address, status, error)
    select p_campaign, j.lead_id, j.contact_id, j.value,
           (case when j.skip is null then 'pending' else 'skipped' end)::public.recipient_status, j.skip
    from judged j
    on conflict (campaign_id, lead_id) do nothing
    returning status, error
  )
  select jsonb_build_object(
    'added', coalesce(sum(n) filter (where status = 'pending'), 0),
    'skipped', coalesce(sum(n) filter (where status = 'skipped'), 0),
    'reasons', coalesce(jsonb_object_agg(error, n) filter (where error is not null), '{}'::jsonb),
    'no_email', coalesce(array_length(p_lead_ids, 1), 0) - (select count(*) from best)
  ) into v_result
  from (select status, error, count(*) as n from ins group by status, error) x;

  update public.campaigns set audience_size = (
    select count(*) from public.campaign_recipients where campaign_id = p_campaign and status = 'pending'
  ) where id = p_campaign;
  return v_result;
end;
$$;
revoke all on function public.build_campaign_audience(uuid, uuid[]) from public, anon;
grant execute on function public.build_campaign_audience(uuid, uuid[]) to authenticated;

-- Live counters for the campaign list and detail (RLS applies).
create or replace function public.campaign_counts(p_ids uuid[])
returns table (
  campaign_id uuid, total bigint, pending bigint, queued bigint, sent bigint, delivered bigint, opened bigint,
  clicked bigint, replied bigint, bounced bigint, complained bigint, unsubscribed bigint, failed bigint, skipped bigint
)
language sql
stable
set search_path = public
as $$
  select r.campaign_id,
    count(*) filter (where r.status <> 'skipped'),
    count(*) filter (where r.status = 'pending'),
    count(*) filter (where r.status = 'queued'),
    count(*) filter (where r.sent_at is not null),
    count(*) filter (where r.delivered_at is not null),
    count(*) filter (where r.opened_at is not null),
    count(*) filter (where r.clicked_at is not null),
    count(*) filter (where r.replied_at is not null),
    count(*) filter (where r.bounced_at is not null),
    count(*) filter (where r.complained_at is not null),
    count(*) filter (where r.opted_out_at is not null and r.complained_at is null),
    count(*) filter (where r.status = 'failed'),
    count(*) filter (where r.status = 'skipped')
  from public.campaign_recipients r
  where r.campaign_id = any (p_ids)
  group by r.campaign_id;
$$;
grant execute on function public.campaign_counts(uuid[]) to authenticated;

-- 7. Worker functions (service role only).

-- Hands the next recipients of a sending campaign to the queue. Rows queued more than two hours
-- ago without being sent (a lost job) go back to pending first.
create or replace function public.claim_email_recipients(p_campaign uuid, p_limit integer)
returns table (id uuid, queued_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.campaign_recipients r set status = 'pending', queued_at = null, job_id = null
  where r.campaign_id = p_campaign and r.status = 'queued' and r.sent_at is null
    and r.queued_at < now() - interval '2 hours';

  return query
  update public.campaign_recipients r set status = 'queued', queued_at = now(), job_id = null
  where r.id in (
    select x.id from public.campaign_recipients x
    where x.campaign_id = p_campaign and x.status = 'pending'
    order by x.created_at
    limit greatest(0, least(p_limit, 500))
    for update skip locked
  )
  returning r.id, r.queued_at;
end;
$$;
revoke all on function public.claim_email_recipients(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_email_recipients(uuid, integer) to service_role;

-- What has already gone out today (Pakistan day starting at p_day_start), for the daily limit,
-- the warm-up schedule of the sender's domain and the overall daily cap.
create or replace function public.email_send_stats(p_campaign uuid, p_day_start timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select c.id, s.domain from public.campaigns c left join public.email_senders s on s.id = c.sender_id where c.id = p_campaign
  ), today as (
    select r.campaign_id, s.domain
    from public.campaign_recipients r
    join public.campaigns c2 on c2.id = r.campaign_id and c2.channel = 'email'
    left join public.email_senders s on s.id = c2.sender_id
    where r.queued_at >= p_day_start
    union all
    select null, lower(split_part(m.from_address, '@', 2))
    from public.messages m
    where m.channel = 'email' and m.direction = 'outbound' and m.campaign_id is null and m.created_at >= p_day_start
  )
  select jsonb_build_object(
    'campaign_today', (select count(*) from today where campaign_id = p_campaign),
    'domain_today', (select count(*) from today t, c where t.domain = c.domain),
    'total_today', (select count(*) from today),
    'remaining', (select count(*) from public.campaign_recipients r where r.campaign_id = p_campaign and r.status in ('pending', 'queued')),
    'pending', (select count(*) from public.campaign_recipients r where r.campaign_id = p_campaign and r.status = 'pending')
  );
$$;
revoke all on function public.email_send_stats(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.email_send_stats(uuid, timestamptz) to service_role;

-- Emails counted against the Resend plan cap this period: sent, plus queued and not yet sent.
create or replace function public.email_cap_usage(p_period_start date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select value from public.usage_counters
                   where provider = 'resend' and metric = 'emails_sent' and period_start = p_period_start), 0)::bigint
       + (select count(*) from public.campaign_recipients where status = 'queued')
       + (select count(*) from public.messages where channel = 'email' and direction = 'outbound' and status = 'queued');
$$;
grant execute on function public.email_cap_usage(date) to authenticated, service_role;

-- Records a sent email: the recipient or message row, the conversation, the lead's last contact,
-- and the usage counters. Only the job that claimed the row can record it, and only once.
create or replace function public.record_email_sent(
  p_recipient uuid,
  p_message uuid,
  p_job text,
  p_provider_id text,
  p_from text,
  p_subject text,
  p_body text,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.campaign_recipients;
  m public.messages;
  v_c public.campaigns;
  v_lead uuid;
  v_product public.product;
  v_conv uuid;
  v_msg uuid;
begin
  if p_recipient is not null then
    select * into r from public.campaign_recipients where id = p_recipient for update;
    if r.id is null or r.job_id is distinct from p_job then return null; end if;
    if r.sent_at is not null then return r.message_id; end if;
    select * into v_c from public.campaigns where id = r.campaign_id;
    v_lead := r.lead_id;
    v_product := v_c.product;
    insert into public.conversations (lead_id, channel, address, last_message_at, last_message_preview)
    values (v_lead, 'email', r.address, now(), left(p_subject, 200))
    on conflict (lead_id, channel) do update
      set last_message_at = excluded.last_message_at, last_message_preview = excluded.last_message_preview, address = excluded.address
    returning id into v_conv;
    insert into public.messages (conversation_id, lead_id, campaign_id, channel, direction, from_address, to_address,
                                 subject, body, template_id, status, provider_message_id, sent_at)
    values (v_conv, v_lead, v_c.id, 'email', 'outbound', p_from, r.address, p_subject, p_body, v_c.template_id,
            'sent', p_provider_id, now())
    returning id into v_msg;
    update public.campaign_recipients
    set status = 'sent', sent_at = now(), provider_message_id = p_provider_id, message_id = v_msg,
        job_id = null, attempts = attempts + 1, error = null
    where id = r.id;
  else
    select * into m from public.messages where id = p_message for update;
    if m.id is null or m.job_id is distinct from p_job then return null; end if;
    if m.status <> 'queued' then return m.id; end if;
    v_msg := m.id;
    v_lead := m.lead_id;
    update public.messages
    set status = 'sent', provider_message_id = p_provider_id, sent_at = now(), job_id = null, from_address = p_from,
        subject = coalesce(p_subject, subject), body = coalesce(p_body, body), error = null
    where id = m.id;
    update public.conversations set last_message_at = now(), last_message_preview = left(m.subject, 200)
    where id = m.conversation_id;
    select product into v_product from public.leads where id = v_lead;
  end if;

  update public.leads set last_contacted_at = now() where id = v_lead;
  insert into public.usage_counters (provider, metric, period_start, period_end, value, source)
  values ('resend', 'emails_sent', p_period_start, p_period_end, 1, 'internal')
  on conflict (provider, metric, period_start) do update set value = public.usage_counters.value + 1;
  if v_product is not null then
    -- Emails within the plan cap carry no per-email charge; the plan fee is on the Costs screen.
    insert into public.message_costs (day, channel, category, product, message_count, cost_pkr)
    values ((now() at time zone 'Asia/Karachi')::date, 'email', 'email', v_product, 1, 0)
    on conflict (day, channel, category, product) do update set message_count = public.message_costs.message_count + 1;
  end if;
  return v_msg;
end;
$$;
revoke all on function public.record_email_sent(uuid, uuid, text, text, text, text, text, date, date) from public, anon, authenticated;
grant execute on function public.record_email_sent(uuid, uuid, text, text, text, text, text, date, date) to service_role;

-- Applies one Resend webhook event (SRS 8.2, screen 16 live sync). A hard bounce or a complaint
-- adds the address to do-not-contact. Pauses the campaign when the bounce or complaint rate passes
-- its limit (SRS screen 7 automatic rule).
create or replace function public.process_resend_event(
  p_type text,
  p_email_id text,
  p_at timestamptz,
  p_bounce_type text,
  p_period_start date,
  p_period_end date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.campaign_recipients;
  m public.messages;
  v_c public.campaigns;
  v_address text;
  v_lead uuid;
  v_metric text;
  v_sent integer;
  v_bounced integer;
  v_complained integer;
  v_min integer;
  v_reason text;
begin
  select * into r from public.campaign_recipients where provider_message_id = p_email_id for update;
  select * into m from public.messages where channel = 'email' and provider_message_id = p_email_id for update;
  if r.id is null and m.id is null then return 'ignored: unknown email'; end if;
  v_address := coalesce(r.address, m.to_address);
  v_lead := coalesce(r.lead_id, m.lead_id);

  if p_type = 'email.delivered' then
    v_metric := 'emails_delivered';
    update public.campaign_recipients set delivered_at = coalesce(delivered_at, p_at),
      status = case when status = 'sent' then 'delivered'::public.recipient_status else status end
    where id = r.id;
    update public.messages set delivered_at = coalesce(delivered_at, p_at),
      status = case when status = 'sent' then 'delivered'::public.message_status else status end
    where id = m.id;
  elsif p_type = 'email.opened' then
    update public.campaign_recipients set opened_at = coalesce(opened_at, p_at),
      status = case when status in ('sent', 'delivered') then 'opened'::public.recipient_status else status end
    where id = r.id;
    update public.messages set read_at = coalesce(read_at, p_at),
      status = case when status in ('sent', 'delivered') then 'read'::public.message_status else status end
    where id = m.id;
  elsif p_type = 'email.clicked' then
    update public.campaign_recipients set clicked_at = coalesce(clicked_at, p_at), opened_at = coalesce(opened_at, p_at),
      status = case when status in ('sent', 'delivered', 'opened') then 'clicked'::public.recipient_status else status end
    where id = r.id;
    update public.messages set read_at = coalesce(read_at, p_at),
      status = case when status in ('sent', 'delivered') then 'read'::public.message_status else status end
    where id = m.id;
  elsif p_type = 'email.bounced' then
    v_metric := 'emails_bounced';
    update public.campaign_recipients set bounced_at = coalesce(bounced_at, p_at),
      status = case when status in ('unsubscribed', 'complained') then status else 'bounced'::public.recipient_status end,
      error = 'The email bounced' || coalesce(' (' || lower(p_bounce_type) || ')', '') || '.'
    where id = r.id;
    update public.messages set status = 'failed', error = 'The email bounced.' where id = m.id;
    if p_bounce_type is null or lower(p_bounce_type) in ('permanent', 'hard') then
      insert into public.do_not_contact (channel, value, reason, source, added_by_system, lead_id, note)
      values ('email', v_address, 'bounced', 'email_provider', 'resend', v_lead, 'Hard bounce reported by Resend')
      on conflict (channel, value_normalized) where removed_at is null do nothing;
    end if;
  elsif p_type = 'email.complained' then
    v_metric := 'emails_complained';
    update public.campaign_recipients set complained_at = coalesce(complained_at, p_at), opted_out_at = coalesce(opted_out_at, p_at),
      status = 'complained'
    where id = r.id;
    insert into public.do_not_contact (channel, value, reason, source, added_by_system, lead_id, note)
    values ('email', v_address, 'complained', 'email_provider', 'resend', v_lead, 'Marked as spam (reported by Resend)')
    on conflict (channel, value_normalized) where removed_at is null do nothing;
  elsif p_type = 'email.failed' then
    update public.campaign_recipients set failed_at = coalesce(failed_at, p_at), status = 'failed',
      error = 'Resend could not send the email.'
    where id = r.id and sent_at is not null and delivered_at is null;
    update public.messages set status = 'failed', error = 'Resend could not send the email.' where id = m.id and delivered_at is null;
  else
    return 'ignored: ' || coalesce(p_type, 'no type');
  end if;

  if v_metric is not null then
    insert into public.usage_counters (provider, metric, period_start, period_end, value, source)
    values ('resend', v_metric, p_period_start, p_period_end, 1, 'webhook')
    on conflict (provider, metric, period_start) do update set value = public.usage_counters.value + 1;
  end if;

  if r.id is not null and p_type in ('email.bounced', 'email.complained') then
    select * into v_c from public.campaigns where id = r.campaign_id for update;
    if v_c.status in ('sending', 'scheduled') then
      select count(*) filter (where sent_at is not null), count(*) filter (where bounced_at is not null),
             count(*) filter (where complained_at is not null)
      into v_sent, v_bounced, v_complained
      from public.campaign_recipients where campaign_id = v_c.id;
      v_min := coalesce((select (value ->> 'min_sample')::integer from public.settings where key = 'email.limits'), 50);
      if v_sent >= greatest(v_min, 1) then
        if v_c.bounce_limit_pct is not null and v_bounced * 100.0 / v_sent > v_c.bounce_limit_pct then
          v_reason := format('Paused automatically: %s%% of emails bounced (limit %s%%).', round(v_bounced * 100.0 / v_sent, 1), v_c.bounce_limit_pct);
        elsif v_c.complaint_limit_pct is not null and v_complained * 100.0 / v_sent > v_c.complaint_limit_pct then
          v_reason := format('Paused automatically: %s%% of emails were marked as spam (limit %s%%).', round(v_complained * 100.0 / v_sent, 2), v_c.complaint_limit_pct);
        end if;
        if v_reason is not null then
          update public.campaigns set status = 'paused', paused_reason = v_reason where id = v_c.id;
          insert into public.audit_log (action, entity_type, entity_id, details)
          values ('campaign.auto_paused', 'campaign', v_c.id::text,
                  jsonb_build_object('reason', v_reason, 'sent', v_sent, 'bounced', v_bounced, 'complained', v_complained));
        end if;
      end if;
    end if;
  end if;
  return 'processed';
end;
$$;
revoke all on function public.process_resend_event(text, text, timestamptz, text, date, date) from public, anon, authenticated;
grant execute on function public.process_resend_event(text, text, timestamptz, text, date, date) to service_role;

-- The unsubscribe link (SRS 8.4: every email has one). Adds the address to do-not-contact, which
-- opts the contact out and writes the consent log, and takes it out of every campaign still sending.
create or replace function public.unsubscribe_email(p_recipient uuid, p_message uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_address text;
  v_lead uuid;
  v_added integer;
begin
  if p_recipient is not null then
    select address, lead_id into v_address, v_lead from public.campaign_recipients where id = p_recipient;
  else
    select to_address, lead_id into v_address, v_lead from public.messages
    where id = p_message and channel = 'email' and direction = 'outbound';
  end if;
  if v_address is null then return jsonb_build_object('found', false); end if;

  insert into public.do_not_contact (channel, value, reason, source, added_by_system, lead_id, note)
  values ('email', v_address, 'unsubscribed', 'unsubscribe_link', 'unsubscribe link', v_lead, 'Used the unsubscribe link in an email')
  on conflict (channel, value_normalized) where removed_at is null do nothing;
  get diagnostics v_added = row_count;

  update public.campaign_recipients set opted_out_at = coalesce(opted_out_at, now()),
    status = case when status in ('complained', 'bounced') then status else 'unsubscribed'::public.recipient_status end
  where id = p_recipient;
  update public.campaign_recipients set status = 'skipped', error = 'Unsubscribed'
  where lower(address) = lower(v_address) and status = 'pending';
  if v_added > 0 then
    insert into public.usage_counters (provider, metric, period_start, period_end, value, source)
    values ('resend', 'emails_unsubscribed', date_trunc('month', now() at time zone 'Asia/Karachi')::date,
            (date_trunc('month', now() at time zone 'Asia/Karachi') + interval '1 month - 1 day')::date, 1, 'internal')
    on conflict (provider, metric, period_start) do update set value = public.usage_counters.value + 1;
  end if;
  return jsonb_build_object('found', true, 'address', v_address, 'already', v_added = 0);
end;
$$;
revoke all on function public.unsubscribe_email(uuid, uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_email(uuid, uuid) to service_role;

-- The owner chose MillionVerifier as the email verification service (SRS 9.3, 2026-11-04).
-- Only fills the setting when nobody has picked a service yet.
update public.settings set value = '"millionverifier"'
where key = 'email_verification.provider' and (value is null or value = 'null'::jsonb);

-- Test emails (Templates and campaign "send a test") count against the Resend plan cap too.
create or replace function public.record_test_email(p_period_start date, p_period_end date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.usage_counters (provider, metric, period_start, period_end, value, source)
  values ('resend', 'emails_sent', p_period_start, p_period_end, 1, 'internal')
  on conflict (provider, metric, period_start) do update set value = public.usage_counters.value + 1;
$$;
revoke all on function public.record_test_email(date, date) from public, anon, authenticated;
grant execute on function public.record_test_email(date, date) to service_role;
