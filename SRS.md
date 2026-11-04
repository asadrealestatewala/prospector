
# Prospector: Software Requirements Specification


## 1. Purpose and scope

Prospector is one internal lead engine and outreach system for three products: Classwell (school management, PKR 20 per student), Vetlin (vet clinic management) and Postwala (social media management and content creation for agencies). It finds businesses, extracts their contact details, builds email and WhatsApp lists, sends campaigns, receives replies and tracks every lead through to a paying customer. All of it lives in one app with one login and one database.


## 2. Users and roles

| Role | What they do | Access |
|---|---|---|
| Admin | Owns the system, sets budgets, keys and users | Everything, including Settings, Users and Costs |
| Manager | Reviews results and approves campaigns | Dashboard, Leads, Campaigns, Inbox, Results, Pipeline |
| Lead expert | Runs searches and builds lists | Campaign Setup, Live Progress, Leads, Lead Detail |
| Sales agent | Answers replies and books demos | Inbox, Pipeline, Lead Detail |


## 3. Design system

The look follows the clean grouped-sidebar admin console pattern used in your ERPs, with BotLinkd's dark teal as the brand base. Exact Agentify ERP values can replace the palette below without changing any screen.

| Element | Specification |
|---|---|
| Sidebar | Dark teal, grouped sections, collapsible, active item highlighted with a green accent |
| Primary colour | Teal 600, used for main buttons and active states |
| Accent | WhatsApp green for WhatsApp actions and success states |
| Surface | White cards on a light grey page, soft borders, 12 px rounded corners |
| Status colours | Green = good, amber = warning, red = failed or blocked, blue = in progress |
| Typography | One clean sans-serif, 14 px body, 12 px helper text, bold 20 px page titles |
| Dashboard cards | Every KPI card is clickable and opens the matching filtered report |
| Tables | Sticky header, filters on top, bulk-select, export to CSV, saved views |
| Product tag | Every record carries a coloured product chip for Classwell, Vetlin or Postwala |
| Language | English and Urdu, with right-to-left support for Urdu templates |


## 4. Sidebar structure

1. **Overview:** Dashboard
2. **Lead engine:** New Search, Live Progress, Leads, Lead Detail
3. **Outreach:** Email Campaigns, WhatsApp Campaigns, Templates, Inbox
4. **Growth:** Pipeline, Results, A/B Tests
5. **Compliance:** Do-Not-Contact, Consent Log
6. **Admin:** Costs, Users, Settings, System Health


## 4A. Design system specification

This section is the full design system for Prospector. It replaces the short table in section 3 wherever the two differ. The direction is calm and data-first, in the spirit of Linear and Stripe dashboards, because staff will work in tables and inboxes all day. Colour carries meaning, so it is never used as decoration. If Claude Code is given the Agentify ERP design tokens, those override the brand colours below while every rule, spacing value and component stays the same.


### Technology

- **Framework:** Next.js with Tailwind CSS and shadcn/ui components.
- **Icons:** Lucide icon set, 1.5 px line weight, 20 px in navigation and 16 px inside buttons and tables.
- **Charts:** Recharts, using the chart colours below.
- **Tokens:** All colours, spacing and radii are defined once as CSS variables, so a theme change is one file.


### Brand and neutral colours

| Token | Value | Used for |
|---|---|---|
| brand-900 | #0D1A1C | Sidebar background |
| brand-700 | #134E4A | Sidebar hover, headings on light surfaces |
| brand-600 | #0F766E | Primary buttons, active tab, links |
| brand-100 | #CCFBF1 | Selected row, soft highlights |
| brand-50 | #F0FDFA | Hover on light surfaces |
| whatsapp-500 | #25D366 | WhatsApp actions and WhatsApp channel chip only |
| page | #F6F7F9 | Page background |
| surface | #FFFFFF | Cards, tables, modals |
| border | #E5E7EB | Card and table borders |
| text-primary | #111827 | Main text |
| text-secondary | #6B7280 | Helper text, labels |
| text-disabled | #9CA3AF | Disabled controls |


### Status and product colours

