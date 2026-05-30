import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

loadLocalEnv();

const PORT = Number(process.env.PORT || 4173);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || Number(process.env.CACHE_TTL_SECONDS || 45) * 1000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS || 9_000);
const MAX_COMMENT_POSTS = Number(process.env.MAX_COMMENT_POSTS || 7);
const DEFAULT_HOURS = Number(process.env.DEFAULT_LOOKBACK_HOURS || 24);
const DEFAULT_TICKER_TEXT = process.env.DEFAULT_TICKERS || "SPCE,SPCX";
const REDDIT_USER_AGENT = process.env.REDDIT_USER_AGENT || "StockHypeTracker/0.1 local research dashboard";
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID || "";
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET || "";
const REDDIT_REFRESH_TOKEN = process.env.REDDIT_REFRESH_TOKEN || "";
const REDDIT_BEARER_TOKEN = process.env.REDDIT_BEARER_TOKEN || "";
const REDDIT_USERNAME = process.env.REDDIT_USERNAME || "";
const REDDIT_PASSWORD = process.env.REDDIT_PASSWORD || "";
const REDDIT_DEVICE_ID = process.env.REDDIT_DEVICE_ID || "stockhypetrackerlocal01";
const MAX_TICKERS = 12;
const REDDIT_POST_LIMIT = Number(process.env.REDDIT_POST_LIMIT || 100);
const DEFAULT_SUBREDDITS = (
  process.env.REDDIT_SUBREDDITS ||
  "wallstreetbets"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const jsonCache = new Map();
const importedRedditItems = new Map();
let redditTokenCache = null;
let lastTrackedTickers = [];

class ApiError extends Error {
  constructor(message, { status = 0, statusText = "", body = "", url = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    this.url = url;
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const bullishWords = [
  "bullish",
  "calls",
  "moon",
  "squeeze",
  "breakout",
  "rally",
  "rip",
  "rocket",
  "buy",
  "long",
  "upside",
  "undervalued",
  "beat",
  "accumulate"
];

const bearishWords = [
  "bearish",
  "puts",
  "short",
  "dump",
  "dilution",
  "bankrupt",
  "scam",
  "sell",
  "bagholder",
  "overvalued",
  "miss",
  "downside",
  "rug",
  "fade"
];

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTickers(value) {
  const raw = String(value || DEFAULT_TICKER_TEXT)
    .split(/[,\s]+/)
    .map((item) => item.replace(/^\$/, "").trim().toUpperCase())
    .filter(Boolean);

  const seen = new Set();
  return raw
    .filter((ticker) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker))
    .filter((ticker) => {
      if (seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    })
    .slice(0, MAX_TICKERS);
}

lastTrackedTickers = parseTickers(DEFAULT_TICKER_TEXT);

function tickerPattern(symbol) {
  return new RegExp(`(^|[^A-Za-z0-9])\\$?${escapeRegExp(symbol)}([^A-Za-z0-9]|$)`, "i");
}

function textMatchesTicker(symbol, ...parts) {
  const text = parts.filter(Boolean).join(" ");
  return tickerPattern(symbol).test(text);
}

function unixToIso(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

function permalink(pathname) {
  if (!pathname) return null;
  return pathname.startsWith("http") ? pathname : `https://www.reddit.com${pathname}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function pctChange(current, previous) {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return current > 0 ? 999 : 0;
  return ((current - previous) / previous) * 100;
}

function inferTextSentiment(text) {
  const normalized = ` ${String(text || "").toLowerCase()} `;
  const bullish = bullishWords.reduce((count, word) => count + (normalized.includes(` ${word} `) ? 1 : 0), 0);
  const bearish = bearishWords.reduce((count, word) => count + (normalized.includes(` ${word} `) ? 1 : 0), 0);
  if (bullish > bearish) return "bullish";
  if (bearish > bullish) return "bearish";
  return "neutral";
}

async function fetchJson(url, { ttlMs = CACHE_TTL_MS, headers = {} } = {}) {
  const cached = jsonCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "application/json,text/plain,*/*",
        "user-agent": REDDIT_USER_AGENT,
        ...headers
      }
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ApiError(`${response.status} ${response.statusText}`, {
        status: response.status,
        statusText: response.statusText,
        body: body.slice(0, 500),
        url
      });
    }

    const value = await response.json();
    jsonCache.set(url, { value, expiresAt: Date.now() + ttlMs });
    return value;
  } finally {
    clearTimeout(timeout);
  }
}

function publicRedditUrl(pathname) {
  const [base, query = ""] = pathname.split("?");
  return `https://www.reddit.com${base}.json${query ? `?${query}` : ""}`;
}

function redditAuthMode() {
  if (REDDIT_BEARER_TOKEN) return "bearer_token";
  if (REDDIT_CLIENT_ID && REDDIT_REFRESH_TOKEN) return "refresh_token";
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET && REDDIT_USERNAME && REDDIT_PASSWORD) return "password";
  if (REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET) return "client_credentials";
  if (REDDIT_CLIENT_ID) return "installed_client";
  return "public_json";
}

async function getRedditAccessToken() {
  if (REDDIT_BEARER_TOKEN) return REDDIT_BEARER_TOKEN;
  if (redditTokenCache && redditTokenCache.expiresAt > Date.now() + 30_000) {
    return redditTokenCache.accessToken;
  }

  const mode = redditAuthMode();
  if (mode === "public_json") return null;

  const body = new URLSearchParams();
  if (mode === "refresh_token") {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", REDDIT_REFRESH_TOKEN);
  } else if (mode === "password") {
    body.set("grant_type", "password");
    body.set("username", REDDIT_USERNAME);
    body.set("password", REDDIT_PASSWORD);
  } else if (mode === "installed_client") {
    body.set("grant_type", "https://oauth.reddit.com/grants/installed_client");
    body.set("device_id", REDDIT_DEVICE_ID);
  } else if (mode === "client_credentials") {
    body.set("grant_type", "client_credentials");
  }

  const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "authorization": `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": REDDIT_USER_AGENT
      },
      body
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new ApiError(`Reddit OAuth ${response.status} ${response.statusText}`, {
        status: response.status,
        statusText: response.statusText,
        body: bodyText.slice(0, 500),
        url: "https://www.reddit.com/api/v1/access_token"
      });
    }

    const payload = await response.json();
    if (!payload.access_token) {
      throw new Error("token response missing access_token");
    }

    redditTokenCache = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000
    };
    return redditTokenCache.accessToken;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRedditJson(pathname) {
  const token = await getRedditAccessToken();
  if (token) {
    return fetchJson(`https://oauth.reddit.com${pathname}`, {
      headers: {
        "authorization": `Bearer ${token}`,
        "user-agent": REDDIT_USER_AGENT
      }
    });
  }

  return fetchJson(publicRedditUrl(pathname), {
    headers: {
      "user-agent": REDDIT_USER_AGENT
    }
  });
}

function listingChildren(listing) {
  return Array.isArray(listing?.data?.children) ? listing.data.children : [];
}

function mapRedditPost(child) {
  const data = child?.data || {};
  const title = data.title || "";
  const body = data.selftext || "";
  return {
    id: `reddit-post-${data.id}`,
    rawId: data.id,
    source: "reddit",
    type: "post",
    title,
    text: body,
    createdAt: unixToIso(data.created_utc),
    author: data.author || "[deleted]",
    community: data.subreddit ? `r/${data.subreddit}` : "reddit",
    engagement: Number(data.score || 0) + Number(data.num_comments || 0),
    score: Number(data.score || 0),
    comments: Number(data.num_comments || 0),
    url: permalink(data.permalink),
    sentiment: inferTextSentiment(`${title} ${body}`)
  };
}

function mapRedditComment(child) {
  const data = child?.data || {};
  const body = data.body || "";
  return {
    id: `reddit-comment-${data.id}`,
    rawId: data.id,
    source: "reddit",
    type: "comment",
    title: data.link_title || "Reddit comment",
    text: body,
    createdAt: unixToIso(data.created_utc),
    author: data.author || "[deleted]",
    community: data.subreddit ? `r/${data.subreddit}` : "reddit",
    engagement: Number(data.score || 0),
    score: Number(data.score || 0),
    comments: 0,
    url: permalink(data.permalink),
    sentiment: inferTextSentiment(body)
  };
}

function flattenCommentListing(children, output = []) {
  for (const child of children || []) {
    if (child?.kind === "t1") {
      output.push(mapRedditComment(child));
      const replies = child?.data?.replies;
      if (replies?.data?.children) {
        flattenCommentListing(replies.data.children, output);
      }
    }
  }
  return output;
}

function collectRedditThings(node, output = [], seen = new Set()) {
  if (!node) return output;

  if (Array.isArray(node)) {
    for (const item of node) collectRedditThings(item, output, seen);
    return output;
  }

  if (typeof node !== "object") return output;

  if ((node.kind === "t3" || node.kind === "t1") && node.data?.id && !seen.has(`${node.kind}:${node.data.id}`)) {
    seen.add(`${node.kind}:${node.data.id}`);
    const item = node.kind === "t3" ? mapRedditPost(node) : mapRedditComment(node);
    if (item.createdAt) output.push(item);
  }

  if (node.data?.children) collectRedditThings(node.data.children, output, seen);
  if (node.data?.replies) collectRedditThings(node.data.replies, output, seen);

  return output;
}

function pruneImportedRedditItems() {
  const maxAge = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, entry] of importedRedditItems) {
    if (entry.importedAtMs < maxAge) importedRedditItems.delete(id);
  }

  if (importedRedditItems.size <= 5000) return;
  const ordered = [...importedRedditItems.entries()].sort((a, b) => b[1].importedAtMs - a[1].importedAtMs);
  importedRedditItems.clear();
  for (const [id, entry] of ordered.slice(0, 5000)) {
    importedRedditItems.set(id, entry);
  }
}

