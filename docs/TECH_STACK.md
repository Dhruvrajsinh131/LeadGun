# LeadGun Tech Stack

## Runtime and Languages

| Layer | Technology | Version | Used for |
| --- | --- | --- | --- |
| Runtime | Node.js | 24.x | Backend, scraper CLI, tooling |
| Backend language | JavaScript (CommonJS) | ES2022 | Express server, jobs, scrapers, services |
| Frontend language | TypeScript | 5.x | Next.js pages and components |
| Package manager | npm | current | Dependency management and scripts |

## Backend

| Technology | Version | Used for |
| --- | --- | --- |
| Express | 4.x | HTTP API and middleware |
| Prisma Client | 6.x | PostgreSQL access and schema |
| PostgreSQL | 18.x | Persistent lead, chat, outreach, and job storage |
| `@openai/agents` | 0.21.x | LeadGun Assistant and tool calling |
| OpenAI Node SDK | 7.x | Query rewriting and reply drafting |
| OpenAI-compatible Chat API | `gpt-4o-mini` by default | Lead classification, query rewriting, drafts |
| Zod | 4.x | Agent tool parameter schemas |
| Playwright | 1.63.x | Chrome automation for all platforms |
| Chrome DevTools Protocol | Chrome remote debugging | Shared logged-in browser session |
| `node-cron` | 3.x | Scheduled scrape runs |
| `dotenv` | 18.x | Environment configuration |
| CORS | 2.x | Browser access from the UI |
| Discord Bot REST API | v10 | Lead notification messages |

## Frontend

| Technology | Version | Used for |
| --- | --- | --- |
| Next.js | 16.4.3 | App Router application |
| React | 19.3.0 | UI components and state |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Radix UI | 1.x/2.x primitives | Dialog, dropdown, select, tabs, tooltip |
| Material Symbols Rounded | self-hosted | Material Design 3 icon set |
| Manrope + Sora | self-hosted | UI and display typography |
| `react-markdown` + `remark-gfm` | 10.x / 4.x | Assistant response rendering |
| `date-fns` | 4.x | Date formatting |
| `clsx` + `tailwind-merge` | current | Conditional class composition |

## Data and Storage

| Store | Purpose |
| --- | --- |
| PostgreSQL | Primary application database |
| Prisma schema | `prisma/schema.prisma` |
| `data/*.json` | Scraper snapshots: posts, matched posts, leads, notified URLs |
| `.pgdata/` | Local PostgreSQL cluster data directory |
| Browser profile | Persistent Chrome cookies/sessions for logged-in sites |

The PostgreSQL cluster uses port `5433` for this local setup. The database URL is configured through `DATABASE_URL`.

## AI Stack

| Component | Responsibility |
| --- | --- |
| `@openai/agents` | Tool-using LeadGun Assistant with streaming execution |
| OpenAI Chat Completions | Query rewriting, lead classification, reply drafts |
| Heuristic matcher | Fast intent/capability/budget pre-scoring before LLM classification |
| Structured tool calls | Search, details, statistics, status, saves, notes, emails, scraping |

The assistant can answer from stored leads and can launch scraper jobs. Scraper jobs remain asynchronous; the UI polls job status and loads the resulting lead cards.

## Scraping Stack

| Component | Responsibility |
| --- | --- |
| Playwright `chromium.connectOverCDP` | Reuse an existing logged-in Chrome instance |
| Chrome auto-launch | Starts Chrome with remote debugging when needed |
| Platform scrapers | Reddit, X, LinkedIn, Upwork DOM/search extraction |
| Source verification helpers | Login-wall and challenge detection |
| JSON snapshots | Durable raw/scraped results before/alongside DB ingestion |

The scraper depends on a valid logged-in Chrome session for reliable results. Login walls, rate limits, and verification challenges can cause a source to return fewer results or an empty run.

## Notifications and Events

| Mechanism | Use |
| --- | --- |
| Discord webhook/bot messages | Per-platform lead alerts |
| Backend SSE (`/api/events`) | Push scrape-completion notifications to connected UI clients |
| Completion webhook | Scraper notifies backend after a run |
| Chat job polling | UI updates scrape status and loads leads |

## Development and Operations

| Tool | Purpose |
| --- | --- |
| `concurrently` | Run backend and UI together |
| Prisma CLI | `db push`, schema validation, client generation |
| `tsc --noEmit` | Frontend type checking |
| `node --check` | Backend syntax verification |
| `scripts/start-leadgun.sh` | Boot-time PostgreSQL + backend + UI startup |
| User crontab `@reboot` | Automatic stack startup when the machine boots |

## Ports and URLs

| Service | URL |
| --- | --- |
| Next.js UI | `http://localhost:3001` |
| Express API | `http://localhost:3000` |
| Health check | `http://localhost:3000/health` |
| PostgreSQL | `127.0.0.1:5433` |
| Chrome CDP | `http://127.0.0.1:9222` |

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes for AI | Agent, rewriting, classification, drafts |
| `OPENAI_MODEL` | No | Override the default model |
| `INGEST_URL` | Yes for DB ingestion | Scraper-to-backend ingestion endpoint |
| `INGEST_SECRET` | Yes | Shared secret for ingestion and webhook calls |
| `DISCORD_BOT_TOKEN` | For Discord | Bot token used by notification service |
| `CDP_URL` | No | Chrome debugging endpoint |
| `CHROME_PATH` | No | Chrome executable path |
| `CHROME_PROFILE_DIR` | No | Persistent browser profile |
| `PGDATA` | No | PostgreSQL data directory |
| `PGCTL` | No | PostgreSQL control binary |
