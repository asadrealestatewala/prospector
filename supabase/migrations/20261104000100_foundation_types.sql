-- Prospector foundation: extensions, enums and shared helpers.
-- SRS 8.1. All schedules use Pakistan time; timestamps are stored as timestamptz.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

-- Roles from SRS section 2.
create type public.app_role as enum ('admin', 'manager', 'lead_expert', 'sales_agent');
create type public.user_status as enum ('invited', 'active', 'deactivated');

create type public.product as enum ('classwell', 'vetlin', 'postwala');
create type public.channel as enum ('email', 'whatsapp', 'phone');

create type public.lead_status as enum (
  'new', 'contacted', 'replied', 'demo_booked', 'trial', 'won', 'lost'
);
create type public.search_status as enum (
  'draft', 'scheduled', 'queued', 'running', 'paused', 'done', 'failed', 'cancelled'
);
create type public.city_status as enum ('queued', 'running', 'paused', 'done', 'failed', 'cancelled');
create type public.crawl_status as enum ('queued', 'running', 'done', 'failed', 'blocked_by_robots');
create type public.contact_kind as enum ('email', 'phone', 'whatsapp');
create type public.verification_result as enum ('unverified', 'valid', 'risky', 'invalid');
create type public.consent_state as enum ('unknown', 'opted_in', 'opted_out');
create type public.consent_source as enum (
  'google_listing', 'website', 'form', 'inbound_message', 'import', 'manual'
);
create type public.consent_event as enum ('collected', 'opt_in', 'opt_out');

create type public.template_language as enum ('en', 'ur');
create type public.template_approval as enum ('draft', 'pending', 'approved', 'rejected');
create type public.whatsapp_category as enum ('marketing', 'utility', 'service', 'authentication');
create type public.campaign_status as enum (
  'draft', 'scheduled', 'sending', 'paused', 'done', 'stopped'
);
create type public.recipient_status as enum (
  'pending', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'replied',
  'failed', 'bounced', 'complained', 'unsubscribed', 'opted_out', 'skipped'
);
create type public.ab_status as enum ('draft', 'running', 'decided', 'cancelled');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_status as enum (
  'queued', 'sent', 'delivered', 'read', 'failed', 'received'
);
create type public.dnc_reason as enum (
  'unsubscribed', 'replied_stop', 'complained', 'bounced', 'manual'
);
create type public.webhook_status as enum ('pending', 'processed', 'failed', 'ignored');

-- Keeps updated_at current on every table.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Lowercase host without "www." from any URL or bare domain. Used for lead de-duplication.
create or replace function public.normalize_domain(url text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(coalesce(url, ''))), '^[a-z][a-z0-9+.-]*://', ''),
        '[/?#:].*$', ''
      ),
      '^www\.', ''
    ),
    ''
  );
$$;

-- Pakistani phone numbers to E.164 (+92...). Other numbers keep their digits with a leading +.
create or replace function public.normalize_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text := regexp_replace(coalesce(raw, ''), '\D', '', 'g');
begin
  if digits = '' then
    return null;
  end if;
  if digits like '0092%' then
    digits := substr(digits, 3);
  elsif digits like '03%' and length(digits) = 11 then
    digits := '92' || substr(digits, 2);
  elsif digits like '3%' and length(digits) = 10 then
    digits := '92' || digits;
  elsif digits like '0%' and length(digits) between 10 and 11 then
    digits := '92' || substr(digits, 2);
  end if;
  return '+' || digits;
end;
$$;
