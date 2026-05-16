import sharp from "sharp";
import { CONFIG } from "./config.js";

const COTTONWOOD_URL =
  process.env.COTTONWOOD_ROAD_INFO_URL || "https://cottonwoodcanyons.udot.utah.gov/road-information/";
const UDOT_CCTV = process.env.UDOT_CCTV_URL_TEMPLATE || "https://www.udottraffic.utah.gov/map/Cctv/{id}";
const USER_AGENT = process.env.USER_AGENT || "AltaDriveEstimator/1.0 (personal trip planner)";

function cameraUrl(cam) {
  if (cam.url) return cam.url;
  return UDOT_CCTV.replace("{id}", String(cam.id));
}

/** @param {string} html */
export function parseSigns(html) {
  const messages = [];
  let lccTopMinutes = null;
  const alerts = [];
  const blockRe = /<div class="message-sign"[^>]*>(.*?)<\/div>/gis;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    let text = m[1].replace(/<[^>]+>/g, "\n");
    text = text.replace(/\s+/g, " ").trim();
    if (!text || text.toUpperCase() === "NO_MESSAGE") continue;
    messages.push(text);
    const upper = text.toUpperCase();
    const lcc = upper.match(/LITTLE\s+COTTONWOOD.*?(\d+)\s*MIN/);
    if (lcc) lccTopMinutes = parseInt(lcc[1], 10);
    const kwMap = [
      ["CLOSED", "Road closure mentioned on sign"],
      ["AVALANCHE", "Avalanche control / safety"],
      ["CHAIN", "Chain requirement"],
      ["DELAY", "Delay warning"],
      ["SLOW", "Slow traffic"],
      ["STOP", "Stop / hold"],
      ["TIRE", "Traction restriction"],
    ];
    for (const [kw, label] of kwMap) {
      if (upper.includes(kw)) alerts.push(label);
    }
  }
  return { messages, lcc_top_minutes: lccTopMinutes, alerts };
}

export async function fetchCottonwoodSigns(signal) {
  const r = await fetch(COTTONWOOD_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal,
  });
  if (!r.ok) throw new Error(`Cottonwood fetch ${r.status}`);
  const html = await r.text();
  return parseSigns(html);
}

/**
 * @param {Buffer} buffer - JPEG/PNG image bytes
 * @returns {Promise<[number, string]>}
 */
async function roadCongestionScore(buffer) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const left = Math.floor(w * 0.12);
  const top = Math.floor(h * 0.42);
  const width = Math.max(1, Math.floor(w * 0.76));
  const height = Math.max(1, Math.floor(h * 0.5));

  const { data, info } = await sharp(buffer)
    .extract({ left, top, width, height })
    .resize(160, 90)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  let edgeSum = 0;
  let brightSum = 0;
  let varSum = 0;
  let count = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = -data[i - 1] + data[i + 1];
      const gy = -data[i - W] + data[i + W];
      edgeSum += Math.sqrt(gx * gx + gy * gy);
      brightSum += data[i];
      count++;
    }
  }
  const edgeMean = edgeSum / Math.max(1, count) / 255;
  let b = 0;
  for (let i = 0; i < W * H; i++) b += data[i];
  const brightness = b / (W * H) / 255;
  const meanPx = b / (W * H);
  let s2 = 0;
  for (let i = 0; i < W * H; i++) {
    const d = data[i] - meanPx;
    s2 += d * d;
  }
  const std = Math.sqrt(s2 / (W * H)) / 255;

  if (brightness > 0.72 && edgeMean < 0.08) {
    return [0.15, "bright conditions (snow/night)"];
  }
  let score = Math.min(1, edgeMean * 2.2 + std * 1.4);
  if (brightness < 0.25) score = Math.min(1, score + 0.15);

  let detail;
  if (score < 0.22) detail = "light traffic";
  else if (score < 0.45) detail = "moderate flow";
  else if (score < 0.65) detail = "slow / heavy";
  else detail = "very congested";
  return [score, detail];
}

export async function scoreCamera(cam, signal) {
  const url = cameraUrl(cam);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
    if (!r.ok) throw new Error(String(r.status));
    const buf = Buffer.from(await r.arrayBuffer());
    const [score, detail] = await roadCongestionScore(buf);
    return {
      id: String(cam.id),
      label: cam.label ?? String(cam.id),
      congestion: score,
      detail,
      image_url: url,
    };
  } catch (e) {
    return {
      id: String(cam.id),
      label: cam.label ?? String(cam.id),
      congestion: 0.35,
      detail: `unavailable (${e?.name || "Error"})`,
      image_url: url,
    };
  }
}

export function camerasForLcc() {
  return [...CONFIG.lcc_cameras, ...CONFIG.approach_cameras, ...CONFIG.wasatch_cameras];
}

/** Milliseconds; set CAMERA_CACHE_MS=0 to disable. Same LCC set for all users → shared cache. */
function cameraCacheTtlMs() {
  const n = Number(process.env.CAMERA_CACHE_MS);
  if (Number.isFinite(n) && n >= 0) return n;
  return 120_000;
}

let cameraCacheState = { scores: null, expiresAt: 0 };

let cameraScanInFlight = null;

async function runCameraScan(signal) {
  const cams = camerasForLcc();
  const out = [];
  for (const cam of cams) {
    out.push(await scoreCamera(cam, signal));
  }
  return out;
}

export async function scanCameras(signal) {
  const ttl = cameraCacheTtlMs();
  const now = Date.now();

  if (ttl > 0 && cameraCacheState.scores && now < cameraCacheState.expiresAt) {
    return cameraCacheState.scores;
  }

  if (ttl <= 0) {
    return runCameraScan(signal);
  }

  if (!cameraScanInFlight) {
    cameraScanInFlight = runCameraScan(signal)
      .then((scores) => {
        cameraCacheState = { scores, expiresAt: Date.now() + ttl };
        return scores;
      })
      .finally(() => {
        cameraScanInFlight = null;
      });
  }

  return cameraScanInFlight;
}

export function cameraDelayMinutes(scores, camsConfig) {
  const byId = Object.fromEntries(camsConfig.map((c) => [String(c.id), c]));
  let weighted = 0;
  let weightSum = 0;
  const breakdown = [];
  for (const s of scores) {
    const cfg = byId[s.id];
    if (!cfg) continue;
    const w = cfg.weight ?? 1;
    const mp = cfg.mp ?? 0;
    const mpFactor = 1 + Math.max(0, 12 - mp) * 0.04;
    weighted += s.congestion * w * mpFactor;
    weightSum += w * mpFactor;
    breakdown.push({
      id: s.id,
      label: s.label,
      congestion: Math.round(s.congestion * 100) / 100,
      detail: s.detail,
      image_url: s.image_url,
      weight: w,
    });
  }
  if (weightSum <= 0) return [0, breakdown];
  const avg = weighted / weightSum;
  const extra = Math.max(0, (avg - 0.2) * 32);
  return [Math.round(extra * 10) / 10, breakdown];
}

export function signDelayMinutes(signs) {
  const reasons = [];
  let extra = 0;
  const alertPenalty = {
    "Road closure mentioned on sign": 45,
    "Avalanche control / safety": 35,
    "Stop / hold": 30,
    "Delay warning": 20,
    "Slow traffic": 12,
    "Chain requirement": 8,
    "Traction restriction": 8,
  };
  for (const alert of signs.alerts) {
    const p = alertPenalty[alert] ?? 10;
    extra += p;
    reasons.push(`${alert} → +${p} min`);
  }
  return [extra, reasons];
}
