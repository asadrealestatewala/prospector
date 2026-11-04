-- Step 5 checks: senders, campaign audience and safeguards, sending records, Resend events, unsubscribe.
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into public.leads (id, name, product, city, last_contacted_at) values
  ('00000000-0000-0000-0000-00000000e501', 'Sunrise Grammar School', 'classwell', 'Lahore', null),
  ('00000000-0000-0000-0000-00000000e502', 'Iqra Academy', 'classwell', 'Lahore', null),
  ('00000000-0000-0000-0000-00000000e503', 'Beacon School', 'classwell', 'Multan', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000e504', 'Paws Clinic', 'vetlin', 'Lahore', null),
  ('00000000-0000-0000-0000-00000000e505', 'No Email School', 'classwell', 'Lahore', null),
  ('00000000-0000-0000-0000-00000000e506', 'Twin Campus', 'classwell', 'Lahore', null),
  ('00000000-0000-0000-0000-00000000e507', 'Risky School', 'classwell', 'Lahore', null);
insert into public.lead_contacts (lead_id, kind, value, value_normalized, verification) values
  ('00000000-0000-0000-0000-00000000e501', 'email', 'info@sunrise.pk', '', 'valid'),
  ('00000000-0000-0000-0000-00000000e501', 'email', 'old@sunrise.pk', '', 'invalid'),
  ('00000000-0000-0000-0000-00000000e502', 'email', 'admin@iqra.pk', '', 'valid'),
  ('00000000-0000-0000-0000-00000000e503', 'email', 'hello@beacon.pk', '', 'valid'),
  ('00000000-0000-0000-0000-00000000e504', 'email', 'vet@paws.pk', '', 'valid'),
  ('00000000-0000-0000-0000-00000000e506', 'email', 'Admin@Iqra.pk', '', 'valid'),
  ('00000000-0000-0000-0000-00000000e507', 'email', 'x@risky.pk', '', 'risky');
insert into public.do_not_contact (channel, value, reason, added_by_system) values ('email', 'admin@iqra.pk', 'manual', 'test');
-- The entry above opted the contact out; put one back to check the list itself is what blocks.
update public.lead_contacts set consent_state = 'unknown' where value = 'admin@iqra.pk';

-- Senders: Admin adds, Manager reads, others see nothing.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.email_senders (id, from_name, from_email, reply_to) values
  ('00000000-0000-0000-0000-00000000e5a1', 'Asad from Classwell', 'asad@outreach.classwell.pk', 'asad@classwell.pk');
select pg_temp.expect_error($$insert into public.email_senders (from_name, from_email) values ('Dup', 'ASAD@outreach.classwell.pk')$$, 'a sender address is unique ignoring case');
select pg_temp.expect_error($$insert into public.email_senders (from_name, from_email) values ('Bad', 'not an email')$$, 'a sender address must be an email');
reset role;
select pg_temp.check((select domain from public.email_senders where id = '00000000-0000-0000-0000-00000000e5a1') = 'outreach.classwell.pk', 'sender domain is worked out from the address');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.email_senders) = 1, 'manager can read senders');
select pg_temp.expect_error($$insert into public.email_senders (from_name, from_email) values ('M', 'm@outreach.classwell.pk')$$, 'manager cannot add a sender');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.email_senders) = 0, 'lead expert sees no senders');
reset role;

-- Starter templates are present for each product.
select pg_temp.check((select count(distinct product) from public.templates where is_starter and channel = 'email') = 3, 'starter email templates for every product');

-- Audience: a manager builds it; each lead gets its best email and skips are explained.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.campaigns (id, channel, name, product, template_id, sender_id, recent_contact_days, bounce_limit_pct, complaint_limit_pct)
select '00000000-0000-0000-0000-00000000e5c1', 'email', 'Lahore schools', 'classwell', t.id, '00000000-0000-0000-0000-00000000e5a1', 7, 5, 0.3
from public.templates t where t.is_starter and t.product = 'classwell' limit 1;
create temp table aud as select public.build_campaign_audience('00000000-0000-0000-0000-00000000e5c1', array[
  '00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-00000000e503',
  '00000000-0000-0000-0000-00000000e504', '00000000-0000-0000-0000-00000000e505', '00000000-0000-0000-0000-00000000e506',
  '00000000-0000-0000-0000-00000000e507']::uuid[]) as r;
