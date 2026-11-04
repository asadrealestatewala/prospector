# Prospector: working rules

## What this is
Prospector is one internal lead generation and outreach system for three products:
**Classwell** (school management), **Vetlin** (vet clinic management) and **Postwala**
(social media management). One app, one login, one database.

## Source of truth
- `SRS.md` is the source of truth. Read it before changing behaviour.
- Section **4A** is the design system and overrides any other style mention (including section 3).
- Section **9.1** is the build order, **9.2** the acceptance checklist, **9.3** the open items.
- Open items in 9.3 must be asked about, never guessed.

## Tech stack
- Next.js App Router with TypeScript, Tailwind and shadcn/ui-style components (Radix primitives).
- Supabase Postgres, auth and realtime.
- Redis with BullMQ for background jobs; Crawlee for the website crawler.
- Resend for email; BotLinkd API and webhook for WhatsApp; Google Places and Custom Search APIs.
- Recharts for charts, Lucide for icons.
- Workers run under PM2 on a Contabo VPS.

## Rules that are never broken
- Leads are unique by Google place ID, then phone, then website domain.
- Check the do-not-contact list **at the moment of sending**.
- Every email has an unsubscribe link.
- WhatsApp business-initiated messages use approved templates only.
- A stop reply adds the contact to do-not-contact immediately.
- All prices, plan caps and budgets come from the editable cost tables (`cost_plans`,
  `cost_rates`, `budgets`). They are never hard-coded. A rate that is not set blocks spend.
- Check the remaining cap and budget **before** queuing any email, WhatsApp message or search.
- Respect each website's robots file.
- All schedules use Pakistan time (`Asia/Karachi`).

## Security
- API keys live only in server environment variables or the encrypted `settings` table.
  Never in browser code, the repository or logs.
- Enforce role-based access on the server (`requireRole`) **and** with Supabase row-level security.
- Never ask the user to paste passwords or keys into chat. Tell them which environment variable to set.

## Working style
- Build one SRS step at a time, in order (9.1).
- After each step report: acceptance checks passed and not passed, how to run it, and which
  environment variables must be set. Then wait for approval.
- Reuse components (`src/components/ui`). Write every database change as a new migration in
  `supabase/migrations`. Never edit an applied migration.
- Keep workers safe to retry (idempotent jobs, unique keys).
- Commit after each working step.
- Ask when anything is unclear. Do not build anything outside the SRS without asking.

## Design reference
- The Agentify ERP project (`C:\Users\HP\Documents\AgentifyERP` on the user's PC) is a
  **read-only** reference. Never modify it.
- Its tokens were read on 2026-11-04 and reported to the user. Until the user approves using them,
  the default palette from SRS 4A applies. All tokens live in `src/app/globals.css`.

## Project layout
- `src/app/(auth)` login and password screens; `src/app/(app)` the signed-in app shell.
- `src/lib/auth` roles and server guards; `src/lib/crypto` settings encryption;
  `src/lib/supabase` clients (the service-role client is server only).
- `supabase/migrations` schema, RLS and seed data; `supabase/tests` SQL checks.
