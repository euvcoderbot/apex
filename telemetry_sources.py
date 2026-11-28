"""Conservative UTC packet reconciliation; resampling is never extra evidence."""
from bisect import bisect_left
import math

CAR_CHANNELS=('Speed','Throttle','Brake','RPM','nGear','DRS')
# The pedal channels carry 104 where the feed has no reading (OpenF1 publishes it on either pedal, often both at once, at
# any speed). Each pedal is decoded on its own: 104 is missing, never braking or full throttle (analysis-core.js matches).
PEDAL_MISSING=104


def _pedal_number(value):
    if value is None or value=='':return None
    try:number=float(value)
    except (TypeError,ValueError):return None
    if not math.isfinite(number) or number==PEDAL_MISSING or number<0:return None
    return number


def observed_brake(value, throttle=None):
    """0 or 100 for a reading, None when missing (104, null, invalid).

    Some stored laps kept the brake only as True/False (bool(104) is True). Both pedals carry the placeholder together in
    most cases, so a True brake beside a 104 throttle is taken as missing too; a False brake is still a reading."""
    if isinstance(value,bool):
        if value and _pedal_number(throttle) is None and throttle not in (None,'') :return None
        return 100 if value else 0
    number=_pedal_number(value)
    return None if number is None else (100 if number>0 else 0)


def _missing(channel, value):
    """No reading on this channel: null, or a pedal's 104 placeholder (filled from the other source when it has one)."""
    if value is None:return True
    if channel=='Brake':return observed_brake(value) is None
    if channel=='Throttle':return observed_throttle(value) is None
    return False


def observed_throttle(value):
    """0-100 for a reading (an odd 101-103 is a full pedal), None when missing."""
    if isinstance(value,bool):return None
    number=_pedal_number(value)
    return None if number is None else min(100.0,number)


def needs_complement(samples):
    if not samples:return True
    native=[p for p in samples if not p.get('IsInterpolatedBoundary')]
    if len(native)<20:return False  # cannot establish a trustworthy whole-lap UTC match
    gaps=[b['ElapsedSeconds']-a['ElapsedSeconds'] for a,b in zip(native,native[1:])]
    return max(gaps,default=0)>1.5 or sum(p.get('X') is None or p.get('Y') is None for p in native)>len(native)*.35


def finite(value):
    return isinstance(value,(float,int)) and math.isfinite(value)


def annotate_samples(samples, source):
    result=[]
    for p in samples:
        row=dict(p);native=not bool(p.get('IsInterpolatedBoundary'))
        provenance=dict(p.get('ChannelSources') or {})
        for channel in CAR_CHANNELS:
            if row.get(channel) is not None:provenance.setdefault(channel,source+(':native' if native else ':boundary-derived'))
        for channel in ('X','Y'):
            if row.get(channel) is not None:provenance.setdefault(channel,source+':position-joined')
        row['ChannelSources']=provenance;row['IndependentPacket']=native
        result.append(row)
    return result


