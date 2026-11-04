-- Step 4: compliance base (SRS screens 14 and 15, email-verify queue in 8.3).

-- 1. Do-not-contact: where the entry came from, and its effect on the matching contacts.
alter table public.do_not_contact
  add column source public.consent_source not null default 'manual';

-- Fix: the step 1 check let a removal through when the reason was empty (null), because a null check passes.
alter table public.do_not_contact drop constraint dnc_removal_reason;
alter table public.do_not_contact add constraint dnc_removal_reason
  check (removed_at is null or (removed_by is not null and length(trim(coalesce(removal_reason, ''))) > 0));

-- Adding an entry marks matching contacts opted out (a bounce marks the email invalid instead)
-- and writes the opt-out to the consent log. Runs for every path: screen, import, later webhooks.
create or replace function public.do_not_contact_apply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kinds public.contact_kind[] := case when new.channel = 'email' then array['email']::public.contact_kind[]
                                        else array['phone', 'whatsapp']::public.contact_kind[] end;
  v_n integer;
begin
  if new.reason = 'bounced' then
    update public.lead_contacts set verification = 'invalid', verified_at = now(), verification_detail = 'The address bounced.'
    where kind = any (v_kinds) and value_normalized = new.value_normalized;
    return new;
  end if;

  with c as (
    update public.lead_contacts set consent_state = 'opted_out'
    where kind = any (v_kinds) and value_normalized = new.value_normalized
    returning id, lead_id, kind, value
  ), logged as (
    insert into public.consent_log (lead_id, contact_id, channel, value, event, source, note, recorded_by, recorded_by_system)
    select c.lead_id, c.id, case when c.kind = 'email' then 'email' when c.kind = 'whatsapp' then 'whatsapp' else 'phone' end::public.channel,
           c.value, 'opt_out', new.source, 'Added to do-not-contact: ' || replace(new.reason::text, '_', ' '), new.added_by, new.added_by_system
    from c
    returning 1
  )
  select count(*) into v_n from logged;

  if v_n = 0 then
    insert into public.consent_log (lead_id, channel, value, event, source, note, recorded_by, recorded_by_system)
    values (new.lead_id, new.channel, new.value, 'opt_out', new.source,
            'Added to do-not-contact: ' || replace(new.reason::text, '_', ' '), new.added_by, new.added_by_system);
  end if;

  if new.lead_id is null then
    update public.do_not_contact d set lead_id = (
      select lc.lead_id from public.lead_contacts lc
      where lc.kind = any (v_kinds) and lc.value_normalized = new.value_normalized
      order by lc.created_at limit 1
    ) where d.id = new.id;
  end if;
  return new;
end;
$$;
create trigger do_not_contact_apply after insert on public.do_not_contact
  for each row execute function public.do_not_contact_apply();

