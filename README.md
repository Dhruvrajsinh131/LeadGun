# LeadGun

LeadGun is a local-first lead-discovery dashboard for finding people and companies that need software work. It scans Reddit, X (Twitter), LinkedIn, and Upwork through a shared logged-in Chrome session, filters and scores posts, stores normalized leads in PostgreSQL, and presents them in a Next.js dashboard. Discord notifications are optional.

## Highlights

- Four scrapers: Reddit, X, LinkedIn, and Upwork.
- Per-source on/off toggles in Settings.
- AI Lead Finder with streaming chat, conversation history, lead cards, and background scrape jobs.
- Lead Explorer with filters, lead detail, notes, saving, archive, status changes, and outreach drafts.
- Dashboard metrics for new, uncontacted, saved, replied, and interested leads.
- Heuristic scoring plus optional LLM classification and query rewriting.
- Deduplicated ingestion, freshness tracking, and Discord notifications.
- Shared Chrome session, so platform logins persist between runs.
- Scheduled scrapes every three hours, optional startup scrape, or on-demand runs from the UI/CLI.

## Stack

| Layer | Technology |
| --- | --- |
| UI | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| API | Node.js, Express 4, CommonJS |
| Database | PostgreSQL 18, Prisma 6 |
| AI | OpenAI Agents SDK, OpenAI-compatible Chat Completions |
| Scraping | Playwright over Chrome DevTools Protocol |
| Scheduling | `node-cron` |
| Notifications | Discord Bot REST API |

The Next.js app is UI only. All business logic, APIs, AI tools, Prisma access, scrape jobs, ingestion, and notifications live in the Express backend.

## Repository Layout

```text
LeadGun/
├── src/
│   ├── server.js              Express bootstrap, cron, status
│   ├── cli.js                 Standalone scraper entry point
│   ├── config/                Sources, queries, thresholds, schedule
│   ├── routes/                REST API routes
│   ├── lib/                   Agent, OpenAI/Prisma clients, normalization
│   ├── jobs/                  Scrape orchestration and persistence
│   ├── scraper/               Reddit, X, LinkedIn, Upwork scrapers
│   ├── services/              Scoring, classification, freshness, Discord
│   ├── browser/               Chrome CDP connection and launch
│   └── utils/                 Scraping, verification, human-behavior helpers
├── web/
│   └── src/
│       ├── app/               Dashboard pages
│       ├── components/        Shared UI components
│       └── lib/               Chat session helpers
├── prisma/
│   └── schema.prisma          PostgreSQL models
├── scripts/
│   └── start-leadgun.sh       Local stack launcher
├── data/                      Scraper JSON snapshots and scraper settings
└── docs/                      Architecture, features, and stack details
```

## Getting Started

### Requirements

- Node.js 24.x (recommended; a current Node LTS also works)
- npm
- Google Chrome or Chromium
- PostgreSQL 18 (or an existing PostgreSQL instance)

### 1. Install dependencies

The backend and UI have separate package manifests:

```bash
npm install
npm --prefix web install
```

### 2. Configure environment variables

Copy the example and fill in the values:

```bash
cp .env.example .env
```

A typical local setup:

```dotenv
DATABASE_URL="postgresql://leadgun:leadgun@127.0.0.1:5433/leadgun"
OPENAI_API_KEY="sk-..."
INGEST_URL="http://127.0.0.1:3000/api/ingest/leads"
INGEST_SECRET="change-me"
DISCORD_BOT_TOKEN="..."
```

Key variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | For AI features | Agent, classification, query rewriting, drafts |
| `OPENAI_MODEL` | No | Model override; defaults to `gpt-4o-mini` |
| `INGEST_SECRET` | Recommended | Shared secret for ingestion and scrape-complete webhooks |
| `INGEST_URL` | No | Ingestion endpoint; defaults to `http://127.0.0.1:3000/api/ingest/leads` |
| `DISCORD_BOT_TOKEN` | No | Enables Discord notifications; set the channel in `src/config/index.js` |
| `CDP_URL` | No | Chrome debugging URL; defaults to `http://127.0.0.1:9222` |
| `CHROME_PATH` | No | Chrome executable; defaults to `google-chrome` |
| `CHROME_PROFILE_DIR` | No | Persistent Chrome profile; defaults to `~/.config/my-site-test` |
| `PGDATA` / `PGCTL` | No | Local PostgreSQL data directory and control binary |
| `NEXT_PUBLIC_API_URL` | No | UI API URL; defaults to `http://localhost:3000` |
| `APP_USER_ID` | No | Local user id; defaults to `default-user` |

The UI reads `NEXT_PUBLIC_API_URL` from `web/.env` (or `web/.env.local`). You only need to set it if the API is not on `http://localhost:3000`.

### 3. Prepare the database

```bash
npx prisma generate
npx prisma db push
```

`db push` creates or updates the tables from `prisma/schema.prisma`. PostgreSQL must be running and the database in `DATABASE_URL` must exist. The included launcher can start an existing local `.pgdata` cluster.

### 4. Run the app

```bash
npm run dev
```

This starts:

- Express API: <http://localhost:3000>
- Next.js UI: <http://localhost:3001>

`npm run dev` does **not** run a startup scrape. To scrape immediately on startup:

```bash
npm run dev:scrape
```

For the backend alone, with cron scheduling and a startup scrape:

```bash
npm start
```

To build and run the UI in production mode (with the backend already running):

```bash
npm --prefix web run build
npm --prefix web run start
```

## Using LeadGun

### Dashboard

