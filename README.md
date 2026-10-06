Lead Gun

What it does:
Lead Gun scans Reddit for people who want to hire developers. It checks subreddits like forhire, startups, SaaS and others for hiring posts. It scores each post, filters out spam, and sends the best leads to Discord.

How to use:
1. Run npm install to install everything
2. Copy .env.example to .env and fill in your Discord bot token, channel ID, and LLM API key
3. Run npm start to start the server. It will scrape automatically every 3 hours
4. Run npm run scrape to scrape once manually without starting server
5. Check leads at http://localhost:3000/api/leads or on Discord
