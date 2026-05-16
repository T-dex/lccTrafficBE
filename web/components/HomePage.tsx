"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CanyonDualSign, homeMinutesLines } from "@/components/CanyonDualSign";
import { PredictiveTrafficOutlook } from "@/components/PredictiveTrafficOutlook";
import { AUTO_REFRESH_MS, DEBOUNCE_MS, DEFAULT_ADDRESS, STORAGE_KEY } from "@/lib/constants";
import { fetchEstimate } from "@/lib/api";
import type { CanyonEstimate } from "@/lib/types";
import { shortPlaceLabel } from "@/lib/shortPlace";

function trafficBackgroundClass(data: CanyonEstimate | undefined) {
  const canyonMinutes = data?.segments?.udot_top_min ?? data?.minutes_to_top;
  if (typeof canyonMinutes !== "number") return "traffic-bg--neutral";
  if (canyonMinutes < 40) return "traffic-bg--good";
  if (canyonMinutes < 70) return "traffic-bg--caution";
  return "traffic-bg--bad";
}

export function HomePage() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [lccData, setLccData] = useState<CanyonEstimate | undefined>();
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestId = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearAutoRefresh = () => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  };

  const runUpdate = useCallback(
    async (showLoading: boolean, addressOverride?: string) => {
      const addr = (addressOverride ?? address).trim();
      if (!addr) return;
      const id = ++requestId.current;
      if (showLoading) setLoading(true);
      setError(null);
      try {
        const data = await fetchEstimate({ address: addr, include_cameras: true });
        if (id !== requestId.current) return;
        try {
          localStorage.setItem(STORAGE_KEY, addr);
        } catch {
          /* quota / private mode */
        }
        setLccData(data);
        setStatus(`From ${shortPlaceLabel(data.home?.label ?? "")}`);
        setLoading(false);
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setLccData(undefined);
      }
    },
    [address],
  );

  useEffect(() => {
    if (!lccData || error) {
      clearAutoRefresh();
      return;
    }
    clearAutoRefresh();
    autoRefreshRef.current = setInterval(() => void runUpdate(false), AUTO_REFRESH_MS);
    return () => clearAutoRefresh();
  }, [lccData, error, runUpdate]);

  useEffect(() => {
    let cancelled = false;
    const initial = (() => {
      try {
        const s = localStorage.getItem(STORAGE_KEY)?.trim();
        if (s && s.length >= 3) return s;
      } catch {
        /* Safari private / disabled storage */
      }
      return DEFAULT_ADDRESS;
    })();
    setAddress(initial);

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const data = await fetchEstimate({ address: initial, include_cameras: true });
        if (cancelled || id !== requestId.current) return;
        try {
          localStorage.setItem(STORAGE_KEY, initial);
        } catch {
          /* ignore */
        }
        setLccData(data);
        setStatus(`From ${shortPlaceLabel(data.home?.label ?? "")}`);
        setLoading(false);
      } catch (e) {
        if (cancelled || id !== requestId.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setLccData(undefined);
      }
    })();

    return () => {
      cancelled = true;
      requestId.current += 1;
      clearAutoRefresh();
    };
  }, []);

  const onInputChange = (v: string) => {
    setAddress(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setStatus("Updating soon…");
    debounceRef.current = setTimeout(() => void runUpdate(true, v.trim()), DEBOUNCE_MS);
  };

  const lccLines = homeMinutesLines(lccData, "LITTLE COTTONWOOD");
  const signState = error ? "error" : loading ? "loading" : "ok";

  return (
    <div className={`page-home ${trafficBackgroundClass(lccData)}`}>
      <div className="page page--compact">
        <section className="sign-stage sign-stage--home" aria-labelledby="main-sign-label">
          <p id="main-sign-label" className="sr-only">
            Estimated drive time to Little Cottonwood canyon top
          </p>
          <CanyonDualSign
            prefix="lcc"
            state={signState}
            line1={error ? "LITTLE COTTONWOOD" : loading ? "LITTLE COTTONWOOD" : lccLines[0]}
            line2={error ? "— —" : loading ? "···" : lccLines[1]}
            line3={error ? "UNAVAILABLE" : loading ? "UPDATING" : lccLines[2]}
          />
        </section>

        <section className="controls controls--minimal">
          <label htmlFor="address">From</label>
          <div className="address-row">
            <input
              id="address"
              type="text"
              placeholder={DEFAULT_ADDRESS}
              autoComplete="street-address"
              value={address}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  void runUpdate(true);
                }
              }}
            />
            <button type="button" title="Update now" onClick={() => void runUpdate(true)}>
              ↻
            </button>
          </div>
          <p className={`status ${loading ? "updating" : ""}`} role="status">
            {error ?? status}
          </p>
        </section>

        {lccData ? <PredictiveTrafficOutlook estimate={lccData} /> : null}

        <nav className="page-nav page-nav--split">
          <Link href="/full">Full trip to Alta →</Link>
        </nav>

        <footer className="footer">
          <p>
            UDOT live signs ·{" "}
            <a
              href="https://cottonwoodcanyons.udot.utah.gov/road-information/"
              target="_blank"
              rel="noopener noreferrer"
            >
              road info
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
