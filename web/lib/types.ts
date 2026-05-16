import type { Forecast3hPayload } from "./forecastTypes";

export type CanyonKey = "lcc";

export interface CameraBreakdownItem {
  label?: string;
  detail?: string;
  congestion?: number;
  image_url?: string;
}

export interface SegmentBreakdown {
  home_to_canyon_mouth_min?: number;
  mouth_to_dest_freeflow_min?: number;
  home_to_dest_freeflow_min?: number;
  udot_top_min?: number | null;
  camera_adjustment_min?: number;
  sign_adjustment_min?: number;
  mouth_to_alta_freeflow_min?: number;
  home_to_alta_freeflow_min?: number;
  udot_lcc_top_min?: number | null;
}

export interface HomeInfo {
  label: string;
  lat?: number;
  lon?: number;
}

export interface CanyonEstimate {
  canyon?: CanyonKey;
  canyon_label?: string;
  destination_label?: string;
  threshold_minutes?: number;
  estimate_minutes?: number;
  minutes_to_top?: number;
  over_threshold?: boolean;
  margin_minutes?: number;
  verdict?: string;
  summary?: string;
  confidence?: string;
  method_note?: string;
  home?: HomeInfo;
  segments: SegmentBreakdown;
  signs?: Record<string, unknown>;
  cameras?: CameraBreakdownItem[];
  forecast_3h?: Forecast3hPayload | null;
}
