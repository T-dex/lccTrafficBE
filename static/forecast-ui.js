/** Render 3-hour Normal / Slower / Stopped outlook chips. */

export function renderForecastChip(el, title, forecast) {
  if (!el || !forecast) return;
  const status = forecast.status || "slower";
  el.className = `forecast-chip forecast-chip--${status}`;
  el.innerHTML = `
    <span class="forecast-chip__canyon">${title}</span>
    <span class="forecast-chip__status">${forecast.label}</span>
    <span class="forecast-chip__when">~${forecast.target_display || "3h"}</span>
    <span class="forecast-chip__detail">${forecast.weather?.short_forecast || ""}</span>
  `;
  el.title = (forecast.factors || []).join(" · ");
}

export function renderForecastPanel(container, items) {
  if (!container) return;
  container.classList.remove("hidden");
  container.innerHTML = `
    <h2 class="forecast-heading">+3 hour outlook</h2>
    <p class="forecast-sub">Normal / Slower / Stopped — traffic patterns, live signs, and NWS weather</p>
    <div class="forecast-grid"></div>
  `;
  const grid = container.querySelector(".forecast-grid");
  if (items.length === 1) grid.classList.add("forecast-grid--single");
  for (const { id, title, forecast } of items) {
    const chip = document.createElement("div");
    chip.id = id;
    renderForecastChip(chip, title, forecast);
    grid.appendChild(chip);
  }
}

export function renderForecastInline(el, forecast) {
  if (!el || !forecast) {
    if (el) el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  const status = forecast.status || "slower";
  el.className = `forecast-inline forecast-inline--${status}`;
  el.innerHTML = `
    <span class="forecast-inline__label">+3h outlook</span>
    <span class="forecast-inline__status">${forecast.label}</span>
    <span class="forecast-inline__meta">${forecast.weather?.short_forecast || ""} · ${forecast.confidence} confidence</span>
  `;
}
