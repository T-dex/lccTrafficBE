"use client";

import { useEffect, useState } from "react";
import { fetchForecastPreview } from "@/lib/api";
import type { CanyonEstimate } from "@/lib/types";
import type { Forecast3hPayload } from "@/lib/forecastTypes";

let outlookFetchSeq = 0;

function signAlertsFromEstimate(d: CanyonEstimate): string[] {
  const a = d.signs?.alerts;
  return Array.isArray(a) ? a.map((x) => String(x)) : [];
}

function avgCongestion(d: CanyonEstimate): number | null {
  const cams = d.cameras;
  if (!cams?.length) return null;
  const vals = cams.map((c) => Number(c.congestion)).filter((n) => Number.isFinite(n));
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function weatherBits(w: { wind_mph?: number; temperature_f?: number | null; pop_percent?: number | null }) {
  const parts: string[] = [];
  if (w.temperature_f != null) parts.push(`${w.temperature_f}°F`);
  if (w.wind_mph != null && w.wind_mph > 0) parts.push(`${w.wind_mph} mph wind`);
  if (w.pop_percent != null && w.pop_percent > 0) parts.push(`${w.pop_percent}% precip`);
  return parts.length ? ` (${parts.join(" · ")})` : "";
}

export function PredictiveTrafficOutlook({ estimate }: { estimate: CanyonEstimate | undefined }) {
  const [hoursAhead, setHoursAhead] = useState(1);
  const [forecast, setForecast] = useState<Forecast3hPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!estimate) {
      setForecast(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const seq = ++outlookFetchSeq;
    setLoading(true);
    setError(null);

    void fetchForecastPreview({
      hours_ahead: hoursAhead,
      udot_top_min: estimate.segments?.udot_top_min ?? null,
      sign_alerts: signAlertsFromEstimate(estimate),
      avg_camera_congestion: avgCongestion(estimate),
    })
      .then((data) => {
        if (cancelled || seq !== outlookFetchSeq) return;
        setForecast(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled || seq !== outlookFetchSeq) return;
        setError(e instanceof Error ? e.message : String(e));
        setForecast(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [estimate, hoursAhead]);

  if (!estimate) return null;

  const status = forecast?.status || "slower";
  const nowWx = forecast?.weather?.now;
  const thenWx = forecast?.weather;

  return (
    <section className="predictive-panel" aria-labelledby="predictive-heading">
      <h2 id="predictive-heading" className="forecast-heading">
        Predictive traffic alert
      </h2>
      <p className="forecast-sub">
        Blends live UDOT sign and camera hints with NWS hourly weather (now vs. your target time) and typical
        canyon traffic patterns.
      </p>

      <div className="predictive-slider-row">
        <label htmlFor="hours-ahead" className="predictive-slider-label">
          Lookahead: <strong>{hoursAhead === 0 ? "Now" : `${hoursAhead} h`}</strong> (0–4 h)
        </label>
        <input
          id="hours-ahead"
          className="predictive-slider"
          type="range"
          min={0}
          max={4}
          step={1}
          value={hoursAhead}
          onChange={(e) => setHoursAhead(Number(e.target.value))}
        />
        <div className="predictive-slider-ticks predictive-slider-ticks--5" aria-hidden>
          <span>Now</span>
          <span>1h</span>
          <span>2h</span>
          <span>3h</span>
          <span>4h</span>
        </div>
      </div>

      {error ? (
        <p className="predictive-error" role="alert">
          {error}
        </p>
      ) : null}

      {!error && (loading || forecast) ? (
        <div
          className={`predictive-alert predictive-alert--${loading ? "loading" : status}`}
          aria-busy={loading}
        >
          {loading ? (
            <p className="predictive-alert__loading">Updating outlook…</p>
          ) : forecast ? (
            <>
              <div className="predictive-alert__head">
                <span className="predictive-alert__label">~{forecast.target_display}</span>
                <span className="predictive-alert__verdict">{forecast.label}</span>
              </div>
              <p className="predictive-alert__confidence">Confidence: {forecast.confidence}</p>

              <div className="predictive-weather-grid">
                <div className="predictive-weather-card">
                  <span className="predictive-weather-card__title">Weather now (area)</span>
                  <p className="predictive-weather-card__body">
                    {nowWx?.short_forecast ?? "—"}
                    {nowWx ? weatherBits(nowWx) : ""}
                  </p>
                </div>
                <div className="predictive-weather-card">
                  <span className="predictive-weather-card__title">
                    {hoursAhead === 0 ? "At target time (now)" : `Weather in ${hoursAhead} h`}
                  </span>
                  <p className="predictive-weather-card__body">
                    {thenWx?.short_forecast ?? "—"}
                    {thenWx ? weatherBits(thenWx) : ""}
                  </p>
                </div>
              </div>

              {(forecast.traffic_score != null || forecast.weather_score != null) && (
                <p className="predictive-scores">
                  Traffic pressure ≈ {forecast.traffic_score ?? "—"} · Weather risk ≈{" "}
                  {forecast.weather_score ?? "—"}
                </p>
              )}

              {forecast.factors?.length ? (
                <ul className="predictive-factors">
                  {forecast.factors.map((f, i) => (
                    <li key={`${i}-${f.slice(0, 24)}`}>{f}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
