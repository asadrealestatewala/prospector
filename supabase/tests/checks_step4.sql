-- Step 4 checks: do-not-contact entries and their effects, removal, consent log, email verification requests.
reset role;
select set_config('request.jwt.claim.sub', '', false);

insert into public.leads (id, name, product, city) values ('00000000-0000-0000-0000-00000000c401', 'Bright Future School', 'classwell', 'Karachi');
insert into public.lead_contacts (lead_id, kind, value, value_normalized, source) values
  ('00000000-0000-0000-0000-00000000c401', 'email', 'Principal@BrightFuture.pk', '', 'website'),
  ('00000000-0000-0000-0000-00000000c401', 'whatsapp', '0321 5556667', '', 'website'),
  ('00000000-0000-0000-0000-00000000c401', 'email', 'office@brightfuture.pk', '', 'website');

-- Adding entries (as an admin through the bulk function).
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((public.add_do_not_contact(
  '[{"value":"principal@brightfuture.pk"},{"value":"+92 321 5556667","channel":"whatsapp","reason":"replied_stop"},{"value":"not-an-email@"},{"value":"12"},{"value":"office@brightfuture.pk","reason":"bounced"},{"value":"x@y.pk","channel":"fax"}]',
  'manual', 'import', 'CSV from old CRM') ->> 'added')::int = 3, 'three valid entries added');
select pg_temp.check((public.add_do_not_contact('[{"value":"PRINCIPAL@brightfuture.pk"}]', 'manual', 'manual') ->> 'already')::int = 1, 'same address is not added twice');
select pg_temp.check((public.add_do_not_contact('[{"value":"bad"},{"value":"x@y.pk","channel":"fax"}]', 'manual', 'manual') ->> 'invalid')::int = 2, 'bad rows are counted as invalid');
reset role;
select pg_temp.check((select consent_state from public.lead_contacts where value = 'Principal@BrightFuture.pk') = 'opted_out', 'matching email marked opted out');
select pg_temp.check((select consent_state from public.lead_contacts where kind = 'whatsapp' and lead_id = '00000000-0000-0000-0000-00000000c401') = 'opted_out', 'matching WhatsApp marked opted out');
select pg_temp.check((select verification from public.lead_contacts where value = 'office@brightfuture.pk') = 'invalid', 'a bounce marks the email invalid');
select pg_temp.check((select consent_state from public.lead_contacts where value = 'office@brightfuture.pk') = 'unknown', 'a bounce is not an opt-out');
select pg_temp.check((select count(*) from public.consent_log where event = 'opt_out' and lead_id = '00000000-0000-0000-0000-00000000c401' and source = 'import') = 2, 'opt-outs written to the consent log');
select pg_temp.check((select lead_id from public.do_not_contact where value = 'principal@brightfuture.pk') = '00000000-0000-0000-0000-00000000c401', 'entry linked to its lead');
select pg_temp.check((select added_by from public.do_not_contact where value = 'principal@brightfuture.pk') = '00000000-0000-0000-0000-00000000000a', 'who added it is recorded');
select pg_temp.check(public.is_do_not_contact('phone', '03215556667'), 'WhatsApp entry also blocks calls to the number');

-- Removal: Admin only, with a reason, never edits.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); -- lead expert
update public.do_not_contact set removed_at = now(), removed_by = '00000000-0000-0000-0000-00000000000c', removal_reason = 'x' where value = 'principal@brightfuture.pk';
reset role;
select pg_temp.check((select removed_at from public.do_not_contact where value = 'principal@brightfuture.pk') is null, 'lead expert cannot remove an entry');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update public.do_not_contact set removed_at = now(), removed_by = '00000000-0000-0000-0000-00000000000a' where value = 'principal@brightfuture.pk'$$, 'removal needs a reason');
select pg_temp.expect_error($$update public.do_not_contact set reason = 'complained' where value = 'principal@brightfuture.pk'$$, 'an entry cannot be edited');
update public.do_not_contact set removed_at = now(), removed_by = '00000000-0000-0000-0000-00000000000a', removal_reason = 'Added by mistake' where value = 'principal@brightfuture.pk';
reset role;
select pg_temp.check(not public.is_do_not_contact('email', 'principal@brightfuture.pk'), 'removed entry no longer blocks');
select pg_temp.check((select consent_state from public.lead_contacts where value = 'Principal@BrightFuture.pk') = 'unknown', 'removal resets consent to unknown');
select pg_temp.check((select count(*) from public.consent_log where value = 'Principal@BrightFuture.pk' and event = 'opt_out') = 1, 'consent log keeps the opt-out');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($$update public.do_not_contact set removed_at = null, removed_by = null, removal_reason = null where value = 'principal@brightfuture.pk'$$, 'a removed entry cannot be restored');
select pg_temp.check((public.add_do_not_contact('[{"value":"principal@brightfuture.pk"}]', 'unsubscribed', 'form') ->> 'added')::int = 1, 'a removed address can be added again');
reset role;

