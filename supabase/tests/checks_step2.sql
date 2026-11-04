-- Step 2 checks: saving Google results, duplicates, contact summary, scoring, edit history,
-- notes, saved views, usage recording, search completion and merging. Runs after checks.sql.
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into public.searches (id, name, product, keywords, status) values
  ('00000000-0000-0000-0000-0000000005e1', 'Lahore schools', 'classwell', '{private school}', 'running');
insert into public.search_cities (search_id, city, status) values
  ('00000000-0000-0000-0000-0000000005e1', 'Lahore', 'running'),
  ('00000000-0000-0000-0000-0000000005e1', 'Karachi', 'queued');

select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000005e1', 'Lahore', null,
  '{"place_id":"place-2","name":"City School Gulberg","phone":"0333 1112223","website":"https://cityschool.pk","rating":4.4,"reviews":120,"keyword":"private school"}',
  true, true) = 'inserted', 'new place saved');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000005e1', 'Lahore', null,
  '{"place_id":"place-2","name":"City School Gulberg"}', true, true) = 'duplicate', 'same place ID is a duplicate');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000005e1', 'Lahore', null,
  '{"place_id":"place-3","name":"City School branch","phone":"+92 333 1112223"}', true, true) = 'duplicate', 'same phone is a duplicate');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000005e1', 'Lahore', null,
  '{"place_id":"place-4","name":"City School web","website":"http://www.cityschool.pk/contact"}', true, true) = 'duplicate', 'same website domain is a duplicate');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000005e1', 'Lahore', null,
  '{"place_id":"place-2","name":"City School Gulberg","rating":4.6,"reviews":130}', false, true) = 'updated', 'existing lead refreshed when not skipping');
select pg_temp.check((select google_review_count from public.leads where google_place_id = 'place-2') = 130, 'refresh updated review count');
select pg_temp.check((select count(*) from public.leads where google_place_id = 'place-2') = 1, 'still one lead for the place');
select pg_temp.check((select count(*) from public.lead_contacts c join public.leads l on l.id = c.lead_id
  where l.google_place_id = 'place-2' and c.kind = 'phone' and c.source = 'google_listing') = 1, 'Google phone saved as a contact');
select pg_temp.check((select count(*) from public.consent_log where event = 'collected' and source = 'google_listing') = 1, 'contact source written to consent log');
select pg_temp.check((select count(*) from public.crawl_jobs where search_id = '00000000-0000-0000-0000-0000000005e1') = 1, 'website queued for crawling');

-- Contact summary and score: website 10 + reviews 10 so far.
select pg_temp.check((select score from public.leads where google_place_id = 'place-2') = 20, 'score counts website and reviews');
insert into public.lead_contacts (lead_id, kind, value, value_normalized)
select id, 'email', 'Info@CitySchool.pk', '' from public.leads where google_place_id = 'place-2';
insert into public.lead_contacts (lead_id, kind, value, value_normalized)
select id, 'whatsapp', '0333 1112223', '' from public.leads where google_place_id = 'place-2';
select pg_temp.check((select email from public.leads where google_place_id = 'place-2') = 'Info@CitySchool.pk', 'lead email summary follows contacts');
select pg_temp.check((select whatsapp from public.leads where google_place_id = 'place-2') = '0333 1112223', 'lead WhatsApp summary follows contacts');
select pg_temp.check((select score from public.leads where google_place_id = 'place-2') = 45, 'score adds unverified email and WhatsApp');
update public.lead_contacts set verification = 'valid' where kind = 'email';
select pg_temp.check((select score from public.leads where google_place_id = 'place-2') = 60, 'verified email scores higher');
update public.settings set value = jsonb_set(value, '{website}', '25') where key = 'scoring.rules';
select pg_temp.check(public.recalculate_lead_scores() >= 1, 'recalculation updates scores');
select pg_temp.check((select score from public.leads where google_place_id = 'place-2') = 75, 'new point value applied');

-- Progress counters.
select pg_temp.check((public.search_progress('00000000-0000-0000-0000-0000000005e1') ->> 'emails_found')::int = 1, 'progress counts emails found');
select pg_temp.check((public.search_progress('00000000-0000-0000-0000-0000000005e1') ->> 'websites_queued')::int = 1, 'progress counts websites queued');

-- Usage recording is atomic and per product.
select public.record_api_usage('google_places', 'text_search', 'classwell', 3, 27.5, null);
select public.record_api_usage('google_places', 'text_search', 'classwell', 2, 10, null);
select public.record_api_usage('google_places', 'text_search', null, 1, 5, null);
select pg_temp.check((select calls from public.api_usage where product = 'classwell') = 5, 'usage adds up per product');
select pg_temp.check((select count(*) from public.api_usage) = 2, 'separate row without a product');
select pg_temp.check((select value from public.usage_counters where metric = 'google_calls') = 6, 'monthly Google counter updated');

