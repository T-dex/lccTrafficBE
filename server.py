"""Cottonwood Canyons drive-time estimator API."""

from __future__ import annotations

import os
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from analyzer import (
    CONFIG,
    camera_delay_minutes,
    cameras_for_lcc,
    fetch_cottonwood_signs,
    scan_cameras,
    sign_delay_minutes,
)
from forecast import avg_camera_congestion, predict_canyon_3h
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

NOMINATIM = os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org/search")
OSRM = os.environ.get("OSRM_URL", "http://router.project-osrm.org/route/v1/driving")
USER_AGENT = os.environ.get("USER_AGENT", "AltaDriveEstimator/1.0")

THRESHOLD_MINUTES = 90
CanyonId = Literal["lcc"]

app = FastAPI(title="Cottonwood Drive Estimator", version="1.1.0")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class EstimateRequest(BaseModel):
    address: str = Field(..., min_length=3)
    threshold_minutes: int = Field(default=THRESHOLD_MINUTES, ge=30, le=240)
    include_cameras: bool = Field(default=True)
    include_forecast: bool = Field(default=True, description="3-hour Normal/Slower/Stopped outlook")
    canyon: CanyonId = Field(default="lcc")


class ForecastPreviewRequest(BaseModel):
    hours_ahead: int = Field(default=1, ge=0, le=4)
    udot_top_min: int | None = None
    sign_alerts: list[str] = Field(default_factory=list)
    avg_camera_congestion: float | None = None