| Meaning | Text and icon | Soft background |
|---|---|---|
| Success, delivered, won | #15803D | #DCFCE7 |
| Warning, near limit, pending | #B45309 | #FEF3C7 |
| Error, failed, blocked | #B91C1C | #FEE2E2 |
| Info, running, new | #1D4ED8 | #DBEAFE |
| Neutral, draft, archived | #4B5563 | #F3F4F6 |

| Product | Chip colour |
|---|---|
| Classwell | Indigo, #4F46E5 on #E0E7FF |
| Vetlin | Emerald, #047857 on #D1FAE5 |
| Postwala | Pink, #BE185D on #FCE7F3 |

Chart series use the product colours when split by product, otherwise brand-600, then #0EA5E9, #F59E0B and #8B5CF6 in that order.


### Typography

| Style | Size and weight | Used for |
|---|---|---|
| Page title | 20 px, semibold | One per screen |
| Section title | 16 px, semibold | Card and panel headings |
| Body | 14 px, regular | Default text and table cells |
| Label and helper | 12 px, medium or regular | Field labels, hints, timestamps |
| KPI number | 28 px, semibold | Dashboard cards |

The typeface is Inter, with Noto Nastaliq Urdu for Urdu text. All numbers in tables, counters and costs use tabular figures so columns align. Line height is 1.5 for body text.


### Spacing, shape and elevation

- **Spacing scale:** 4, 8, 12, 16, 24 and 32 px only.
- **Radius:** 8 px for inputs and buttons, 12 px for cards and modals, full round for chips and avatars.
- **Borders:** 1 px in the border colour. Shadows are used only on floating layers such as menus and modals.
- **Page layout:** Sidebar 256 px wide, collapsing to a 64 px icon rail. Top bar 56 px high. Content area has 24 px padding with a maximum width of 1440 px.


### Components

| Component | Rules |
|---|---|
| Primary button | brand-600 fill, white text, 36 px high. One per screen area. |
| Secondary button | White fill, border, primary text. |
| WhatsApp button | whatsapp-500 fill, used only for sending or opening WhatsApp. |
| Destructive button | Red text on white, solid red only inside a confirmation dialog. |
| Inputs | 36 px high, border, brand-600 focus ring, error shown in red with a message below. |
| Status chip | Soft background with matching text and a small dot, 24 px high. |
| Product chip | Product colours above, shown on every lead, campaign and conversation. |
| KPI card | White card, label, large number, small change versus the previous period, and a click target that opens the filtered report. |
| Data table | 44 px rows, sticky header, hover in brand-50, selected row in brand-100, checkbox column, sortable headers, pagination with page size choice. |
| Filter bar | Sits above tables, shows active filters as removable chips, with Save view. |
| Tabs | Underlined, brand-600 on the active tab. |
| Modal and side panel | Modals for confirmations, right-hand side panel for quick lead preview and editing. |
| Toast | Bottom right, auto-dismiss after five seconds, errors stay until closed. |
| Empty state | Simple icon, one sentence, and one primary action. |
| Progress bar | brand-600 on a neutral track, turns amber near a limit and red at the limit. |
| Kanban card | White card, product chip, score badge, city, and next follow-up date. |
| Chat bubbles | Incoming grey, outgoing brand-100, WhatsApp-channel messages carry a small green WhatsApp mark. |


### Interaction rules

- **Loading:** Skeleton rows and cards instead of spinners for page loads. Buttons show a spinner while saving.
- **Real time:** Counters and the inbox update live. New items fade in without moving the row the user is reading.
- **Confirmation:** Any delete, bulk send or stop-all action needs a confirmation dialog naming what will happen and how many records are affected.
- **Undo:** Status changes and tag edits show a toast with Undo for ten seconds.
- **Keyboard:** A command palette opened with Ctrl K for search and jumping between screens, plus Esc to close panels.
- **Errors:** Plain-language messages saying what failed and what to do next, never raw error codes.


### Accessibility, language and responsiveness

