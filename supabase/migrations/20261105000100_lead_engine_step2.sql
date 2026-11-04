-- Step 2, lead engine: progress checkpoints, lead summary columns, scoring, notes, saved views,
-- per-product Google usage and the functions the places-search worker calls.

-- Search checkpoints so a paused or restarted city carries on where it stopped.
alter table public.search_cities
  add column keyword_index integer not null default 0 check (keyword_index >= 0),
  add column latitude double precision,
  add column longitude double precision,
  add column job_id text,
  add column cost_pkr numeric(14, 4) not null default 0;

alter table public.searches
  add column paused_at timestamptz,
  add column cancelled_at timestamptz,
  add column source_template_id uuid references public.searches (id) on delete set null;
create index searches_scheduled_idx on public.searches (scheduled_at) where status = 'scheduled';
create index searches_templates_idx on public.searches (created_at desc) where is_saved_template;

-- Summary columns on leads so the Leads table can filter 100,000 rows quickly (SRS 8.5).
-- They are kept in step with lead_contacts by a trigger and never edited directly.
alter table public.leads
  add column email text,
  add column whatsapp text,
  add column last_replied_at timestamptz,
  add column demo_at timestamptz,
  add column trial_ends_at timestamptz,
  add column demo_notes text,
  add column google_maps_url text;
create index leads_email_present_idx on public.leads (created_at desc) where email is not null;
create index leads_whatsapp_present_idx on public.leads (created_at desc) where whatsapp is not null;
create index leads_website_present_idx on public.leads (created_at desc) where website is not null;
create index leads_name_city_idx on public.leads (lower(name), city);

-- Lead score: points for a website, verified email, WhatsApp number, many reviews and a recent reply.
-- Point values come from the scoring.rules setting, editable on the Settings screen (SRS 8.4).
insert into public.settings (key, category, value) values
  ('scoring.rules', 'scoring', '{"website": 10, "email": 5, "verified_email": 20, "whatsapp": 20, "reviews": 10, "reviews_min": 20, "recent_reply": 30, "recent_reply_days": 14}'),
  ('search.city_groups', 'search', '[]')
on conflict (key) do nothing;

create or replace function public.compute_lead_score(p_lead public.leads)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r jsonb;
  s integer := 0;
  has_verified boolean;
begin
  select value into r from public.settings where key = 'scoring.rules';
  r := coalesce(r, '{}'::jsonb);
  if p_lead.website_domain is not null then s := s + coalesce((r ->> 'website')::int, 0); end if;
  if p_lead.email is not null then
    select exists (
      select 1 from public.lead_contacts c
      where c.lead_id = p_lead.id and c.kind = 'email' and c.verification = 'valid'
    ) into has_verified;
    s := s + case when has_verified then coalesce((r ->> 'verified_email')::int, 0) else coalesce((r ->> 'email')::int, 0) end;
  end if;
  if p_lead.whatsapp is not null then s := s + coalesce((r ->> 'whatsapp')::int, 0); end if;
  if coalesce(p_lead.google_review_count, 0) >= coalesce((r ->> 'reviews_min')::int, 2147483647) then
    s := s + coalesce((r ->> 'reviews')::int, 0);
  end if;
  if p_lead.last_replied_at is not null
     and p_lead.last_replied_at > now() - make_interval(days => coalesce((r ->> 'recent_reply_days')::int, 0)) then
    s := s + coalesce((r ->> 'recent_reply')::int, 0);
  end if;
  return s;
end;
$$;
revoke all on function public.compute_lead_score(public.leads) from public, anon, authenticated;
grant execute on function public.compute_lead_score(public.leads) to authenticated, service_role;

create or replace function public.leads_set_score()
returns trigger
language plpgsql
as $$
begin
  new.score := public.compute_lead_score(new);
  return new;
end;
$$;
-- Runs after leads_normalize (triggers fire in name order) so website_domain is current.
create trigger leads_zz_score before insert or update of website, email, whatsapp, google_review_count, last_replied_at
  on public.leads for each row execute function public.leads_set_score();

