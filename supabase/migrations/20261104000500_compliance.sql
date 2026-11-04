-- Compliance: do-not-contact list and consent log.

create table public.do_not_contact (
  id uuid primary key default gen_random_uuid(),
  channel public.channel not null,
  value text not null,
  value_normalized text not null,
  reason public.dnc_reason not null,
  note text,
  lead_id uuid references public.leads (id) on delete set null,
  added_by uuid references public.users (id) on delete set null,
  added_by_system text,
  -- Removal needs Admin approval and a recorded reason; rows are never deleted.
  removed_at timestamptz,
  removed_by uuid references public.users (id) on delete set null,
  removal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dnc_removal_reason check (removed_at is null or (removed_by is not null and length(trim(removal_reason)) > 0))
);
create unique index do_not_contact_active_key on public.do_not_contact (channel, value_normalized)
  where removed_at is null;
create index do_not_contact_value_idx on public.do_not_contact (value_normalized);

create or replace function public.do_not_contact_normalize()
returns trigger
language plpgsql
as $$
begin
  if new.channel = 'email' then
    new.value_normalized := lower(trim(new.value));
  else
    new.value_normalized := coalesce(public.normalize_phone(new.value), trim(new.value));
  end if;
  return new;
end;
$$;
create trigger do_not_contact_normalize before insert or update of value, channel on public.do_not_contact
  for each row execute function public.do_not_contact_normalize();
create trigger do_not_contact_updated_at before update on public.do_not_contact
  for each row execute function public.set_updated_at();

-- Checked at the moment of sending by every send path (SRS 8.4).
-- A WhatsApp number on the list also blocks phone calls to the same number and vice versa.
create or replace function public.is_do_not_contact(p_channel public.channel, p_value text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.do_not_contact d
    where d.removed_at is null
      and d.value_normalized = case
        when p_channel = 'email' then lower(trim(p_value))
        else coalesce(public.normalize_phone(p_value), trim(p_value))
      end
      and (d.channel = p_channel or (p_channel <> 'email' and d.channel <> 'email'))
  );
$$;
revoke all on function public.is_do_not_contact(public.channel, text) from public;
grant execute on function public.is_do_not_contact(public.channel, text) to authenticated, service_role;

create table public.consent_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads (id) on delete set null,
  contact_id uuid references public.lead_contacts (id) on delete set null,
  channel public.channel not null,
  value text not null,
  event public.consent_event not null,
  source public.consent_source not null,
  source_url text,
  note text,
  recorded_by uuid references public.users (id) on delete set null,
  recorded_by_system text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consent_log_lead_idx on public.consent_log (lead_id, occurred_at);
create index consent_log_value_idx on public.consent_log (value);

-- The consent log is proof of where each contact came from, so it is append only.
create trigger consent_log_immutable before update or delete on public.consent_log
  for each row execute function public.append_only();