-- Search finishes only when no city is open.
update public.search_cities set status = 'done' where city = 'Lahore';
select pg_temp.check(public.finish_search_if_complete('00000000-0000-0000-0000-0000000005e1') = 'running', 'search keeps running while a city is queued');
update public.search_cities set status = 'failed' where city = 'Karachi';
select pg_temp.check(public.finish_search_if_complete('00000000-0000-0000-0000-0000000005e1') = 'done', 'search done when all cities finished');

-- Worker-only functions are closed to signed-in users.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); -- lead expert
select pg_temp.expect_error($$select public.save_place_lead('00000000-0000-0000-0000-0000000005e1','Lahore',null,'{"place_id":"x","name":"x"}',true,true)$$, 'lead expert cannot call the worker save function');
select pg_temp.expect_error($$select public.record_api_usage('google_places','text_search',null,1,0,null)$$, 'lead expert cannot record usage');
select pg_temp.expect_error($$select public.recalculate_lead_scores()$$, 'only an Admin recalculates scores');

-- Edits are logged with who made them.
update public.leads set phone = '0333 9998887' where google_place_id = 'place-2';
select pg_temp.check((select changed_by from public.lead_field_changes where field = 'phone' order by id desc limit 1) = '00000000-0000-0000-0000-00000000000c', 'phone edit logged with the editor');
update public.lead_field_changes set new_value = 'x';
select pg_temp.check(not exists (select 1 from public.lead_field_changes where new_value = 'x'), 'edit history cannot be changed by users');

reset role;
update public.lead_field_changes set new_value = 'y' where false;
select pg_temp.expect_error($$update public.lead_field_changes set new_value = 'x'$$, 'edit history is append only even for the server');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');

-- Notes are written as yourself only.
insert into public.lead_notes (lead_id, body, author_id) select id, 'Called the principal', auth.uid() from public.leads where google_place_id = 'place-2';
select pg_temp.expect_error($$insert into public.lead_notes (lead_id, body, author_id) select id, 'x', '00000000-0000-0000-0000-00000000000a' from public.leads limit 1$$, 'cannot write a note as someone else');

-- Saved views are private unless shared.
insert into public.saved_views (screen, name, params) values ('leads', 'Lahore with email', '{"city":"Lahore","has_email":"1"}');
insert into public.saved_views (screen, name, params, is_shared) values ('leads', 'Team view', '{}', true);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); -- manager
select pg_temp.check((select count(*) from public.saved_views) = 1, 'manager sees only the shared view');
update public.saved_views set name = 'mine' where is_shared;
select pg_temp.check((select name from public.saved_views where is_shared) = 'Team view', 'cannot edit another user''s view');

-- Merge: contacts move to the kept lead and the duplicate is removed.
reset role;
insert into public.leads (id, name, product, city, tags) values
  ('00000000-0000-0000-0000-00000000d001', 'Al-Huda Vet Clinic', 'vetlin', 'Lahore', '{a}'),
  ('00000000-0000-0000-0000-00000000d002', 'Al Huda Vet Clinic', 'vetlin', 'Lahore', '{b}');
update public.leads set phone = '0345 7778889' where id = '00000000-0000-0000-0000-00000000d002';
insert into public.lead_contacts (lead_id, kind, value, value_normalized) values
  ('00000000-0000-0000-0000-00000000d002', 'email', 'vet@alhuda.pk', '');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b'); -- manager
select pg_temp.check((select lead_count from public.lead_duplicate_groups(10) where city = 'Lahore' and name_key = 'alhudavetclinic') = 2, 'near-duplicate names grouped');
select pg_temp.check(public.merge_leads('00000000-0000-0000-0000-00000000d001', array['00000000-0000-0000-0000-00000000d002']::uuid[]) = 1, 'merge removes the duplicate');
select pg_temp.check((select email from public.leads where id = '00000000-0000-0000-0000-00000000d001') = 'vet@alhuda.pk', 'merged email now on kept lead');
select pg_temp.check((select tags from public.leads where id = '00000000-0000-0000-0000-00000000d001') @> '{a,b}', 'tags combined');
select pg_temp.check((select phone_e164 from public.leads where id = '00000000-0000-0000-0000-00000000d001') = '+923457778889', 'merged phone fills the gap on the kept lead');
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-00000000000f', 'agent2@test.pk', '{"role":"sales_agent"}');
update public.users set status = 'active' where email = 'agent2@test.pk';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.expect_error($$select public.merge_leads('00000000-0000-0000-0000-00000000d001', array['00000000-0000-0000-0000-0000000005e1']::uuid[])$$, 'sales agent cannot merge leads');
reset role;
select pg_temp.check(not has_function_privilege('anon', 'public.search_progress(uuid)', 'execute'), 'anonymous visitors cannot call functions');
