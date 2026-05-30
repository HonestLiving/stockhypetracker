const LOCAL_BASE = "http://localhost:4173";
const REDDIT_BASE = "https://www.reddit.com";
const SCAN_INTERVAL_MS = 120_000;
const MAX_SEARCH_TICKERS = 6;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ enabled: true, lastRunAt: 0 });
  chrome.alarms.create("scan-wsb", { delayInMinutes: 0.1, periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("scan-wsb", { delayInMinutes: 0.1, periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "scan-wsb") {
    scanIfEnabled().catch((error) => chrome.storage.local.set({ lastError: error.message }));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "scan-now") {
    scanWsb()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "set-enabled") {
    chrome.storage.local.set({ enabled: Boolean(message.enabled) }).then(() => {
      if (message.enabled) scanIfEnabled().catch((error) => chrome.storage.local.set({ lastError: error.message }));
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function scanIfEnabled() {
  const state = await chrome.storage.local.get(["enabled", "lastRunAt"]);
  if (state.enabled === false) return;
  if (Date.now() - Number(state.lastRunAt || 0) < SCAN_INTERVAL_MS) return;
  await scanWsb();
}

async function scanWsb() {
  await chrome.storage.local.set({ lastRunAt: Date.now(), lastError: "" });

  const tickers = await getTrackedTickers();
  const endpoints = buildEndpoints(tickers);
  let found = 0;
  let added = 0;
  let updated = 0;

  for (const endpoint of endpoints) {
    const payload = await fetchRedditJson(endpoint);
    const imported = await postToTracker(payload, `${REDDIT_BASE}${endpoint}`);
    found += imported.found || 0;
    added += imported.added || 0;
    updated += imported.updated || 0;
  }

  const result = {
    ok: true,
    found,
    added,
    updated,
    endpoints: endpoints.length,
    tickers,
    scannedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ lastResult: result, lastError: "" });
  return result;
}

async function getTrackedTickers() {
  try {
    const response = await fetch(`${LOCAL_BASE}/api/tracked-tickers`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = await response.json();
    if (Array.isArray(payload.tickers) && payload.tickers.length) {
      return payload.tickers.slice(0, MAX_SEARCH_TICKERS);
    }
  } catch {
    // The dashboard will still catch broad WSB new posts/comments.
  }
  return [];
}

function buildEndpoints(tickers) {
  const endpoints = [
    "/r/wallstreetbets/new.json?limit=100&raw_json=1",
    "/r/wallstreetbets/comments.json?limit=100&raw_json=1"
  ];

  for (const ticker of tickers) {
    endpoints.push(
      `/r/wallstreetbets/search.json?q=${encodeURIComponent(`$${ticker}`)}&restrict_sr=1&sort=new&t=day&limit=100&raw_json=1`,
      `/r/wallstreetbets/search.json?q=${encodeURIComponent(ticker)}&restrict_sr=1&sort=new&t=day&limit=100&raw_json=1`
    );
  }

  return endpoints;
}

async function fetchRedditJson(endpoint) {
  const response = await fetch(`${REDDIT_BASE}${endpoint}`, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    const error = `${response.status} ${response.statusText} from ${endpoint}`;
    await chrome.storage.local.set({ lastError: error });
    throw new Error(error);
  }

  return response.json();
}

async function postToTracker(payload, sourceUrl) {
  const response = await fetch(`${LOCAL_BASE}/api/import-reddit`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ sourceUrl, payload })
  });

  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(result.error || `Tracker import failed: ${response.status}`);
  }

  return result;
}
