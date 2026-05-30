const state = {
  tickers: ["SPCE", "SPCX"],
  hours: 24,
  loading: false,
  data: null,
  timer: null,
  view: document.querySelector(".app-shell")?.dataset.view || "dashboard"
};

const elements = {
  form: document.querySelector("#tickerForm"),
  input: document.querySelector("#tickerInput"),
  hours: document.querySelector("#hoursSelect"),
  auto: document.querySelector("#autoRefresh"),
  refresh: document.querySelector("#refreshButton"),
  popAll: document.querySelector("#popAllButton"),
  grid: document.querySelector("#tickerGrid"),
  compareBody: document.querySelector("#compareBody"),
  lastUpdated: document.querySelector("#lastUpdated"),
  singleTitle: document.querySelector("#singleTitle"),
  importStatus: document.querySelector("#importStatus"),
  importText: document.querySelector("#importText"),
  importButton: document.querySelector("#importButton"),
  clearImports: document.querySelector("#clearImportsButton"),
  bookmarklet: document.querySelector("#bookmarkletLink")
};

function icon(name) {
  const paths = {
    open: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.8 5.13"/><path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07l1.32-1.32"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function normalizeTickers(value) {
  const seen = new Set();
  return String(value || "")
    .split(/[,\s]+/)
    .map((ticker) => ticker.replace(/^\$/, "").trim().toUpperCase())
    .filter((ticker) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker))
    .filter((ticker) => {
      if (seen.has(ticker)) return false;
      seen.add(ticker);
      return true;
    })
    .slice(0, 12);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function signedPercent(value) {
  if (value >= 999) return "+999%";
  const number = Math.round(Number(value || 0));
  return `${number > 0 ? "+" : ""}${number}%`;
}

function relativeTime(iso) {
  const deltaSeconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return formatter.format(deltaSeconds, "second");
  if (abs < 3600) return formatter.format(Math.round(deltaSeconds / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(deltaSeconds / 3600), "hour");
  return formatter.format(Math.round(deltaSeconds / 86400), "day");
}

function trendClass(trend) {
  return {
    increasing: "good",
    steady: "neutral",
    cooling: "warn",
    quiet: "muted",
    concentrated: "bad"
  }[trend] || "neutral";
}

function readParams() {
  const params = new URLSearchParams(window.location.search);
  const fromParams = normalizeTickers(params.get("tickers") || params.get("ticker"));
  const hasTickerParam = params.has("tickers") || params.has("ticker");
  if (fromParams.length) {
    state.tickers = state.view === "single" ? [fromParams[0]] : fromParams;
  }
  const hours = Number(params.get("hours"));
  if (Number.isFinite(hours) && hours > 0) state.hours = hours;
  elements.input.value = state.view === "single" ? state.tickers[0] : state.tickers.join(", ");
  elements.hours.value = String(state.hours);
  return { hasTickerParam, hasHoursParam: params.has("hours") };
}

function syncUrl() {
  const params = new URLSearchParams();
  params.set(state.view === "single" ? "ticker" : "tickers", state.tickers.join(","));
  params.set("hours", String(state.hours));
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", next);
}

function redditJsonUrlScript() {
  return `
    const asJsonUrl = (href) => {
      const url = new URL(href);
      if (!url.pathname.endsWith(".json")) {
        url.pathname = url.pathname.replace(/\\/$/, "") + ".json";
      }
      url.searchParams.set("raw_json", "1");
      return url.href;
    };
    const response = await fetch(asJsonUrl(location.href), { credentials: "include" });
    if (!response.ok) throw new Error(response.status + " " + response.statusText);
    const payload = await response.json();
    const imported = await fetch("${window.location.origin}/api/import-reddit", {
      method: "POST",
      mode: "cors",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ sourceUrl: location.href, payload })
    });
    const result = await imported.json();
    if (!result.ok) throw new Error(result.error || "Import failed");
    alert("Imported " + result.added + " new Reddit items into Stock Hype Tracker.");
  `;
}

function setupBookmarklet() {
  if (!elements.bookmarklet) return;
  const code = `(async()=>{try{${redditJsonUrlScript()}}catch(error){alert("Reddit import failed: "+error.message)}})()`;
  elements.bookmarklet.href = `javascript:${encodeURIComponent(code)}`;
  elements.bookmarklet.title = "Drag to bookmarks, then click it on a Reddit page.";
}

async function loadData() {
  if (state.loading || !state.tickers.length) return;
  state.loading = true;
  document.body.classList.add("is-loading");

  try {
    const params = new URLSearchParams({
      tickers: state.tickers.join(","),
      hours: String(state.hours)
    });
    const response = await fetch(`/api/hype?${params.toString()}`);
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Request failed: ${response.status}`);
    }
    state.data = await response.json();
    render();
  } catch (error) {
    renderError(error);
  } finally {
    state.loading = false;
    document.body.classList.remove("is-loading");
  }
}

function updateImportStatus() {
  if (!elements.importStatus) return;
  const imports = state.data?.imports;
  if (!imports?.total) {
    elements.importStatus.textContent = "No local imports";
    return;
  }
  elements.importStatus.textContent = `${imports.inWindow} in window / ${imports.total} imported`;
}

async function importPastedRedditJson() {
  if (!elements.importText) return;
  const raw = elements.importText.value.trim();
  if (!raw) {
    elements.importStatus.textContent = "Paste Reddit JSON first";
    return;
  }

  try {
    const payload = JSON.parse(raw);
    const response = await fetch("/api/import-reddit", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ sourceUrl: "manual paste", payload })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Import failed");
    elements.importText.value = "";
    elements.importStatus.textContent = `${result.added} new / ${result.updated} updated`;
    await loadData();
  } catch (error) {
    elements.importStatus.textContent = `Import failed: ${error.message}`;
  }
}

async function clearImportedRedditJson() {
  await fetch("/api/imports", { method: "DELETE" });
  if (elements.importText) elements.importText.value = "";
  if (elements.importStatus) elements.importStatus.textContent = "No local imports";
  await loadData();
}

function renderError(error) {
  elements.grid.innerHTML = `
    <div class="empty-state error-state">
      <h2>Could not load hype data</h2>
      <p>${escapeHtml(error.message)}</p>
    </div>
  `;
}

function render() {
  if (!state.data?.tickers?.length) {
    elements.grid.innerHTML = document.querySelector("#emptyTemplate")?.innerHTML || "";
    return;
  }

  if (elements.singleTitle && state.data.tickers[0]) {
    elements.singleTitle.textContent = `$${state.data.tickers[0].symbol}`;
    document.title = `$${state.data.tickers[0].symbol} - Stock Hype Tracker`;
  }

  if (elements.lastUpdated) {
    elements.lastUpdated.textContent = `Updated ${relativeTime(state.data.generatedAt)}`;
  }

  renderComparison(state.data.tickers);
  elements.grid.innerHTML = state.data.tickers.map(renderTickerCard).join("");
  updateImportStatus();
}

function sourceStatus(ticker, source) {
  const count = ticker.sourceCounts?.[source] || 0;
  const hasError = (ticker.errors || []).some((error) => error.toLowerCase().includes(source));
  if (count > 0) return { label: "live", className: "good" };
  if (hasError) return { label: "blocked", className: "bad" };
  return { label: "quiet", className: "muted" };
}

function renderComparison(tickers) {
  if (!elements.compareBody) return;
  elements.compareBody.innerHTML = tickers.map((ticker) => {
    return `
      <tr>
        <td><button class="symbol-link" data-action="focus" data-symbol="${ticker.symbol}">$${ticker.symbol}</button></td>
        <td><strong>${ticker.hypeScore}</strong></td>
        <td><span class="pill ${trendClass(ticker.trend)}">${ticker.trend}</span></td>
        <td>${ticker.counts.total}</td>
        <td>${ticker.counts.current1h}/${ticker.counts.previous1h}</td>
        <td>${signedPercent(ticker.growth.velocityPct)}</td>
        <td>${ticker.breadth.uniqueAuthors}</td>
        <td>${Math.round(ticker.sentiment.bullishShare * 100)}%</td>
        <td>${ticker.counts.redditPosts}/${ticker.counts.redditComments}</td>
      </tr>
    `;
  }).join("");
}

function renderTickerCard(ticker) {
  const tickerWindowUrl = tickerUrl(ticker.symbol);
  const redditStatus = sourceStatus(ticker, "reddit");
  const maxBucket = Math.max(...ticker.timeline.map((bucket) => bucket.total), 1);
  const timeline = ticker.timeline
    .map((bucket) => {
      const height = Math.max(4, Math.round((bucket.total / maxBucket) * 100));
      return `
        <div class="bar" title="${bucket.total} mentions at ${bucket.label}">
          <span class="bar-reddit" style="height:${height}%"></span>
        </div>
      `;
    })
    .join("");

  const communities = ticker.breadth.topCommunities
    .map((item) => `<span>${escapeHtml(item.name)} <strong>${item.count}</strong></span>`)
    .join("");

  const recent = ticker.recent.length
    ? ticker.recent.map(renderMention).join("")
    : '<li class="mention muted-row">No recent matching mentions in this window.</li>';

  const errors = ticker.errors?.length
    ? `<div class="notice">${ticker.errors.slice(0, 3).map(escapeHtml).join("<br>")}</div>`
    : "";

  return `
    <article class="ticker-card" id="ticker-${ticker.symbol}">
      <header class="card-head">
        <div>
          <p class="eyebrow">${ticker.sourceCounts.reddit} reddit mentions</p>
          <h2>$${ticker.symbol}</h2>
        </div>
        <div class="score-ring" style="--score:${ticker.hypeScore}">
          <strong>${ticker.hypeScore}</strong>
          <span>score</span>
        </div>
      </header>

      <div class="panel-actions">
        <span class="pill ${trendClass(ticker.trend)}">${ticker.trend}</span>
        <a class="ghost-button" href="${tickerWindowUrl}" target="_blank" rel="noreferrer" title="Open ticker window" aria-label="Open ticker window">
          ${icon("open")}
          <span>Window</span>
        </a>
        ${state.view === "dashboard" ? `
          <button class="ghost-button icon-only" data-action="remove" data-symbol="${ticker.symbol}" title="Remove ticker" aria-label="Remove ticker">
            ${icon("close")}
          </button>
        ` : ""}
      </div>

      <div class="metric-grid">
        ${metric("Mentions", ticker.counts.total)}
        ${metric("1h now/prev", `${ticker.counts.current1h}/${ticker.counts.previous1h}`)}
        ${metric("Velocity", signedPercent(ticker.growth.velocityPct))}
        ${metric("6h", signedPercent(ticker.growth.sixHourPct))}
        ${metric("Authors", ticker.breadth.uniqueAuthors)}
        ${metric("Engagement", compactNumber(ticker.engagement.total))}
      </div>

      <div class="source-status">
        <span>Reddit <strong class="${redditStatus.className}">${redditStatus.label}</strong></span>
      </div>

      <div class="timeline" style="--buckets:${ticker.timeline.length}" aria-label="${ticker.symbol} mention timeline">${timeline}</div>

      <div class="split-block">
        <div>
          <h3>Sentiment</h3>
          <div class="sentiment-bar" style="--bull:${ticker.sentiment.bullishShare * 100}">
            <span></span>
          </div>
          <p>${ticker.sentiment.bullish} bullish / ${ticker.sentiment.bearish} bearish / ${ticker.sentiment.neutral} neutral</p>
        </div>
        <div>
          <h3>Breadth</h3>
          <div class="tag-cloud">${communities || "<span>No communities yet</span>"}</div>
        </div>
      </div>

      ${errors}

      <ol class="mention-list">${recent}</ol>
    </article>
  `;
}

function metric(label, value) {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderMention(item) {
  const text = escapeHtml(item.text || item.title || "").slice(0, 240);
  const label = item.community || "Reddit";
  const sentiment = item.sentiment || "neutral";
  return `
    <li class="mention">
      <div>
        <span class="mention-source">${escapeHtml(label)} - ${escapeHtml(item.author)} - ${relativeTime(item.createdAt)}</span>
        <p>${text || escapeHtml(item.title)}</p>
      </div>
      <div class="mention-side">
        <span class="pill ${sentiment === "bullish" ? "good" : sentiment === "bearish" ? "bad" : "muted"}">${sentiment}</span>
        ${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" title="Open source">${icon("link")}</a>` : ""}
      </div>
    </li>
  `;
}

function tickerUrl(symbol) {
  return `/ticker.html?ticker=${encodeURIComponent(symbol)}&hours=${encodeURIComponent(state.hours)}`;
}

function openTickerWindow(symbol) {
  window.open(tickerUrl(symbol), `hype-${symbol}`, "width=760,height=920,noreferrer");
}

function scheduleRefresh() {
  if (state.timer) window.clearInterval(state.timer);
  if (elements.auto?.checked) {
    state.timer = window.setInterval(loadData, 60_000);
  }
}

elements.form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const tickers = normalizeTickers(elements.input.value);
  if (!tickers.length) return;
  if (state.view === "single") {
    state.tickers = [tickers[0]];
  } else {
    state.tickers = normalizeTickers([...state.tickers, ...tickers].join(","));
  }
  elements.input.value = state.view === "single" ? state.tickers[0] : state.tickers.join(", ");
  syncUrl();
  loadData();
});

elements.hours?.addEventListener("change", () => {
  state.hours = Number(elements.hours.value || 24);
  syncUrl();
  loadData();
});

elements.auto?.addEventListener("change", scheduleRefresh);
elements.refresh?.addEventListener("click", loadData);
elements.popAll?.addEventListener("click", () => state.tickers.forEach(openTickerWindow));
elements.importButton?.addEventListener("click", importPastedRedditJson);
elements.clearImports?.addEventListener("click", clearImportedRedditJson);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const symbol = button.dataset.symbol;
  if (button.dataset.action === "remove") {
    state.tickers = state.tickers.filter((ticker) => ticker !== symbol);
    elements.input.value = state.tickers.join(", ");
    syncUrl();
    loadData();
  }
  if (button.dataset.action === "focus") {
    document.querySelector(`#ticker-${symbol}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

async function loadConfig(paramsState) {
  if (paramsState.hasTickerParam && paramsState.hasHoursParam) return;
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const config = await response.json();
    if (!paramsState.hasTickerParam && Array.isArray(config.defaultTickers) && config.defaultTickers.length) {
      state.tickers = state.view === "single" ? [config.defaultTickers[0]] : config.defaultTickers;
      elements.input.value = state.view === "single" ? state.tickers[0] : state.tickers.join(", ");
    }
    if (!paramsState.hasHoursParam && Number.isFinite(Number(config.defaultHours))) {
      state.hours = Number(config.defaultHours);
      elements.hours.value = String(state.hours);
    }
  } catch {
    // The baked-in defaults are enough for offline UI startup.
  }
}

const paramsState = readParams();
await loadConfig(paramsState);
setupBookmarklet();
syncUrl();
scheduleRefresh();
loadData();
