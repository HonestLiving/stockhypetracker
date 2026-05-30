const statusEl = document.querySelector("#status");
const scanNow = document.querySelector("#scanNow");
const toggle = document.querySelector("#toggle");

async function render() {
  const state = await chrome.storage.local.get(["enabled", "lastResult", "lastError", "lastRunAt"]);
  const enabled = state.enabled !== false;
  const result = state.lastResult;
  const lastRun = state.lastRunAt ? new Date(state.lastRunAt).toLocaleTimeString() : "never";

  toggle.textContent = enabled ? "Pause" : "Resume";
  statusEl.innerHTML = `
    <p><strong>${enabled ? "Running" : "Paused"}</strong></p>
    <p>Last scan: ${lastRun}</p>
    <p>Added: ${result?.added ?? 0} / Updated: ${result?.updated ?? 0}</p>
    <p>${state.lastError ? `Error: ${state.lastError}` : "No current errors"}</p>
  `;
}

scanNow.addEventListener("click", async () => {
  statusEl.textContent = "Scanning...";
  const response = await chrome.runtime.sendMessage({ type: "scan-now" });
  if (!response?.ok) {
    statusEl.textContent = response?.error || "Scan failed";
  }
  render();
});

toggle.addEventListener("click", async () => {
  const state = await chrome.storage.local.get(["enabled"]);
  await chrome.runtime.sendMessage({ type: "set-enabled", enabled: state.enabled === false });
  render();
});

render();
