"""Local FastF1 API and static site server for APEX DATA."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import fastf1
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
CACHE = ROOT / ".fastf1-cache"
CACHE.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE))

app = FastAPI(title="APEX DATA API")


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


@lru_cache(maxsize=8)
def load_session(year: int, gp: str, session_name: str):
    session = fastf1.get_session(year, gp, session_name)
    session.load(telemetry=True, weather=False, messages=False)
    return session


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
                    "stint": int(row.get("Stint", 0) or 0),
                }
                for _, row in laps.iterrows()
                if seconds(row["LapTime"]) is not None
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
        selected = data.laps.pick_drivers(driver)
        selected = selected[selected["LapNumber"] == lap]
        if selected.empty:
            raise ValueError("lap was not found")
        telemetry_data = selected.iloc[0].get_telemetry().add_distance()
    except Exception as exc:
        raise HTTPException(404, f"Could not load telemetry: {exc}") from exc

    columns = ["Distance", "Speed", "Throttle", "Brake", "RPM", "nGear", "DRS"]
    samples = telemetry_data[columns].iloc[::4].replace({np.nan: None}).to_dict("records")
    return {"driver": driver, "lap": lap, "samples": samples}


app.mount("/", StaticFiles(directory=ROOT, html=True), name="site")
