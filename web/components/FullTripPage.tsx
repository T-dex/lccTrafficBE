"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CameraGrid } from "@/components/CameraGrid";
import { ForecastInline } from "@/components/ForecastInline";
import { AUTO_REFRESH_MS, DEBOUNCE_MS, DEFAULT_ADDRESS, STORAGE_KEY, THRESHOLD_MINUTES } from "@/lib/constants";
import { fetchEstimate } from "@/lib/api";
import type { CanyonEstimate } from "@/lib/types";
import { shortPlaceLabel } from "@/lib/shortPlace";
import { fullTripSignState, thresholdStatusLine } from "@/lib/fullTripUtils";

export interface FullTripConfig {
  headLine: string;
  udotSignTitle: string;
  destShort: string;
}

export function FullTripPage({ cfg }: { cfg: FullTripConfig }) {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [threshold, setThreshold] = useState(THRESHOLD_MINUTES);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [data, setData] = useState<CanyonEstimate | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("Updating from UDOT…");
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const clearAutoRefresh = () => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  };

  const runEstimate = useCallback(
    async (showLoading: boolean) => {
      const addr = address.trim();
      if (!addr) return;
      const id = ++requestId.current;
      if (showLoading) {
        setLoading(true);
        setError(null);
      }
      setStatusText("Updating from UDOT…");
      try {
        const canyonData = await fetchEstimate({
          address: addr,
          threshold_minutes: threshold,
          include_cameras: true,
        });
        if (id !== requestId.current) return;
        try {
          localStorage.setItem(STORAGE_KEY, addr);
        } catch {
          /* ignore */
        }
        setData(canyonData);
        setLoading(false);
        setError(null);
        const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        setStatusText(`Updated ${t} · confidence ${canyonData.confidence}`);
      } catch (e) {
        if (id !== requestId.current) return;
        setData(null);
        setLoading(false);
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatusText(msg);
      }
    },
    [address, threshold],
  );

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)?.trim();
    setAddress(saved || DEFAULT_ADDRESS);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !address.trim()) return;
    void runEstimate(true);
    return () => clearAutoRefresh();
  }, [hydrated, runEstimate]);

  useEffect(() => {
    if (!autoRefresh || !data || error) {
      clearAutoRefresh();
      return;
    }
    clearAutoRefresh();
    autoRefreshRef.current = setInterval(() => void runEstimate(false), AUTO_REFRESH_MS);
    return () => clearAutoRefresh();
  }, [autoRefresh, data, error, runEstimate]);

  const signState = error ? "error" : loading ? "loading" : data ? fullTripSignState(data) : "idle";

  const line1 = error
    ? cfg.headLine
    : loading
      ? cfg.headLine
      : data
        ? `FROM ${shortPlaceLabel(data.home?.label ?? "")}`
        : cfg.headLine;
  const line2 = error ? "ERROR" : loading ? "···" : data ? `${Math.round(data.estimate_minutes ?? 0)} MIN` : "— —";
  const line3 = error
    ? String(error)
        .slice(0, 40)
        .toUpperCase()
    : loading
      ? "SCANNING CAMERAS"
      : data
        ? thresholdStatusLine(data)
        : "LOADING";

  const udotTop = data?.segments?.udot_top_min;

  return (
    <div className="page">
      <nav className="page-nav page-nav--top">
        <Link href="/">← Canyon top</Link>
      </nav>

      <section className="sign-stage" aria-labelledby="main-sign-label">
        <p id="main-sign-label" className="sr-only">
          Estimated drive time to {cfg.destShort}
        </p>

        <div className="road-sign" data-state={signState}>
          <div className="sign-bezel">
            <div className="sign-face">
              <div className="sign-line">{line1}</div>
              <div className="sign-line sign-line--hero">{line2}</div>
              <div className="sign-line sign-line--sub">{line3}</div>
            </div>
          </div>
          <p className="sign-caption">Full trip · cameras &amp; 90-minute check</p>
        </div>

        {data?.forecast_3h ? <ForecastInline forecast={data.forecast_3h} /> : null}

        {udotTop != null && !error ? (
          <div className="road-sign road-sign--secondary" aria-label="UDOT canyon travel time">
            <div className="sign-bezel sign-bezel--small">
              <div className="sign-face sign-face--small">
                <div className="sign-line sign-line--sm">{cfg.udotSignTitle}</div>
                <div className="sign-line sign-line--sm sign-line--hero">CANYON TOP</div>
                <div className="sign-line sign-line--sm">{udotTop} MIN</div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="controls panel">
        <label htmlFor="address">From (home address)</label>
        <div className="address-row">
          <input
            id="address"
            type="text"
            placeholder={DEFAULT_ADDRESS}
            autoComplete="street-address"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              setStatusText("Address changed — updating soon…");
              debounceRef.current = setTimeout(() => void runEstimate(true), DEBOUNCE_MS);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (debounceRef.current) clearTimeout(debounceRef.current);
                void runEstimate(true);
              }
            }}
          />
          <button type="button" title="Update now" onClick={() => void runEstimate(true)}>
            ↻
          </button>
        </div>
        <p className={`status ${loading ? "updating" : ""}`} role="status">
          {statusText}
        </p>

        <details className="options">
          <summary>Options &amp; details</summary>
          <label htmlFor="threshold">90-minute threshold</label>
          <input
            id="threshold"
            type="number"
            min={30}
            max={240}
            value={threshold}
            onChange={(e) =>
              setThreshold(Math.min(240, Math.max(30, Number(e.target.value) || THRESHOLD_MINUTES)))
            }
            onBlur={() => void runEstimate(true)}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh every 5 minutes
          </label>
          {data ? (
            <div className="breakdown">
              <p className="from-line">
                <strong>From:</strong> {data.home?.label}
              </p>
              <ul>
                <li>To canyon top: ~{data.minutes_to_top} min</li>
                <li>
                  Full trip to {cfg.destShort}: ~{Math.round(data.estimate_minutes ?? 0)} min
                </li>
                <li>Home → canyon mouth: ~{data.segments.home_to_canyon_mouth_min} min</li>
                <li>UDOT canyon-top sign: {data.segments.udot_top_min ?? "—"} min</li>
                <li>Camera adjustment: +{data.segments.camera_adjustment_min} min</li>
                {data.forecast_3h ? (
                  <li>
                    +3h outlook: <strong>{data.forecast_3h.label}</strong> (
                    {data.forecast_3h.target_display}) —{" "}
                    {(data.forecast_3h.factors || []).slice(0, 2).join("; ")}
                  </li>
                ) : null}
              </ul>
              <p>{data.method_note}</p>
            </div>
          ) : null}
        </details>
      </section>

      <CameraGrid cameras={data?.cameras} />

      <footer className="footer">
        <p>
          Estimates only —{" "}
          <a
            href="https://cottonwoodcanyons.udot.utah.gov/road-information/"
            target="_blank"
            rel="noopener noreferrer"
          >
            official UDOT road info
          </a>
        </p>
      </footer>
    </div>
  );
}
