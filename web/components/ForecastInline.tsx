"use client";

import type { Forecast3hPayload } from "@/lib/forecastTypes";

export function ForecastInline({ forecast }: { forecast: Forecast3hPayload | null | undefined }) {
  if (!forecast) return null;
  const status = forecast.status || "slower";
  return (
    <div className={`forecast-inline forecast-inline--${status}`} aria-live="polite">
      <span className="forecast-inline__label">+3h outlook</span>
      <span className="forecast-inline__status">{forecast.label}</span>
      <span className="forecast-inline__meta">
        {forecast.weather?.short_forecast ?? ""} · {forecast.confidence} confidence
      </span>
    </div>
  );
}
