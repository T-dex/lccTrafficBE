"""UDOT camera + sign analysis for Little Cottonwood / Alta drive estimates."""

from __future__ import annotations

import asyncio
import io
import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from PIL import Image, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "cameras.json").read_text())

COTTONWOOD_URL = os.environ.get(
    "COTTONWOOD_ROAD_INFO_URL",
    "https://cottonwoodcanyons.udot.utah.gov/road-information/",
)
UDOT_CCTV = os.environ.get("UDOT_CCTV_URL_TEMPLATE", "https://www.udottraffic.utah.gov/map/Cctv/{id}")
USER_AGENT = os.environ.get("USER_AGENT", "AltaDriveEstimator/1.0 (personal trip planner)")

# Seconds; 0 disables caching. Shared across all requests (same LCC camera set).
_CAMERA_CACHE_TTL_SEC = float(os.environ.get("CAMERA_CACHE_SEC", "120"))
_camera_cache_lock = asyncio.Lock()
_camera_cache_entry: tuple[list[CameraScore], float] | None = None


@dataclass
class SignData:
    messages: list[str] = field(default_factory=list)
    lcc_top_minutes: int | None = None
    alerts: list[str] = field(default_factory=list)


@dataclass
class CameraScore:
    id: str
    label: str
    congestion: float
    detail: str
    image_url: str


def _camera_url(cam: dict) -> str:
    if url := cam.get("url"):
        return url
    return UDOT_CCTV.format(id=cam["id"])


def parse_signs(html: str) -> SignData:
    data = SignData()
    blocks = re.findall(r'<div class="message-sign"[^>]*>(.*?)</div>', html, re.S | re.I)
    for raw in blocks:
        text = re.sub(r"<[^>]+>", "\n", raw)
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text.upper() == "NO_MESSAGE":
            continue
        data.messages.append(text)
        upper = text.upper()
        m = re.search(r"LITTLE\s+COTTONWOOD.*?(\d+)\s*MIN", upper)
        if m:
            data.lcc_top_minutes = int(m.group(1))
        for kw, label in [
            ("CLOSED", "Road closure mentioned on sign"),
            ("AVALANCHE", "Avalanche control / safety"),
            ("CHAIN", "Chain requirement"),
            ("DELAY", "Delay warning"),
            ("SLOW", "Slow traffic"),
            ("STOP", "Stop / hold"),
            ("TIRE", "Traction restriction"),
        ]:
            if kw in upper:
                data.alerts.append(label)
    return data


async def fetch_cottonwood_signs(client: httpx.AsyncClient) -> SignData:
    r = await client.get(COTTONWOOD_URL, headers={"User-Agent": USER_AGENT})
    r.raise_for_status()
    return parse_signs(r.text)


def _road_congestion_score(img: Image.Image) -> tuple[float, str]:
    """Heuristic 0–1 congestion from a traffic camera still (not ML)."""
    w, h = img.size
    road = img.crop((int(w * 0.12), int(h * 0.42), int(w * 0.88), int(h * 0.92))).convert("L")
    road_small = road.resize((160, 90), Image.Resampling.BILINEAR)
    edges = road_small.filter(ImageFilter.FIND_EDGES)
    edge_mean = ImageStat.Stat(edges).mean[0] / 255.0
    brightness = ImageStat.Stat(road_small).mean[0] / 255.0
    std = ImageStat.Stat(road_small).stddev[0] / 255.0

    # Night / snow: very bright and low edge detail → light penalty
    if brightness > 0.72 and edge_mean < 0.08:
        return 0.15, "bright conditions (snow/night)"

    # Many edges + moderate brightness → queued traffic
    score = min(1.0, edge_mean * 2.2 + std * 1.4)
    if brightness < 0.25:
        score = min(1.0, score + 0.15)

    if score < 0.22:
        detail = "light traffic"
    elif score < 0.45:
        detail = "moderate flow"
    elif score < 0.65:
        detail = "slow / heavy"
    else:
        detail = "very congested"
    return score, detail


