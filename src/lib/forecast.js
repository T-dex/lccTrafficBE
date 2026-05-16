import { CONFIG } from "./config.js";

const NWS_POINTS = process.env.NWS_POINTS_URL_TEMPLATE || "https://api.weather.gov/points/{lat},{lon}";
const USER_AGENT = process.env.USER_AGENT || "AltaDriveEstimator/1.0 (cottonwood forecast)";

function parseWindMph(wind) {
  if (!wind) return 0;
  const m = String(wind).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

export function scoreWeather(short, pop, windMph, tempF) {
  const text = (short || "").toLowerCase();
  const factors = [];
  let score = 0;
  const severe = [
    "blizzard",
    "ice storm",
    "freezing rain",
    "heavy snow",
    "snow storm",
    "thunderstorm",
    "blowing snow",
  ];
  const moderate = ["snow", "wintry", "sleet", "freezing", "fog", "rain showers", "rain"];
  let hitSevere = false;
  for (const term of severe) {
    if (text.includes(term)) {
      score = Math.max(score, 0.92);
      factors.push(`Forecast: ${short}`);
      hitSevere = true;
      break;
    }
  }
  if (!hitSevere) {
    for (const term of moderate) {
      if (text.includes(term)) {
        score = Math.max(score, 0.62);
        factors.push(`Forecast: ${short}`);
        break;
      }
    }
  }
  if (pop != null) {
    if (pop >= 80) {
      score = Math.max(score, 0.75);
      factors.push(`Precipitation chance ${pop}%`);
    } else if (pop >= 50) {
      score = Math.max(score, 0.5);
      factors.push(`Precipitation chance ${pop}%`);
    }
  }
  if (windMph >= 35) {
    score = Math.max(score, 0.7);
    factors.push(`Wind ${windMph} mph`);
  } else if (windMph >= 25) {
    score = Math.max(score, 0.45);
    factors.push(`Wind ${windMph} mph`);
  }
  if (tempF != null && tempF <= 28 && (text.includes("snow") || (pop || 0) >= 40)) {
    score = Math.max(score, 0.55);
    factors.push(`Cold (${tempF}°F) with wintry precip`);
  }
  if (factors.length === 0) factors.push(`Weather OK — ${short}`);
  return [Math.min(1, score), factors];
}

/** Denver wall-clock weekday (Mon=0) and hour 0-23 for a Date */
export function denverWeekdayHour(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const wdPart = parts.find((p) => p.type === "weekday")?.value;
  const hPart = parts.find((p) => p.type === "hour")?.value;
  const pyWd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const wd = pyWd[wdPart] ?? 0;
  const h = parseInt(hPart ?? "0", 10);
  return { wd, h };
}

export function skiTrafficTimePressure(date) {
  const factors = [];
  const { wd, h } = denverWeekdayHour(date);
  let score = 0.12;
  if (wd === 5 || wd === 6) {
    if (h >= 6 && h < 10) {
      score = 0.72;
      factors.push("Weekend morning ski traffic");
    } else if (h >= 15 && h < 19) {
      score = 0.78;
      factors.push("Weekend afternoon departure rush");
    } else if (h >= 10 && h < 15) {
      score = 0.45;
      factors.push("Weekend midday canyon travel");
    }
  } else if (wd === 4) {
    if (h >= 15 && h < 20) {
      score = 0.65;
      factors.push("Friday evening canyon traffic");
    }
  } else {
    if (h >= 7 && h < 9) {
      score = 0.55;
      factors.push("Weekday morning commute window");
    } else if (h >= 16 && h < 19) {
      score = 0.6;
      factors.push("Weekday afternoon commute window");
    }
  }
  return [Math.min(1, score), factors];
}

export function scoreCurrentTraffic({
  udotTopMin,
  clearTopMin,
  avgCameraCongestion,
  signAlerts,
}) {
  const factors = [];
  let score = 0.15;
  if (udotTopMin != null) {
    const ratio = udotTopMin / Math.max(clearTopMin, 1);
    const signScore = Math.min(1, Math.max(0, (ratio - 1) * 0.85));
    score = Math.max(score, signScore);
    if (ratio >= 1.8) factors.push(`UDOT canyon sign ${udotTopMin} min (well above typical)`);
    else if (ratio >= 1.25) factors.push(`UDOT canyon sign ${udotTopMin} min (elevated)`);
  }
  if (avgCameraCongestion != null) {
    score = Math.max(score, avgCameraCongestion);
    if (avgCameraCongestion >= 0.55) factors.push("Cameras show heavy congestion now");
    else if (avgCameraCongestion >= 0.35) factors.push("Cameras show moderate congestion now");
  }
  const closureWords = ["closure", "closed", "avalanche", "stop", "hold"];
  for (const alert of signAlerts) {
    const low = alert.toLowerCase();
    if (closureWords.some((w) => low.includes(w))) {
      score = Math.max(score, 0.95);
      factors.push(alert);
    }
  }
  if (factors.length === 0) factors.push("Current traffic near typical");
  return [Math.min(1, score), factors];
}

function combineForecast(
  trafficNow,
  trafficTime,
  weatherRisk,
  trafficFactors,
  timeFactors,
  weatherFactors,
  target
) {
  const traffic3h = Math.min(1, trafficNow * 0.55 + trafficTime * 0.45);
  const combined = Math.min(1, traffic3h * 0.62 + weatherRisk * 0.38);
  let status, label;
  if (combined >= 0.78 || (trafficNow >= 0.9 && weatherRisk >= 0.5)) {
    status = "stopped";
    label = "Stopped";
  } else if (combined >= 0.42 || traffic3h >= 0.5 || weatherRisk >= 0.55) {
    status = "slower";
    label = "Slower";
  } else {
    status = "normal";
    label = "Normal";
  }
  let confidence = "medium";
  if (weatherRisk >= 0.7 || trafficNow >= 0.7) confidence = "high";
  else if (weatherRisk < 0.2 && trafficNow < 0.3) confidence = "medium-low";
  const disp = target.toLocaleTimeString("en-US", {
    timeZone: "America/Denver",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const allFactors = [...trafficFactors, ...timeFactors, ...weatherFactors].slice(0, 6);
  return {
    status,
    label,
    traffic_score: Math.round(traffic3h * 100) / 100,
    weather_score: Math.round(weatherRisk * 100) / 100,
    confidence,
    target_display: disp,
    factors: allFactors,
  };
}

function weatherFromPeriod(p) {
  const pop = p.probabilityOfPrecipitation?.value ?? null;
  const temp = p.temperature ?? null;
  const wind = parseWindMph(p.windSpeed);
  const short = p.shortForecast || "";
  const [risk, factors] = scoreWeather(short, pop, wind, temp);
  return {
    short_forecast: short,
    wind_mph: wind,
    pop_percent: pop,
    temperature_f: temp,
    risk_score: risk,
    factors,
  };
}

function pickClosestPeriod(periods, whenMs) {
  let best = periods[0];
  let bestDelta = Infinity;
  for (const p of periods) {
    const start = new Date(p.startTime).getTime();
    const delta = Math.abs(start - whenMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = p;
    }
  }
  return best;
}

/**
 * NWS hourly: conditions near Alta now vs the hour closest to (now + hoursAhead).
 * Scoring uses the target hour; factors summarize both when they differ.
 */
export async function fetchWeatherPlusHours(lat, lon, hoursAhead, signal) {
  const u1 = NWS_POINTS.replace("{lat}", String(lat)).replace("{lon}", String(lon));
  const r1 = await fetch(u1, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/geo+json",
    },
    signal,
  });
  if (!r1.ok) throw new Error(`NWS points ${r1.status}`);
  const j1 = await r1.json();
  const hourlyUrl = j1.properties.forecastHourly;
  const r2 = await fetch(hourlyUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/geo+json",
    },
    signal,
  });
  if (!r2.ok) throw new Error(`NWS hourly ${r2.status}`);
  const j2 = await r2.json();
  const periods = j2.properties.periods;
  const nowMs = Date.now();
  const targetMs = nowMs + hoursAhead * 3600 * 1000;
  const nowPeriod = pickClosestPeriod(periods, nowMs);
  const targetPeriod = pickClosestPeriod(periods, targetMs);
  const nowW = weatherFromPeriod(nowPeriod);
  const targetW = weatherFromPeriod(targetPeriod);

  const weatherFactors = [...targetW.factors];
  if (nowW.short_forecast !== targetW.short_forecast) {
    weatherFactors.unshift(`Now near Alta: ${nowW.short_forecast}`);
    weatherFactors.push(`~${hoursAhead}h out: ${targetW.short_forecast}`);
  }

  return {
    now: {
      short_forecast: nowW.short_forecast,
      wind_mph: nowW.wind_mph,
      pop_percent: nowW.pop_percent,
      temperature_f: nowW.temperature_f,
    },
    target: {
      short_forecast: targetW.short_forecast,
      wind_mph: targetW.wind_mph,
      pop_percent: targetW.pop_percent,
      temperature_f: targetW.temperature_f,
    },
    risk_score: targetW.risk_score,
    factors: weatherFactors.length ? weatherFactors : targetW.factors,
  };
}