def fuse_native_samples(primary, secondary, primary_source='FastF1', secondary_source='OpenF1'):
    """Fill verified holes only; keep primary values and report conflicts.

    Both commonly redistribute the same upstream stream. Exact duplicate UTC
    packets remain ONE observation. Different lap-origin clocks, resampled
    edges and conflicting packets cannot create apparent higher resolution.
    """
    rows=annotate_samples(primary,primary_source);other=annotate_samples(secondary,secondary_source)
    report={'method':'UTC-hole-fill-v1','duplicate_packets':0,'added_packets':0,'filled_channels':0,'conflicts':0,'status':'no-secondary'}
    if not rows or not other:return rows,report
    if any(not finite(r.get('Timestamp')) or not finite(r.get('ElapsedSeconds')) for r in rows+other):
        report['status']='unverified-UTC';return rows,report
    origin=rows[0]['Timestamp']-rows[0]['ElapsedSeconds']
    secondary_origin=other[0]['Timestamp']-other[0]['ElapsedSeconds']
    if abs(origin-secondary_origin)>.005:
        report['status']='different-lap-origin';report['origin_difference_s']=secondary_origin-origin;return rows,report
    times=[r['Timestamp'] for r in rows];added=[]
    for p in other:
        if not p['IndependentPacket']:continue
        t=p['Timestamp'];i=bisect_left(times,t)
        matches=[j for j in (i-1,i) if 0<=j<len(rows) and abs(times[j]-t)<=.002]
        if matches:
            old=rows[min(matches,key=lambda j:abs(times[j]-t))];report['duplicate_packets']+=1
            for c in CAR_CHANNELS+('X','Y'):
                value=p.get(c)
                if _missing(c,old.get(c)) and not _missing(c,value):
                    old[c]=value;old['ChannelSources'][c]=p['ChannelSources'].get(c,secondary_source);report['filled_channels']+=1
                elif c in CAR_CHANNELS and not _missing(c,value) and not _missing(c,old.get(c)):
                    a,b=(observed_brake(old[c]),observed_brake(value)) if c=='Brake' else (old[c],value)
                    if abs(float(a)-float(b))>(1 if c in ('Speed','Throttle','RPM') else 0):report['conflicts']+=1
        elif 0<i<len(rows) and times[i]-times[i-1]>.6 and times[i-1]+.02<t<times[i]-.02:
            # Missing primary packet, not an interlaced duplicate with a small
            # clock offset. Endpoints of the hole must be UTC verified.
            if finite(p.get('Speed')) and 30<=p['Speed']<=420:
                p['ElapsedSeconds']=t-origin;added.append(p);report['added_packets']+=1
    if added:
        rows=sorted(rows+added,key=lambda r:r['Timestamp']);distance=0
        for i,r in enumerate(rows):
            if i:distance+=(r['Timestamp']-rows[i-1]['Timestamp'])*(r['Speed']+rows[i-1]['Speed'])/7.2
            r['Distance']=distance
    report['status']='filled' if report['filled_channels'] or report['added_packets'] else 'duplicates-or-no-supported-holes'
    return rows,report


# Positions arrive on their own clock (OpenF1 location, FastF1 position: about 3.7 Hz), never at the car-data instants.
# Each car packet takes the position interpolated in time between the two location packets either side of it, when those
# are at most POSITION_BRACKET_S apart; an exact match is native. Across a longer gap, or outside the observed interval,
# the coordinate stays missing: the nearest packet up to 0.4 s away was up to about 30 m from where the car really was.
POSITION_BRACKET_S = .6


def interpolate_positions(car_times, position_rows, max_gap=POSITION_BRACKET_S):
    """car_times: seconds (any epoch); position_rows: sorted [(seconds, x, y)].
    Returns per car time (x, y, interval_s, estimated) with None for x/y where not bracketed."""
    stamps = [row[0] for row in position_rows]
    out = []
    for t in car_times:
        if t is None or not stamps:
            out.append((None, None, None, False))
            continue
        i = bisect_left(stamps, t)
        if i < len(stamps) and abs(stamps[i] - t) <= .001:
            while i + 1 < len(stamps) and stamps[i + 1] == stamps[i]:
                i += 1   # duplicate packets at one instant: the later one, as merge_asof did
            _, x, y = position_rows[i]
            out.append((x, y, 0.0, False))
            continue
        if 0 < i < len(stamps):
            (t0, x0, y0), (t1, x1, y1) = position_rows[i - 1], position_rows[i]   # the later of any duplicate before t
            span = t1 - t0
            if 0 < span <= max_gap and None not in (x0, y0, x1, y1):
                f = (t - t0) / span
                out.append((x0 + f * (x1 - x0), y0 + f * (y1 - y0), span, True))
                continue
        out.append((None, None, None, False))
    return out