function importRedditPayload(payload, sourceUrl = "manual import") {
  const importedAt = new Date().toISOString();
  const importedAtMs = Date.now();
  const items = collectRedditThings(payload);
  let added = 0;
  let updated = 0;

  for (const item of items) {
    const existed = importedRedditItems.has(item.id);
    importedRedditItems.set(item.id, {
      ...item,
      importedAt,
      importedAtMs,
      importSourceUrl: sourceUrl
    });
    if (existed) {
      updated += 1;
    } else {
      added += 1;
    }
  }

  pruneImportedRedditItems();

  return {
    found: items.length,
    added,
    updated,
    totalImported: importedRedditItems.size,
    importedAt
  };
}

function importedRedditSnapshot(hours) {
  pruneImportedRedditItems();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return [...importedRedditItems.values()]
    .filter((item) => Date.parse(item.createdAt) >= cutoff)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function fetchSharedRedditFeeds(hours) {
  const multi = DEFAULT_SUBREDDITS.join("+");
  const limit = Math.min(REDDIT_POST_LIMIT, 100);
  const [posts, comments] = await Promise.allSettled([
    fetchRedditJson(`/r/${multi}/new?limit=${limit}&raw_json=1`),
    fetchRedditJson(`/r/${multi}/comments?limit=${limit}&raw_json=1`)
  ]);

  return {
    posts:
      posts.status === "fulfilled"
        ? listingChildren(posts.value).map(mapRedditPost).filter((item) => item.createdAt)
        : [],
    comments:
      comments.status === "fulfilled"
        ? listingChildren(comments.value).map(mapRedditComment).filter((item) => item.createdAt)
        : [],
    errors: [posts, comments]
      .filter((entry) => entry.status === "rejected")
      .map((entry) => humanSourceError("Reddit feed", entry.reason, "reddit"))
  };
}

async function fetchRedditSearch(symbol) {
  const queries = [`"$${symbol}"`, `"${symbol}"`];
  const paths = queries.map(
    (query) =>
      `/search?q=${encodeURIComponent(query)}&sort=new&t=week&limit=100&raw_json=1`
  );

  const settled = await Promise.allSettled(paths.map((url) => fetchRedditJson(url)));
  const posts = [];
  const errors = [];

  for (const entry of settled) {
    if (entry.status === "fulfilled") {
      posts.push(...listingChildren(entry.value).map(mapRedditPost));
    } else {
      errors.push(humanSourceError(`Reddit search ${symbol}`, entry.reason, "reddit"));
    }
  }

  return { posts, errors };
}

async function fetchRedditPostComments(postId, symbol) {
  const payload = await fetchRedditJson(`/comments/${postId}?limit=200&sort=new&raw_json=1`);
  const commentTree = Array.isArray(payload) ? payload[1] : null;
  return flattenCommentListing(listingChildren(commentTree)).filter((item) =>
    textMatchesTicker(symbol, item.title, item.text)
  );
}

async function collectReddit(symbol, shared, hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const itemsById = new Map();
  const errors = [...(shared.errors || [])];

  const include = (item) => {
    if (!item.createdAt) return;
    const created = Date.parse(item.createdAt);
    if (!Number.isFinite(created) || created < cutoff) return;
    if (!textMatchesTicker(symbol, item.title, item.text)) return;
    itemsById.set(item.id, item);
  };

  for (const item of shared.posts) include(item);
  for (const item of shared.comments) include(item);

  const searched = await fetchRedditSearch(symbol);
  searched.errors.forEach((error) => errors.push(error));
  searched.posts.forEach(include);

  const commentTargets = [...itemsById.values()]
    .filter((item) => item.type === "post" && item.rawId && item.comments > 0)
    .sort((a, b) => b.comments - a.comments)
    .slice(0, MAX_COMMENT_POSTS);

  const commentSettled = await Promise.allSettled(
    commentTargets.map((post) => fetchRedditPostComments(post.rawId, symbol))
  );

  for (const entry of commentSettled) {
    if (entry.status === "fulfilled") {
      entry.value.forEach(include);
    } else {
      errors.push(humanSourceError(`Reddit comments ${symbol}`, entry.reason, "reddit"));
    }
  }

  return {
    items: [...itemsById.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    errors
  };
}

function countInRange(items, startMs, endMs = Date.now()) {
  return items.filter((item) => {
    const created = Date.parse(item.createdAt);
    return created >= startMs && created < endMs;
  }).length;
}

function topCounts(items, key, limit = 5) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function uniqueErrors(errors) {
  return [...new Set(errors.filter(Boolean))];
}

function humanSourceError(label, error, provider) {
  if (error instanceof ApiError && error.status === 403) {
    if (provider === "reddit" && redditAuthMode() === "public_json") {
      return `${label}: 403 blocked. Reddit is rejecting public JSON access from this network; add Reddit OAuth values to .env and restart.`;
    }
    if (provider === "reddit") {
      return `${label}: 403 forbidden. Reddit rejected the configured OAuth request; check REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET/refresh token, and REDDIT_USER_AGENT.`;
    }
  }

  if (error instanceof ApiError && error.status === 401) {
    return `${label}: 401 unauthorized. Check the configured API token or OAuth credentials.`;
  }

  if (error instanceof ApiError && error.status === 429) {
    if (provider === "reddit" && redditAuthMode() === "public_json") {
      return `${label}: 429 rate limited. Reddit is throttling public access from this network; add Reddit OAuth values to .env and restart.`;
    }
    return `${label}: 429 rate limited. Slow down requests or check the provider limit for your credentials.`;
  }

  return `${label}: ${error.message}`;
}

function sourceConfig() {
  return {
    reddit: {
      mode: redditAuthMode(),
      hasClientId: Boolean(REDDIT_CLIENT_ID),
      hasClientSecret: Boolean(REDDIT_CLIENT_SECRET),
      hasRefreshToken: Boolean(REDDIT_REFRESH_TOKEN),
      hasBearerToken: Boolean(REDDIT_BEARER_TOKEN),
      hasUsernamePassword: Boolean(REDDIT_USERNAME && REDDIT_PASSWORD),
      userAgentConfigured: REDDIT_USER_AGENT !== "StockHypeTracker/0.1 local research dashboard"
    }
  };
}

async function testSources() {
  const result = {
    generatedAt: new Date().toISOString(),
    config: sourceConfig(),
    reddit: { ok: false, message: "" }
  };

  try {
    const payload = await fetchRedditJson(`/r/${DEFAULT_SUBREDDITS[0] || "wallstreetbets"}/new?limit=1&raw_json=1`);
    result.reddit.ok = Array.isArray(payload?.data?.children);
    result.reddit.message = result.reddit.ok ? "Reddit read endpoint is reachable." : "Reddit responded with an unexpected shape.";
  } catch (error) {
    result.reddit.message = humanSourceError("Reddit diagnostic", error, "reddit");
  }

  return result;
}

function buildTimeline(items, hours) {
  const bucketCount = clamp(Math.ceil(hours), 1, 48);
  const bucketMs = (hours * 60 * 60 * 1000) / bucketCount;
  const start = Date.now() - hours * 60 * 60 * 1000;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const bucketStart = start + bucketMs * index;
    return {
      start: new Date(bucketStart).toISOString(),
      label: new Date(bucketStart).toLocaleTimeString("en-US", { hour: "numeric" }),
      reddit: 0,
      total: 0
    };
  });

  for (const item of items) {
    const created = Date.parse(item.createdAt);
    const index = Math.floor((created - start) / bucketMs);
    if (index >= 0 && index < buckets.length) {
      buckets[index].reddit += 1;
      buckets[index].total += 1;
    }
  }

  return buckets;
}

