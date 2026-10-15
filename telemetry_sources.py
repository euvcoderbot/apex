"""Conservative UTC packet reconciliation; resampling is never extra evidence."""
from bisect import bisect_left
import math

CAR_CHANNELS=('Speed','Throttle','Brake','RPM','nGear','DRS')


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
                if old.get(c) is None and value is not None:
                    old[c]=value;old['ChannelSources'][c]=p['ChannelSources'].get(c,secondary_source);report['filled_channels']+=1
                elif c in CAR_CHANNELS and value is not None and old.get(c) is not None:
                    a,b=(bool(old[c]),bool(value)) if c=='Brake' else (old[c],value)
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
