"use client";

import type { CameraBreakdownItem } from "@/lib/types";

export function CameraGrid({ cameras }: { cameras: CameraBreakdownItem[] | undefined }) {
  if (!cameras?.length) return null;
  const t = Date.now();
  return (
    <section className="panel cameras-panel">
      <h2>Camera scan</h2>
      <div className="camera-grid">
        {cameras.map((cam, i) => {
          const pct = Math.round((cam.congestion ?? 0) * 100);
          const src = cam.image_url ? `${cam.image_url}?t=${t}` : "";
          return (
            <article key={i} className="cam-card">
              {src ? <img src={src} alt="" loading="lazy" /> : null}
              <div className="meta">
                <div className="label">{cam.label}</div>
                <div className="detail">
                  {cam.detail} ({pct}%)
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