select pg_temp.check((select (r ->> 'added')::int from aud) = 1, 'only the clean lead is added for sending');
select pg_temp.check((select (r ->> 'no_email')::int from aud) = 1, 'a lead without email is counted');
select pg_temp.check((select (r -> 'reasons' ->> 'On the do-not-contact list')::int from aud) = 2, 'do-not-contact address skipped (both leads that share it)');
select pg_temp.check((select (r -> 'reasons' ->> 'Lead is for another product')::int from aud) = 1, 'another product is skipped');
select pg_temp.check((select (r -> 'reasons' ->> 'Contacted in the last 7 days')::int from aud) = 1, 'recently contacted lead skipped');
select pg_temp.check((select (r -> 'reasons' ->> 'Email is risky')::int from aud) = 1, 'only verified emails are sent');
select pg_temp.check((select address from public.campaign_recipients where lead_id = '00000000-0000-0000-0000-00000000e501') = 'info@sunrise.pk', 'the verified email is picked over an invalid one');
select pg_temp.check((select audience_size from public.campaigns where id = '00000000-0000-0000-0000-00000000e5c1') = 1, 'audience size counts sendable recipients');
select pg_temp.check((select (public.build_campaign_audience('00000000-0000-0000-0000-00000000e5c1', array['00000000-0000-0000-0000-00000000e501']::uuid[]) ->> 'added')::int) = 0, 'adding the same lead twice does nothing');
select pg_temp.check((select pending from public.campaign_counts(array['00000000-0000-0000-0000-00000000e5c1']::uuid[])) = 1, 'counters read by the manager');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error($$select public.build_campaign_audience('00000000-0000-0000-0000-00000000e5c1', array[]::uuid[])$$, 'sales agent cannot build an audience');
reset role;
-- Duplicate address across leads: allow the shared address once, then the second lead is skipped.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update public.do_not_contact set removed_at = now(), removed_by = '00000000-0000-0000-0000-00000000000a', removal_reason = 'test' where value = 'admin@iqra.pk';
select set_config('request.jwt.claim.sub', '', false);
update public.lead_contacts set consent_state = 'unknown' where value_normalized = 'admin@iqra.pk';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.campaigns (id, channel, name, product) values ('00000000-0000-0000-0000-00000000e5c2', 'email', 'Dup check', 'classwell');
select pg_temp.check((select (public.build_campaign_audience('00000000-0000-0000-0000-00000000e5c2', array['00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-00000000e506']::uuid[]) -> 'reasons' ->> 'Same address as another lead')::int) = 1, 'two leads sharing one address get one email');
reset role;

