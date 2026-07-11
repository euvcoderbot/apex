"""Local FastF1 API and static site server for APEX DATA."""
from __future__ import annotations

from functools import lru_cache
from datetime import datetime, timedelta
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

import fastf1
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
CACHE = ROOT / ".fastf1-cache"
CACHE.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE))

app = FastAPI(title="APEX DATA API")
OPENF1 = "https://api.openf1.org/v1"


def seconds(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if hasattr(value, "total_seconds"):
            value = value.total_seconds()
        value = float(value)
        return value if np.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def integer(value: Any, default: int = 0) -> int:
    try:
        value = float(value)
        return int(value) if np.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def openf1(endpoint: str, **params: Any) -> list[dict[str, Any]]:
    query = urlencode({key: value for key, value in params.items() if value is not None})
    with urlopen(f"{OPENF1}/{endpoint}?{query}", timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def openf1_session(year: int, gp: str, session_name: str) -> dict[str, Any] | None:
    sessions = openf1("sessions", year=year)
    wanted = gp.lower().replace("grand prix", "").replace("great britain", "british").strip()
    session_name = session_name.lower().replace("practice ", "practice ")
    for item in sessions:
        meeting = item.get("meeting_name", "").lower().replace("grand prix", "").replace("great britain", "british")
        if wanted in meeting and item.get("session_name", "").lower() == session_name:
            return item
    return None


def openf1_lap_telemetry(year: int, gp: str, session_name: str, driver_number: str, lap_number: int) -> list[dict[str, Any]]:
    session = openf1_session(year, gp, session_name)
    if not session:
        return []
    session_key = session["session_key"]
    laps = openf1("laps", session_key=session_key, driver_number=driver_number, lap_number=lap_number)
    if not laps or not laps[0].get("date_start") or not laps[0].get("lap_duration"):
        return []
    start = datetime.fromisoformat(laps[0]["date_start"].replace("Z", "+00:00"))
    end = start + timedelta(seconds=float(laps[0]["lap_duration"]) + 0.5)
    car = openf1("car_data", session_key=session_key, driver_number=driver_number, **{"date>": start.isoformat(), "date<": end.isoformat()})
    if not car:
        return []
    car.sort(key=lambda item: item["date"])
    samples: list[dict[str, Any]] = []
    distance = 0.0
    previous = None
    for point in car:
        timestamp = datetime.fromisoformat(point["date"].replace("Z", "+00:00"))
        elapsed = (timestamp - start).total_seconds()
        if previous is not None:
            dt = (timestamp - previous).total_seconds()
            distance += max(0.0, float(point.get("speed") or 0) / 3.6 * dt)
        previous = timestamp
        samples.append({
            "Distance": distance,
            "ElapsedSeconds": elapsed,
            "Speed": point.get("speed"),
            "Throttle": point.get("throttle"),
            "Brake": point.get("brake"),
            "RPM": point.get("rpm"),
            "nGear": point.get("n_gear"),
            "DRS": point.get("drs"),
        })
    return samples


@lru_cache(maxsize=8)
def load_session(year: int, gp: str, session_name: str):
    # Prefer the official F1 timing backend. It is usually available shortly
    # after a session ends and avoids waiting for an aggregated mirror update.
    session = fastf1.get_session(year, gp, session_name, backend="f1timing")
    session.load(telemetry=True, weather=False, messages=False)
    return session


@app.get("/api/events")
def events(year: int = Query(2025, ge=2014)):
    try:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
    except Exception as exc:
        raise HTTPException(422, f"Could not load the {year} calendar: {exc}") from exc
    result = []
    for _, event in schedule.iterrows():
        sessions = []
        for index in range(1, 6):
            name = event.get(f"Session{index}")
            if name and str(name) not in {"nan", "None"}:
                sessions.append(str(name))
        result.append({
            "round": int(event["RoundNumber"]),
            "name": str(event["EventName"]),
            "date": str(event["EventDate"])[:10],
            "sessions": sessions,
        })
    return result


@app.get("/api/session")
def session_data(
    year: int = Query(2025, ge=2018),
    gp: str = Query("British Grand Prix"),
    session: str = Query("Q"),
):
    try:
        data = load_session(year, gp, session)
    except Exception as exc:
        raise HTTPException(422, f"Could not load this session: {exc}") from exc

    drivers = []
    for code in data.drivers:
        info = data.get_driver(code)
        laps = data.laps.pick_drivers(code)
        if laps.empty:
            continue
        drivers.append({
            "code": str(info.get("Abbreviation", code)),
            "number": str(info.get("DriverNumber", "")),
            "name": str(info.get("FullName", info.get("BroadcastName", code))),
            "team": str(info.get("TeamName", "")),
            "team_color": "#" + str(info.get("TeamColor", "777777")).lstrip("#"),
            "laps": [
                {
                    "lap": int(row["LapNumber"]),
                    "time": seconds(row["LapTime"]),
                    "s1": seconds(row["Sector1Time"]),
                    "s2": seconds(row["Sector2Time"]),
                    "s3": seconds(row["Sector3Time"]),
                    "compound": str(row.get("Compound", "UNKNOWN")),
                    "stint": integer(row.get("Stint")),
                    "in_lap": seconds(row.get("PitInTime")) is not None,
                    "out_lap": seconds(row.get("PitOutTime")) is not None,
                }
                for _, row in laps.iterrows()
                if row.get("LapNumber") is not None
            ],
        })
    return {"event": data.event["EventName"], "session": data.name, "drivers": drivers}


@app.get("/api/telemetry")
def telemetry(
    year: int = Query(2025, ge=2018),
    gp: str = Query("British Grand Prix"),
    session: str = Query("Q"),
    driver: str = Query(..., min_length=2),
    lap: int = Query(..., ge=1),
):
    try:
        data = load_session(year, gp, session)
        driver_info = data.get_driver(driver)
        driver_number = str(driver_info.get("DriverNumber", driver))
        selected = data.laps.pick_drivers(driver_number)
        selected = selected[np.isclose(selected["LapNumber"].astype(float), float(lap))]
        if selected.empty:
            raise ValueError("lap was not found")
        telemetry_data = selected.iloc[0].get_telemetry().add_distance().copy()
        telemetry_data["Distance"] = telemetry_data["Distance"] - telemetry_data["Distance"].iloc[0]
    except Exception:
        try:
            data = load_session(year, gp, session)
            driver_number = str(data.get_driver(driver).get("DriverNumber", driver))
            samples = openf1_lap_telemetry(year, gp, session, driver_number, lap)
            if samples:
                return {"driver": driver, "lap": lap, "samples": samples, "source": "OpenF1"}
        except Exception:
            pass
        raise HTTPException(422, "No telemetry is published for this session/lap yet. Try a completed session or a 2023+ event with OpenF1 coverage.")

    telemetry_data = telemetry_data.copy()
    telemetry_data["ElapsedSeconds"] = telemetry_data["Time"].dt.total_seconds()
    columns = ["Distance", "ElapsedSeconds", "Speed", "Throttle", "Brake", "RPM", "nGear", "DRS"]
    samples = telemetry_data[columns].iloc[::4].replace({np.nan: None}).to_dict("records")
    if samples:
        return {"driver": driver, "lap": lap, "samples": samples, "source": "FastF1"}

    try:
        samples = openf1_lap_telemetry(year, gp, session, driver_number, lap)
        if samples:
            return {"driver": driver, "lap": lap, "samples": samples, "source": "OpenF1"}
    except Exception:
        pass
    raise HTTPException(422, "No telemetry is published for this session/lap yet. Try a completed session or a 2023+ event with OpenF1 coverage.")


app.mount("/", StaticFiles(directory=ROOT, html=True), name="site")
