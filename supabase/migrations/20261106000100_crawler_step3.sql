-- Step 3: website crawler (SRS 8.3 website-crawl queue, screen 4 failure panel, screen 6 crawled data).

-- 1. Crawl job bookkeeping for the worker.
alter table public.crawl_jobs
  add column job_id text,            -- the BullMQ job that holds this crawl; a retry of the same job may take it over
  add column enqueued_at timestamptz; -- when the row was handed to the queue; null means it still has to be
create index crawl_jobs_dispatch_idx on public.crawl_jobs (created_at) where status = 'queued';

-- 2. A Facebook page, Instagram profile or link page given as the "website" is not the business's own domain.
-- Before this, the second business with a Facebook page was taken as a duplicate of the first.
create or replace function public.normalize_domain(url text)
returns text
language sql
immutable
as $$
  select case
    when d is null then null
    when d in (
      'facebook.com', 'm.facebook.com', 'web.facebook.com', 'business.facebook.com', 'fb.com', 'fb.me',
      'instagram.com', 'linkedin.com', 'pk.linkedin.com', 'youtube.com', 'm.youtube.com', 'youtu.be',
      'tiktok.com', 'twitter.com', 'x.com', 'wa.me', 'api.whatsapp.com', 'whatsapp.com', 'chat.whatsapp.com',
      'linktr.ee', 'bio.link', 'sites.google.com', 'google.com', 'maps.google.com', 'g.page', 'goo.gl',
      'maps.app.goo.gl', 'bit.ly', 'tinyurl.com', 'foodpanda.pk', 'daraz.pk', 'olx.com.pk'
    ) then null
    else d
  end
  from (
    select nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(coalesce(url, ''))), '^[a-z][a-z0-9+.-]*://', ''),
          '[/?#:].*$', ''
        ),
        '^www\.', ''
      ),
      ''
    ) as d
  ) x;
$$;

-- Recompute existing rows (the leads_normalize trigger fires on update of website).
update public.leads set website = website where website_domain is not null and public.normalize_domain(website) is null;

-- 3. Hands queued crawls to the dispatcher. A row handed over more than two hours ago and still queued
-- (its Redis job was lost) is handed over again; the worker's claim makes a second copy harmless.
-- A crawl stuck as running for two hours (its worker died and the job was lost) goes back to the queue.
create or replace function public.take_crawls_to_enqueue(p_limit integer default 500)
returns table (id uuid, enqueued_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crawl_jobs j set status = 'queued', job_id = null, enqueued_at = null
  where j.status = 'running' and j.started_at < now() - interval '2 hours';

  return query
  update public.crawl_jobs c set enqueued_at = now()
  where c.id in (
    select j.id from public.crawl_jobs j
    where j.status = 'queued' and (j.enqueued_at is null or j.enqueued_at < now() - interval '2 hours')
    order by j.created_at
    limit greatest(1, least(p_limit, 2000))
    for update skip locked
  )
  returning c.id, c.enqueued_at;
end;
$$;
revoke all on function public.take_crawls_to_enqueue(integer) from public, anon, authenticated;
grant execute on function public.take_crawls_to_enqueue(integer) to service_role;

-- 4. Saves what the crawler found on one website, in one transaction.
-- p = { pages: [{url,title,status}], emails: [{value,source_url}], phones: [...], whatsapp: [...],
--       social: [{platform,url,source_url}], description, hints: {...} }
-- Returns null when the job no longer holds the crawl (another worker took it or the lead was deleted).
create or replace function public.save_crawl_result(p_crawl_id uuid, p_job_id text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.crawl_jobs;
  v_emails integer := 0;
  v_phones integer := 0;
  v_whatsapp integer := 0;
  v_social integer := 0;
  v_kind public.contact_kind;
  v_key text;
  v_n integer;
begin
  select * into v_job from public.crawl_jobs
  where id = p_crawl_id and status = 'running' and job_id = p_job_id
  for update;
  if not found then
    return null;
  end if;

  foreach v_key in array array['emails', 'phones', 'whatsapp'] loop
    v_kind := case v_key when 'emails' then 'email' when 'phones' then 'phone' else 'whatsapp' end::public.contact_kind;
    with found as (
      select distinct on (left(trim(e ->> 'value'), 200)) left(trim(e ->> 'value'), 200) as value, left(e ->> 'source_url', 500) as source_url
      from jsonb_array_elements(coalesce(p -> v_key, '[]'::jsonb)) e
      where nullif(trim(e ->> 'value'), '') is not null
      limit 20
    ), ins as (
      insert into public.lead_contacts (lead_id, kind, value, value_normalized, label, source, source_url)
      select v_job.lead_id, v_kind, f.value, '', 'Website', 'website', f.source_url from found f
      on conflict do nothing
      returning id, value, source_url
    ), logged as (
      insert into public.consent_log (lead_id, contact_id, channel, value, event, source, source_url, recorded_by_system, note)
      select v_job.lead_id, ins.id, case when v_kind = 'email' then 'email' when v_kind = 'whatsapp' then 'whatsapp' else 'phone' end::public.channel,
             ins.value, 'collected', 'website', ins.source_url, 'website-crawl', 'Found on the business website'
      from ins
      returning 1
    )
    select count(*) into v_n from logged;
    if v_kind = 'email' then v_emails := v_n; elsif v_kind = 'phone' then v_phones := v_n; else v_whatsapp := v_n; end if;
  end loop;

  with ins as (
    insert into public.lead_social_links (lead_id, platform, url, source_url)
    select distinct on (left(s ->> 'url', 500)) v_job.lead_id, s ->> 'platform', left(s ->> 'url', 500), left(s ->> 'source_url', 500)
    from jsonb_array_elements(coalesce(p -> 'social', '[]'::jsonb)) s
    where s ->> 'platform' in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'other')
      and s ->> 'url' ~ '^https?://'
    on conflict do nothing
    returning 1
  )
  select count(*) into v_social from ins;

  update public.leads set
    description = coalesce(description, nullif(left(trim(p ->> 'description'), 600), '')),
    crawl_hints = crawl_hints || coalesce(case when jsonb_typeof(p -> 'hints') = 'object' then p -> 'hints' end, '{}'::jsonb)
  where id = v_job.lead_id;

  update public.crawl_jobs set
    status = 'done',
    pages = coalesce(case when jsonb_typeof(p -> 'pages') = 'array' then p -> 'pages' end, '[]'::jsonb),
    pages_visited = coalesce(jsonb_array_length(case when jsonb_typeof(p -> 'pages') = 'array' then p -> 'pages' end), 0),
    error_reason = nullif(p ->> 'note', ''),
    finished_at = now()
  where id = p_crawl_id;

  return jsonb_build_object('emails', v_emails, 'phones', v_phones, 'whatsapp', v_whatsapp, 'social', v_social);
end;
$$;
revoke all on function public.save_crawl_result(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_crawl_result(uuid, text, jsonb) to service_role;

-- 5. Realtime for the Live Progress counters and failure panel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crawl_jobs') then
    alter publication supabase_realtime add table public.crawl_jobs;
  end if;
end;
$$;