- **Contrast:** Text meets at least 4.5 to 1 against its background. Status is never shown by colour alone, always with a word or icon too.
- **Focus:** Every interactive element has a visible focus ring and works by keyboard.
- **Urdu:** Right-to-left layout switches for Urdu templates and message previews, with mirrored alignment.
- **Breakpoints:** Full layout from 1280 px. Between 768 and 1279 px the sidebar becomes an icon rail. Below 768 px the sidebar becomes a slide-in drawer, tables become card lists, and the Inbox shows one column at a time.
- **Dark mode:** Planned for a later phase using the same tokens, so no screen needs redesign.


### Layout pattern for every screen

1. Page title on the left, primary action on the right.
2. Filter bar or tabs directly below.
3. One main content area: a table, board, chat or form.
4. A right-hand side panel for details, opened on row click, instead of leaving the page where possible.
5. Every KPI number, chart bar and funnel stage is clickable and opens the matching filtered list.


## 5. Screens, part 1


### Screen 1: Login

- **Layout:** Centred card on a dark teal background with the Prospector logo.
- **Fields:** Email, password, show-password toggle.
- **Actions:** Sign in, forgot password by email link.
- **Rules:** Five failed attempts lock the account for 15 minutes. Optional two-step verification for Admin and Manager. After login, each role lands on its own home screen.


### Screen 2: Dashboard

- **Top bar:** Product switcher (All, Classwell, Vetlin, Postwala), date range, and a global search box for businesses, emails and phone numbers.
- **KPI cards, each clickable into the matching filtered report:** Total leads, New today, Leads with email, Leads with WhatsApp, Emails sent, WhatsApp sent, Replies, Demos booked, Customers won.
- **Charts:** Leads per day, leads per city (top 10), channel comparison for email versus WhatsApp, and a funnel from leads to customers.
- **Panels:** Running searches with progress bars, today's sending quota used for each channel, Google API spend against budget, and the latest replies.
- **Alerts strip:** Failed workers, low WhatsApp quality rating, bounce rate above limit, budget near limit.


### Screen 3: New Search (Campaign Setup)

- **Step 1, Product:** Choose Classwell, Vetlin or Postwala. This sets the default business type and templates.
- **Step 2, Business type:** Schools, vet clinics, marketing agencies, or a custom keyword. Several keywords can be added, for example private school, academy, college.
- **Step 3, Cities:** Multi-select list of Pakistani cities with search. Select all, clear all, and saved city groups such as Punjab or Sindh. Optional radius per city and an option to split a large city by area for fuller coverage.
- **Step 4, Options:** Maximum results per city, minimum Google rating, require website, skip businesses already in the system, and crawl websites automatically.
- **Step 5, Review:** Estimated number of API calls and estimated Google cost, with a warning if it exceeds the remaining monthly budget.
- **Actions:** Start now, schedule for later, save as a reusable search.
- **Rules:** A search cannot start if the budget is exhausted. Duplicate businesses are matched by Google place ID and phone number.


### Screen 4: Live Progress

- **Header:** Search name, product, status chip (Queued, Running, Paused, Done, Failed), and Pause, Resume and Cancel buttons.
- **Counters:** Cities completed out of total, businesses found, websites queued, websites crawled, emails found, WhatsApp numbers found, failed crawls, and duplicates skipped.
- **City table:** One row per city with its own progress bar, count found and status.
- **Live feed:** Newest businesses appearing as they are saved.
- **Failure panel:** Websites that could not be crawled, with the reason and a Retry button for each.
- **Rules:** Updates arrive in real time without refreshing. Pausing stops new jobs but lets running jobs finish.


### Screen 5: Leads

- **Columns:** Business name, product chip, city, phone, website, email, WhatsApp number, rating, score, status, source search, last contacted, owner.
- **Filters:** Product, city, status, has email, has WhatsApp, has website, score range, source search, date added, and consent state.
- **Bulk actions:** Add to email campaign, add to WhatsApp campaign, assign owner, change status, add tags, add to do-not-contact, export CSV, delete.
- **Extras:** Saved views, column chooser, search box, and duplicate-merge tool.
- **Row click:** Opens the Lead Detail screen.