async def score_camera(client: httpx.AsyncClient, cam: dict) -> CameraScore:
    url = _camera_url(cam)
    try:
        r = await client.get(url, headers={"User-Agent": USER_AGENT}, timeout=25.0)
        r.raise_for_status()
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
        score, detail = _road_congestion_score(img)
    except Exception as exc:
        return CameraScore(
            id=str(cam["id"]),
            label=cam.get("label", cam["id"]),
            congestion=0.35,
            detail=f"unavailable ({exc.__class__.__name__})",
            image_url=url,
        )
    return CameraScore(
        id=str(cam["id"]),
        label=cam.get("label", cam["id"]),
        congestion=score,
        detail=detail,
        image_url=url,
    )


def cameras_for_lcc() -> list[dict]:
    approach = CONFIG["approach_cameras"]
    return CONFIG["lcc_cameras"] + approach + CONFIG["wasatch_cameras"]


async def _scan_cameras_uncached(client: httpx.AsyncClient) -> list[CameraScore]:
    out: list[CameraScore] = []
    for cam in cameras_for_lcc():
        out.append(await score_camera(client, cam))
    return out


async def scan_cameras(client: httpx.AsyncClient) -> list[CameraScore]:
    """Fetch LCC camera stills; results are cached briefly to limit UDOT load."""
    global _camera_cache_entry
    if _CAMERA_CACHE_TTL_SEC <= 0:
        return await _scan_cameras_uncached(client)

    now = time.monotonic()
    if _camera_cache_entry is not None:
        scores, deadline = _camera_cache_entry
        if now < deadline:
            return scores

    async with _camera_cache_lock:
        now = time.monotonic()
        if _camera_cache_entry is not None:
            scores, deadline = _camera_cache_entry
            if now < deadline:
                return scores
        scores = await _scan_cameras_uncached(client)
        _camera_cache_entry = (scores, time.monotonic() + _CAMERA_CACHE_TTL_SEC)
        return scores


def camera_delay_minutes(scores: list[CameraScore], cams_config: list[dict]) -> tuple[float, list[dict]]:
    """Map weighted camera congestion to extra minutes."""
    by_id = {c["id"]: c for c in cams_config}
    weighted = 0.0
    weight_sum = 0.0
    breakdown: list[dict] = []
    for s in scores:
        cfg = by_id.get(s.id)
        if not cfg:
            continue
        w = cfg.get("weight", 1.0)
        mp = cfg.get("mp", 0)
        # Mouth cameras matter more for total trip
        mp_factor = 1.0 + max(0, (12 - mp)) * 0.04
        contrib = s.congestion * w * mp_factor
        weighted += contrib
        weight_sum += w * mp_factor
        breakdown.append(
            {
                "id": s.id,
                "label": s.label,
                "congestion": round(s.congestion, 2),
                "detail": s.detail,
                "image_url": s.image_url,
                "weight": w,
            }
        )
    if weight_sum <= 0:
        return 0.0, breakdown
    avg = weighted / weight_sum
    # 0 → 0 min, 1 → ~25 min extra from cameras alone
    extra = max(0.0, (avg - 0.2) * 32)
    return round(extra, 1), breakdown


def sign_delay_minutes(signs: SignData) -> tuple[float, list[str]]:
    """Extra minutes from sign alert keywords (canyon time is handled separately)."""
    reasons: list[str] = []
    extra = 0.0
    alert_penalty = {
        "Road closure mentioned on sign": 45,
        "Avalanche control / safety": 35,
        "Stop / hold": 30,
        "Delay warning": 20,
        "Slow traffic": 12,
        "Chain requirement": 8,
        "Traction restriction": 8,
    }
    for alert in signs.alerts:
        p = alert_penalty.get(alert, 10)
        extra += p
        reasons.append(f"{alert} → +{p} min")
    return extra, reasons
