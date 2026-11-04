-- Staff accounts, roles, audit log, login lockout and the encrypted settings table.

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext not null unique,
  full_name text not null default '',
  role public.app_role not null default 'sales_agent',
  status public.user_status not null default 'invited',
  last_login_at timestamptz,
  must_reset_password boolean not null default false,
  mfa_required boolean not null default false,
  invited_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- Role of the signed-in user, or null if they are not an active staff member.
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid() and status = 'active';
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = any (roles), false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() is not null;
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.has_role(public.app_role[]) from public;
revoke all on function public.is_staff() from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.has_role(public.app_role[]) to authenticated;
grant execute on function public.is_staff() to authenticated;

-- A user may not change their own role or status; only an admin can (enforced again by RLS).
create or replace function public.users_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- service role or migrations
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status
      or new.mfa_required is distinct from old.mfa_required
      or new.must_reset_password is distinct from old.must_reset_password
      or new.email is distinct from old.email
      or new.invited_by is distinct from old.invited_by
      or new.last_login_at is distinct from old.last_login_at)
     and not public.has_role('admin') then
    raise exception 'Only an admin can change roles or account status';
  end if;
  if new.id = auth.uid() and new.role is distinct from old.role then
    raise exception 'You cannot change your own role';
  end if;
  return new;
end;
$$;
create trigger users_guard before update on public.users
  for each row execute function public.users_guard_privileged_columns();

-- Audit trail of sensitive actions (exports, deletes, role changes, budget edits, key changes).
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.users (id) on delete set null,
  actor_email citext,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- The audit log is append only.
create or replace function public.append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append only: rows cannot be changed or deleted', tg_table_name;
end;
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.append_only();

-- Login attempts for the five-failures, fifteen-minute lockout. Service role only.
create table public.login_attempts (
  id bigint generated always as identity primary key,
  email citext not null,
  succeeded boolean not null,
  ip inet,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index login_attempts_email_idx on public.login_attempts (email, created_at desc);

-- Settings: keys (encrypted by the app server with AES-256-GCM), limits, scoring rules, branding.
-- secret_ciphertext is never readable from the browser; only the server's service role reads it.
create table public.settings (
  key text primary key,
  category text not null default 'general',
  value jsonb,
  is_secret boolean not null default false,
  secret_ciphertext text,
  secret_last4 text,
  last_tested_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_secret_shape check (
    (is_secret and value is null) or (not is_secret and secret_ciphertext is null)
  )
);
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();
