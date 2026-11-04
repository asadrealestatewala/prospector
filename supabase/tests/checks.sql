-- SQL checks for the foundation schema: de-duplication, role access, append-only logs,
-- settings secrecy and cost history. Run with: npm run db:test
\set QUIET on
create or replace function pg_temp.expect_error(sql text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    raise notice 'ok: % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % should have been refused', label;
end $$;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAILED: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Every SRS 8.1 table exists.
select pg_temp.check(count(*) = 29, 'all 29 tables exist') from information_schema.tables
where table_schema = 'public' and table_name in (
  'users','searches','search_cities','leads','lead_contacts','lead_social_links','crawl_jobs','templates',
  'campaigns','campaign_recipients','ab_tests','conversations','messages','pipeline_events','tasks',
  'do_not_contact','consent_log','api_usage','message_costs','cost_plans','cost_rates','budgets',
  'usage_counters','invoice_reconciliation','webhook_events','settings','audit_log','login_attempts','cost_change_log');
select pg_temp.check(bool_and(rowsecurity), 'RLS on for every public table')
from pg_tables where schemaname = 'public';

-- Normalisers.
select pg_temp.check(public.normalize_phone('0300-1234567') = '+923001234567', 'PK mobile 03xx to +92');
select pg_temp.check(public.normalize_phone('+92 300 1234567') = '+923001234567', 'PK +92 kept');
select pg_temp.check(public.normalize_phone('042 35761234') = '+924235761234', 'PK landline');
select pg_temp.check(public.normalize_domain('https://WWW.Example.com/contact?x=1') = 'example.com', 'domain normalised');

-- Staff accounts through the auth trigger.
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.pk', '{"role":"admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'manager@test.pk', '{"role":"manager"}'),
  ('00000000-0000-0000-0000-00000000000c', 'expert@test.pk', '{"role":"lead_expert"}'),
  ('00000000-0000-0000-0000-00000000000d', 'agent@test.pk', '{"role":"sales_agent"}'),
  ('00000000-0000-0000-0000-00000000000e', 'hacker@test.pk', '{"role":"superuser"}');
update public.users set status = 'active';
select pg_temp.check((select role from public.users where email = 'hacker@test.pk') = 'sales_agent', 'unknown role falls back to sales_agent');

-- Lead de-duplication: place ID, then phone, then domain.
insert into public.leads (name, product, google_place_id, phone, website)
values ('Beaconhouse Model', 'classwell', 'place-1', '0300 1234567', 'https://www.beacon-model.pk');
select pg_temp.expect_error($$insert into public.leads (name, product, google_place_id) values ('x','classwell','place-1')$$, 'duplicate place ID refused');
select pg_temp.expect_error($$insert into public.leads (name, product, phone) values ('x','classwell','+92-300-1234567')$$, 'duplicate phone refused');
select pg_temp.expect_error($$insert into public.leads (name, product, website) values ('x','classwell','http://beacon-model.pk/about')$$, 'duplicate domain refused');

-- Do-not-contact lookups match normalised values across phone and WhatsApp.
insert into public.do_not_contact (channel, value, reason) values ('whatsapp', '0321 7654321', 'replied_stop'), ('email', 'Owner@Clinic.PK', 'unsubscribed');
select pg_temp.check(public.is_do_not_contact('whatsapp', '+923217654321'), 'DNC WhatsApp match');
select pg_temp.check(public.is_do_not_contact('phone', '03217654321'), 'DNC phone blocked by WhatsApp entry');
select pg_temp.check(public.is_do_not_contact('email', 'owner@clinic.pk'), 'DNC email case-insensitive');
select pg_temp.check(not public.is_do_not_contact('email', 'other@clinic.pk'), 'DNC no false positive');

-- Effective-dated rates: old reports keep the old price.
insert into public.cost_rates (provider, item, label, whatsapp_category, country, unit, rate, currency, effective_from)
values ('meta_whatsapp', 'marketing', 'WhatsApp marketing message', 'marketing', 'PK', 'message', 15, 'PKR', date '2030-01-01');
select pg_temp.check((public.rate_on('meta_whatsapp', 'marketing', 'PK', date '2029-06-01')).rate = 13.5, 'rate before change is 13.5');
select pg_temp.check((public.rate_on('meta_whatsapp', 'marketing', 'PK', date '2030-02-01')).rate = 15, 'rate after change is 15');
select pg_temp.check((public.rate_on('google_places', 'text_search', 'PK')).rate is null, 'unset Google rate reads as not set');
select pg_temp.check((select count(*) from public.cost_change_log where table_name = 'cost_rates') >= 12, 'rate inserts recorded in history');

-- Append-only logs.
insert into public.audit_log (action, entity_type) values ('test', 'test');
select pg_temp.expect_error($$update public.audit_log set action = 'x'$$, 'audit log update refused');
select pg_temp.expect_error($$delete from public.audit_log$$, 'audit log delete refused');

-- Role-based access as each role.
create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, false);
  execute 'set role authenticated';
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); -- sales agent
select pg_temp.check((select count(*) from public.leads) = 1, 'agent can read leads');
select pg_temp.check((select count(*) from public.cost_rates) = 0, 'agent sees no cost rates');
select pg_temp.check((select count(*) from public.settings) = 0, 'agent sees no settings');
select pg_temp.check((select count(*) from public.searches) = 0, 'agent sees no searches');
select pg_temp.expect_error($$insert into public.leads (name, product) values ('x','vetlin')$$, 'agent cannot create leads');
select pg_temp.expect_error($$update public.users set role = 'admin' where id = auth.uid()$$, 'agent cannot promote self');
select pg_temp.check((select count(*) from public.audit_log) = 0, 'agent cannot read audit log');
select pg_temp.expect_error($$insert into public.cost_rates (provider,item,label,unit) values ('x','y','z','call')$$, 'agent cannot add rates');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); -- lead expert
insert into public.searches (name, product) values ('Lahore schools', 'classwell');
select pg_temp.check((select count(*) from public.searches) = 1, 'lead expert creates and reads searches');
select pg_temp.check((select count(*) from public.campaigns) = 0, 'lead expert sees no campaigns');
select pg_temp.expect_error($$insert into public.campaigns (channel,name,product) values ('email','x','classwell')$$, 'lead expert cannot create campaigns');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); -- manager
insert into public.campaigns (channel, name, product) values ('email', 'Intro', 'classwell');
select pg_temp.check((select count(*) from public.campaigns) = 1, 'manager creates campaigns');
select pg_temp.check((select count(*) from public.budgets) = 0, 'manager sees no budgets');
update public.do_not_contact set removed_at = now(), removed_by = auth.uid(), removal_reason = 'x';
select pg_temp.check((select count(*) from public.do_not_contact where removed_at is not null) = 0, 'manager cannot remove DNC entries');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a'); -- admin
select pg_temp.check((select count(*) from public.settings) >= 9, 'admin reads settings');
select pg_temp.expect_error($$select secret_ciphertext from public.settings$$, 'encrypted key column not readable by signed-in users');
insert into public.budgets (name, provider, amount, currency) values ('Google monthly', 'google_places', 5000, 'PKR');
update public.cost_rates set rate = 0.032 where provider = 'google_places' and item = 'text_search';
update public.users set role = 'lead_expert' where email = 'agent@test.pk';
select pg_temp.expect_error($$update public.users set role = 'manager' where id = auth.uid()$$, 'admin cannot change own role');
reset role;
select pg_temp.check((select changed_by from public.cost_change_log where table_name = 'budgets' order by id desc limit 1) = '00000000-0000-0000-0000-00000000000a', 'budget edit records who changed it');
select pg_temp.check((select count(*) from public.cost_change_log where table_name = 'cost_rates' and action = 'update') = 1, 'rate edit recorded with old and new values');

-- Do-not-contact removals need a reason and are never deleted.
select pg_temp.expect_error($$update public.do_not_contact set removed_at = now() where channel = 'email'$$, 'DNC removal without reason refused');
select pg_temp.check((select count(*) from public.do_not_contact) = 2, 'DNC rows intact');

-- Campaign follow-ups capped at three.
select pg_temp.expect_error($$insert into public.campaigns (channel,name,product,max_follow_ups) values ('email','x','classwell',4)$$, 'more than three follow-ups refused');