export async function predictCanyon3h(
  canyon,
  { udotTopMin, signAlerts, avgCameraCongestion, hoursAhead = 3, signal }
) {
  const cfg = CONFIG[canyon];
  const dest = cfg.destination;
  const clear = cfg.clear_canyon_top_minutes;
  const target = new Date(Date.now() + hoursAhead * 3600 * 1000);
  const weather = await fetchWeatherPlusHours(dest.lat, dest.lon, hoursAhead, signal);
  const [trafficNow, tf] = scoreCurrentTraffic({
    udotTopMin,
    clearTopMin: clear,
    avgCameraCongestion,
    signAlerts,
  });
  const [trafficTime, ttf] = skiTrafficTimePressure(target);
  const fc = combineForecast(
    trafficNow,
    trafficTime,
    weather.risk_score,
    tf,
    ttf,
    weather.factors,
    target
  );
  return {
    status: fc.status,
    label: fc.label,
    hours_ahead: hoursAhead,
    target_time_local: target.toISOString(),
    target_display: fc.target_display,
    confidence: fc.confidence,
    traffic_score: fc.traffic_score,
    weather_score: fc.weather_score,
    weather: {
      short_forecast: weather.target.short_forecast,
      wind_mph: weather.target.wind_mph,
      pop_percent: weather.target.pop_percent,
      temperature_f: weather.target.temperature_f,
      now: weather.now,
    },
    factors: fc.factors,
  };
}

export function avgCameraCongestion(camBreakdown) {
  if (!camBreakdown?.length) return null;
  const vals = camBreakdown.map((c) => c.congestion);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
