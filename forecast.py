"""3-hour canyon drive outlook: Normal / Slower / Stopped."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "cameras.json").read_text())

NWS_POINTS = os.environ.get("NWS_POINTS_URL_TEMPLATE", "https://api.weather.gov/points/{lat},{lon}")
USER_AGENT = os.environ.get("USER_AGENT", "AltaDriveEstimator/1.0 (cottonwood forecast)")
TZ = ZoneInfo("America/Denver")

Status = Literal["normal", "slower", "stopped"]


@dataclass
class Forecast3h:
    status: Status
    label: str
    target_local: str
    confidence: str
    traffic_score: float
    weather_score: float
    factors: list[str]


def _parse_wind_mph(wind: str | None) -> int:
    if not wind:
        return 0
    m = re.search(r"(\d+)", wind)
    return int(m.group(1)) if m else 0


def score_weather(short: str, pop: int | None, wind_mph: int, temp_f: int | None) -> tuple[float, list[str]]:
    text = (short or "").lower()
    factors: list[str] = []
    score = 0.0

    severe = (
        "blizzard",
        "ice storm",
        "freezing rain",
        "heavy snow",
        "snow storm",
        "thunderstorm",
        "blowing snow",
    )
    moderate = ("snow", "wintry", "sleet", "freezing", "fog", "rain showers", "rain")

    for term in severe:
        if term in text:
            score = max(score, 0.92)
            factors.append(f"Forecast: {short}")
            break
    else:
        for term in moderate:
            if term in text:
                score = max(score, 0.62)
                factors.append(f"Forecast: {short}")
                break

    if pop is not None:
        if pop >= 80:
            score = max(score, 0.75)
            factors.append(f"Precipitation chance {pop}%")
        elif pop >= 50:
            score = max(score, 0.5)
            factors.append(f"Precipitation chance {pop}%")

    if wind_mph >= 35:
        score = max(score, 0.7)
        factors.append(f"Wind {wind_mph} mph")
    elif wind_mph >= 25:
        score = max(score, 0.45)
        factors.append(f"Wind {wind_mph} mph")

    if temp_f is not None and temp_f <= 28 and ("snow" in text or (pop or 0) >= 40):
        score = max(score, 0.55)
        factors.append(f"Cold ({temp_f}°F) with wintry precip")

    if not factors:
        factors.append(f"Weather OK — {short}")

    return min(1.0, score), factors


def _period_slice(p: dict) -> dict:
    pop = (p.get("probabilityOfPrecipitation") or {}).get("value")
    temp = p.get("temperature")
    wind = _parse_wind_mph(p.get("windSpeed"))
    short = p.get("shortForecast", "")
    risk, factors = score_weather(short, pop, wind, temp)
    return {
        "short_forecast": short,
        "wind_mph": wind,
        "pop_percent": pop,
        "temperature_f": temp,
        "risk_score": risk,
        "factors": factors,
    }


def _pick_closest_period(periods: list, when: datetime) -> dict:
    best = periods[0]
    best_delta = timedelta(days=999)
    for p in periods:
        start = datetime.fromisoformat(p["startTime"].replace("Z", "+00:00")).astimezone(TZ)
        delta = abs(start - when)
        if delta < best_delta:
            best_delta = delta
            best = p
    return best


async def fetch_weather_plus_hours(
    client: httpx.AsyncClient, lat: float, lon: float, hours_ahead: int = 3
) -> dict:
    """NWS hourly nearest to now and nearest to (now + hours_ahead); scoring uses target hour."""
    r = await client.get(
        NWS_POINTS.format(lat=round(lat, 4), lon=round(lon, 4)),
        headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json"},
        timeout=15.0,
    )
    r.raise_for_status()
    hourly_url = r.json()["properties"]["forecastHourly"]
    r2 = await client.get(
        hourly_url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json"},
        timeout=15.0,
    )
    r2.raise_for_status()
    periods = r2.json()["properties"]["periods"]

    now_dt = datetime.now(TZ)
    target_dt = now_dt + timedelta(hours=hours_ahead)
    now_p = _pick_closest_period(periods, now_dt)
    tgt_p = _pick_closest_period(periods, target_dt)
    now_w = _period_slice(now_p)
    tgt_w = _period_slice(tgt_p)

    weather_factors: list[str] = list(tgt_w["factors"])
    if now_w["short_forecast"] != tgt_w["short_forecast"]:
        weather_factors.insert(0, f"Now near Alta: {now_w['short_forecast']}")
        weather_factors.append(f"~{hours_ahead}h out: {tgt_w['short_forecast']}")

    return {
        "now": {
            "short_forecast": now_w["short_forecast"],
            "wind_mph": now_w["wind_mph"],
            "pop_percent": now_w["pop_percent"],
            "temperature_f": now_w["temperature_f"],
        },
        "target": {
            "short_forecast": tgt_w["short_forecast"],
            "wind_mph": tgt_w["wind_mph"],
            "pop_percent": tgt_w["pop_percent"],
            "temperature_f": tgt_w["temperature_f"],
        },
        "risk_score": tgt_w["risk_score"],
        "factors": weather_factors if weather_factors else tgt_w["factors"],
    }


def ski_traffic_time_pressure(when: datetime) -> tuple[float, list[str]]:
    """Heuristic congestion pressure for +3h window in America/Denver."""
    factors: list[str] = []
    wd = when.weekday()  # 0=Mon
    h = when.hour
    score = 0.12

    if wd in (5, 6):  # Sat, Sun
        if 6 <= h < 10:
            score = 0.72
            factors.append("Weekend morning ski traffic")
        elif 15 <= h < 19:
            score = 0.78
            factors.append("Weekend afternoon departure rush")
        elif 10 <= h < 15:
            score = 0.45
            factors.append("Weekend midday canyon travel")
    elif wd == 4:  # Friday
        if 15 <= h < 20:
            score = 0.65
            factors.append("Friday evening canyon traffic")
    else:
        if 7 <= h < 9:
            score = 0.55
            factors.append("Weekday morning commute window")
        elif 16 <= h < 19:
            score = 0.6
            factors.append("Weekday afternoon commute window")

    return min(1.0, score), factors


def score_current_traffic(
    *,
    udot_top_min: int | None,
    clear_top_min: int,
    avg_camera_congestion: float | None,
    sign_alerts: list[str],
) -> tuple[float, list[str]]:
    factors: list[str] = []
    score = 0.15

    if udot_top_min is not None:
        ratio = udot_top_min / max(clear_top_min, 1)
        sign_score = min(1.0, max(0.0, (ratio - 1.0) * 0.85))
        score = max(score, sign_score)
        if ratio >= 1.8:
            factors.append(f"UDOT canyon sign {udot_top_min} min (well above typical)")
        elif ratio >= 1.25:
            factors.append(f"UDOT canyon sign {udot_top_min} min (elevated)")

    if avg_camera_congestion is not None:
        score = max(score, avg_camera_congestion)
        if avg_camera_congestion >= 0.55:
            factors.append("Cameras show heavy congestion now")
        elif avg_camera_congestion >= 0.35:
            factors.append("Cameras show moderate congestion now")

    closure_words = ("closure", "closed", "avalanche", "stop", "hold")
    for alert in sign_alerts:
        low = alert.lower()
        if any(w in low for w in closure_words):
            score = max(score, 0.95)
            factors.append(alert)

    if not factors:
        factors.append("Current traffic near typical")

    return min(1.0, score), factors


def combine_forecast(
    traffic_now: float,
    traffic_time: float,
    weather_risk: float,
    traffic_factors: list[str],
    time_factors: list[str],
    weather_factors: list[str],
    *,
    target: datetime,
) -> Forecast3h:
    # Weighted blend: current traffic persists; time-of-day shapes +3h; weather adds risk
    traffic_3h = min(1.0, traffic_now * 0.55 + traffic_time * 0.45)
    combined = min(1.0, traffic_3h * 0.62 + weather_risk * 0.38)

    if combined >= 0.78 or (traffic_now >= 0.9 and weather_risk >= 0.5):
        status: Status = "stopped"
        label = "Stopped"
    elif combined >= 0.42 or traffic_3h >= 0.5 or weather_risk >= 0.55:
        status = "slower"
        label = "Slower"
    else:
        status = "normal"
        label = "Normal"

    confidence = "medium"
    if weather_risk >= 0.7 or traffic_now >= 0.7:
        confidence = "high"
    elif weather_risk < 0.2 and traffic_now < 0.3:
        confidence = "medium-low"

    all_factors = traffic_factors + time_factors + weather_factors
    return Forecast3h(
        status=status,
        label=label,
        target_local=target.strftime("%I:%M %p").lstrip("0"),
        confidence=confidence,
        traffic_score=round(traffic_3h, 2),
        weather_score=round(weather_risk, 2),
        factors=all_factors[:6],
    )


async def predict_canyon_3h(
    client: httpx.AsyncClient,
    canyon: str,
    *,
    udot_top_min: int | None,
    sign_alerts: list[str],
    avg_camera_congestion: float | None = None,
    hours_ahead: int = 3,
) -> dict:
    cfg = CONFIG[canyon]
    dest = cfg["destination"]
    clear = cfg["clear_canyon_top_minutes"]

    target = datetime.now(TZ) + timedelta(hours=hours_ahead)
    weather = await fetch_weather_plus_hours(client, dest["lat"], dest["lon"], hours_ahead)
    traffic_now, tf = score_current_traffic(
        udot_top_min=udot_top_min,
        clear_top_min=clear,
        avg_camera_congestion=avg_camera_congestion,
        sign_alerts=sign_alerts,
    )
    traffic_time, ttf = ski_traffic_time_pressure(target)
    fc = combine_forecast(
        traffic_now,
        traffic_time,
        weather["risk_score"],
        tf,
        ttf,
        weather["factors"],
        target=target,
    )

    return {
        "status": fc.status,
        "label": fc.label,
        "hours_ahead": hours_ahead,
        "target_time_local": target.isoformat(),
        "target_display": fc.target_local,
        "confidence": fc.confidence,
        "traffic_score": fc.traffic_score,
        "weather_score": fc.weather_score,
        "weather": {
            "short_forecast": weather["target"]["short_forecast"],
            "wind_mph": weather["target"]["wind_mph"],
            "pop_percent": weather["target"]["pop_percent"],
            "temperature_f": weather["target"]["temperature_f"],
            "now": weather["now"],
        },
        "factors": fc.factors,
    }


def avg_camera_congestion(cam_breakdown: list[dict]) -> float | None:
    if not cam_breakdown:
        return None
    vals = [c["congestion"] for c in cam_breakdown]
    return sum(vals) / len(vals) if vals else None
