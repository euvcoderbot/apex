"""Regulatory context for car performance.

Competition power-unit limits are event and document-version specific. Until an
exact FIA event document and its applicability have been checked, return no
event-specific numeric limit. A regulatory maximum is never an observation of
the energy deployment on an individual lap.
"""


def get_fia_energy_envelope(year, event_name, session="Q"):
    if year is None:
        return None
    if year < 2026:
        return {
            "regulation_generation": "2014-2025-hybrid",
            "mgu_h_present": True,
            "is_competition_specific": False,
            "data_status": "generation_only",
        }
    return {
        "regulation_generation": "2026-active-aero",
        "mgu_h_present": False,
        "mgu_k_power_kw": 350.0,
        "session_type": session,
        "event": event_name,
        "recharge_limit_mj": None,
        "race_overtake_recharge_mj": None,
        "power_limited_distance_m": None,
        "is_competition_specific": False,
        "data_status": "event_document_not_verified",
        "source_url": "https://www.fia.com/regulation/fia-formula-1-technical-regulations",
    }
