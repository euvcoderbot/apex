"""Local FastF1 API and static site server for APEX DATA."""
from __future__ import annotations

from functools import lru_cache
from datetime import datetime, timedelta
import logging
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

import fastf1
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
CACHE = ROOT / ".fastf1-cache"
CACHE.mkdir(exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE))

app = FastAPI(title="APEX DATA API")
OPENF1 = "https://api.openf1.org/v1"
logger = logging.getLogger("apex.telemetry")


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
    from urllib.parse import quote
    valid_params = {key: value for key, value in params.items() if value is not None}
    parts = []
    for key, value in valid_params.items():
        if key.endswith(">=") or key.endswith("<=") or key.endswith(">") or key.endswith("<"):
            parts.append(f"{key}{quote(str(value))}")
        else:
            parts.append(f"{key}={quote(str(value))}")
    query = "&".join(parts)
    with urlopen(f"{OPENF1}/{endpoint}?{query}", timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


@lru_cache(maxsize=64)
def openf1_session(year: int, gp: str, session_name: str) -> dict[str, Any] | None:
    try:
        meetings = openf1("meetings", year=year)
        wanted = gp.lower().replace("grand prix", "").replace("great britain", "british").strip()
        
        meeting_key = None
        for item in meetings:
            name = item.get("meeting_name", "").lower().replace("grand prix", "").replace("great britain", "british")
            if wanted in name or wanted in item.get("location", "").lower():
                meeting_key = item.get("meeting_key")
                break
                
        if meeting_key is None:
            return None
            
        sessions = openf1("sessions", year=year, meeting_key=meeting_key)
        wanted_session = session_name.lower().strip()
        
        for item in sessions:
            name = item.get("session_name", "").lower().strip()
            if wanted_session == name:
                return item
            if wanted_session == 'q' and 'qualifying' in name:
                return item
            if wanted_session == 'r' and 'race' in name:
                return item
            if wanted_session == 'fp1' and 'practice 1' in name:
                return item
            if wanted_session == 'fp2' and 'practice 2' in name:
                return item
            if wanted_session == 'fp3' and 'practice 3' in name:
                return item
            if wanted_session == 's' and 'sprint' in name and 'qualifying' not in name:
                return item
            if wanted_session == 'sq' and ('sprint qualifying' in name or 'sprint shootout' in name):
                return item
    except Exception as e:
        logger.error("Error in openf1_session: %s", e)
        return None
    return None


@lru_cache(maxsize=256)
def openf1_lap_telemetry(year: int, gp: str, session_name: str, driver_number: str, lap_number: int) -> list[dict[str, Any]]:
    session = openf1_session(year, gp, session_name)
    if not session:
        return []
    session_key = session["session_key"]
    laps = openf1("laps", session_key=session_key, driver_number=driver_number, lap_number=lap_number)
    if not laps or not laps[0].get("date_start") or not laps[0].get("lap_duration"):
        return []
    start_dt = datetime.fromisoformat(laps[0]["date_start"].replace("Z", "+00:00"))
    end_dt = start_dt + timedelta(seconds=float(laps[0]["lap_duration"]) + 0.5)
    
    start_str = start_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    end_str = end_dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    
    car = openf1("car_data", session_key=session_key, driver_number=driver_number, **{"date>=": start_str, "date<=": end_str})
    if not car:
        return []
    # OpenF1 publishes vehicle location separately from car channels. Joining
    # it here gives the mini-sector map a real circuit shape even when FastF1's
    # car-data archive is unavailable for a recent weekend.
    try:
        location = openf1("location", session_key=session_key, driver_number=driver_number, **{"date>=": start_str, "date<=": end_str})
        if location:
            car_frame = pd.DataFrame(car)
            location_frame = pd.DataFrame(location)
            car_frame["_date"] = pd.to_datetime(car_frame["date"], utc=True)
            location_frame["_date"] = pd.to_datetime(location_frame["date"], utc=True)
            position_columns = [column for column in ("_date", "x", "y") if column in location_frame]
            car = pd.merge_asof(
                car_frame.sort_values("_date"),
                location_frame[position_columns].sort_values("_date"),
                on="_date",
                direction="nearest",
                tolerance=pd.Timedelta(milliseconds=400),
            ).to_dict("records")
    except Exception as error:
        logger.debug("OpenF1 position data unavailable: %s", error)

    car.sort(key=lambda item: item["date"])
    samples: list[dict[str, Any]] = []
    distance = 0.0
    previous = None
    for point in car:
        timestamp = pd.Timestamp(point["date"]).to_pydatetime()
        elapsed = (timestamp - start_dt).total_seconds()
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
            "X": point.get("x"),
            "Y": point.get("y"),
        })
    return samples


