-- Lead engine: searches, cities, leads, contacts, social links and crawl jobs.

create table public.searches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product public.product not null,
  business_types text[] not null default '{}',
  keywords text[] not null default '{}',
  options jsonb not null default '{}'::jsonb, -- max per city, min rating, require website, skip existing, auto crawl
  status public.search_status not null default 'draft',
  is_saved_template boolean not null default false,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  estimated_calls integer not null default 0,
  estimated_cost_pkr numeric(14, 2) not null default 0,
  actual_calls integer not null default 0,
  actual_cost_pkr numeric(14, 2) not null default 0,
  error text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index searches_status_idx on public.searches (status, created_at desc);
create trigger searches_updated_at before update on public.searches
  for each row execute function public.set_updated_at();

create table public.search_cities (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references public.searches (id) on delete cascade,
  city text not null,
  area text,
  radius_m integer,
  status public.city_status not null default 'queued',
  found_count integer not null default 0,
  saved_count integer not null default 0,
  duplicate_count integer not null default 0,
  api_calls integer not null default 0,
  next_page_token text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (search_id, city, area)
);
create index search_cities_search_idx on public.search_cities (search_id);
create trigger search_cities_updated_at before update on public.search_cities
  for each row execute function public.set_updated_at();

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product public.product not null,
  business_type text,
  city text,
  area text,
  address text,
  latitude double precision,
  longitude double precision,
  phone text,
  phone_e164 text,
  website text,
  website_domain text,
  google_place_id text,
  google_rating numeric(2, 1),
  google_review_count integer,
  opening_hours jsonb,
  description text,
  crawl_hints jsonb not null default '{}'::jsonb, -- product hints such as class levels or services
  score integer not null default 0,
  status public.lead_status not null default 'new',
  owner_id uuid references public.users (id) on delete set null,
  source_search_id uuid references public.searches (id) on delete set null,
  tags text[] not null default '{}',
  next_follow_up_at timestamptz,
  last_contacted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- SRS 8.4: a lead is unique by Google place ID, then phone, then website domain.
create unique index leads_place_id_key on public.leads (google_place_id) where google_place_id is not null;
create unique index leads_phone_key on public.leads (phone_e164) where phone_e164 is not null;
create unique index leads_domain_key on public.leads (website_domain) where website_domain is not null;
create index leads_product_status_idx on public.leads (product, status);
create index leads_city_idx on public.leads (city);
create index leads_owner_idx on public.leads (owner_id);
create index leads_source_idx on public.leads (source_search_id);
create index leads_created_idx on public.leads (created_at desc);
create index leads_score_idx on public.leads (score desc);
create index leads_name_trgm_idx on public.leads using gin (name gin_trgm_ops);
create index leads_tags_idx on public.leads using gin (tags);

create or replace function public.leads_normalize()
returns trigger
language plpgsql
as $$
begin
  new.phone_e164 := public.normalize_phone(new.phone);
  new.website_domain := public.normalize_domain(new.website);
  return new;
end;
$$;
create trigger leads_normalize before insert or update of phone, website on public.leads
  for each row execute function public.leads_normalize();
create trigger leads_updated_at before update on public.leads
  for each row execute function public.set_updated_at();

create table public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind public.contact_kind not null,
  value text not null,
  value_normalized text not null,
  label text,
  source public.consent_source not null default 'website',
  source_url text,
  verification public.verification_result not null default 'unverified',
  verified_at timestamptz,
  consent_state public.consent_state not null default 'unknown',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, kind, value_normalized)
);
create index lead_contacts_value_idx on public.lead_contacts (value_normalized);
create index lead_contacts_lead_idx on public.lead_contacts (lead_id);

create or replace function public.lead_contacts_normalize()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'email' then
    new.value_normalized := lower(trim(new.value));
  else
    new.value_normalized := coalesce(public.normalize_phone(new.value), trim(new.value));
  end if;
  return new;
end;
$$;
create trigger lead_contacts_normalize before insert or update of value, kind on public.lead_contacts
  for each row execute function public.lead_contacts_normalize();
create trigger lead_contacts_updated_at before update on public.lead_contacts
  for each row execute function public.set_updated_at();

create table public.lead_social_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin', 'youtube', 'tiktok', 'x', 'other')),
  url text not null,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, url)
);
create index lead_social_links_lead_idx on public.lead_social_links (lead_id);
create trigger lead_social_links_updated_at before update on public.lead_social_links
  for each row execute function public.set_updated_at();

create table public.crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  search_id uuid references public.searches (id) on delete set null,
  url text not null,
  status public.crawl_status not null default 'queued',
  pages_visited integer not null default 0,
  pages jsonb not null default '[]'::jsonb,
  error_reason text,
  retries integer not null default 0 check (retries >= 0),
  max_retries integer not null default 3,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crawl_jobs_status_idx on public.crawl_jobs (status, created_at);
create index crawl_jobs_search_idx on public.crawl_jobs (search_id);
create index crawl_jobs_lead_idx on public.crawl_jobs (lead_id);
create trigger crawl_jobs_updated_at before update on public.crawl_jobs
  for each row execute function public.set_updated_at();
