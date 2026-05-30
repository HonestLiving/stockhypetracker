# Stock Hype Tracker

Stock Hype Tracker is a local web app for tracking ticker discussion on r/wallstreetbets, then comparing hype across multiple symbols in the same view. It is built for research and monitoring only; it is not trading advice.

## What It Tracks

- r/wallstreetbets posts and comments that mention tickers or cashtags.
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

## Reddit API Access

Reddit may return `403` or `429` for public `.json` requests. For reliable local use, create a Reddit app and copy `.env.example` to `.env`.

The server supports these modes, in order:

- `REDDIT_BEARER_TOKEN` if you already have one.
- `REDDIT_CLIENT_ID` + `REDDIT_REFRESH_TOKEN`.
- `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` for app-only `client_credentials`.
- `REDDIT_CLIENT_ID` without a secret for installed-client OAuth using `REDDIT_DEVICE_ID`.

Set `REDDIT_USER_AGENT` to something descriptive that includes your Reddit username, then restart the server after changing `.env`.

Check the current source status at:

```text
http://localhost:4173/api/sources
```

## Automatic WSB Scanner

The most automatic setup is the included browser extension. It scans r/wallstreetbets from your browser session and sends results to the local app every two minutes.

1. Open Chrome or Edge extensions:

   ```text
   chrome://extensions
   ```

2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   ```text
   C:\Users\matth\Documents\Stock hype tracker\extension
   ```

5. Keep the local tracker running:

   ```bash
   node server.mjs
   ```

The extension reads Reddit pages your browser can already access and posts public JSON results to `http://localhost:4173`. It does not ask for or store your Reddit password.

## Browser Bookmarklet

If Reddit blocks public server requests while your normal browser can view Reddit, use the local import tools in the dashboard.

- Drag **WSB Bookmarklet** to your bookmarks bar.
- Open r/wallstreetbets in your browser.
- Click the bookmarklet once to start or stop a two-minute scanner in that Reddit tab.

Useful pages to import:

```text
https://www.reddit.com/r/wallstreetbets/new.json?limit=100&raw_json=1
https://www.reddit.com/r/wallstreetbets/comments.json?limit=100&raw_json=1
https://www.reddit.com/r/wallstreetbets/search.json?q=SPCE&restrict_sr=1&sort=new&t=day&limit=100&raw_json=1
```

The bookmarklet imports WSB JSON into your local `localhost:4173` app. It does not read or store browser cookies.

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

### Removed Sources

Stocktwits is not included as an active source because its developer registration is paused and automated extraction is restricted unless authorized through an approved API or product rule.

References: [Stocktwits developer page](https://api.stocktwits.com/developers), [Stocktwits Terms](https://stocktwits.com/about/legal/terms/).

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