async def geocode(client: httpx.AsyncClient, address: str) -> tuple[float, float, str]:
    r = await client.get(
        NOMINATIM,
        params={"q": address, "format": "json", "limit": 1, "countrycodes": "us"},
        headers={"User-Agent": USER_AGENT},
        timeout=20.0,
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        raise HTTPException(status_code=400, detail=f"Could not geocode address: {address}")
    return float(rows[0]["lat"]), float(rows[0]["lon"]), rows[0].get("display_name", address)


async def osrm_minutes(
    client: httpx.AsyncClient, lon1: float, lat1: float, lon2: float, lat2: float
) -> float:
    url = f"{OSRM}/{lon1},{lat1};{lon2},{lat2}"
    r = await client.get(url, params={"overview": "false"}, headers={"User-Agent": USER_AGENT}, timeout=25.0)
    r.raise_for_status()
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise HTTPException(status_code=502, detail="Routing service unavailable")
    return data["routes"][0]["duration"] / 60.0


def _udot_lcc_top(signs) -> int | None:
    return signs.lcc_top_minutes


def _build_canyon_payload(
    canyon: str,
    *,
    home_label: str,
    home_lat: float,
    home_lon: float,
    home_to_mouth: float,
    mouth_to_dest: float,
    home_to_dest_freeflow: float,
    signs,
    cam_extra: float,
    cam_breakdown: list,
    sign_extra: float,
    sign_reasons: list[str],
    threshold_minutes: int,
    include_cameras: bool,
) -> dict[str, Any]:
    cfg = CONFIG[canyon]
    dest = cfg["destination"]
    tail = cfg["tail_top_to_dest_minutes"]
    clear_top = cfg["clear_canyon_top_minutes"]
    udot_top = _udot_lcc_top(signs)

    dest_name = dest["label"]
    canyon_label = "LITTLE COTTONWOOD"

    if udot_top is not None:
        canyon_drive = udot_top + tail
        estimate_min = round(home_to_mouth + canyon_drive + cam_extra + sign_extra, 1)
        method_note = (
            f"Home → {canyon_label} mouth ({home_to_mouth:.0f} min) + "
            f"UDOT canyon-top sign ({udot_top} min) + {dest_name} tail (~{tail} min) + adjustments"
        )
    else:
        estimate_min = round(home_to_dest_freeflow + cam_extra + sign_extra, 1)
        method_note = f"UDOT {canyon_label} sign unavailable; free-flow routing + adjustments"

    canyon_for_top = udot_top if udot_top is not None else clear_top
    minutes_to_top = round(home_to_mouth + canyon_for_top + cam_extra * 0.5 + sign_extra, 1)

    confidence = "medium"
    if udot_top is not None and (not include_cameras or len(cam_breakdown) >= 4):
        confidence = "high"
    elif udot_top is None:
        confidence = "low"

    over_threshold = estimate_min > threshold_minutes
    margin = round(estimate_min - threshold_minutes, 1)

    if over_threshold:
        verdict, summary = "likely_long", (
            f"Estimate ~{estimate_min:.0f} min — probably over {threshold_minutes} minutes."
        )
    elif estimate_min > threshold_minutes - 12:
        verdict, summary = "borderline", (
            f"Estimate ~{estimate_min:.0f} min — close to your {threshold_minutes}-minute limit."
        )
    else:
        verdict, summary = "likely_ok", (
            f"Estimate ~{estimate_min:.0f} min — likely under {threshold_minutes} minutes."
        )

    return {
        "canyon": canyon,
        "canyon_label": canyon_label,
        "destination_label": dest_name,
        "threshold_minutes": threshold_minutes,
        "estimate_minutes": estimate_min,
        "minutes_to_top": minutes_to_top,
        "over_threshold": over_threshold,
        "margin_minutes": margin,
        "verdict": verdict,
        "summary": summary,
        "confidence": confidence,
        "method_note": method_note,
        "home": {"label": home_label, "lat": home_lat, "lon": home_lon},
        "segments": {
            "home_to_canyon_mouth_min": round(home_to_mouth, 1),
            "mouth_to_dest_freeflow_min": round(mouth_to_dest, 1),
            "home_to_dest_freeflow_min": round(home_to_dest_freeflow, 1),
            "udot_top_min": udot_top,
            "camera_adjustment_min": cam_extra,
            "sign_adjustment_min": round(sign_extra, 1),
        },
        "signs": {
            "messages": signs.messages,
            "lcc_top_minutes": signs.lcc_top_minutes,
            "alerts": signs.alerts,
            "reasons": sign_reasons,
        },
        "cameras": cam_breakdown,
    }


async def _estimate_one_canyon(
    client: httpx.AsyncClient,
    canyon: str,
    home_lat: float,
    home_lon: float,
    home_label: str,
    signs,
    threshold_minutes: int,
    include_cameras: bool,
) -> dict[str, Any]:
    cfg = CONFIG[canyon]
    mouth = cfg["canyon_mouth"]
    dest = cfg["destination"]

    home_to_mouth = await osrm_minutes(client, home_lon, home_lat, mouth["lon"], mouth["lat"])
    mouth_to_dest = await osrm_minutes(client, mouth["lon"], mouth["lat"], dest["lon"], dest["lat"])
    home_to_dest = await osrm_minutes(client, home_lon, home_lat, dest["lon"], dest["lat"])

    cam_scores = await scan_cameras(client) if include_cameras else []
    cam_extra, cam_breakdown = camera_delay_minutes(cam_scores, cameras_for_lcc())
    sign_extra, sign_reasons = sign_delay_minutes(signs)

    udot_top = _udot_lcc_top(signs)
    sign_reasons.insert(
        0,
        f"UDOT LCC canyon-top sign: {udot_top} min"
        if udot_top is not None
        else "UDOT LCC canyon-top sign: not posted",
    )

    payload = _build_canyon_payload(
        canyon,
        home_label=home_label,
        home_lat=home_lat,
        home_lon=home_lon,
        home_to_mouth=home_to_mouth,
        mouth_to_dest=mouth_to_dest,
        home_to_dest_freeflow=home_to_dest,
        signs=signs,
        cam_extra=cam_extra,
        cam_breakdown=cam_breakdown,
        sign_extra=sign_extra,
        sign_reasons=sign_reasons,
        threshold_minutes=threshold_minutes,
        include_cameras=include_cameras,
    )
    return payload


async def _attach_forecast(
    client: httpx.AsyncClient,
    canyon: str,
    payload: dict[str, Any],
    signs,
    *,
    include_forecast: bool,
) -> None:
    if not include_forecast:
        return
    try:
        payload["forecast_3h"] = await predict_canyon_3h(
            client,
            canyon,
            udot_top_min=payload["segments"]["udot_top_min"],
            sign_alerts=signs.alerts,
            avg_camera_congestion=avg_camera_congestion(payload["cameras"]),
        )
    except Exception as exc:
        payload["forecast_3h"] = {
            "status": "slower",
            "label": "Unknown",
            "hours_ahead": 3,
            "confidence": "low",
            "factors": [f"Forecast unavailable ({exc.__class__.__name__})"],
        }


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/full")
async def full_lcc():
    return FileResponse(STATIC / "full.html")


@app.post("/api/forecast")
async def forecast_preview(body: ForecastPreviewRequest):
    async with httpx.AsyncClient(follow_redirects=True) as client:
        try:
            return await predict_canyon_3h(
                client,
                "lcc",
                udot_top_min=body.udot_top_min,
                sign_alerts=body.sign_alerts,
                avg_camera_congestion=body.avg_camera_congestion,
                hours_ahead=body.hours_ahead,
            )
        except Exception as exc:
            return {
                "status": "slower",
                "label": "Unknown",
                "hours_ahead": body.hours_ahead,
                "confidence": "low",
                "factors": [f"Forecast unavailable ({exc.__class__.__name__})"],
            }


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/estimate")
async def estimate(body: EstimateRequest):
    async with httpx.AsyncClient(follow_redirects=True) as client:
        home_lat, home_lon, home_label = await geocode(client, body.address)
        signs = await fetch_cottonwood_signs(client)

        result = await _estimate_one_canyon(
            client, "lcc", home_lat, home_lon, home_label, signs,
            body.threshold_minutes, body.include_cameras,
        )
        await _attach_forecast(
            client, "lcc", result, signs, include_forecast=body.include_forecast
        )
        result["sources"] = [
            "https://cottonwoodcanyons.udot.utah.gov/road-information/",
            "https://www.udottraffic.utah.gov/",
            "https://api.weather.gov/",
        ]
        result["segments"]["mouth_to_alta_freeflow_min"] = result["segments"]["mouth_to_dest_freeflow_min"]
        result["segments"]["home_to_alta_freeflow_min"] = result["segments"]["home_to_dest_freeflow_min"]
        result["segments"]["udot_lcc_top_min"] = result["segments"]["udot_top_min"]
        return result


@app.get("/api/quick")
async def quick_estimate(
    address: str = Query(..., min_length=3),
    threshold: int = Query(default=THRESHOLD_MINUTES, ge=30, le=240),
    canyon: CanyonId = Query(default="lcc"),
):
    return await estimate(
        EstimateRequest(
            address=address,
            threshold_minutes=threshold,
            canyon=canyon,
            include_cameras=False,
        )
    )