## 6. Screens, part 2


### Screen 6: Lead Detail

- **Header:** Business name, product chip, status dropdown, score badge, owner, and quick buttons for Send email, Send WhatsApp, Call and Add note.
- **Left panel, business info:** Address with map link, phone numbers, emails found with a verified or risky tag, WhatsApp number, website, social links, Google rating and review count, opening hours.
- **Crawled data panel:** Pages visited, description text, and product-specific hints such as class levels for schools or services listed for clinics.
- **Centre, timeline:** Every email and WhatsApp sent, delivered, opened, clicked and replied, plus notes, status changes and calls, in date order.
- **Right panel:** Tags, consent state for each channel, next follow-up date, demo or trial details, and a Mark as do-not-contact button.
- **Rules:** Editing any contact field is logged with who changed it and when.


### Screen 7: Email Campaigns

- **List view:** Name, product, audience size, status (Draft, Scheduled, Sending, Paused, Done), sent, delivered, opened, clicked, replied, bounced and unsubscribed.
- **Create steps:** Name and product, choose the audience from saved filters or a lead selection, choose the template and language, set the sender name and sending domain, then schedule.
- **Sending controls:** Daily limit, sending hours in Pakistan time, gap between emails, and automatic follow-ups after a set number of days if there is no reply, up to a maximum of three.
- **Safeguards before send:** Only verified emails, skip do-not-contact and recently contacted leads, unsubscribe link mandatory, and a test email to yourself.
- **Campaign detail:** Live counters, a per-recipient table, pause and resume, and a stop-all button.
- **Automatic rule:** If the bounce rate or complaint rate passes the set limit, the campaign pauses itself and alerts the Admin.


### Screen 8: WhatsApp Campaigns

- **List view:** Name, product, audience size, template, status, sent, delivered, read, replied, failed and opted-out.
- **Create steps:** Name and product, choose the audience, choose an approved template, fill the variables such as business name and city, set the daily limit and sending hours, then schedule.
- **Safeguards before send:** Only approved templates are selectable. Numbers are checked for correct Pakistani format. Opted-out and do-not-contact numbers are skipped. A test message to your own number is available.
- **Cost estimate:** Shows the expected Meta charge for the selected audience, using the configured per-message rate, before the campaign starts.
- **Sending:** A worker sends through the BotLinkd template endpoint at the daily limit. Failed sends retry up to three times.
- **Quality guard:** If delivery drops or opt-outs spike, the campaign pauses and alerts the Admin.
- **Campaign detail:** Live counters, per-recipient status table, pause, resume and stop.


### Screen 9: Templates

- **Tabs:** Email templates and WhatsApp templates.
- **Email templates:** Name, product, language (English, Urdu), subject, rich body editor with variables such as business name, city, contact name and product price, and a live preview. Every template has the unsubscribe footer added automatically.
- **WhatsApp templates:** Name, category (marketing, utility), language, header (none, image, video, document), body with numbered variables, buttons (call, visit website, quick reply), and approval status (Draft, Pending, Approved, Rejected with reason).
- **Library:** Starter templates per product, for example a Classwell school introduction mentioning PKR 20 per student, a Vetlin clinic introduction, and a Postwala agency introduction.
- **Actions:** Duplicate, archive, send a test, and create an A/B variant.


### Screen 10: Inbox

- **Layout:** Three columns: conversation list, chat window, lead panel.
- **Conversation list:** Filters for All, Mine, Unassigned, Unread, WhatsApp, Email, and by product. Shows last message, time, unread count and assigned agent.
- **Chat window:** Full message history, text box, template picker, attachments (image, PDF, voice note), quick replies, and internal notes visible only to the team.
- **WhatsApp 24-hour rule:** When the customer's last message is older than 24 hours, free text is disabled and only approved templates can be sent, with a clear banner explaining why.
- **Lead panel:** The same business details as Lead Detail, status dropdown, tags, and buttons to Book demo or Mark won.
- **Assignment:** Assign to an agent, auto-assign by round robin or by city, and transfer with a note.
- **Automation:** Keyword auto-replies, opt-out words (stop, unsubscribe) that add the lead to do-not-contact instantly, and an optional AI assistant that drafts replies for a human to approve.
- **Real time:** New messages arrive through the webhooks and appear instantly with a sound and badge.