function computeMetrics(symbol, redditItems, hours) {
  const now = Date.now();
  const items = [...redditItems].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const oneHour = 60 * 60 * 1000;
  const sixHours = 6 * oneHour;
  const selectedWindowMs = hours * oneHour;
  const halfWindowMs = selectedWindowMs / 2;
  const current1h = countInRange(items, now - oneHour, now + 1);
  const previous1h = countInRange(items, now - 2 * oneHour, now - oneHour);
  const current6h = countInRange(items, now - sixHours, now + 1);
  const previous6h = countInRange(items, now - 2 * sixHours, now - sixHours);
  const currentWindowHalf = countInRange(items, now - halfWindowMs, now + 1);
  const previousWindowHalf = countInRange(items, now - selectedWindowMs, now - halfWindowMs);
  const averageHourly = items.length / Math.max(hours, 1);
  const velocityRatio = averageHourly === 0 ? current1h : current1h / averageHourly;
  const velocityPct = pctChange(current1h, previous1h);
  const sixHourPct = pctChange(current6h, previous6h);
  const windowGrowthPct = pctChange(currentWindowHalf, previousWindowHalf);

  const uniqueAuthors = new Set(items.map((item) => `${item.source}:${item.author}`).filter(Boolean));
  const communities = new Set(items.map((item) => item.community).filter(Boolean));
  const engagementTotal = items.reduce((total, item) => total + Number(item.engagement || 0), 0);
  const engagement1h = items
    .filter((item) => Date.parse(item.createdAt) >= now - oneHour)
    .reduce((total, item) => total + Number(item.engagement || 0), 0);
  const engagementPrev1h = items
    .filter((item) => Date.parse(item.createdAt) >= now - 2 * oneHour && Date.parse(item.createdAt) < now - oneHour)
    .reduce((total, item) => total + Number(item.engagement || 0), 0);
  const engagementPct = pctChange(engagement1h, engagementPrev1h);

  const sentimentCounts = items.reduce(
    (acc, item) => {
      acc[item.sentiment] = (acc[item.sentiment] || 0) + 1;
      return acc;
    },
    { bullish: 0, bearish: 0, neutral: 0 }
  );
  const opinionated = sentimentCounts.bullish + sentimentCounts.bearish;
  const bullishShare = opinionated ? sentimentCounts.bullish / opinionated : 0.5;
  const sourceCounts = {
    reddit: redditItems.length
  };
  const authorCounts = topCounts(items, "author", 8);
  const topAuthorShare = items.length ? (authorCounts[0]?.count || 0) / items.length : 0;
  const concentrationPenalty = clamp01((topAuthorShare - 0.28) / 0.45);

  const volumeComponent = 20 * clamp01(Math.log1p(items.length) / Math.log1p(130));
  const velocityComponent = 20 * clamp01(velocityRatio / 5);
  const accelerationComponent = 16 * clamp01((current1h - previous1h + 3) / 12);
  const sixHourComponent = 12 * clamp01((sixHourPct + 100) / 350);
  const authorComponent = 12 * clamp01(uniqueAuthors.size / Math.max(items.length * 0.7, 8));
  const breadthComponent = 10 * clamp01(communities.size / 7);
  const engagementComponent = 8 * clamp01(Math.log1p(engagementTotal) / Math.log1p(500));
  const sentimentComponent = 8 * clamp01((bullishShare - 0.35) / 0.55);
  const hypeScore = Math.round(
    clamp(
      volumeComponent +
        velocityComponent +
        accelerationComponent +
        sixHourComponent +
        authorComponent +
        breadthComponent +
        engagementComponent +
        sentimentComponent -
        16 * concentrationPenalty,
      0,
      100
    )
  );

  let trend = "quiet";
  if (items.length >= 5) trend = "steady";
  if ((current1h >= 3 && current1h > previous1h * 1.35) || (current6h >= 8 && current6h > previous6h * 1.25)) {
    trend = "increasing";
  }
  if (items.length >= 5 && current1h < previous1h * 0.6 && current6h < previous6h * 0.8) {
    trend = "cooling";
  }
  if (concentrationPenalty > 0.7 && items.length >= 8) {
    trend = "concentrated";
  }

  return {
    symbol,
    trend,
    hypeScore,
    generatedAt: new Date().toISOString(),
    sourceCounts,
    counts: {
      total: items.length,
      redditPosts: redditItems.filter((item) => item.type === "post").length,
      redditComments: redditItems.filter((item) => item.type === "comment").length,
      current1h,
      previous1h,
      current6h,
      previous6h,
      currentWindowHalf,
      previousWindowHalf
    },
    growth: {
      velocityRatio: Number(velocityRatio.toFixed(2)),
      velocityPct: Math.round(velocityPct),
      sixHourPct: Math.round(sixHourPct),
      windowGrowthPct: Math.round(windowGrowthPct),
      engagementPct: Math.round(engagementPct)
    },
    breadth: {
      uniqueAuthors: uniqueAuthors.size,
      communities: communities.size,
      topCommunities: topCounts(items, "community", 8),
      topAuthors: authorCounts,
      topAuthorShare: Number(topAuthorShare.toFixed(2))
    },
    sentiment: {
      ...sentimentCounts,
      bullishShare: Number(bullishShare.toFixed(2))
    },
    engagement: {
      total: engagementTotal,
      current1h: engagement1h,
      previous1h: engagementPrev1h
    },
    spam: {
      concentrationPenalty: Number(concentrationPenalty.toFixed(2)),
      topAuthorShare: Number(topAuthorShare.toFixed(2))
    },
    timeline: buildTimeline(items, hours),
    recent: items.slice(0, 18)
  };
}

