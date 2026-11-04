# Prospector

One internal lead engine and outreach system for **Classwell**, **Vetlin** and **Postwala**.
Everything it does is specified in [`SRS.md`](SRS.md); working rules for contributors are in [`CLAUDE.md`](CLAUDE.md).

Build status (SRS 9.1): **step 2, Lead engine** (step 1, Foundation, is done). The rest of the sidebar shows which step delivers each screen.

## Stack

Next.js 16 (App Router, TypeScript), Tailwind CSS 4 with shadcn-style components on Radix,
Supabase (Postgres, Auth, Realtime), Lucide icons, Redis with BullMQ workers under PM2, and the Google
Places API. Later steps add Crawlee, Resend and BotLinkd.

## Run it locally

Needs Node 20.9 or newer, a Supabase project (hosted, or local with Docker), and Redis for the
background workers (on Windows use Memurai or Redis in WSL; on Ubuntu `sudo apt install redis-server`).

```bash
npm install
npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,storage-api,postgres-meta
# The command prints the API URL, the anon key and the service_role key.
cp .env.example .env.local     # then fill in the values it printed
openssl rand -base64 32        # paste the result into SETTINGS_ENCRYPTION_KEY
npm run admin:invite -- you@example.com "Your Name"
npm run dev        # the app, http://localhost:3000
npm run workers    # second terminal: the search worker (reads .env.local)
```

Open the invite email (locally at http://127.0.0.1:54324, the Mailpit inbox), set your password and sign in.

## Hosting

**Now:** the database, sign-in and realtime run on a hosted Supabase project. The web app (and later
Redis and the workers) runs on the Contabo VPS under PM2, as in sections 1, 2, 4 and 5 of
[`docs/deploy-vps.md`](docs/deploy-vps.md), with the hosted Supabase values in `.env.local`.

**Later:** everything moves to the VPS with self-hosted Supabase in Docker. The same guide covers the
setup and how to move the data across (section 7). The app code does not change; only the three
Supabase environment variables do.

### Set up the hosted Supabase project

1. Create a Supabase project and link it: `npx supabase link --project-ref <ref>`.
2. Push the schema: `npx supabase db push`. Every database change is a migration in `supabase/migrations`.
3. In Authentication settings: turn **off** public sign-ups (accounts are invite-only), set the minimum
   password length to 12, turn on TOTP multi-factor, set the Site URL to `APP_URL`, and add
   `APP_URL/auth/confirm` to the redirect URLs.
4. Copy the email templates from `supabase/templates` into the Invite and Reset password templates.
5. Set the environment variables below on the server, then run `npm run admin:invite` once.

## Environment variables

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (later: your self-hosted API gateway) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. Server only. |
| `SETTINGS_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts API keys saved in Settings. Back it up. |
| `APP_URL` | Public address of Prospector, used in email links and webhook addresses |
| `REDIS_URL` | Redis for the background queues. Default `redis://127.0.0.1:6379` |
| `PLACES_CONCURRENCY` | How many cities the search worker runs at once. Default `3` |

Google, Resend and BotLinkd keys are **not** environment variables. An Admin enters them on the
Settings screen, where they are encrypted with AES-256-GCM and only the last four characters are shown.

## Checks

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # unit tests (encryption, lockout, cost maths, search estimates, places worker)
npm run db:test     # applies every migration to a throwaway Postgres and runs the SQL checks in supabase/tests
npm run build       # production build
```

## Security model

- Roles: Admin, Manager, Lead expert, Sales agent (SRS section 2). Every page and server action checks
  the role on the server, and row-level security enforces the same rules in the database.
- Five failed sign-ins lock an account for 15 minutes. Admins and Managers can turn on two-step
  verification, and an Admin can require it.
- The audit log, consent log and cost change history are append-only.
- API keys never reach the browser, the repository or logs.

## Running a search (step 2)

Before the first search an Admin must, once:

1. Add the Google Places API key on **Settings** (Integrations) and press Test connection.
2. On **Costs**, enter the Google Places text search price per call, its free monthly allowance, and the
   USD to PKR rate, then add a monthly budget for Google Places (or an overall budget).

Searches are blocked with a clear message until the price and a budget are set (CLAUDE.md: a rate
that is not set blocks spend). The worker checks the budget again before every Google call and pauses
the search if it would go over.