## 7. Screens, part 3


### Screen 11: Pipeline

- **Board view:** Columns for New, Contacted, Replied, Demo booked, Trial, Won and Lost. Cards show business, city, product chip, score and next follow-up. Cards drag between columns.
- **Automatic moves:** Sending a message moves a lead to Contacted. A reply moves it to Replied. A booked demo moves it to Demo booked.
- **Follow-up tasks:** Each card can have a due date and reminder. A Today list shows overdue and due tasks for the logged-in agent.
- **Closing:** Moving to Won asks for plan and student or user count. Moving to Lost asks for a reason from a list, which feeds the Results screen.
- **Table view:** The same data as a table with filters for owner, product, city and stage.


### Screen 12: Results

- **Filters:** Product, city, channel, template, campaign and date range.
- **Reports:** Funnel from found to customer, performance by city, by channel, by template and by campaign, and reasons leads were lost.
- **Key figures:** Cost per lead, cost per demo and cost per customer, combining Google, email and WhatsApp spend.
- **Exports:** Any report to CSV or PDF, and an optional weekly summary email to the Admin and Managers.


### Screen 13: A/B Tests

- **Create:** Pick a campaign, two versions of a subject or message, and the share of the audience for the test, for example 20 percent.
- **Result:** After the test window, the version with more replies wins, and the rest of the audience gets the winner automatically, or the manager picks manually.
- **History:** Past tests with the winning wording, so good messages are reused.


### Screen 14: Do-Not-Contact

- **List:** Email or phone, channel, reason (unsubscribed, replied stop, complained, bounced, manual), date and who added it.
- **Actions:** Add one or many, import a CSV, and remove only with Admin approval and a recorded reason.
- **Rule:** Every send path checks this list at the moment of sending, not only when the campaign is created.


### Screen 15: Consent Log

- **Records:** For each lead and channel, the source of the contact (Google listing, website, form, inbound message), the date collected, and any opt-in or opt-out events.
- **Use:** Proof of where each contact came from. Exportable per lead on request.


### Screen 16: Costs

This screen is the super admin cost control center. Every price, plan cap and budget on it is an editable setting, never fixed in code, so figures can be changed when a provider changes its pricing. It has a summary header and six tabs.

- **Summary header:** Total spend this month in PKR, total budget, percentage used, spend per product (Classwell, Vetlin, Postwala), cost per lead, cost per demo and cost per customer. A currency switch shows PKR or USD, using a live USD to PKR rate that the Admin can also override.
- **Tab 1, Email (Resend):** The current plan name, monthly price and monthly email cap, for example a 20 dollar plan with 50,000 emails. Shows emails sent this month, remaining emails, a usage bar that turns amber at 80 percent and red at 100 percent, projected month-end usage, and the extra-email cost if the cap is exceeded. When the cap is reached, new email campaigns are blocked and queued emails pause, with an Admin alert.
- **Tab 2, WhatsApp (Meta):** Total messages run, split by category: marketing, utility, service and authentication. For each category it shows the count, the rate per message in PKR, and the total cost. It also shows free service conversations within Meta's free allowance, and whether the Meta billing account is active. Rates are editable per category and per country, since Meta changes them. The Pakistan marketing rate, for example the 13.5 rupees you quoted, is stored as a setting.
- **Tab 3, Platform service charges:** Fixed monthly fees for each platform: the BotLinkd plan, the Resend plan, the Contabo server, the domain and DNS, the social media API plan, the email verification service and any other tool. Each line has a name, provider, amount, currency, billing day and next renewal date, and renewals within seven days are highlighted.
- **Tab 4, Google APIs:** Calls and spend per day and month for Places and Search, against Google's free monthly allowance and the paid per-call rates, both editable. Shows free allowance remaining, a budget cap, and a hard stop option that blocks new searches when the cap is reached.
- **Tab 5, Social APIs:** The paid social media API plan with its price, request limit, requests used, and renewal date. Usage is pulled in automatically where the provider offers it, and otherwise entered by hand.
- **Tab 6, Pricing and budgets (settings):** One table of every rate, plan price and cap used by the other tabs, each with an edit button and a change history showing who changed what and when. Each price has an effective-from date so old reports keep the old price. Budgets can be set per month, per product and per channel, with a warning percentage and an automatic stop percentage.
- **Live sync:** Where a provider sends webhooks, usage and costs update in real time. Resend webhooks update sent, delivered, bounced and complained counts. BotLinkd webhooks update message events and statuses. Meta's billing and usage can be added through its reporting API as a later step, and until then the Admin can enter the Meta invoice total to reconcile against the calculated figure.
- **Reconciliation:** A monthly table compares the cost calculated by Prospector with the figure on each provider's invoice, showing any difference so wrong rates are caught early.
- **Alerts:** Email or WhatsApp alert to the Admin at 80 and 100 percent of any cap or budget, when a renewal is due, when the Meta billing status becomes inactive, and when a rate is changed.
- **Exports:** Any tab to CSV or PDF, and a monthly cost report emailed to the Admin.


