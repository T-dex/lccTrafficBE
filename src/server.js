import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONFIG } from "./lib/config.js";
import {
  cameraDelayMinutes,
  camerasForLcc,
  fetchCottonwoodSigns,
  scanCameras,
  signDelayMinutes,
} from "./lib/analyzer.js";
import { avgCameraCongestion, predictCanyon3h } from "./lib/forecast.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const STATIC = path.join(ROOT, "static");

const USER_AGENT = process.env.USER_AGENT || "AltaDriveEstimator/1.0";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const OSRM = process.env.OSRM_URL || "http://router.project-osrm.org/route/v1/driving";
const THRESHOLD_MINUTES = 90;
const PORT = process.env.PORT || 8765;

function udotLccTop(signs) {
  return signs.lcc_top_minutes;
}

async function geocode(address, signal) {
  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    countrycodes: "us",
  });
  const r = await fetch(`${NOMINATIM}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
    signal,
  });
  if (!r.ok) throw new Error(`Geocode ${r.status}`);
  const rows = await r.json();
  if (!rows.length) {
    const err = new Error(`Could not geocode address: ${address}`);
    err.status = 400;
    throw err;
  }
  return {
    lat: parseFloat(rows[0].lat),
    lon: parseFloat(rows[0].lon),
    label: rows[0].display_name || address,
  };
}

async function osrmMinutes(lon1, lat1, lon2, lat2, signal) {
  const url = `${OSRM}/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  const r = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal,
  });
  if (!r.ok) throw new Error(`OSRM ${r.status}`);
  const data = await r.json();
  if (data.code !== "Ok" || !data.routes?.length) {
    const err = new Error("Routing service unavailable");
    err.status = 502;
    throw err;
  }
  return data.routes[0].duration / 60;
}

function buildCanyonPayload(
  canyon,
  {
    homeLabel,
    homeLat,
    homeLon,
    homeToMouth,
    mouthToDest,
    homeToDestFreeflow,
    signs,
    camExtra,
    camBreakdown,
    signExtra,
    signReasons,
    thresholdMinutes,
    includeCameras,
  }
) {
  const cfg = CONFIG[canyon];
  const dest = cfg.destination;
  const tail = cfg.tail_top_to_dest_minutes;
  const clearTop = cfg.clear_canyon_top_minutes;
  const udotTopVal = udotLccTop(signs);
  const destName = dest.label;
  const canyonLabel = "LITTLE COTTONWOOD";

  let estimateMin;
  let methodNote;
  if (udotTopVal != null) {
    const canyonDrive = udotTopVal + tail;
    estimateMin = Math.round((homeToMouth + canyonDrive + camExtra + signExtra) * 10) / 10;
    methodNote =
      `Home → ${canyonLabel} mouth (${Math.round(homeToMouth)} min) + ` +
      `UDOT canyon-top sign (${udotTopVal} min) + ${destName} tail (~${tail} min) + adjustments`;
  } else {
    estimateMin = Math.round((homeToDestFreeflow + camExtra + signExtra) * 10) / 10;
    methodNote = `UDOT ${canyonLabel} sign unavailable; free-flow routing + adjustments`;
  }

  const canyonForTop = udotTopVal != null ? udotTopVal : clearTop;
  const minutesToTop = Math.round((homeToMouth + canyonForTop + camExtra * 0.5 + signExtra) * 10) / 10;

  let confidence = "medium";
  if (udotTopVal != null && (!includeCameras || camBreakdown.length >= 4)) confidence = "high";
  else if (udotTopVal == null) confidence = "low";

  const overThreshold = estimateMin > thresholdMinutes;
  const margin = Math.round((estimateMin - thresholdMinutes) * 10) / 10;

  let verdict, summary;
  if (overThreshold) {
    verdict = "likely_long";
    summary = `Estimate ~${Math.round(estimateMin)} min — probably over ${thresholdMinutes} minutes.`;
  } else if (estimateMin > thresholdMinutes - 12) {
    verdict = "borderline";
    summary = `Estimate ~${Math.round(estimateMin)} min — close to your ${thresholdMinutes}-minute limit.`;
  } else {
    verdict = "likely_ok";
    summary = `Estimate ~${Math.round(estimateMin)} min — likely under ${thresholdMinutes} minutes.`;
  }

  return {
    canyon,
    canyon_label: canyonLabel,
    destination_label: destName,
    threshold_minutes: thresholdMinutes,
    estimate_minutes: estimateMin,
    minutes_to_top: minutesToTop,
    over_threshold: overThreshold,
    margin_minutes: margin,
    verdict,
    summary,
    confidence,
    method_note: methodNote,
    home: { label: homeLabel, lat: homeLat, lon: homeLon },
    segments: {
      home_to_canyon_mouth_min: Math.round(homeToMouth * 10) / 10,
      mouth_to_dest_freeflow_min: Math.round(mouthToDest * 10) / 10,
      home_to_dest_freeflow_min: Math.round(homeToDestFreeflow * 10) / 10,
      udot_top_min: udotTopVal,
      camera_adjustment_min: camExtra,
      sign_adjustment_min: Math.round(signExtra * 10) / 10,
    },
    signs: {
      messages: signs.messages,
      lcc_top_minutes: signs.lcc_top_minutes,
      alerts: signs.alerts,
      reasons: signReasons,
    },
    cameras: camBreakdown,
  };
}

