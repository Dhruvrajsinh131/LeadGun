# LeadGun Features

## Lead Discovery

- Scrapes four platforms independently or together:
  - Reddit
  - X / Twitter
  - LinkedIn
  - Upwork
- Uses a shared logged-in Chrome session through Playwright and CDP.
- Runs on demand from AI chat, the CLI, the API, or the scheduler.
- Supports scheduled scraping every three hours.
- Supports an optional scrape on backend startup.
- Preserves source-specific defaults while allowing dynamic search phrases.
- Detects login walls, rate limits, verification challenges, and closed tabs.
- Retries a failed platform tab once where the scraper supports it.
- Runs selected platforms in parallel when more than one source is requested.
- Avoids duplicate leads through URL/key based merging and Prisma upserts.

## AI Search Query Rewriting

- Converts natural-language requests into complete search phrases.
- Prevents generic split-token searches such as `software`, `developer`, `remote`, `jobs`.
- Produces buyer-intent and role-oriented variants.
- Uses LLM rewriting when available.
- Falls back to deterministic phrase generation when the LLM is unavailable.
- Works through the AI chat, the manual scrape API, and the CLI.

Example:

```text
Find me remote software dev jobs
```

Produces phrases such as:

```text
remote software developer
remote software developer needed
hire remote software developer
freelance remote software developer
contract remote software developer
remote software engineer
```

## Lead Filtering and Scoring

- Normalizes leads from four different platforms into one database shape.
- Applies direct and indirect buying-intent patterns.
- Detects technical capabilities, categories, budget signals, and intent type.
- Filters out sellers, job seekers, spam, and unrelated posts with exclusion rules.
- Scores leads with a deterministic heuristic matcher.
- Optionally refines scoring/classification with an LLM.
- Assigns and stores lead score, grade, reasoning, and capability labels.
- Detects freshness from posted/discovered timestamps.
- Uses a 15-day freshness limit and a 7-day healthy threshold by default.
- Exposes fresh, aging, and stale filters and badges.

## Lead Database

- Stores normalized leads in PostgreSQL through Prisma.
- Stores platform, title, content, URL, author, company, location, skills, budget, score, status, and source metadata.
- Preserves workflow fields such as status, saved state, and archived state when a lead is re-ingested.
- Excludes archived leads from normal lists by default.
- Supports saved leads, archived leads, status changes, and notes.
- Stores lead activity history.
- Stores outreach messages and reply state.
- Stores scrape jobs with source, keyword, status, output, errors, and resulting lead IDs.

## Lead Explorer

- Card and list layouts.
- Search by title, content, username, name, company, location, and capabilities.
- Filters for platform, workflow status, saved state, contacted state, score range, date range, and freshness.
- Sorting and pagination.
- Lead detail drawer.
- Save/unsave and archive/unarchive actions.
- Status changes with activity logging.
- Notes.
- Outreach history.
- AI reply drafting.
- Candidate outreach creation.

## AI Lead Finder Chat

- Streaming assistant responses.
- Persisted conversation history and conversation sidebar.
- New chat and conversation loading.
- Stop button for streaming responses.
- Markdown rendering.
- Lead cards rendered below assistant responses.
- No duplicate lead lists in assistant text.
- Tracks recent lead IDs for follow-up questions such as "explain the last lead".
- Search existing leads by natural-language request.
- Exact-count searches when the user requests a specific number.
- Fetch a single lead's details, notes, activities, and outreach history.
- Extract email addresses from stored lead content.
- Update status, save leads, add notes, and draft replies through tools.
- Start scraper jobs without waiting for completion.
- Poll scrape jobs and show status.
- Load completed scrape-job leads as chat cards.
- Link scrape jobs to the active conversation.
- Select platforms from the user's request.
- Omit source selection to search all platforms.

## Scrape Job Tracking

- Creates a `ScrapeJob` row before a background scrape starts.
- Status values include `started`, `scraping`, `ai_processing`, `completed`, `failed`, and `timeout`.
- Stores the final rewritten search phrases.
- Stores the resulting lead IDs.
- Stores output tail and error details.
- Updates when the scraper CLI exits normally.
- Handles process failures and timeouts.
- Loads job results into the originating chat.
- Supports polling by conversation.
- Sends a completion webhook and SSE event when the scraper finishes.

## Dashboard and Reporting

- Total leads.
- New leads today.
- New leads this week.
- Uncontacted leads.
- Saved leads.
- Replied leads.
- Interested leads.
- Outreach count.
- Leads by platform.
- Leads by status.
- Latest leads.
- Recent activity feed.

## Outreach Workflow

- Draft personalized replies with AI.
- Store drafts in the `Outreach` model.
- Track outbound and inbound messages.
- Track draft, sent, and replied states.
- View outreach history per lead.
- Log drafting, outreach, and reply-received events in lead activity.

## Notifications

- Discord notifications remain active alongside database ingestion.
- Per-platform notification summaries.
- Lead cards with score, capabilities, intent, and source.
- Notification deduplication through stored notified URLs.
- SSE stream for UI scrape-completion updates.
- Scraper-to-backend completion webhook.

## Ingestion and API

- Dedicated ingestion endpoint for the scraper.
- Per-source scraper toggles for Reddit, X, LinkedIn, and Upwork.
- Shared-secret authentication for ingestion and webhooks.
- Upsert behavior keyed by `postUrl`.
- Large JSON payload support up to 50 MB.
- CORS support for the separate Next.js origin.
- Health endpoint for process checks.
- Statistics endpoint for dashboard metrics.
- Lead, outreach, chat, and scrape-job REST endpoints.

## Local Operations

- One-command development startup: `npm run dev`.
- Optional startup scrape: `npm run dev:scrape`.
- Standalone scraper CLI with source flags and keyword overrides.
- Persistent PostgreSQL cluster under `.pgdata`.
- Backend auto-starts the local PostgreSQL cluster if it is stopped.
- `scripts/start-leadgun.sh` starts PostgreSQL, backend, and UI.
- User crontab `@reboot` entry starts the stack when the machine boots.
- Prisma schema managed from `prisma/schema.prisma`.

## Current Limitations

- Scraper reliability depends on a logged-in Chrome session and the target site's current DOM.
- Login walls, rate limits, or verification challenges can reduce or empty a scrape.
- There is no automated test suite yet; verification is done with syntax checks, type checks, API calls, and manual UI testing.
- Chat conversation lead cards are partly tracked in memory; scrape-job cards are reloaded from PostgreSQL.
- The application is designed as a local single-user tool, not a multi-tenant SaaS deployment.
- Background scrape jobs do not currently enforce a global queue across separate scraper processes.