### Screen 17: Users

- **List:** Name, email, role, status, last login.
- **Actions:** Invite by email, change role, deactivate, force password reset.
- **Audit trail:** A log of important actions such as exports, deletes, role changes and budget edits.


### Screen 18: Settings

- **Integrations:** Fields for the Google Places and Search keys, Resend key, BotLinkd app key and auth key, and the webhook address to paste into BotLinkd. Keys are stored encrypted and shown masked, with a Test connection button for each.
- **Sending limits:** Default daily limits and sending hours for each channel, and the warm-up schedule that raises limits gradually.
- **Sender identities:** Sending domains and addresses for email, with verification status, and the connected WhatsApp number.
- **Defaults:** Product price lines, city groups, lead scoring rules with adjustable points, and follow-up gaps.
- **Branding:** Logo, colours and email footer text.


### Screen 19: System Health

- **Workers:** Status of the Places search, crawler, email sender and WhatsApp sender workers, with last activity.
- **Queues:** Waiting, running, failed and delayed jobs for each queue, with buttons to retry or clear failed jobs.
- **Webhooks:** Recent events from Resend and BotLinkd, with success or failure and a replay button.
- **Server:** CPU, memory and disk use of the Contabo server, and the last successful database backup.
- **Alerts:** Rules for when to email or WhatsApp the Admin, such as a worker down for ten minutes or a queue backlog.


## 8. Data, integrations and rules


### 8.1 Database tables (Supabase Postgres)

| Table | Holds |
|---|---|
| users | Staff accounts, role, status |
| searches | Each search: product, business type, cities, options, status, estimated and actual cost |
| search_cities | One row per city within a search, with progress counts |
| leads | One business: name, product, city, address, phone, website, rating, Google place ID, score, status, owner, source search |
| lead_contacts | Every email, phone and WhatsApp number found for a lead, with source page, verification result and consent state |
| lead_social_links | Facebook, Instagram, LinkedIn and YouTube links per lead |
| crawl_jobs | One row per website crawl: status, pages visited, error reason, retries |
| templates | Email and WhatsApp templates, language, variables, approval status |
| campaigns | Email or WhatsApp campaign: audience, template, limits, schedule, status |
| campaign_recipients | One row per lead per campaign with sent, delivered, opened, clicked, replied, failed and opted-out times |
| ab_tests | Variants, audience share, winner |
| conversations | One thread per lead per channel, assigned agent, unread count, last message time |
| messages | Every inbound and outbound message with channel, status and provider message ID |
| pipeline_events | Every status change with who or what caused it |
| tasks | Follow-up tasks with due date and owner |
| do_not_contact | Email or phone, channel, reason, date |
| consent_log | Source and consent events per contact |
| api_usage | Daily Google API calls and cost |
| message_costs | Email and WhatsApp spend by category and day |
| cost_plans | Each paid plan: provider, plan name, monthly price, currency, usage cap, extra-usage rate, billing day, next renewal date |
| cost_rates | Editable per-unit prices such as WhatsApp rate by category and country, Google rate per call, social API rate; each with an effective-from date and change history |
| budgets | Monthly budgets and caps per provider, product and channel, with warning percentage and automatic stop percentage |
| usage_counters | Running usage per provider and period: emails sent, WhatsApp messages by category, Google calls, social API requests, updated live from webhooks and workers |
| invoice_reconciliation | Monthly provider invoice totals entered by the Admin, compared with the calculated cost, with the difference |
| webhook_events | Raw incoming events from Resend and BotLinkd, with processing result |
| settings | Keys (encrypted), limits, scoring rules, branding |
| audit_log | Sensitive actions by users |

