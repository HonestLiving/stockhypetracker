# Stock Hype Tracker

Stock Hype Tracker is a local web app for tracking ticker discussion across Reddit and Stocktwits, then comparing hype across multiple symbols in the same view. It is built for research and monitoring only; it is not trading advice.

## What It Tracks

- Reddit posts and comments that mention tickers or cashtags.
- Recent Stocktwits symbol messages when access is available.
- Relative ticker hype across a shared lookback window, source filter, and scoring method.

## Local Setup

1. Install Node.js 20 or newer.
2. Clone the repo and enter the project directory.
3. Copy `.env.example` to `.env` if you want to change the defaults.
4. Start the local app:

   ```bash
   npm run dev
   ```

5. Open the local URL printed by the server:

   ```bash
   http://localhost:4173
   ```

There are no npm package dependencies in the current version; the app uses Node's built-in HTTP server and `fetch`.

## Comparing Multiple Tickers

Use the ticker comparison input with comma-separated symbols, for example:

```text
TSLA,NVDA,AMD,SPY
```

Keep the same lookback window and source selection when comparing symbols. The app should normalize plain tickers and cashtags, so `TSLA` and `$TSLA` are treated as the same symbol. Compare the relative hype score, mention count, source split, and trend direction together; a high social volume reading can reflect spam, coordinated posting, news shocks, or market-wide attention rather than fundamentals.

## Data Sources And Limits

### Reddit

- Uses Reddit's public JSON endpoints from the local server when no credentials are configured.
- Supports optional Reddit OAuth via `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REFRESH_TOKEN`, or `REDDIT_BEARER_TOKEN`.
- For heavier, hosted, or commercial use, move to authorized Reddit Data API access with valid credentials and a clear user agent.
- Reddit can require OAuth for hosted-provider IP ranges and can enforce request, user, or app limits at its discretion.
- Reddit content can be deleted, private, quarantined, rate limited, delayed, or unavailable through the API.
- Follow Reddit's Data API Terms, Developer Terms, attribution requirements, privacy requirements, and cache/deletion rules.

References: [Reddit API docs](https://www.reddit.com/dev/api/), [Reddit developer access help](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data), [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms).

### Stocktwits

- Uses Stocktwits' public symbol stream endpoint for recent messages by default, with optional `STOCKTWITS_ACCESS_TOKEN` passthrough.
- The default Stocktwits endpoint is recent-only, so growth metrics are best interpreted as short-window momentum.
- Stocktwits developer registration and commercial access may have separate approval, terms, and rate limits.
- Do not scrape, harvest, mirror, data-mine, or automate extraction unless Stocktwits authorizes that access through an approved API, widget, developer offering, or other product rule.
- Approved Firestream access uses authenticated streaming and may provide real-time symbol metrics rather than complete historical message archives.
- Stocktwits content can be rate limited, incomplete, delayed, moderated, or unavailable depending on the access method.

References: [Stocktwits developer page](https://api.stocktwits.com/developers), [Stocktwits Terms](https://stocktwits.com/about/legal/terms/), [Stocktwits Firestream symbols stream docs](https://firestream-portal.stocktwits.com/documentation/symbols-stream).

## Legal And API Caveats

- This project is for informational and educational use only.
- It does not provide investment, legal, tax, accounting, or financial advice.
- You are responsible for complying with platform terms, API limits, privacy law, securities law, data retention rules, and attribution requirements.
- Do not commit secrets, access tokens, refresh tokens, cookies, downloaded raw user content, or private datasets.
- Review all source terms before deploying publicly, monetizing, storing content long term, or redistributing social data.

## Publishing

The repo includes `.env.example` for configuration discovery and `.gitignore` to keep local secrets, dependencies, build output, logs, and caches out of Git. To publish it after creating a GitHub repository:

```bash
git remote add origin https://github.com/YOUR_USER/stock-hype-tracker.git
git branch -M main
git push -u origin main
```
