import {
  AUTO_REFRESH_MS,
  DEBOUNCE_MS,
  DEFAULT_ADDRESS,
  fetchEstimate,
  getAddress,
  saveAddress,
  shortPlace,
} from "./common.js";
import { renderForecastPanel } from "./forecast-ui.js";

const addressEl = document.getElementById("address");
const refreshBtn = document.getElementById("refresh-btn");
const statusEl = document.getElementById("status");
const lccSign = document.getElementById("lcc-sign");
const forecastPanel = document.getElementById("forecast-panel");

let debounceTimer = null;
let autoRefreshTimer = null;
let requestId = 0;

function setCanyonSign(el, prefix, lines, state) {
  el.dataset.state = state;
  el.querySelector(`.${prefix}-l1`).textContent = lines[0];
  el.querySelector(`.${prefix}-l2`).textContent = lines[1];
  el.querySelector(`.${prefix}-l3`).textContent = lines[2];
}

function setLoading() {
  setCanyonSign(lccSign, "lcc", ["LITTLE COTTONWOOD", "···", "UPDATING"], "loading");
}

function updateCanyonSign(el, prefix, name, data) {
  const mins = Math.round(data.minutes_to_top);
  const udot = data.segments.udot_top_min;
  const sub = udot != null ? `CANYON TOP · UDOT ${udot} MIN` : "CANYON TOP";
  setCanyonSign(el, prefix, [name, `${mins} MIN`, sub], "ok");
}

function setError(msg) {
  setCanyonSign(lccSign, "lcc", ["LITTLE COTTONWOOD", "— —", "UNAVAILABLE"], "error");
  statusEl.textContent = msg;
  statusEl.classList.remove("updating");
}

function scheduleAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => runUpdate(false), AUTO_REFRESH_MS);
}

async function runUpdate(showLoading = true) {
  const address = getAddress(addressEl);
  if (!address) return;

  const id = ++requestId;
  refreshBtn.disabled = true;
  if (showLoading) setLoading();
  statusEl.classList.add("updating");
  statusEl.textContent = "Updating…";

  try {
    const data = await fetchEstimate(address, { includeCameras: false });
    if (id !== requestId) return;
    saveAddress(address);
    updateCanyonSign(lccSign, "lcc", "LITTLE COTTONWOOD", data);
    renderForecastPanel(forecastPanel, [
      { id: "lcc-fc", title: "Little Cottonwood", forecast: data.forecast_3h },
    ]);
    statusEl.textContent = `From ${shortPlace(data.home.label)}`;
    statusEl.classList.remove("updating");
    scheduleAutoRefresh();
  } catch (err) {
    if (id !== requestId) return;
    setError(err.message);
  } finally {
    if (id === requestId) refreshBtn.disabled = false;
  }
}

function scheduleUpdate(immediate = false) {
  clearTimeout(debounceTimer);
  if (immediate) {
    runUpdate(true);
    return;
  }
  statusEl.textContent = "Updating soon…";
  statusEl.classList.add("updating");
  debounceTimer = setTimeout(() => runUpdate(true), DEBOUNCE_MS);
}

addressEl.value = localStorage.getItem("alta-drive-home") || DEFAULT_ADDRESS;
addressEl.addEventListener("input", () => scheduleUpdate(false));
addressEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    clearTimeout(debounceTimer);
    runUpdate(true);
  }
});
refreshBtn.addEventListener("click", () => {
  clearTimeout(debounceTimer);
  runUpdate(true);
});

runUpdate(true);