All tables carry created and updated times. Leads, contacts and messages are indexed on phone, email and Google place ID for fast duplicate checks.


### 8.2 Integrations

| Service | Used for | Direction |
|---|---|---|
| Google Places API | Finding businesses, phone, website, rating | Out |
| Google Custom Search API | Finding agencies and extra discovery | Out |
| Crawlee crawler | Extracting emails, WhatsApp numbers and social links from websites | Internal |
| Resend | Sending email; webhooks for delivered, opened, clicked, bounced, complained | Out and in |
| BotLinkd API | Sending WhatsApp text and approved template messages using the app key and auth key | Out |
| BotLinkd webhook | Receiving incoming WhatsApp messages and replies at a Prospector address | In |
| Redis with BullMQ | Background job queues | Internal |
| Email verification service | Checking addresses before sending | Out |
| Social media API (paid plan) | Extra lead discovery from social platforms, with usage and cost tracked on the Costs screen | Out |
| Meta billing reports | Optional later step to pull actual WhatsApp charges for reconciliation | Out |

Keys live only in server environment variables or the encrypted settings table, never in browser code.


### 8.3 Background queues

| Queue | Job | Behaviour |
|---|---|---|
| places-search | Search one city and keyword | Pages through results, saves leads, adds crawl jobs |
| website-crawl | Crawl one website | Homepage plus contact, about and team pages, three retries, then marked failed |
| email-verify | Verify one address | Result stored on the contact |
| email-send | Send one email | Respects daily limit, hours, gap, do-not-contact |
| whatsapp-send | Send one template message | Same rules, three retries, stores provider message ID |
| follow-up | Schedule next message if no reply | Stops after the maximum or on reply |
| report | Build weekly summary | Runs on a schedule |

Workers run under PM2 on the Contabo server and restart automatically after a crash or reboot.


### 8.4 Business rules

- A lead is unique by Google place ID, then by phone and by website domain.
- Lead score adds points for a website, verified email, WhatsApp number, many reviews and a recent reply, with point values editable in Settings.
- No message is sent to a contact on the do-not-contact list, checked at the moment of sending.
- Email requires a working unsubscribe link. WhatsApp uses approved templates only for business-initiated messages.
- A stop or unsubscribe reply adds the contact to do-not-contact immediately.
- Sending limits start low and rise on the warm-up schedule.
- The crawler honours each site's robots file and collects business contact details only. Prices, plan caps and budgets are read from the editable cost tables at the moment of use, never hard-coded. Before any email, WhatsApp message or search is queued, the system checks the remaining plan cap and budget, and blocks the action with a clear message if it would exceed them. Cost is recorded using the rate that was effective on the day of sending. Where a provider offers webhooks, usage counters update from them in real time, and otherwise from Prospector's own send logs.


### 8.5 Non-functional requirements

| Area | Requirement |
|---|---|
| Security | Role-based access, encrypted keys, hashed passwords, HTTPS only, audit log of sensitive actions |
| Reliability | Daily database backup, automatic worker restart, jobs survive a restart |
| Performance | Leads table handles at least 100,000 rows with filters returning in a few seconds |
| Real time | Progress counters and inbox update without page refresh |
| Time zone | All schedules and sending hours in Pakistan time |
| Languages | English and Urdu interface and templates, right-to-left for Urdu text |
| Responsive | Works on laptop first, and usable on a phone for the inbox and dashboard |
| Compliance | Unsubscribe, opt-out, consent log and policy limits for WhatsApp and email |


