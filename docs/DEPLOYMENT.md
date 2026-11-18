# Going live

How to put the store on a real server. Written for one server running everything (a good start for one shop); the same pieces scale out later.

**What was checked on the development computer (2026-11-19):** the Docker image builds; started from it, the website answers `/api/health` and serves the shop, the worker starts and processes jobs, the `migrate` command applies database changes, and the container runs as a normal user (not root). A database backup was made and restored into a separate database with the same contents. **Not yet done:** a real server, a real domain with HTTPS, a real email service. Those are the owner's steps below.

## 1. What you need

| Item | Notes |
| --- | --- |
| A server | A Linux server (VPS) with 2 CPU cores and 4 GB of memory is enough to start. Docker installed. |
| A domain | For example `cedarbags.lb` or `shop.yourname.com`, with its DNS pointing at the server. |
| PostgreSQL 17 | A managed database from the hosting provider (recommended: they take backups too), or the one in the example below. |
| Redis 7 | For background jobs and rate limits. Managed, or the one in the example below. |
| S3-compatible file storage | For product pictures and customer photos: for example Cloudflare R2, Backblaze B2, DigitalOcean Spaces or AWS S3. Make the bucket publicly readable for files (see `docker/storage-public-read-policy.json`) and note its public address. |
| An email sending service (SMTP) | For example Brevo, Mailgun, Amazon SES or Postmark. Verify your domain with it (SPF and DKIM records) so emails do not land in spam. |

## 2. Settings

Copy `.env.example` to `.env.production` **on the server** (never into the repository) and set:

| Setting | Live value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | Your address, `https://...` |
| `DATABASE_URL`, `DATABASE_ADMIN_URL` | From the database provider. The runtime user and the admin user must be different (see `ARCHITECTURE.md`). |
| `REDIS_URL` | From the Redis provider |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` | From the storage provider; `S3_PUBLIC_URL` must be `https://` |
| `AUTH_SECRET`, `ENCRYPTION_KEY` | New random values: `openssl rand -base64 48` for each. Never reuse the development ones. Keep `ENCRYPTION_KEY` forever: guest order and message links depend on it. |
| `EMAIL_PROVIDER` | `smtp`, with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` from the email service |
| `EMAIL_FROM` | An address on your own domain, e.g. `orders@cedarbags.lb` |
| `PAYMENT_PROVIDER` | `none` (cash on delivery) until a card gateway is connected |
| `AI_PROVIDER`, `AI_FALLBACK_PROVIDER` | `mock` (no AI, costs nothing), `anthropic`, `groq`, `moonshot` or `openai-compatible`; the backup takes over when the main one is busy |
| `AI_API_KEY`, `AI_DEFAULT_MODEL`, `AI_BASE_URL` | Claude, or another OpenAI-compatible service. Keys stay on the server only |
| `GROQ_API_KEY`, `GROQ_MODEL`, `MOONSHOT_API_KEY`, `MOONSHOT_MODEL` | For Groq and Moonshot (Kimi); list model names with `pnpm ai:models groq` or `moonshot` |
| `AI_INPUT_PRICE_PER_MTOK`, `AI_OUTPUT_PRICE_PER_MTOK` | Price of a model the built-in list does not know (0 and 0 for a free plan) |
| `AI_MONTHLY_BUDGET_USD`, `AI_PAUSED` | The most one store may spend on AI per month; `AI_PAUSED=true` stops all AI at once |
| `ALLOW_SEARCH_INDEXING` | `true` once you are ready for Google |
| `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION`, `IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS` | `false` (test switches; never on a live site) |

The app refuses to start in production with the example secrets or the test payment provider.

## 3. Start it

Example `compose.yml` on the server (HTTPS by Caddy, which gets and renews the certificate itself):

```yaml
services:
  web:
    image: ecom:latest            # built with: docker build -t ecom .
    env_file: .env.production
    command: ["web"]
    restart: unless-stopped
  worker:
    image: ecom:latest
    env_file: .env.production
    command: ["worker"]
    restart: unless-stopped
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    restart: unless-stopped
volumes:
  caddy-data:
```

`Caddyfile`:

```
cedarbags.lb {
  reverse_proxy web:3000
}
```

Then, on the server:

```bash
docker build -t ecom .
docker compose run --rm web migrate
docker compose up -d
```

Create the store and its owner (once):

```bash
docker compose run --rm web pnpm db:seed
docker compose run --rm web pnpm store:create --slug cedar --name "Cedar Bags" --domain cedarbags.lb --currency USD --timezone Asia/Beirut
docker compose run --rm web pnpm admin:create --email you@yourdomain --name "Your Name" --tenant cedar
```

`db:seed` writes only the built-in roles and permissions on a live server (no demo data). `store:create` makes the store and gives it its web address; run it again with another `--domain` to add one (for example `www.cedarbags.lb`). `admin:create` makes the owner account and asks for its password, typed hidden (it is never put on the command line, where it would stay in the shell history).

## 4. Check before opening

```bash
docker compose run --rm web pnpm launch:check --tenant <store slug>
```

It lists everything that is not ready: settings (HTTPS, email, payments, test switches), services (database, Redis, storage), and the store (web address, products, delivery areas, tax, policy pages, staff email addresses, two-factor sign-in for owners). Fix every **FAIL**; decide about every **warn**.

In the admin, also:
- **Policy pages**: write and publish returns, delivery, privacy and terms.
- **Store and look**: name, logo, colours, contact details, time zone.
- **Delivery and tax**, **Store emails**.
- **Account, Security**: turn on two-factor sign-in.
- Place a test order yourself, mark it sent, and check the emails arrive.

## 5. Backups

```bash
docker compose run --rm -v /srv/backups:/app/backups web pnpm db:backup
```

Run it every night (for example with cron at 03:00). It keeps the newest 14 copies (`BACKUP_KEEP` to change). **Copy the backup folder off the server too** (for example to the storage provider in another region): a backup on the same disk does not survive losing the server. A managed database usually has its own daily backups as well; keep both.

Restore (with the app stopped):

```bash
pg_restore --clean --if-exists --no-owner --dbname "<DATABASE_ADMIN_URL>" /srv/backups/<file>.dump
```

Try a restore into a spare database once a month, so you know it works when you need it.

Pictures live in the file storage, not the database: turn on versioning or replication for the bucket with your storage provider.

## 6. Watching it

- **Health:** `https://your-domain/api/health` answers `{"status":"ok"}` when the database, Redis and storage are reachable. Point an uptime monitor at it (for example UptimeRobot or Better Stack, free plans exist) to be alerted when it fails.
- **Logs:** both containers write one JSON line per event, without personal data or secrets: `docker compose logs -f web worker`. Errors have `"level":50`.
- **Emails that could not be sent** are listed in the admin under **Store emails**.

## 7. Updating

```bash
git pull
docker build -t ecom .
docker compose run --rm web migrate
docker compose up -d
```

Take a backup first. Database changes are written to be applied while the old version is still running; if one ever is not, its notes say so.
