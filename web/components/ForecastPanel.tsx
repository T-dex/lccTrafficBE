"use client";

import type { Forecast3hPayload } from "@/lib/forecastTypes";

function ForecastChip({
  id,
  title,
  forecast,
}: {
  id: string;
  title: string;
  forecast: Forecast3hPayload | null | undefined;
}) {
  if (!forecast) return null;
  const status = forecast.status || "slower";
  const factors = forecast.factors || [];
  return (
    <div
      id={id}
      className={`forecast-chip forecast-chip--${status}`}
      title={factors.join(" · ")}
    >
      <span className="forecast-chip__canyon">{title}</span>
      <span className="forecast-chip__status">{forecast.label}</span>
      <span className="forecast-chip__when">~{forecast.target_display || "3h"}</span>
      <span className="forecast-chip__detail">{forecast.weather?.short_forecast ?? ""}</span>
    </div>
  );
}

export function ForecastPanel({
  items,
}: {
  items: { id: string; title: string; forecast: Forecast3hPayload | null | undefined }[];
}) {
  const hasAny = items.some((i) => i.forecast);
  if (!hasAny) return null;
  return (
    <section className="forecast-panel" aria-label="Three hour outlook">
      <h2 className="forecast-heading">+3 hour outlook</h2>
      <p className="forecast-sub">
        Normal / Slower / Stopped — traffic patterns, live signs, and NWS weather
      </p>
      <div className={`forecast-grid ${items.length === 1 ? "forecast-grid--single" : ""}`}>
        {items.map(({ id, title, forecast }) => (
          <ForecastChip key={id} id={id} title={title} forecast={forecast} />
        ))}
      </div>
    </section>
  );
}