## 9. Build plan and open items


### 9.1 Build order for Claude Code

1. **Foundation:** Next.js app, Supabase project, login, roles, sidebar and design system, Settings with encrypted keys.
2. **Lead engine:** New Search, Places worker, leads and lead_contacts tables, Leads and Lead Detail screens, Live Progress.
3. **Crawler:** Crawlee worker on BullMQ, crawl results saved to contacts, failure panel and retry.
4. **Compliance base:** Do-Not-Contact, Consent Log, email verification.
5. **Email:** Templates, Email Campaigns, Resend sending and webhooks.
6. **WhatsApp:** WhatsApp templates, WhatsApp Campaigns, BotLinkd send worker and webhook route.
7. **Inbox:** Conversations, chat window, assignment, opt-out handling, real-time updates.
8. **Growth:** Pipeline, follow-up tasks, automatic follow-ups, A/B tests, Results.
9. **Operations:** Dashboard, Costs, Users, System Health, alerts, backups.

Each step ends with the acceptance checks below before the next begins.


### 9.2 Acceptance checklist

- A lead expert selects three cities and gets saved businesses within minutes, with no duplicates.
- Websites are crawled in parallel and emails and WhatsApp numbers appear on the lead.
- A search that would exceed the Google budget is blocked with a clear message.
- An email campaign respects the daily limit and sending hours and includes a working unsubscribe link.
- A WhatsApp campaign sends only approved templates and skips do-not-contact numbers.
- A reply to a WhatsApp message appears in the Inbox within seconds and links to the right lead.
- Replying stop adds the contact to do-not-contact and no further message is sent.
- A lead moves through the pipeline automatically as messages and replies happen.
- A crashed worker restarts itself and an alert reaches the Admin.
- Every dashboard card opens the matching filtered report.


### 9.3 What remains open

These are the points I could not settle from our conversation, and each needs your input or an external step before or during the build.

| Open item | Why it matters | Who handles it |
|---|---|---|
| Exact Agentify ERP colours and fonts | Section 4A uses a dark teal brand palette as the default; if the Agentify ERP design tokens are supplied, they replace the brand colours and nothing else changes | You share the theme file or a screenshot, or Claude Code reads the Agentify design tokens |
| Cold WhatsApp messaging risk | Meta can restrict a number that sends many marketing messages to people who did not opt in. This needs a business rule decision on who gets messaged | You decide; the spec assumes approved templates and an opt-out in every message |
| Meta business verification and template approval | Needed before any WhatsApp marketing starts, and takes time | You, through BotLinkd's onboarding |
| BotLinkd delivery and read status | BotLinkd is confirmed as the WhatsApp provider and the subscription is already active. Their public docs mention only send endpoints and incoming webhooks, so delivered and read reports depend on what their webhook returns | Send a few test messages in the first WhatsApp build step and ask BotLinkd support which status events the webhook sends |
| BotLinkd plan limits | Their plans cap monthly usage and allow few API endpoints and one number, so heavy campaigns may need the Scale plan or the direct Meta Cloud API later | You decide after a pilot |
| Email verification provider | The spec needs one chosen service for checking addresses | We pick one, for example from the common paid options |
| Sending domain for outreach | Cold email should use a separate domain with SPF, DKIM and DMARC records set up in Contabo DNS | You, with Claude Code guiding the records |
| Facebook and social lead sources | Meta's platform rules limit scraping and require app review for page data, so these are listed as a later phase, not in the first build | Later phase |
| Google Places terms | Google's terms limit how long place data may be stored and how it is used, so the retention rule should be checked before scaling | You review Google's current terms |
| Legal and consent rules | Pakistani and international rules on unsolicited messages vary and I am not a lawyer | Check with a legal advisor |
| Hosting size | The Contabo plan needs enough memory for the crawler, Redis and the app together | Check after the first crawl test |

Everything else in this specification is defined enough to build without further decisions.