async function buildHypePayload(tickers, hours) {
  const sharedReddit = await fetchSharedRedditFeeds(hours);
  const importedItems = importedRedditSnapshot(hours);
  sharedReddit.posts.push(...importedItems.filter((item) => item.type === "post"));
  sharedReddit.comments.push(...importedItems.filter((item) => item.type === "comment"));

  const entries = await Promise.all(
    tickers.map(async (symbol) => {
      const reddit = await collectReddit(symbol, sharedReddit, hours);
      const metrics = computeMetrics(symbol, reddit.items, hours);
      return {
        ...metrics,
        importCounts: {
          matched: reddit.items.filter((item) => item.importedAt).length
        },
        errors: uniqueErrors(reddit.errors)
      };
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    hours,
    subreddits: DEFAULT_SUBREDDITS,
    imports: {
      total: importedRedditItems.size,
      inWindow: importedItems.length
    },
    tickers: entries
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendCorsJson(response, status, payload) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendCorsPreflight(response) {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "cache-control": "no-store"
  });
  response.end();
}

async function readBody(request, maxBytes = 6_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(request, response, pathname) {
  let requested = decodeURIComponent(pathname);
  if (requested === "/") requested = "/index.html";
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!fullPath.startsWith(PUBLIC_DIR) || !existsSync(fullPath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const ext = path.extname(fullPath);
  response.writeHead(200, {
    "content-type": mimeTypes[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  response.end(await readFile(fullPath));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/import-reddit" && request.method === "OPTIONS") {
      sendCorsPreflight(response);
      return;
    }

    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, time: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/api/config") {
      sendJson(response, 200, {
        defaultTickers: parseTickers(DEFAULT_TICKER_TEXT),
        defaultHours: DEFAULT_HOURS,
        subreddits: DEFAULT_SUBREDDITS,
        maxTickers: MAX_TICKERS,
        sources: sourceConfig()
      });
      return;
    }

    if (url.pathname === "/api/sources") {
      sendJson(response, 200, await testSources());
      return;
    }

    if (url.pathname === "/api/tracked-tickers") {
      if (request.method === "OPTIONS") {
        sendCorsPreflight(response);
        return;
      }
      sendCorsJson(response, 200, { tickers: lastTrackedTickers });
      return;
    }

    if (url.pathname === "/api/imports") {
      if (request.method === "DELETE") {
        importedRedditItems.clear();
        sendJson(response, 200, { ok: true, totalImported: 0 });
        return;
      }

      sendJson(response, 200, {
        totalImported: importedRedditItems.size,
        sample: [...importedRedditItems.values()].slice(0, 5).map((item) => ({
          type: item.type,
          title: item.title,
          community: item.community,
          createdAt: item.createdAt,
          importedAt: item.importedAt
        }))
      });
      return;
    }

    if (url.pathname === "/api/import-reddit" && request.method === "POST") {
      try {
        const body = await readBody(request);
        const parsed = JSON.parse(body);
        const payload = parsed.payload ?? parsed.data ?? parsed;
        const sourceUrl = parsed.sourceUrl || parsed.url || "manual import";
        sendCorsJson(response, 200, {
          ok: true,
          ...importRedditPayload(payload, sourceUrl)
        });
      } catch (error) {
        sendCorsJson(response, 400, { ok: false, error: error.message || "Import failed" });
      }
      return;
    }

    if (url.pathname === "/api/hype") {
      const tickers = parseTickers(url.searchParams.get("tickers"));
      const hours = clamp(Number(url.searchParams.get("hours") || DEFAULT_HOURS), 1, 72);
      if (!tickers.length) {
        sendJson(response, 400, { error: "Provide at least one ticker." });
        return;
      }
      lastTrackedTickers = tickers;
      sendJson(response, 200, await buildHypePayload(tickers, hours));
      return;
    }

    await serveStatic(request, response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Stock Hype Tracker running at http://localhost:${PORT}`);
});
