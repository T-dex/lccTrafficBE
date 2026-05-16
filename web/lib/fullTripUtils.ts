import type { CanyonEstimate } from "./types";

export type SignVisualState = "ok" | "warn" | "bad" | "loading" | "error" | "idle";

export function fullTripSignState(data: CanyonEstimate): Exclude<SignVisualState, "loading" | "error" | "idle"> {
  if (data.over_threshold) return "bad";
  if (data.verdict === "borderline") return "warn";
  return "ok";
}

export function thresholdStatusLine(data: CanyonEstimate): string {
  const limit = data.threshold_minutes ?? 90;
  if (data.over_threshold) {
    const margin = Math.round(Math.abs(Number(data.margin_minutes) || 0));
    return `OVER ${limit} MIN · +${margin} MIN`;
  }
  if (data.verdict === "borderline") return `CLOSE CALL · ${limit} MIN LIMIT`;
  return `UNDER ${limit} MIN · OK TO GO`;
}
