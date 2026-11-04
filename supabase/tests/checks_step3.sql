-- Step 3 checks: crawl dispatch, saving crawl results, social-page websites and function rights.
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- Social pages as "website" are not a business domain, so they do not collide.
select pg_temp.check(public.normalize_domain('https://www.facebook.com/alnoorschool') is null, 'Facebook page is not a domain');
select pg_temp.check(public.normalize_domain('https://m.facebook.com/x') is null, 'mobile Facebook page is not a domain');
select pg_temp.check(public.normalize_domain('https://www.beaconhouse.edu.pk/contact') = 'beaconhouse.edu.pk', 'real domain still normalised');
insert into public.searches (id, name, product, keywords, status) values
  ('00000000-0000-0000-0000-0000000006e1', 'Multan clinics', 'vetlin', '{vet clinic}', 'running');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000006e1', 'Multan', null,
  '{"place_id":"fb-1","name":"Pet Care Multan","website":"https://www.facebook.com/petcaremultan"}', true, true) = 'inserted', 'first Facebook-page business saved');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000006e1', 'Multan', null,
  '{"place_id":"fb-2","name":"Paws Clinic","website":"https://facebook.com/pawsclinic"}', true, true) = 'inserted', 'second Facebook-page business is not a duplicate');
select pg_temp.check(public.save_place_lead('00000000-0000-0000-0000-0000000006e1', 'Multan', null,
  '{"place_id":"vet-1","name":"Multan Vet Hospital","website":"https://multanvet.pk"}', true, true) = 'inserted', 'business with its own site saved');

-- Dispatcher hands each queued crawl over once.
select pg_temp.check((select count(*) from public.take_crawls_to_enqueue(100)) >= 3, 'queued crawls handed to the queue');
select pg_temp.check((select count(*) from public.take_crawls_to_enqueue(100)) = 0, 'a crawl is not handed over twice');
update public.crawl_jobs set enqueued_at = now() - interval '3 hours' where url = 'https://multanvet.pk';
select pg_temp.check((select count(*) from public.take_crawls_to_enqueue(100)) = 1, 'a crawl lost from the queue is handed over again');
update public.crawl_jobs set status = 'running', job_id = 'dead', started_at = now() - interval '3 hours' where url = 'https://multanvet.pk';
select pg_temp.check((select count(*) from public.take_crawls_to_enqueue(100)) = 1, 'a crawl stuck as running goes back to the queue');

-- Saving a result needs the job that holds the crawl.
update public.crawl_jobs set status = 'running', job_id = 'job-a', started_at = now() where url = 'https://multanvet.pk';
select pg_temp.check(public.save_crawl_result((select id from public.crawl_jobs where url = 'https://multanvet.pk'), 'job-b', '{}') is null, 'another job cannot save the result');
select pg_temp.check(
  (public.save_crawl_result((select id from public.crawl_jobs where url = 'https://multanvet.pk'), 'job-a', '{
     "pages":[{"url":"https://multanvet.pk/","title":"Home"},{"url":"https://multanvet.pk/contact","title":"Contact"}],
     "emails":[{"value":"info@multanvet.pk","source_url":"https://multanvet.pk/contact"},{"value":"info@multanvet.pk","source_url":"https://multanvet.pk/"}],
     "phones":[{"value":"061 4512345","source_url":"https://multanvet.pk/contact"}],
     "whatsapp":[{"value":"+92 300 1234567","source_url":"https://multanvet.pk/"}],
     "social":[{"platform":"facebook","url":"https://facebook.com/multanvet","source_url":"https://multanvet.pk/"},{"platform":"myspace","url":"https://myspace.com/x"}],
     "description":"Pet hospital in Multan.",
     "hints":{"services":["Vaccination","Surgery"]}
   }') ->> 'emails')::int = 1, 'crawl result saved once per email');
select pg_temp.check((select status from public.crawl_jobs where url = 'https://multanvet.pk') = 'done', 'crawl marked done');
select pg_temp.check((select pages_visited from public.crawl_jobs where url = 'https://multanvet.pk') = 2, 'pages visited counted');
select pg_temp.check((select email from public.leads where google_place_id = 'vet-1') = 'info@multanvet.pk', 'email appears on the lead');
select pg_temp.check((select whatsapp from public.leads where google_place_id = 'vet-1') = '+92 300 1234567', 'WhatsApp appears on the lead');
select pg_temp.check((select count(*) from public.lead_contacts c join public.leads l on l.id = c.lead_id
  where l.google_place_id = 'vet-1' and c.source = 'website' and c.source_url = 'https://multanvet.pk/contact') = 2, 'source page kept on contacts');
select pg_temp.check((select count(*) from public.consent_log where source = 'website' and recorded_by_system = 'website-crawl') = 3, 'website contacts written to consent log');
select pg_temp.check((select count(*) from public.lead_social_links s join public.leads l on l.id = s.lead_id where l.google_place_id = 'vet-1') = 1, 'known social platforms saved, others ignored');
select pg_temp.check((select description from public.leads where google_place_id = 'vet-1') = 'Pet hospital in Multan.', 'description saved');
select pg_temp.check((select crawl_hints -> 'services' from public.leads where google_place_id = 'vet-1') = '["Vaccination","Surgery"]', 'product hints saved');
select pg_temp.check((select score from public.leads where google_place_id = 'vet-1') = 50, 'score rises with crawled email and WhatsApp (website 25 after the step 2 edit)');
select pg_temp.check(public.save_crawl_result((select id from public.crawl_jobs where url = 'https://multanvet.pk'), 'job-a', '{}') is null, 'a finished crawl cannot be saved again');
select pg_temp.check((public.search_progress('00000000-0000-0000-0000-0000000006e1') ->> 'emails_found')::int = 1, 'progress counts crawled emails');
select pg_temp.check((public.search_progress('00000000-0000-0000-0000-0000000006e1') ->> 'websites_crawled')::int = 1, 'progress counts crawled websites');

-- Only the worker may call the crawl functions.
select pg_temp.check(not has_function_privilege('authenticated', 'public.save_crawl_result(uuid, text, jsonb)', 'execute'), 'signed-in users cannot save crawl results');
select pg_temp.check(not has_function_privilege('authenticated', 'public.take_crawls_to_enqueue(integer)', 'execute'), 'signed-in users cannot dispatch crawls');
select pg_temp.check(not has_function_privilege('anon', 'public.save_crawl_result(uuid, text, jsonb)', 'execute'), 'anonymous visitors cannot save crawl results');
select pg_temp.check(has_function_privilege('service_role', 'public.save_crawl_result(uuid, text, jsonb)', 'execute'), 'worker can save crawl results');

-- A lead expert can queue a failed crawl again; a sales agent cannot.
update public.crawl_jobs set status = 'failed', error_reason = 'Timed out' where url like '%pawsclinic';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f'); -- sales agent
update public.crawl_jobs set status = 'queued' where url like '%pawsclinic';
reset role;
select pg_temp.check((select status from public.crawl_jobs where url like '%pawsclinic') = 'failed', 'sales agent cannot retry a crawl');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); -- lead expert
update public.crawl_jobs set status = 'queued', error_reason = null, enqueued_at = null where url like '%pawsclinic';
reset role;
select pg_temp.check((select status from public.crawl_jobs where url like '%pawsclinic') = 'queued', 'lead expert can retry a crawl');
