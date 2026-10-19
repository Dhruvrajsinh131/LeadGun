Lead Gun

What it does:
Lead Gun scans Reddit, X (Twitter) and LinkedIn for people who want to hire developers. It checks subreddits like forhire, startups, SaaS and others for hiring posts, searches X and LinkedIn for hiring phrases. It scores each post, filters out spam, and sends the best leads to Discord.

How to use:
1. Run npm install to install everything
2. Copy .env.example to .env and fill in your Discord bot token and LLM API key. All other settings live in src/config/index.js
3. Run npm start to start the server. It will scrape automatically every 3 hours
4. Run npm run scrape to scrape once manually without starting server (pick sources with npm run scrape -- --reddit, --x, --linkedin or --all)
5. Check leads at http://localhost:3000/api/leads, http://localhost:3000/api/x/leads, http://localhost:3000/api/linkedin/leads or on Discord