@lru_cache(maxsize=8)
def load_session(year: int, gp: str, session_name: str, round_number: int | None = None):
    # Do not pass the calendar round straight to the F1 Timing schedule. That
    # schedule may only contain weekends with timing data available, so its
    # round numbers are not always the championship round numbers. In the
    # worst case it silently selected another event; in the best case it raised
    # "Invalid round". Resolve the exact event name from the full calendar,
    # then create the session from that event.
    backend = "fastf1" if year >= 2018 else "ergast"
    event = fastf1.get_event(year, gp, backend=backend, exact_match=True)
    if event is None:
        raise ValueError(f"'{gp}' is not an exact event name on the {year} calendar")

    session = event.get_session(session_name)
    # Session controls need timing/lap data, not the multi-megabyte car stream
    # for every driver. Fetch the car stream only if OpenF1 cannot provide a
    # selected lap (mainly older seasons).
    session.load(telemetry=False, weather=False, messages=False)
    return session


@lru_cache(maxsize=4)
def load_telemetry_session(year: int, gp: str, session_name: str):
    """Load FastF1 car data only as the historical fallback."""
    backend = "fastf1" if year >= 2018 else "ergast"
    event = fastf1.get_event(year, gp, backend=backend, exact_match=True)
    if event is None:
        raise ValueError(f"'{gp}' is not an exact event name on the {year} calendar")
    data = event.get_session(session_name)
    data.load(telemetry=True, weather=False, messages=False)
    return data


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


def get_tire_nominations(year: int, gp: str) -> list[str]:
    # Standard Pirelli dry slick compound allocations for common Grand Prix
    name = gp.lower()
    
    # 2025 special street races with C6
    if year == 2025:
        if "monaco" in name or "monal" in name:
            return ["C4", "C5", "C6"]
        if "canada" in name or "montreal" in name:
            return ["C4", "C5", "C6"]
        if "azerbaijan" in name or "baku" in name:
            return ["C4", "C5", "C6"]
            
    # Hardest selection: C1, C2, C3
    if any(k in name for k in ["bahrain", "suzuka", "japan", "spain", "barcelona", "great britain", "british", "silverstone", "zandvoort", "netherlands", "qatar", "lusail"]):
        return ["C1", "C2", "C3"]
        
    # Medium selection: C2, C3, C4
    if any(k in name for k in ["china", "shanghai", "miami", "belgium", "spa", "americas", "austin", "united states"]):
        return ["C2", "C3", "C4"]
        
    # Softest selection: C3, C4, C5
    # Default to C3, C4, C5 for street circuits and high grip tracks (Melbourne, Monaco, Montreal, Austria, Hungary, Monza, Baku, Singapore, Mexico, Brazil, Las Vegas, Abu Dhabi)
    return ["C3", "C4", "C5"]


@app.get("/api/session")
def session_data(
    year: int = Query(2025, ge=2018),
    gp: str = Query("British Grand Prix"),
    round: int | None = Query(None, ge=1),
    session: str = Query("Q"),
):
    # For current-era weekends OpenF1 exposes individual lap streams (and
    # location points) without making the browser wait for FastF1 to download
    # every car in the session. Prefer it where it exists.
    try:
        metadata = load_session(year, gp, session, round)
        driver_number = str(metadata.get_driver(driver).get("DriverNumber", driver))
        if year >= 2023:
            samples = openf1_lap_telemetry(year, gp, session, driver_number, lap)
            if samples:
                return {"driver": driver, "lap": lap, "samples": samples, "source": "OpenF1"}
    except Exception as openf1_lookup_error:
        logger.debug("OpenF1 lookup unavailable for %s L%s: %s", driver, lap, openf1_lookup_error)

    try:
        data = load_telemetry_session(year, gp, session)
    except Exception as exc:
        raise HTTPException(422, f"Could not load this session: {exc}") from exc

    # FastF1 already knows the real Q1/Q2/Q3 boundaries (including delays and
    # red flags). Keep that phase against each lap so the UI can show runs by
    # qualifying segment instead of treating every run as a generic stint.
    qualifying_phase: dict[Any, str] = {}
    if data.name in getattr(data, "_QUALI_LIKE_SESSIONS", ()):
        try:
            for index, phase_laps in enumerate(data.laps.split_qualifying_sessions(), start=1):
                if phase_laps is not None:
                    for lap_index in phase_laps.index:
                        qualifying_phase[lap_index] = f"Q{index}"
        except Exception as exc:
            logger.warning("Could not split qualifying laps into Q1/Q2/Q3: %s", exc)

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
                    "phase": qualifying_phase.get(lap_index),
                    "in_lap": seconds(row.get("PitInTime")) is not None,
                    "out_lap": seconds(row.get("PitOutTime")) is not None,
                }
                for lap_index, row in laps.iterrows()
                if row.get("LapNumber") is not None
            ],
        })
    corners = []
    marker_reference_distance = None
    circuit_info = None
    try:
        circuit_info = data.get_circuit_info()
    except Exception as e:
        logger.warning("Direct get_circuit_info failed: %s", e)
        
    has_valid_corners = False
    if circuit_info is not None and circuit_info.corners is not None and not circuit_info.corners.empty:
        first_dist = circuit_info.corners["Distance"].iloc[0]
        if np.isfinite(first_dist):
            has_valid_corners = True
            
    if has_valid_corners:
        try:
            fastest_telemetry = data.laps.pick_fastest().get_telemetry(frequency="original")
            marker_reference_distance = float(fastest_telemetry["Distance"].max())
        except Exception as exc:
            logger.warning("Could not calculate the circuit-marker reference distance: %s", exc)
        for _, row in circuit_info.corners.iterrows():
            dist = row.get("Distance")
            if dist is not None and np.isfinite(dist):
                corners.append({
                    "number": str(row["Number"]),
                    "letter": str(row.get("Letter") or ""),
                    "distance": float(dist),
                    "fraction": float(dist / marker_reference_distance)
                    if marker_reference_distance and marker_reference_distance > 0 else None,
                })
    else:
        logger.warning("No valid circuit-marker distances for this session; corner overlays are disabled.")

    return {
        "event": data.event["EventName"],
        "session": data.name,
        "drivers": drivers,
        "corners": corners,
        "compounds": get_tire_nominations(year, gp),
    }