-- Adds many entries at once (Add dialog, CSV import). Runs with the caller's rights, so RLS applies.
-- p_rows = [{value, channel?, reason?, note?}]; the channel is guessed from the value when missing.
create or replace function public.add_do_not_contact(
  p_rows jsonb,
  p_default_reason public.dnc_reason,
  p_source public.consent_source,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_added integer := 0;
  v_skipped integer := 0;
  v_invalid integer := 0;
  r jsonb;
  v_value text;
  v_channel public.channel;
  v_reason public.dnc_reason;
  v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Send at most 10,000 rows at a time.';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_value := left(trim(coalesce(r ->> 'value', '')), 200);
    begin
      v_channel := coalesce(nullif(lower(trim(r ->> 'channel')), '')::public.channel,
                            case when v_value like '%@%' then 'email' else 'phone' end::public.channel);
      v_reason := coalesce(nullif(lower(trim(r ->> 'reason')), '')::public.dnc_reason, p_default_reason);
    exception when invalid_text_representation then
      v_invalid := v_invalid + 1;
      continue;
    end;
    if v_value = ''
       or (v_channel = 'email' and v_value !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$')
       or (v_channel <> 'email' and length(regexp_replace(v_value, '\D', '', 'g')) < 7) then
      v_invalid := v_invalid + 1;
      continue;
    end if;
    insert into public.do_not_contact (channel, value, value_normalized, reason, note, source, added_by)
    values (v_channel, v_value, '', v_reason, coalesce(nullif(left(trim(r ->> 'note'), 500), ''), p_note), p_source, auth.uid())
    on conflict (channel, value_normalized) where removed_at is null do nothing
    returning id into v_id;
    if v_id is null then v_skipped := v_skipped + 1; else v_added := v_added + 1; end if;
    v_id := null;
  end loop;
  return jsonb_build_object('added', v_added, 'already', v_skipped, 'invalid', v_invalid);
end;
$$;
grant execute on function public.add_do_not_contact(jsonb, public.dnc_reason, public.consent_source, text) to authenticated;

-- Removal (Admin only, through RLS) puts the matching contacts back to "unknown" consent.
-- The consent log keeps the opt-out; the removal and its reason are on the entry and in the audit log.
create or replace function public.do_not_contact_removed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.removed_at is null and new.removed_at is not null then
    if new.removed_by is distinct from auth.uid() and auth.uid() is not null then
      raise exception 'removed_by must be the signed-in user';
    end if;
    update public.lead_contacts set consent_state = 'unknown'
    where consent_state = 'opted_out'
      and kind = any (case when new.channel = 'email' then array['email']::public.contact_kind[] else array['phone', 'whatsapp']::public.contact_kind[] end)
      and value_normalized = new.value_normalized
      and not exists (
        select 1 from public.do_not_contact d
        where d.id <> new.id and d.removed_at is null and d.value_normalized = new.value_normalized
      );
  elsif old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'A removed entry cannot be restored; add it again instead.';
  end if;
  if new.value is distinct from old.value or new.channel is distinct from old.channel or new.reason is distinct from old.reason then
    raise exception 'A do-not-contact entry cannot be edited; remove it and add a new one.';
  end if;
  return new;
end;
$$;
create trigger do_not_contact_removed before update on public.do_not_contact
  for each row execute function public.do_not_contact_removed();

-- 2. Email verification (email-verify queue).
alter table public.lead_contacts
  add column verification_detail text,
  add column verify_requested_at timestamptz,
  add column verify_enqueued_at timestamptz,
  add column verify_job_id text;
create index lead_contacts_verify_idx on public.lead_contacts (verify_requested_at)
  where verify_requested_at is not null and kind = 'email';

insert into public.settings (key, category, value) values
  ('verification.options', 'defaults', '{"auto_verify_new": false}'),
  ('email_verification.provider', 'integrations', 'null')
on conflict (key) do nothing;
insert into public.settings (key, category, is_secret) values
  ('email_verification.api_key', 'integrations', true)
on conflict (key) do nothing;

-- Asks for emails to be verified. Signed-in Admins and Lead experts only; returns how many were asked.
create or replace function public.request_email_verification(p_lead_ids uuid[], p_recheck boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is not null and not public.has_role('admin', 'lead_expert') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.lead_contacts set verify_requested_at = now(), verify_enqueued_at = null, verify_job_id = null
  where kind = 'email' and lead_id = any (p_lead_ids)
    and (p_recheck or verification = 'unverified')
    and verify_requested_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.request_email_verification(uuid[], boolean) from public, anon;
grant execute on function public.request_email_verification(uuid[], boolean) to authenticated, service_role;

-- Count of emails a request would send for checking, for the budget check before queuing.
create or replace function public.count_emails_to_verify(p_lead_ids uuid[], p_recheck boolean default false)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::int from public.lead_contacts
  where kind = 'email' and lead_id = any (p_lead_ids)
    and (p_recheck or verification = 'unverified') and verify_requested_at is null;
$$;
grant execute on function public.count_emails_to_verify(uuid[], boolean) to authenticated, service_role;

-- New crawled emails are verified automatically when the Admin turned that on.
create or replace function public.lead_contacts_auto_verify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'email' and new.verification = 'unverified' and new.verify_requested_at is null
     and coalesce((select (value ->> 'auto_verify_new')::boolean from public.settings where key = 'verification.options'), false) then
    new.verify_requested_at := now();
  end if;
  return new;
end;
$$;
create trigger lead_contacts_auto_verify before insert on public.lead_contacts
  for each row execute function public.lead_contacts_auto_verify();

-- Hands requested checks to the dispatcher; lost or stuck ones are handed over again after two hours.
create or replace function public.take_emails_to_verify(p_limit integer default 500)
returns table (id uuid, enqueued_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.lead_contacts c set verify_enqueued_at = now(), verify_job_id = null
  where c.id in (
    select x.id from public.lead_contacts x
    where x.kind = 'email' and x.verify_requested_at is not null
      and (x.verify_enqueued_at is null or x.verify_enqueued_at < now() - interval '2 hours')
    order by x.verify_requested_at
    limit greatest(1, least(p_limit, 2000))
    for update skip locked
  )
  returning c.id, c.verify_enqueued_at;
end;
$$;
revoke all on function public.take_emails_to_verify(integer) from public, anon, authenticated;
grant execute on function public.take_emails_to_verify(integer) to service_role;

-- 3. Consent log search and export: one view joining the lead name for the screen.
create or replace view public.consent_log_view
with (security_invoker = true)
as
select cl.id, cl.occurred_at, cl.lead_id, l.name as lead_name, l.product, cl.channel, cl.value, cl.event, cl.source,
       cl.source_url, cl.note, cl.recorded_by, u.full_name as recorded_by_name, cl.recorded_by_system
from public.consent_log cl
left join public.leads l on l.id = cl.lead_id
left join public.users u on u.id = cl.recorded_by;
grant select on public.consent_log_view to authenticated;
revoke all on public.consent_log_view from anon;

create index if not exists consent_log_occurred_idx on public.consent_log (occurred_at desc);
create index if not exists consent_log_value_lower_idx on public.consent_log (lower(value));
create index if not exists do_not_contact_created_idx on public.do_not_contact (created_at desc);

-- 4. Fix: the consent log was fully append only, so deleting or merging a lead (which re-links or
-- clears lead_id and contact_id) failed. Re-linking is now allowed; the record itself still cannot change.
create or replace function public.consent_log_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'consent_log is append only: rows cannot be deleted';
  end if;
  if (to_jsonb(new) - array['lead_id', 'contact_id', 'updated_at']) is distinct from (to_jsonb(old) - array['lead_id', 'contact_id', 'updated_at']) then
    raise exception 'consent_log is append only: rows cannot be changed';
  end if;
  return new;
end;
$$;
drop trigger consent_log_immutable on public.consent_log;
create trigger consent_log_immutable before update or delete on public.consent_log
  for each row execute function public.consent_log_guard();

-- 5. Fix: deleting a lead removes its contacts, and the contact history trigger then tried to write
-- a history row for the lead being deleted, so a signed-in user could not delete or merge leads.
create or replace function public.log_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    insert into public.lead_field_changes (lead_id, field, old_value, new_value, changed_by)
    values (new.lead_id, new.kind::text, null, new.value, auth.uid());
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.leads where id = old.lead_id) then
      insert into public.lead_field_changes (lead_id, field, old_value, new_value, changed_by)
      values (old.lead_id, old.kind::text, old.value, null, auth.uid());
    end if;
  elsif old.value is distinct from new.value then
    insert into public.lead_field_changes (lead_id, field, old_value, new_value, changed_by)
    values (new.lead_id, new.kind::text, old.value, new.value, auth.uid());
  end if;
  return coalesce(new, old);
end;
$$;
