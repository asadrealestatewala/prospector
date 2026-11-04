-- Starting rows for the editable cost tables and settings.
-- Only figures stated in the SRS are filled in. Every other price is left empty ("not set"),
-- which blocks any spend that depends on it until the Admin enters the real figure on the Costs screen.

insert into public.cost_plans (provider, kind, plan_name, monthly_price, currency, usage_cap, usage_unit, notes) values
  ('resend', 'plan', 'Resend plan', 20, 'USD', 50000, 'emails', 'SRS example: 20 dollar plan with 50,000 emails. Confirm against your Resend account.'),
  ('botlinkd', 'plan', 'BotLinkd plan', null, 'PKR', null, 'messages', 'Enter your BotLinkd plan price and monthly cap.'),
  ('contabo', 'service_charge', 'Contabo VPS', null, 'USD', null, null, 'Enter the server fee.'),
  ('domain_dns', 'service_charge', 'Domain and DNS', null, 'USD', null, null, 'Enter the domain and DNS fee.'),
  ('social_api', 'plan', 'Social media API plan', null, 'USD', null, 'requests', 'Enter the plan price and request limit.'),
  ('email_verification', 'service_charge', 'Email verification service', null, 'USD', null, 'checks', 'Provider not chosen yet (SRS 9.3).');

insert into public.cost_rates (provider, item, label, whatsapp_category, country, unit, rate, currency, notes) values
  ('meta_whatsapp', 'marketing', 'WhatsApp marketing message', 'marketing', 'PK', 'message', 13.5, 'PKR', 'Pakistan marketing rate quoted in the SRS.'),
  ('meta_whatsapp', 'utility', 'WhatsApp utility message', 'utility', 'PK', 'message', null, 'PKR', null),
  ('meta_whatsapp', 'service', 'WhatsApp service conversation', 'service', 'PK', 'message', null, 'PKR', 'Free within Meta''s allowance; set the rate beyond it.'),
  ('meta_whatsapp', 'authentication', 'WhatsApp authentication message', 'authentication', 'PK', 'message', null, 'PKR', null),
  ('google_places', 'text_search', 'Google Places text search', null, '*', 'call', null, 'USD', 'Enter the paid per-call rate and the free monthly allowance.'),
  ('google_places', 'place_details', 'Google Places details', null, '*', 'call', null, 'USD', null),
  ('google_search', 'query', 'Google Custom Search query', null, '*', 'call', null, 'USD', null),
  ('social_api', 'request', 'Social API request', null, '*', 'request', null, 'USD', null),
  ('email_verification', 'check', 'Email verification check', null, '*', 'request', null, 'USD', null),
  ('resend', 'extra_email', 'Resend email over the plan cap', null, '*', 'message', null, 'USD', null),
  ('fx', 'usd_to_pkr', 'USD to PKR exchange rate', null, '*', 'usd', null, 'PKR', 'Admin override for the live rate.');

insert into public.settings (key, category, value) values
  ('timezone', 'general', '"Asia/Karachi"'),
  ('google.custom_search_cx', 'integrations', 'null'),
  ('branding.email_footer', 'branding', '""'),
  ('branding.app_name', 'branding', '"Prospector"');

-- Integration keys start empty; the Admin sets them in Settings (stored encrypted).
insert into public.settings (key, category, is_secret) values
  ('google.places_api_key', 'integrations', true),
  ('google.custom_search_api_key', 'integrations', true),
  ('resend.api_key', 'integrations', true),
  ('botlinkd.app_key', 'integrations', true),
  ('botlinkd.auth_key', 'integrations', true);
