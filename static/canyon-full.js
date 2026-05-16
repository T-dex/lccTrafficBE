import {
  AUTO_REFRESH_MS,
  DEBOUNCE_MS,
  DEFAULT_ADDRESS,
  fetchEstimate,
  getAddress,
  saveAddress,
  shortPlace,
} from "./common.js";
import { renderForecastInline } from "./forecast-ui.js";

/** @param {{ canyon: 'lcc', headLine: string, udotSignTitle: string, destShort: string }} cfg */
export function initFullPage(cfg) {
  const addressEl = document.getElementById("address");
  const thresholdEl = document.getElementById("threshold");
  const refreshBtn = document.getElementById("refresh-btn");
  const statusEl = document.getElementById("status");
  const roadSign = document.getElementById("road-sign");
  const signLine1 = document.getElementById("sign-line-1");
  const signLine2 = document.getElementById("sign-line-2");
  const signLine3 = document.getElementById("sign-line-3");
  const udotSign = document.getElementById("udot-sign");
  const udotLine1 = document.getElementById("udot-line-1");
  const udotLine2 = document.getElementById("udot-line-2");
  const udotLine3 = document.getElementById("udot-line-3");
  const breakdownEl = document.getElementById("breakdown");
  const autoRefreshEl = document.getElementById("auto-refresh");
  const camerasSection = document.getElementById("cameras");
  const cameraGrid = document.getElementById("camera-grid");
  const forecastEl = document.getElementById("forecast-inline");

  let debounceTimer = null;
  let autoRefreshTimer = null;
  let requestId = 0;

  function signState(data) {
    if (data.over_threshold) return "bad";
    if (data.verdict === "borderline") return "warn";
    return "ok";
  }

  function statusLine(data) {
    const limit = data.threshold_minutes;
    if (data.over_threshold) {
      return `OVER ${limit} MIN · +${Math.abs(Math.round(data.margin_minutes))} MIN`;
    }
    if (data.verdict === "borderline") return `CLOSE CALL · ${limit} MIN LIMIT`;
    return `UNDER ${limit} MIN · OK TO GO`;
  }

  function setSignLoading() {
    roadSign.dataset.state = "loading";
    signLine1.textContent = cfg.headLine;
    signLine2.textContent = "···";
    signLine3.textContent = "SCANNING CAMERAS";
  }

  function updateMainSign(data) {
    const mins = Math.round(data.estimate_minutes);
    roadSign.dataset.state = signState(data);
    signLine1.textContent = `FROM ${shortPlace(data.home.label)}`;
    signLine2.textContent = `${mins} MIN`;
    signLine3.textContent = statusLine(data);

    const udot = data.segments.udot_top_min;
    if (udot != null) {
      udotSign.classList.remove("hidden");
      udotLine1.textContent = cfg.udotSignTitle;
      udotLine2.textContent = "CANYON TOP";
      udotLine3.textContent = `${udot} MIN`;
    } else {
      udotSign.classList.add("hidden");
    }
  }

  function renderBreakdown(data) {
    const seg = data.segments;
    breakdownEl.classList.remove("hidden");
    const fc = data.forecast_3h;
    const fcLine = fc
      ? `<li>+3h outlook: <strong>${fc.label}</strong> (${fc.target_display}) — ${(fc.factors || []).slice(0, 2).join("; ")}</li>`
      : "";
    breakdownEl.innerHTML = `
      <p class="from-line"><strong>From:</strong> ${data.home.label}</p>
      <ul>
        <li>To canyon top: ~${data.minutes_to_top} min</li>
        <li>Full trip to ${cfg.destShort}: ~${Math.round(data.estimate_minutes)} min</li>
        <li>Home → canyon mouth: ~${seg.home_to_canyon_mouth_min} min</li>
        <li>UDOT canyon-top sign: ${seg.udot_top_min ?? "—"} min</li>
        <li>Camera adjustment: +${seg.camera_adjustment_min} min</li>
        ${fcLine}
      </ul>
      <p>${data.method_note}</p>
    `;
  }

  function renderCameras(data) {
    cameraGrid.innerHTML = "";
    for (const cam of data.cameras) {
      const pct = Math.round(cam.congestion * 100);
      const card = document.createElement("article");
      card.className = "cam-card";
      card.innerHTML = `
        <img src="${cam.image_url}?t=${Date.now()}" alt="" loading="lazy" />
        <div class="meta">
          <div class="label">${cam.label}</div>
          <div class="detail">${cam.detail} (${pct}%)</div>
        </div>
      `;
      cameraGrid.appendChild(card);
    }
    camerasSection.classList.remove("hidden");
  }

  function scheduleAutoRefresh() {
    clearInterval(autoRefreshTimer);
    if (!autoRefreshEl.checked) return;
    autoRefreshTimer = setInterval(() => runEstimate(false), AUTO_REFRESH_MS);
  }

  async function runEstimate(showLoading = true) {
    const address = getAddress(addressEl);
    if (!address) return;

    const id = ++requestId;
    refreshBtn.disabled = true;
    if (showLoading) setSignLoading();
    statusEl.textContent = "Updating from UDOT…";
    statusEl.classList.add("updating");

    try {
      const data = await fetchEstimate(address, {
        threshold: Number(thresholdEl.value) || 90,
        includeCameras: true,
        canyon: cfg.canyon,
      });
      if (id !== requestId) return;

      saveAddress(address);
      updateMainSign(data);
      renderForecastInline(forecastEl, data.forecast_3h);
      renderBreakdown(data);
      renderCameras(data);
      const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      statusEl.textContent = `Updated ${t} · confidence ${data.confidence}`;
      statusEl.classList.remove("updating");
      scheduleAutoRefresh();
    } catch (err) {
      if (id !== requestId) return;
      roadSign.dataset.state = "error";
      signLine1.textContent = cfg.headLine;
      signLine2.textContent = "ERROR";
      signLine3.textContent = String(err.message).slice(0, 40).toUpperCase();
      statusEl.textContent = err.message;
      statusEl.classList.remove("updating");
    } finally {
      if (id === requestId) refreshBtn.disabled = false;
    }
  }

  function scheduleUpdate(immediate = false) {
    clearTimeout(debounceTimer);
    if (immediate) {
      runEstimate(true);
      return;
    }
    statusEl.textContent = "Address changed — updating soon…";
    statusEl.classList.add("updating");
    debounceTimer = setTimeout(() => runEstimate(true), DEBOUNCE_MS);
  }

  addressEl.value = localStorage.getItem("alta-drive-home") || DEFAULT_ADDRESS;
  addressEl.addEventListener("input", () => scheduleUpdate(false));
  addressEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounceTimer);
      runEstimate(true);
    }
  });
  thresholdEl.addEventListener("change", () => runEstimate(true));
  refreshBtn.addEventListener("click", () => {
    clearTimeout(debounceTimer);
    runEstimate(true);
  });
  autoRefreshEl.addEventListener("change", scheduleAutoRefresh);

  runEstimate(true);
}