-- Keeps leads.email and leads.whatsapp in step with the contacts found for the lead.
create or replace function public.lead_contacts_sync_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead uuid := coalesce(new.lead_id, old.lead_id);
begin
  update public.leads l set
    email = (
      select c.value from public.lead_contacts c
      where c.lead_id = v_lead and c.kind = 'email' and c.verification <> 'invalid'
      order by c.is_primary desc, (c.verification = 'valid') desc, c.created_at
      limit 1
    ),
    whatsapp = (
      select c.value from public.lead_contacts c
      where c.lead_id = v_lead and c.kind = 'whatsapp'
      order by c.is_primary desc, c.created_at
      limit 1
    )
  where l.id = v_lead;
  -- Verification changes the score without changing the summary columns.
  update public.leads l set score = public.compute_lead_score(l) where l.id = v_lead;
  return null;
end;
$$;
create trigger lead_contacts_sync_lead after insert or update or delete on public.lead_contacts
  for each row execute function public.lead_contacts_sync_lead();

-- Recalculates every score after the Admin changes the point values.
create or replace function public.recalculate_lead_scores()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an Admin can recalculate scores' using errcode = '42501';
  end if;
  update public.leads l set score = public.compute_lead_score(l)
  where l.score is distinct from public.compute_lead_score(l);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.recalculate_lead_scores() from public, anon, authenticated;
grant execute on function public.recalculate_lead_scores() to authenticated, service_role;

-- Notes and logged calls on the Lead Detail timeline.
create table public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'call')),
  body text not null check (length(trim(body)) > 0),
  author_id uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);
create trigger lead_notes_updated_at before update on public.lead_notes
  for each row execute function public.set_updated_at();
alter table public.lead_notes enable row level security;
alter table public.lead_notes force row level security;
revoke all on public.lead_notes from anon;
create policy lead_notes_select on public.lead_notes for select to authenticated using ((select public.is_staff()));
create policy lead_notes_insert on public.lead_notes for insert to authenticated
  with check ((select public.is_staff()) and author_id = (select auth.uid()));

-- Every edit of a lead's contact fields, with who changed it and when (SRS screen 6).
create table public.lead_field_changes (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads (id) on delete cascade,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid references public.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_field_changes_lead_idx on public.lead_field_changes (lead_id, changed_at desc);
-- Rows are never edited. They are removed only together with their lead (no delete policy exists).
create trigger lead_field_changes_immutable before update on public.lead_field_changes
  for each row execute function public.append_only();
alter table public.lead_field_changes enable row level security;
alter table public.lead_field_changes force row level security;
revoke all on public.lead_field_changes from anon;
create policy lead_field_changes_select on public.lead_field_changes for select to authenticated
  using ((select public.is_staff()));

create or replace function public.log_lead_field_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f text;
  o text;
  n text;
begin
  -- Changes made by the search worker (no signed-in user) are refreshes from Google, not edits.
  if auth.uid() is null then
    return new;
  end if;
  foreach f in array array['name', 'phone', 'website', 'address', 'city', 'area', 'business_type'] loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into o, n using old, new;
    if o is distinct from n then
      insert into public.lead_field_changes (lead_id, field, old_value, new_value, changed_by)
      values (new.id, f, o, n, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;
create trigger leads_log_field_changes after update on public.leads
  for each row execute function public.log_lead_field_changes();

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
    insert into public.lead_field_changes (lead_id, field, old_value, new_value, changed_by)
    values (old.lead_id, old.kind::text, old.value, null, auth.uid());
  elsif old.value is distinct from new.value then
    insert into public.lead_field_changes (lead_id, field, old_value, new_value, changed_by)
    values (new.lead_id, new.kind::text, old.value, new.value, auth.uid());
  end if;
  return coalesce(new, old);
end;
$$;
create trigger lead_contacts_log_changes after insert or update or delete on public.lead_contacts
  for each row execute function public.log_contact_changes();

-- Saved views on the Leads screen. Each user owns their views; shared ones are visible to all staff.
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade default auth.uid(),
  screen text not null check (screen in ('leads')),
  name text not null check (length(trim(name)) between 1 and 80),
  params jsonb not null default '{}'::jsonb,
  columns text[] not null default '{}',
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, screen, name)
);
create trigger saved_views_updated_at before update on public.saved_views
  for each row execute function public.set_updated_at();
