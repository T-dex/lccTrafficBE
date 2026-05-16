/** Snapshot from NWS hourly (current hour vs. lookahead hour near Alta). */
export interface WeatherSnapshot {
  short_forecast?: string;
  wind_mph?: number;
  pop_percent?: number | null;
  temperature_f?: number | null;
}

/** Shape returned from Express `predictCanyon3h` / `forecast_3h` / `POST /api/forecast` */
export interface Forecast3hPayload {
  status?: string;
  label?: string;
  hours_ahead?: number;
  target_display?: string;
  confidence?: string;
  factors?: string[];
  traffic_score?: number;
  weather_score?: number;
  weather?: WeatherSnapshot & {
    /** Conditions for the hour nearest “now” at the canyon (same NWS grid as target). */
    now?: WeatherSnapshot;
  };
}