@app.get("/api/telemetry")
def telemetry(
    year: int = Query(2025, ge=2018),
    gp: str = Query("British Grand Prix"),
    round: int | None = Query(None, ge=1),
    session: str = Query("Q"),
    driver: str = Query(..., min_length=2),
    lap: int = Query(..., ge=1),
):
    try:
        data = load_session(year, gp, session, round)
        driver_info = data.get_driver(driver)
        driver_number = str(driver_info.get("DriverNumber", driver))
        selected = data.laps.pick_drivers(driver_number)
        selected = selected[np.isclose(selected["LapNumber"].astype(float), float(lap))]
        if selected.empty:
            raise ValueError("lap was not found")
        lap_row = selected.iloc[0]
        # Use the raw car stream for the trace. FastF1's convenience
        # get_telemetry() helper merges position and car channels, which can
        # introduce interpolated/padded samples around some laps.
        telemetry_data = lap_row.get_car_data().add_distance().copy()
        try:
            position_data = lap_row.get_pos_data().loc[:, ["Date", "X", "Y"]].copy()
            telemetry_data = pd.merge_asof(
                telemetry_data.sort_values("Date"),
                position_data.sort_values("Date"),
                on="Date",
                direction="nearest",
                tolerance=pd.Timedelta(milliseconds=300),
            )
        except Exception as position_error:
            logger.warning("Position join unavailable for %s L%s: %s", driver, lap, position_error)
        for coordinate in ("X", "Y"):
            if coordinate not in telemetry_data.columns:
                telemetry_data[coordinate] = np.nan

        # Keep only the official lap-time interval as a final guard.
        official_lap_time = seconds(lap_row.get("LapTime"))
        if official_lap_time and "Time" in telemetry_data.columns:
            elapsed = telemetry_data["Time"].dt.total_seconds()
            telemetry_data = telemetry_data[
                (elapsed >= -0.25) & (elapsed <= official_lap_time + 0.25)
            ].copy()
        if telemetry_data.empty:
            raise ValueError("lap telemetry was empty after official-time trimming")
        telemetry_data["Distance"] = telemetry_data["Distance"] - telemetry_data["Distance"].iloc[0]
    except Exception as fastf1_error:
        logger.debug("FastF1 telemetry unavailable for %s L%s: %s", driver, lap, fastf1_error)
        try:
            data = load_session(year, gp, session, round)
            driver_number = str(data.get_driver(driver).get("DriverNumber", driver))
            samples = openf1_lap_telemetry(year, gp, session, driver_number, lap)
            if samples:
                return {"driver": driver, "lap": lap, "samples": samples, "source": "OpenF1"}
        except Exception as openf1_error:
            logger.warning("OpenF1 telemetry fallback unavailable for %s L%s: %s", driver, lap, openf1_error)
            raise HTTPException(422, f"No telemetry source returned this lap. FastF1: {fastf1_error}; OpenF1: {openf1_error}") from openf1_error
        raise HTTPException(422, "No telemetry is published for this session/lap yet.")

    telemetry_data = telemetry_data.copy()
    telemetry_data["ElapsedSeconds"] = telemetry_data["Time"].dt.total_seconds()
    columns = ["Distance", "ElapsedSeconds", "Speed", "Throttle", "Brake", "RPM", "nGear", "DRS", "X", "Y"]
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