alter table public.saved_views enable row level security;
alter table public.saved_views force row level security;
revoke all on public.saved_views from anon;
create policy saved_views_select on public.saved_views for select to authenticated
  using ((select public.is_staff()) and (user_id = (select auth.uid()) or is_shared));
create policy saved_views_write on public.saved_views for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and (select public.is_staff()));

-- Google usage per product so product budgets can be checked.
alter table public.api_usage add column product public.product;
alter table public.api_usage drop constraint api_usage_day_provider_item_key;
alter table public.api_usage add constraint api_usage_day_provider_item_product_key
  unique nulls not distinct (day, provider, item, product);

-- Called by the worker after each paid call. Adds calls and cost to today's row atomically.
create or replace function public.record_api_usage(
  p_provider text, p_item text, p_product public.product, p_calls integer, p_cost_pkr numeric, p_rate_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Karachi')::date;
begin
  insert into public.api_usage (day, provider, item, product, calls, cost_pkr, rate_id)
  values (v_day, p_provider, p_item, p_product, p_calls, p_cost_pkr, p_rate_id)
  on conflict (day, provider, item, product) do update
    set calls = public.api_usage.calls + excluded.calls,
        cost_pkr = public.api_usage.cost_pkr + excluded.cost_pkr,
        rate_id = excluded.rate_id;

  insert into public.usage_counters (provider, metric, period_start, period_end, value)
  values (p_provider, 'google_calls', date_trunc('month', v_day)::date,
          (date_trunc('month', v_day) + interval '1 month - 1 day')::date, p_calls)
  on conflict (provider, metric, period_start) do update
    set value = public.usage_counters.value + excluded.value;
end;
$$;
revoke all on function public.record_api_usage(text, text, public.product, integer, numeric, uuid) from public, anon, authenticated;
grant execute on function public.record_api_usage(text, text, public.product, integer, numeric, uuid) to service_role;

-- Saves one business found by Google. Returns 'inserted', 'updated' or 'duplicate'.
-- Duplicates are matched by place ID, then phone, then website domain (the unique indexes).
create or replace function public.save_place_lead(
  p_search_id uuid,
  p_city text,
  p_area text,
  p jsonb,
  p_skip_existing boolean,
  p_auto_crawl boolean
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search public.searches;
  v_id uuid;
  v_phone text := nullif(trim(p ->> 'phone'), '');
  v_website text := nullif(trim(p ->> 'website'), '');
  v_existing uuid;
begin
  select * into v_search from public.searches where id = p_search_id;

  insert into public.leads (
    name, product, business_type, city, area, address, latitude, longitude, phone, website,
    google_place_id, google_rating, google_review_count, opening_hours, google_maps_url, source_search_id
  ) values (
    p ->> 'name', v_search.product, p ->> 'keyword', p_city, p_area, p ->> 'address',
    (p ->> 'lat')::double precision, (p ->> 'lng')::double precision, v_phone, v_website,
    p ->> 'place_id', (p ->> 'rating')::numeric, (p ->> 'reviews')::int, p -> 'hours', p ->> 'maps_url', p_search_id
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    if not p_skip_existing then
      -- Refresh the Google facts on the existing record; owner, status and product stay as they are.
      select id into v_existing from public.leads
      where google_place_id = p ->> 'place_id'
         or (v_phone is not null and phone_e164 = public.normalize_phone(v_phone))
         or (v_website is not null and website_domain = public.normalize_domain(v_website))
      limit 1;
      if v_existing is not null then
        update public.leads set
          google_rating = coalesce((p ->> 'rating')::numeric, google_rating),
          google_review_count = coalesce((p ->> 'reviews')::int, google_review_count),
          opening_hours = coalesce(p -> 'hours', opening_hours),
          google_maps_url = coalesce(p ->> 'maps_url', google_maps_url)
        where id = v_existing;
        return 'updated';
      end if;
    end if;
    return 'duplicate';
  end if;

  if v_phone is not null then
    with c as (
      insert into public.lead_contacts (lead_id, kind, value, value_normalized, label, source, is_primary)
      values (v_id, 'phone', v_phone, '', 'Google listing', 'google_listing', true)
      on conflict do nothing
      returning id, value
    )
    insert into public.consent_log (lead_id, contact_id, channel, value, event, source, recorded_by_system, note)
    select v_id, c.id, 'phone', c.value, 'collected', 'google_listing', 'places-search', 'Phone listed on Google'
    from c;
  end if;

  if p_auto_crawl and v_website is not null then
    insert into public.crawl_jobs (lead_id, search_id, url) values (v_id, p_search_id, v_website);
  end if;

  return 'inserted';
end;
$$;
revoke all on function public.save_place_lead(uuid, text, text, jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_place_lead(uuid, text, text, jsonb, boolean, boolean) to service_role;

-- Marks the search done once every city has finished, failed or been cancelled.
create or replace function public.finish_search_if_complete(p_search_id uuid)
returns public.search_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open integer;
  v_done integer;
  v_status public.search_status;
begin
  select count(*) filter (where status in ('queued', 'running', 'paused')),
         count(*) filter (where status = 'done')
    into v_open, v_done
  from public.search_cities where search_id = p_search_id;

  update public.searches s set
    status = case when v_done > 0 then 'done'::public.search_status else 'failed'::public.search_status end,
    finished_at = now()
  where s.id = p_search_id and v_open = 0 and s.status in ('running', 'queued')
  returning s.status into v_status;

  return coalesce(v_status, (select status from public.searches where id = p_search_id));
end;
$$;
revoke all on function public.finish_search_if_complete(uuid) from public, anon, authenticated;
grant execute on function public.finish_search_if_complete(uuid) to service_role;

-- Totals on the search row, from its cities. Each city is worked by one job at a time.
create or replace function public.refresh_search_totals(p_search_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.searches s set
    actual_calls = t.calls,
    actual_cost_pkr = round(t.cost, 2)
  from (
    select coalesce(sum(api_calls), 0)::int as calls, coalesce(sum(cost_pkr), 0) as cost
    from public.search_cities where search_id = p_search_id
  ) t
  where s.id = p_search_id;
$$;

-- Counters for the Live Progress screen. Runs with the caller's rights, so row-level security applies.
create or replace function public.search_progress(p_search_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'cities_total', (select count(*) from public.search_cities where search_id = p_search_id),
    'cities_done', (select count(*) from public.search_cities where search_id = p_search_id and status in ('done', 'failed', 'cancelled')),
    'found', (select coalesce(sum(found_count), 0) from public.search_cities where search_id = p_search_id),
    'saved', (select coalesce(sum(saved_count), 0) from public.search_cities where search_id = p_search_id),
    'duplicates', (select coalesce(sum(duplicate_count), 0) from public.search_cities where search_id = p_search_id),
    'api_calls', (select coalesce(sum(api_calls), 0) from public.search_cities where search_id = p_search_id),
    'websites_queued', (select count(*) from public.crawl_jobs where search_id = p_search_id and status in ('queued', 'running')),
    'websites_crawled', (select count(*) from public.crawl_jobs where search_id = p_search_id and status = 'done'),
    'failed_crawls', (select count(*) from public.crawl_jobs where search_id = p_search_id and status in ('failed', 'blocked_by_robots')),
    'emails_found', (select count(*) from public.lead_contacts c join public.leads l on l.id = c.lead_id
                     where l.source_search_id = p_search_id and c.kind = 'email'),
    'whatsapp_found', (select count(*) from public.lead_contacts c join public.leads l on l.id = c.lead_id
                       where l.source_search_id = p_search_id and c.kind = 'whatsapp')
  );
$$;
grant execute on function public.search_progress(uuid) to authenticated;

-- Possible duplicates the unique keys cannot catch: same business name in the same city.
create or replace function public.lead_duplicate_groups(p_limit integer default 50)
returns table (name_key text, city text, lead_ids uuid[], names text[], lead_count integer)
language sql
stable
set search_path = public
as $$
  select lower(regexp_replace(l.name, '[^[:alnum:]]+', '', 'g')) as name_key,
         l.city,
         array_agg(l.id order by l.created_at) as lead_ids,
         array_agg(l.name order by l.created_at) as names,
         count(*)::int as lead_count
  from public.leads l
  group by 1, 2
  having count(*) > 1
  order by count(*) desc, 1
  limit greatest(1, least(p_limit, 200));
$$;
grant execute on function public.lead_duplicate_groups(integer) to authenticated;

-- Merges duplicates into one lead: contacts, links, notes, events and tasks move to the kept lead.
create or replace function public.merge_leads(p_keep uuid, p_merge uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  v_phone text;
  v_website text;
  v_address text;
  v_tags text[];
begin
  if not public.has_role('admin', 'manager', 'lead_expert') then
    raise exception 'You do not have access to merge leads' using errcode = '42501';
  end if;
  if p_keep = any (p_merge) then
    raise exception 'The kept lead cannot also be merged away';
  end if;

  -- Move contacts that the kept lead does not already have.
  update public.lead_contacts c set lead_id = p_keep
  where c.lead_id = any (p_merge)
    and not exists (select 1 from public.lead_contacts k where k.lead_id = p_keep and k.kind = c.kind and k.value_normalized = c.value_normalized);
  update public.lead_social_links s set lead_id = p_keep
  where s.lead_id = any (p_merge)
    and not exists (select 1 from public.lead_social_links k where k.lead_id = p_keep and k.url = s.url);
  update public.lead_notes set lead_id = p_keep where lead_id = any (p_merge);
  update public.pipeline_events set lead_id = p_keep where lead_id = any (p_merge);
  update public.tasks set lead_id = p_keep where lead_id = any (p_merge);
  update public.crawl_jobs set lead_id = p_keep where lead_id = any (p_merge);
  update public.consent_log set lead_id = p_keep where lead_id = any (p_merge);
  update public.do_not_contact set lead_id = p_keep where lead_id = any (p_merge);

  -- Remember what the merged leads knew, remove them (freeing their unique phone and website),
  -- then fill the gaps on the kept lead and combine the tags.
  select (array_agg(phone order by created_at) filter (where phone is not null))[1],
         (array_agg(website order by created_at) filter (where website is not null))[1],
         (array_agg(address order by created_at) filter (where address is not null))[1],
         coalesce((select array_agg(distinct t) from public.leads l2, unnest(l2.tags) t where l2.id = any (p_merge)), '{}')
    into v_phone, v_website, v_address, v_tags
  from public.leads where id = any (p_merge);

  delete from public.leads where id = any (p_merge);
  get diagnostics n = row_count;

  update public.leads k set
    phone = coalesce(k.phone, v_phone),
    website = coalesce(k.website, v_website),
    address = coalesce(k.address, v_address),
    tags = (select array(select distinct x from unnest(k.tags || v_tags) x))
  where k.id = p_keep;

  return n;
end;
$$;
revoke all on function public.merge_leads(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.merge_leads(uuid, uuid[]) to authenticated;

-- Live feed and failure panel updates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.lead_contacts;
  end if;
end;
$$;

-- Function rights. Postgres lets PUBLIC run new functions and Supabase also grants them to anon,
-- so anonymous visitors lose them all, signed-in staff keep them, and the worker-only ones are
-- closed to signed-in users again.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public revoke execute on functions from public, anon;
revoke execute on function public.record_api_usage(text, text, public.product, integer, numeric, uuid) from authenticated;
revoke execute on function public.save_place_lead(uuid, text, text, jsonb, boolean, boolean) from authenticated;
revoke execute on function public.finish_search_if_complete(uuid) from authenticated;
revoke execute on function public.refresh_search_totals(uuid) from authenticated;
