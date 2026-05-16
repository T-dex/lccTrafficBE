import type { CanyonEstimate } from "./types";
import type { Forecast3hPayload } from "./forecastTypes";
import { THRESHOLD_MINUTES } from "./constants";
import { resolveForGeocode } from "./geocode";

function clampThreshold(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return THRESHOLD_MINUTES;
  return Math.min(240, Math.max(30, Math.round(x)));
}

/** FastAPI/Pydantic returns `detail` as a string or a list of validation-error objects */
function formatApiError(data: unknown, fallback: string): string {
  if (typeof data !== "object" || data === null || !("detail" in data)) return fallback;
  const detail = (data as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return String(detail);
  const parts = detail.map((item) => {
    if (typeof item !== "object" || item === null) return String(item);
    const o = item as { loc?: unknown; msg?: unknown };
    const loc = Array.isArray(o.loc) ? o.loc.join(".") : "";
    const msg = typeof o.msg === "string" ? o.msg : JSON.stringify(item);
    return loc ? `${loc}: ${msg}` : msg;
  });
  return parts.join("; ") || fallback;
}

export async function fetchEstimate(body: {
  address: string;
  threshold_minutes?: number;
  include_cameras?: boolean;
  include_forecast?: boolean;
}): Promise<CanyonEstimate> {
  const addr = String(body.address ?? "").trim();
  const payload = {
    address: resolveForGeocode(addr),
    threshold_minutes: clampThreshold(body.threshold_minutes ?? THRESHOLD_MINUTES),
    include_cameras: Boolean(body.include_cameras),
    include_forecast: body.include_forecast !== false,
  };

  const res = await fetch("/api/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatApiError(data, res.statusText));
  }
  if (typeof data === "object" && data !== null && "segments" in data) {
    return data as CanyonEstimate;
  }
  throw new Error("Unexpected API response shape");
}

function clampForecastHours(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 1;
  return Math.min(4, Math.max(0, Math.round(x)));
}

/** Lightweight lookahead: UDOT sign + alerts + optional camera congestion + NWS now/future hour. */
export async function fetchForecastPreview(body: {
  hours_ahead: number;
  udot_top_min?: number | null;
  sign_alerts: string[];
  avg_camera_congestion?: number | null;
}): Promise<Forecast3hPayload> {
  const payload = {
    hours_ahead: clampForecastHours(body.hours_ahead),
    udot_top_min: body.udot_top_min ?? null,
    sign_alerts: body.sign_alerts,
    avg_camera_congestion: body.avg_camera_congestion ?? null,
  };
  const res = await fetch("/api/forecast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(formatApiError(data, res.statusText));
  }
  if (typeof data === "object" && data !== null && ("label" in data || "status" in data)) {
    return data as Forecast3hPayload;
  }
  throw new Error("Unexpected forecast API response");
}