-- Consent log stays append only, but deleting a lead still works.
select pg_temp.expect_error($$update public.consent_log set note = 'changed' where value = 'Principal@BrightFuture.pk'$$, 'consent log rows cannot be changed');
select pg_temp.expect_error($$delete from public.consent_log where value = 'Principal@BrightFuture.pk'$$, 'consent log rows cannot be deleted');
insert into public.leads (id, name, product, city) values ('00000000-0000-0000-0000-00000000c402', 'Temp Lead', 'vetlin', 'Quetta');
insert into public.lead_contacts (lead_id, kind, value, value_normalized) values ('00000000-0000-0000-0000-00000000c402', 'email', 'temp@vet.pk', '');
insert into public.consent_log (lead_id, channel, value, event, source) values ('00000000-0000-0000-0000-00000000c402', 'email', 'temp@vet.pk', 'collected', 'manual');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from public.leads where id = '00000000-0000-0000-0000-00000000c402';
reset role;
select pg_temp.check((select count(*) from public.leads where id = '00000000-0000-0000-0000-00000000c402') = 0, 'a signed-in admin can delete a lead that has contacts');
select pg_temp.check((select lead_id from public.consent_log where value = 'temp@vet.pk') is null, 'deleting a lead keeps its consent record');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select lead_name from public.consent_log_view where value = 'Principal@BrightFuture.pk' limit 1) = 'Bright Future School', 'consent view shows the lead name');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f'); -- sales agent
select pg_temp.check((select count(*) from public.consent_log_view) > 0, 'staff can read the consent log');
reset role;
select pg_temp.check(not has_table_privilege('anon', 'public.consent_log_view', 'select'), 'anonymous visitors cannot read the consent log');

-- Email verification requests.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f'); -- sales agent (added in step 2 checks)
select pg_temp.expect_error($$select public.request_email_verification(array['00000000-0000-0000-0000-00000000c401']::uuid[])$$, 'sales agent cannot request verification');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); -- lead expert
select pg_temp.check(public.count_emails_to_verify(array['00000000-0000-0000-0000-00000000c401']::uuid[]) = 1, 'only unverified emails are counted');
select pg_temp.check(public.request_email_verification(array['00000000-0000-0000-0000-00000000c401']::uuid[]) = 1, 'unverified email requested');
select pg_temp.check(public.request_email_verification(array['00000000-0000-0000-0000-00000000c401']::uuid[]) = 0, 'a pending request is not repeated');
reset role;
select pg_temp.check((select count(*) from public.take_emails_to_verify(100)) = 1, 'requested email handed to the queue');
select pg_temp.check((select count(*) from public.take_emails_to_verify(100)) = 0, 'not handed over twice');
select pg_temp.check(not has_function_privilege('authenticated', 'public.take_emails_to_verify(integer)', 'execute'), 'only the worker dispatches checks');
update public.settings set value = '{"auto_verify_new": true}' where key = 'verification.options';
insert into public.lead_contacts (lead_id, kind, value, value_normalized) values ('00000000-0000-0000-0000-00000000c401', 'email', 'admissions@brightfuture.pk', '');
select pg_temp.check((select verify_requested_at from public.lead_contacts where value = 'admissions@brightfuture.pk') is not null, 'new email queued for checking when automatic checks are on');
update public.settings set value = '{"auto_verify_new": false}' where key = 'verification.options';