| Page | Purpose |
| --- | --- |
| Overview | Metrics, platform/status breakdowns, recent activity |
| AI Lead Finder | Streaming chat, history, lead cards, scrape progress |
| Lead Explorer | Search, filters, pagination, detail, notes, status, archive |
| Saved Leads | Saved lead collection |
| Replies & Outreach | AI drafts and outreach tracking |
| Activity | Recent lead activity |
| Settings | Reddit, X, LinkedIn, and Upwork scraper toggles |

Scraper toggles are saved to `data/scraper-settings.json`. Disabled sources are skipped by scheduled and AI-triggered scrapes. If every source is disabled, a scheduled scrape exits without doing work.

### Scraper CLI

Run a one-off scrape without starting the server:

```bash
npm run scrape -- --reddit
npm run scrape -- --x --keywords="remote software developer"
npm run scrape -- --linkedin --upwork
npm run scrape -- --all
```

Without source flags, the CLI uses the sources enabled in Settings. If all explicitly selected sources are disabled, the run fails.

### Scrape flow

1. Resolve enabled sources and search phrases.
2. Connect Playwright to Chrome over CDP.
3. Scrape selected platforms in parallel where possible.
4. Normalize and filter posts with the heuristic matcher.
5. Optionally refine leads with the LLM classifier.
6. Save JSON snapshots under `data/`.
7. Push normalized leads into PostgreSQL through `/api/ingest/leads`.
8. Send Discord notifications and a scrape-complete webhook.
9. Update the tracked `ScrapeJob` and notify the UI through SSE/polling.

PostgreSQL is the source of truth for the dashboard. Files under `data/` are scraper snapshots and local settings, not the UI database.

## API

The Express API runs on port `3000`.

| Area | Endpoints |
| --- | --- |
| Health | `GET /health`, `GET /api/status` |
| Leads | `GET /api/leads`, `GET /api/leads/:id`, `PATCH /api/leads/:id` |
| Ingestion | `POST /api/ingest/leads` |
| Statistics | `GET /api/stats` |
| AI drafting | `POST /api/ai/draft-reply` |
| Manual scrape | `POST /api/scrape` |
| Scrape jobs | `GET /api/scrape/jobs`, `GET /api/scrape/jobs/:id` |
| Chat | `GET /api/chat`, `POST /api/chat`, `GET /api/chat/:id`, `GET /api/chat/leads` |
| Outreach | `GET /api/leads/:id/outreach`, `POST /api/leads/:id/outreach` |
| Settings | `GET /api/scrapers`, `PATCH /api/scrapers/:id` |
| Events | `GET /api/events` (SSE), `POST /api/webhooks/scrape-complete` |

When `INGEST_SECRET` is set, ingestion and webhook callers must send it as `x-ingest-secret` or as a Bearer token. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for request details and agent tools.

## Chrome and Scraping

Chrome is launched on demand with remote debugging. You do not need to start it manually.

- Log in to Reddit, X, LinkedIn, and Upwork once in the launched Chrome window. The profile persists between runs.
- Upwork works logged out, but a logged-in session reduces Cloudflare checks.
- If Chrome is already running with the same profile but without the debugging port, close it fully and retry. Chrome only exposes CDP when it starts with `--remote-debugging-port`.
- If a verification challenge appears, solve it in the Chrome window. Scrapers wait for the challenge before continuing.
- Override the binary or profile with `CHROME_PATH` and `CHROME_PROFILE_DIR`. Set `CDP_URL` if port `9222` is unavailable.

Scrapers depend on each site's current DOM and your session state. Login walls, rate limits, or markup changes can reduce or empty a run.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Backend + UI, no startup scrape |
| `npm run dev:scrape` | Backend + UI, with startup scrape |
| `npm start` | Backend only, with cron and startup scrape |
| `npm run scrape -- ...` | One-off scraper CLI |
| `npm --prefix web run lint` | UI lint |
| `cd web && npx tsc --noEmit` | UI type check |
| `npm --prefix web run build` | Production UI build |
| `npx prisma db push` | Apply Prisma schema |
| `./scripts/start-leadgun.sh` | Start PostgreSQL, backend, and UI |

`scripts/start-leadgun.sh` contains machine-specific Node/PostgreSQL paths and is intended for this local setup. Adjust it before reusing it elsewhere. It expects the local `.pgdata` PostgreSQL cluster to exist.

## Verification

There is no automated test suite yet. Typical checks:

```bash
node --check src/server.js
npm --prefix web run lint
cd web && npx tsc --noEmit
npm --prefix web run build
curl http://localhost:3000/health
curl http://localhost:3000/api/scrapers
```

## Configuration

- Environment variables: `.env` in the repository root.
- UI API URL: `web/.env` or `web/.env.local`.
- Sources, default queries, scoring thresholds, age windows, LLM limits, and cron schedule: `src/config/index.js`.
- Per-source toggles: Settings page or `data/scraper-settings.json`.
- Prisma models: `prisma/schema.prisma`.

Default behavior keeps leads posted within 15 days and treats anything under 7 days as healthy. These values can be changed in `src/config/index.js`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Features](docs/FEATURES.md)
- [Tech stack](docs/TECH_STACK.md)

## Limitations

- Designed as a local, single-user tool, not a multi-tenant SaaS.
- Scraper reliability depends on Chrome sessions and target-site markup.
- Chat lead cards are partly tracked in memory; scrape-job results reload from PostgreSQL.
- Separate scraper processes do not currently share a global queue.
- No automated test suite.

## License

ISC
