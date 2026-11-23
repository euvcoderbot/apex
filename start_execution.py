"""Native speed packet estimates of observed standing-start execution (version 1)."""
from math import isfinite, sqrt

DISTANCES = (5, 10, 15, 20, 25, 50, 75, 100)
MAX_GAP = 0.6


def standing_start(packets):
    """Input (seconds, km/h, brake), restricted to a known grid-start window.
    Start at the midpoint between last stopped and first moving packet.
    Beyond that first packet integrate piecewise-linear speed in SI units.
    """
    if len(packets) < 4:
        return {}
    for i in range(1, len(packets)):
        t, speed, brake = packets[i]
        last, previous, _ = packets[i-1]
        if not all(isfinite(n) for n in (last, t, previous, speed)) or not 0 < t-last <= MAX_GAP:
            return {}
        if previous == 0 and speed > 0:
            break
    else:
        return {}
    # Require a stationary baseline within the window. A racing lap or a
    # momentary zero during a moving trace cannot supply a launch origin.
    if last-packets[0][0] < 1 or any(v != 0 for _, v, _ in packets[:i]):
        return {}
    origin = (last+t)/2
    elapsed = origin
    v0 = distance = 0.
    gap = t-last
    results = {}
    for stamp, kmh, braking in packets[i:]:
        dt = stamp-elapsed
        if braking or not all(isfinite(n) for n in (dt, kmh)) or not 0 < dt <= MAX_GAP or not 0 <= kmh <= 400:
            break
        v1 = kmh/3.6
        end = distance+(v0+v1)*dt/2
        gap = max(gap, dt)
        for mark in DISTANCES:
            if distance < mark <= end:
                length = mark-distance
                terminal = sqrt(max(0., v0*v0 + 2*(v1-v0)*length/dt))
                crossing = 2*length/(v0+terminal)
                results[mark] = dict(seconds=round(elapsed-origin+crossing,3),
                                     kmh=round(terminal*3.6,1), packet_s=round(gap,3))
        if end >= DISTANCES[-1]:
            break
        elapsed, distance, v0 = stamp, end, v1
    return results
