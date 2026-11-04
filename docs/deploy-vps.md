# Deploying Prospector on the Contabo VPS

The final setup runs everything on one server: Supabase (self-hosted in Docker), the Next.js app
under PM2, and, from step 2 on, Redis and the background workers.

Until then the database is a hosted Supabase project. For that phase, follow sections 1, 2, 4 and 5
only (skip section 3, drop the `api.` DNS record, and put the hosted project's URL and keys in
`.env.local`). Section 7 moves the data to the VPS when you are ready.

## 1. Server

- Ubuntu 24.04 LTS. At least **8 GB RAM, 4 vCPU and 100 GB disk**: self-hosted Supabase uses about
  4 GB, the app about 1 GB, and the crawler, Redis and workers the rest (SRS 9.3 "Hosting size").
- Install Docker with the Compose plugin, Node 22 LTS, `pm2` (`npm i -g pm2`), Git, and Caddy or Nginx.
- Install Redis for the background queues and keep it private: `sudo apt install redis-server`, then in
  `/etc/redis/redis.conf` keep `bind 127.0.0.1 ::1`, set `appendonly yes` (jobs survive a restart, SRS 8.5)
  and `maxmemory-policy noeviction` (BullMQ needs it), and `sudo systemctl restart redis-server`.
- Set the server clock zone: `sudo timedatectl set-timezone Asia/Karachi`.
- Open only ports 22, 80 and 443 in the firewall (`ufw allow OpenSSH http https`).

## 2. DNS

Point two names at the server, for example:

| Name | Serves |
|---|---|
| `prospector.yourdomain.com` | The Prospector app (port 3000) |
| `api.prospector.yourdomain.com` | Supabase API gateway (port 8000) |

## 3. Self-hosted Supabase

```bash
git clone --depth 1 https://github.com/supabase/supabase /opt/supabase-src
mkdir -p /opt/supabase && cp -r /opt/supabase-src/docker/* /opt/supabase/ && cp /opt/supabase-src/docker/.env.example /opt/supabase/.env
cd /opt/supabase
```

Edit `/opt/supabase/.env` on the server (never paste these values into chat):

| Setting | Value |
|---|---|
| `POSTGRES_PASSWORD` | A long random password |
| `JWT_SECRET` | 40+ random characters |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | Generate from your `JWT_SECRET` with the key generator in the Supabase self-hosting guide |
| `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD` | Studio login (Studio stays private, see below) |
| `SITE_URL` | `https://prospector.yourdomain.com` |
| `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL` | `https://api.prospector.yourdomain.com` |
| `ADDITIONAL_REDIRECT_URLS` | `https://prospector.yourdomain.com/auth/confirm` |
| `DISABLE_SIGNUP` | `true` (accounts are invite-only) |
| `ENABLE_EMAIL_SIGNUP` | `true`, `ENABLE_EMAIL_AUTOCONFIRM` = `false` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME` | Your mail provider, for invite and reset emails (Resend SMTP works) |

In `docker-compose.yml`, add these lines to the `auth` service's `environment:` block:

```yaml
      GOTRUE_PASSWORD_MIN_LENGTH: 12
      GOTRUE_PASSWORD_REQUIRED_CHARACTERS: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789"
      GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true"
      GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true"
      GOTRUE_MAILER_TEMPLATES_INVITE: https://prospector.yourdomain.com/email-templates/invite.html
      GOTRUE_MAILER_TEMPLATES_RECOVERY: https://prospector.yourdomain.com/email-templates/recovery.html
      GOTRUE_MAILER_SUBJECTS_INVITE: "You're invited to Prospector"
      GOTRUE_MAILER_SUBJECTS_RECOVERY: "Reset your Prospector password"
```

Keep Studio and Postgres off the internet: in `docker-compose.yml` bind their published ports to
`127.0.0.1` (for example `127.0.0.1:5432:5432`), and open Studio through an SSH tunnel when needed
(`ssh -L 8000:127.0.0.1:8000 you@server`).

Start it: `docker compose pull && docker compose up -d`.

## 4. Prospector app

```bash
git clone https://github.com/asadrealestatewala/prospector /opt/prospector
cd /opt/prospector && npm ci
```

Create `/opt/prospector/.env.local` on the server:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.prospector.yourdomain.com` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` from the Supabase `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` from the Supabase `.env` |
| `SETTINGS_ENCRYPTION_KEY` | `openssl rand -base64 32`; keep a backup |
| `APP_URL` | `https://prospector.yourdomain.com` |
| `REDIS_URL` | `redis://127.0.0.1:6379` (the default, so it can be left out) |
| `PLACES_CONCURRENCY` | Cities searched at the same time, default `3` |
| `CRAWL_CONCURRENCY` | Websites crawled at the same time, default `5`. Lower it on a small server |
| `VERIFY_CONCURRENCY` | Email addresses checked at the same time, default `3` |

Apply the database schema (every migration in `supabase/migrations`):

```bash
npx supabase db push --db-url "postgresql://postgres:<POSTGRES_PASSWORD>@127.0.0.1:5432/postgres"
```

Build and start under PM2, and make PM2 start on boot. This starts two processes: `prospector-web`
(the app) and `prospector-workers` (the search and crawl queues now; the email and WhatsApp senders
join it in later steps). PM2 restarts either one after a crash or reboot.

```bash
npm run build
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

Invite the first Admin: `npm run admin:invite -- you@example.com "Your Name"`.

## 5. HTTPS reverse proxy (Caddy example)

`/etc/caddy/Caddyfile`:

```
prospector.yourdomain.com {
  reverse_proxy 127.0.0.1:3000
}
api.prospector.yourdomain.com {
  reverse_proxy 127.0.0.1:8000
}
```

`sudo systemctl reload caddy`. Caddy gets and renews the certificates itself.

## 6. Updates and backups

- Deploy a new step: `git pull && npm ci && npx supabase db push --db-url ... && npm run build && pm2 restart prospector-web`.
- Daily database backup (SRS 8.5) until System Health adds monitoring in step 9:
  `0 2 * * * docker exec supabase-db pg_dump -U postgres -Fc postgres > /var/backups/prospector-$(date +\%F).dump`
  and copy the files off the server regularly.

## 7. Moving from hosted Supabase to the VPS

Plan a short quiet window (no searches or sends running).

1. Set up self-hosted Supabase as in section 3 and apply the migrations to it (section 4).
2. Stop the app and workers: `pm2 stop all`.
3. Dump the hosted data, using the connection string from the hosted project's Connect page:
   ```bash
   pg_dump "<hosted connection string>" --data-only --schema=public --schema=auth \
     --exclude-table=auth.schema_migrations -Fc -f prospector-move.dump
   ```
4. Load it into the VPS database with triggers off, so audit and cost-history triggers do not fire twice:
   ```bash
   pg_restore --data-only --disable-triggers -U postgres -h 127.0.0.1 -d postgres prospector-move.dump
   ```
5. Users keep their passwords (they are stored in `auth.users`), but everyone signs in again once,
   because the VPS has a different `JWT_SECRET`.
6. Change the three Supabase variables in `.env.local` to the VPS values, keep `SETTINGS_ENCRYPTION_KEY`
   exactly the same (otherwise saved API keys cannot be read), then `npm run build && pm2 restart all`.
7. Update the webhook addresses in Resend and BotLinkd only if `APP_URL` changed.
8. Keep the hosted project paused for a week as a fallback, then delete it.