-- Worker: claim, record the send once, and only by the job that claimed it.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$select public.claim_email_recipients('00000000-0000-0000-0000-00000000e5c1', 5)$$, 'signed-in users cannot claim recipients');
reset role;
update public.campaigns set status = 'sending' where id = '00000000-0000-0000-0000-00000000e5c1';
select pg_temp.check((select count(*) from public.claim_email_recipients('00000000-0000-0000-0000-00000000e5c1', 5)) = 1, 'one recipient claimed');
select pg_temp.check((select count(*) from public.claim_email_recipients('00000000-0000-0000-0000-00000000e5c1', 5)) = 0, 'a claimed recipient is not handed out again');
select pg_temp.check(public.email_cap_usage(date_trunc('month', now())::date) = 1, 'a queued email counts against the cap');
select pg_temp.check((public.email_send_stats('00000000-0000-0000-0000-00000000e5c1', now() - interval '1 hour') ->> 'domain_today')::int = 1, 'today''s sends counted per sender domain');
update public.campaign_recipients set job_id = 'job-1' where campaign_id = '00000000-0000-0000-0000-00000000e5c1' and status = 'queued';
select pg_temp.check(public.record_email_sent((select id from public.campaign_recipients where campaign_id = '00000000-0000-0000-0000-00000000e5c1' and status = 'queued'), null, 'job-other', 're_1', 'asad@outreach.classwell.pk', 'Hi', '<p>Hi</p>', date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date) is null, 'another job cannot record the send');
select public.record_email_sent((select id from public.campaign_recipients where campaign_id = '00000000-0000-0000-0000-00000000e5c1' and status = 'queued'), null, 'job-1', 're_1', 'asad@outreach.classwell.pk', 'Hi', '<p>Hi</p>', date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
select pg_temp.check((select status from public.campaign_recipients where provider_message_id = 're_1') = 'sent', 'recipient marked sent');
select pg_temp.check((select count(*) from public.messages where provider_message_id = 're_1' and campaign_id = '00000000-0000-0000-0000-00000000e5c1') = 1, 'message saved for the lead timeline');
select pg_temp.check((select count(*) from public.conversations where lead_id = '00000000-0000-0000-0000-00000000e501' and channel = 'email') = 1, 'conversation opened for the inbox');
select pg_temp.check((select last_contacted_at from public.leads where id = '00000000-0000-0000-0000-00000000e501') > now() - interval '1 minute', 'lead last contacted time updated');
select pg_temp.check((select value from public.usage_counters where provider = 'resend' and metric = 'emails_sent') = 1, 'emails sent counter updated');
select pg_temp.check((select message_count from public.message_costs where channel = 'email' and product = 'classwell') = 1, 'email counted on the costs table');
select public.record_email_sent((select id from public.campaign_recipients where provider_message_id = 're_1'), null, 'job-1', 're_1', 'a@b.pk', 'Hi', 'x', date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
select pg_temp.check((select value from public.usage_counters where provider = 'resend' and metric = 'emails_sent') = 1, 'recording twice counts once');

-- Resend events.
select pg_temp.check(public.process_resend_event('email.delivered', 're_unknown', now(), null, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date) like 'ignored%', 'unknown email ignored');
select public.process_resend_event('email.delivered', 're_1', now(), null, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
select public.process_resend_event('email.opened', 're_1', now(), null, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
select public.process_resend_event('email.delivered', 're_1', now(), null, date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
select pg_temp.check((select status from public.campaign_recipients where provider_message_id = 're_1') = 'opened', 'a late delivered event does not move the status back');
select pg_temp.check((select status from public.messages where provider_message_id = 're_1') = 'read', 'opened email shows as read on the timeline');
-- Pause rule: with a sample of 1 the single bounce is 100%.
update public.settings set value = jsonb_set(value, '{min_sample}', '1') where key = 'email.limits';
select public.process_resend_event('email.bounced', 're_1', now(), 'Permanent', date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date);
select pg_temp.check((select status from public.campaign_recipients where provider_message_id = 're_1') = 'bounced', 'bounce recorded');
select pg_temp.check(public.is_do_not_contact('email', 'info@sunrise.pk'), 'hard bounce added to do-not-contact');
select pg_temp.check((select verification from public.lead_contacts where value = 'info@sunrise.pk') = 'invalid', 'hard bounce marks the email invalid');
select pg_temp.check((select status from public.campaigns where id = '00000000-0000-0000-0000-00000000e5c1') = 'paused', 'campaign paused when the bounce rate passes its limit');
select pg_temp.check((select paused_reason from public.campaigns where id = '00000000-0000-0000-0000-00000000e5c1') like 'Paused automatically%', 'pause reason explains why');
select pg_temp.check((select count(*) from public.audit_log where action = 'campaign.auto_paused') = 1, 'automatic pause is logged');

-- One-off email and unsubscribe.
insert into public.messages (id, lead_id, channel, direction, from_address, to_address, subject, body, status)
values ('00000000-0000-0000-0000-00000000e5f1', '00000000-0000-0000-0000-00000000e502', 'email', 'outbound', 'asad@outreach.classwell.pk', 'admin@iqra.pk', 'Hello', 'x', 'queued');
select pg_temp.check((select status from public.campaign_recipients where campaign_id = '00000000-0000-0000-0000-00000000e5c2' and lead_id = '00000000-0000-0000-0000-00000000e502') = 'pending', 'a pending send exists before unsubscribing');
select pg_temp.check((public.unsubscribe_email(null, '00000000-0000-0000-0000-00000000e5f1') ->> 'already')::boolean = false, 'unsubscribe link adds the address');
select pg_temp.check((public.unsubscribe_email(null, '00000000-0000-0000-0000-00000000e5f1') ->> 'already')::boolean, 'using the link twice is harmless');
select pg_temp.check(public.is_do_not_contact('email', 'ADMIN@iqra.pk'), 'unsubscribed address is on do-not-contact');
select pg_temp.check((select source::text from public.do_not_contact where value = 'admin@iqra.pk' and removed_at is null) = 'unsubscribe_link', 'source is the unsubscribe link');
select pg_temp.check((select count(*) from public.consent_log where lower(value) = 'admin@iqra.pk' and event = 'opt_out' and source::text = 'unsubscribe_link') >= 1, 'unsubscribe written to the consent log');
select pg_temp.check((select status from public.campaign_recipients where campaign_id = '00000000-0000-0000-0000-00000000e5c2' and lead_id = '00000000-0000-0000-0000-00000000e502') = 'skipped', 'pending sends to that address are skipped');
select pg_temp.check((public.unsubscribe_email(null, '00000000-0000-0000-0000-000000000bad') ->> 'found')::boolean = false, 'unknown link finds nothing');