async function estimateLcc(
  homeLat,
  homeLon,
  homeLabel,
  signs,
  thresholdMinutes,
  includeCameras,
  signal
) {
  const canyon = "lcc";
  const cfg = CONFIG[canyon];
  const mouth = cfg.canyon_mouth;
  const dest = cfg.destination;

  const [homeToMouth, mouthToDest, homeToDest] = await Promise.all([
    osrmMinutes(homeLon, homeLat, mouth.lon, mouth.lat, signal),
    osrmMinutes(mouth.lon, mouth.lat, dest.lon, dest.lat, signal),
    osrmMinutes(homeLon, homeLat, dest.lon, dest.lat, signal),
  ]);

  const camScores = includeCameras ? await scanCameras(signal) : [];
  const [camExtra, camBreakdown] = cameraDelayMinutes(camScores, camerasForLcc());
  const [signExtra, signReasons0] = signDelayMinutes(signs);
  const signReasons = [...signReasons0];
  const udotTopVal = udotLccTop(signs);
  signReasons.unshift(
    udotTopVal != null
      ? `UDOT LCC canyon-top sign: ${udotTopVal} min`
      : `UDOT LCC canyon-top sign: not posted`
  );

  return buildCanyonPayload(canyon, {
    homeLabel,
    homeLat,
    homeLon,
    homeToMouth,
    mouthToDest,
    homeToDestFreeflow: homeToDest,
    signs,
    camExtra,
    camBreakdown,
    signExtra,
    signReasons,
    thresholdMinutes,
    includeCameras,
  });
}

async function attachForecast(payload, signs, includeForecast, signal) {
  if (!includeForecast) return;
  try {
    payload.forecast_3h = await predictCanyon3h("lcc", {
      udotTopMin: payload.segments.udot_top_min,
      signAlerts: signs.alerts,
      avgCameraCongestion: avgCameraCongestion(payload.cameras),
      signal,
    });
  } catch (e) {
    payload.forecast_3h = {
      status: "slower",
      label: "Unknown",
      hours_ahead: 3,
      confidence: "low",
      factors: [`Forecast unavailable (${e.name || "Error"})`],
    };
  }
}

async function runForecast(body, signal) {
  const raw = Number(body.hours_ahead);
  const hoursAhead = Number.isFinite(raw) ? Math.min(4, Math.max(0, Math.round(raw))) : 1;
  let udotTopMin = body.udot_top_min;
  if (udotTopMin === "" || udotTopMin === undefined) udotTopMin = null;
  else {
    udotTopMin = Number(udotTopMin);
    if (!Number.isFinite(udotTopMin)) udotTopMin = null;
  }
  const signAlerts = Array.isArray(body.sign_alerts) ? body.sign_alerts.map(String) : [];
  let avg = body.avg_camera_congestion;
  if (avg === "" || avg === undefined) avg = null;
  else {
    avg = Number(avg);
    if (!Number.isFinite(avg)) avg = null;
  }
  return predictCanyon3h("lcc", {
    udotTopMin,
    signAlerts,
    avgCameraCongestion: avg,
    hoursAhead,
    signal,
  });
}

async function runEstimate(body, signal) {
  const address = String(body.address || "").trim();
  if (address.length < 3) {
    const err = new Error("address required (min 3 chars)");
    err.status = 400;
    throw err;
  }
  const thresholdMinutes = Math.min(240, Math.max(30, Number(body.threshold_minutes) || THRESHOLD_MINUTES));
  const includeCameras = body.include_cameras !== false;
  const includeForecast = body.include_forecast !== false;

  const { lat: homeLat, lon: homeLon, label: homeLabel } = await geocode(address, signal);
  const signs = await fetchCottonwoodSigns(signal);

  const result = await estimateLcc(
    homeLat,
    homeLon,
    homeLabel,
    signs,
    thresholdMinutes,
    includeCameras,
    signal
  );
  await attachForecast(result, signs, includeForecast, signal);
  result.sources = [
    "https://cottonwoodcanyons.udot.utah.gov/road-information/",
    "https://www.udottraffic.utah.gov/",
    "https://api.weather.gov/",
  ];

  result.segments.mouth_to_alta_freeflow_min = result.segments.mouth_to_dest_freeflow_min;
  result.segments.home_to_alta_freeflow_min = result.segments.home_to_dest_freeflow_min;
  result.segments.udot_lcc_top_min = result.segments.udot_top_min;

  return result;
}

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use("/static", express.static(STATIC));

app.get("/", (req, res) => res.sendFile(path.join(STATIC, "index.html")));
app.get("/full", (req, res) => res.sendFile(path.join(STATIC, "full.html")));
app.get("/api/health", (req, res) => res.json({ ok: true }));

async function withTimeout(handler, req, res) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 120000);
  try {
    const data = await handler(controller.signal);
    return res.json(data);
  } catch (e) {
    const status = e.status || (e.name === "AbortError" ? 504 : 500);
    return res.status(status).json({ detail: String(e.message || e) });
  } finally {
    clearTimeout(t);
  }
}

app.post("/api/estimate", (req, res) =>
  withTimeout((signal) => runEstimate(req.body || {}, signal), req, res)
);

app.post("/api/forecast", (req, res) =>
  withTimeout((signal) => runForecast(req.body || {}, signal), req, res)
);

app.get("/api/quick", (req, res) => {
  const address = String(req.query.address || "").trim();
  if (address.length < 3) {
    return res.status(400).json({ detail: "address query required (min 3 chars)" });
  }
  return withTimeout(
    (signal) =>
      runEstimate(
        {
          address,
          threshold_minutes: Number(req.query.threshold) || THRESHOLD_MINUTES,
          canyon: "lcc",
          include_cameras: false,
        },
        signal
      ),
    req,
    res
  );
});

app.listen(PORT, () => {
  console.log(`Cottonwood drive server http://127.0.0.1:${PORT}`);
});
