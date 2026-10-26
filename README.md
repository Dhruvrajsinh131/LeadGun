Lead Gun

What it does:
Lead Gun scans Reddit, X (Twitter), LinkedIn and Upwork for people who want to hire developers. It checks subreddits like forhire, startups, SaaS and others for hiring posts, searches X and LinkedIn for hiring phrases, and searches Upwork for fresh software jobs. It scores each post, filters out spam, and sends the best leads to Discord.

How to use:
1. Run npm install to install everything
2. Copy .env.example to .env and fill in your Discord bot token and LLM API key. All other settings live in src/config/index.js
3. Run npm start to start the server. It will scrape automatically every 3 hours
4. Run npm run scrape to scrape once manually without starting server (pick sources with npm run scrape -- --reddit, --x, --linkedin, --upwork or --all)
5. Check leads at http://localhost:3000/api/leads, http://localhost:3000/api/x/leads, http://localhost:3000/api/linkedin/leads, http://localhost:3000/api/upwork/leads or on Discord

Chrome:
- No need to start Chrome manually. The scraper launches it on demand with remote debugging on http://127.0.0.1:9222 and reuses it across runs. Log in to Reddit/X/LinkedIn/Upwork once in that window; the session persists in the profile. Upwork search works logged out but a logged-in session reduces Cloudflare checks.
- If Chrome is already open with the same profile but without the debug port, close it fully and rerun — Chrome only exposes the port when it starts with --remote-debugging-port.
- Override with CHROME_PATH (Chrome binary) and CHROME_PROFILE_DIR (profile folder, default ~/.config/my-site-test) in .env. Set CDP_URL if port 9222 is taken.
