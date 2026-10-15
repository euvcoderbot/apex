"""Mechanically package already-captured source inputs, not previous scores."""
import gzip, hashlib, json
from datetime import datetime,timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sessions={}
for folder in (ROOT/'ui-cache',ROOT.parent/'outputs/ui-cache'):
    if not folder.exists():continue
    for path in folder.glob('*.json'):
        try:
            entry=json.loads(path.read_text());data=entry.get('data',{})
            if not isinstance(data,dict):continue
            if (data.get('event') not in {'Singapore Grand Prix','Bahrain Grand Prix'} or
                data.get('session') not in {'Qualifying','Race'} or not data.get('lap_data_complete') or
                len(data.get('drivers',[]))<20):continue
            date=datetime.fromisoformat(data['date']).replace(tzinfo=timezone.utc)
            if date.year!=2026:continue
            code={'Qualifying':'Q','Race':'R'}[data['session']]
            key=f"2026:{data['event']}:{code}"
            # Preserve the original captured lifetime; never renew it at build.
            expiry=entry['expires']/1000
            if expiry<=datetime.now(timezone.utc).timestamp():continue
            if key in sessions and sessions[key]['expires']>=expiry:continue
            raw=json.dumps(data,sort_keys=True,separators=(',',':')).encode()
            sessions[key]={'year':2026,'data':data,'expires':expiry,
                           'captured_at':None,
                           'source_sha256':hashlib.sha256(raw).hexdigest(),'telemetry':[]}
        except (KeyError,ValueError,TypeError):continue

for name,gp in [('2026-Singapore-Grand-Prix-metric-replay-archive.json','Singapore Grand Prix'),
                ('2026-Singapore-Grand-Prix-metric-replay-driver-archive.json','Singapore Grand Prix'),
                ('2026-Bahrain-Grand-Prix-metric-replay-archive.json','Bahrain Grand Prix')]:
    path=ROOT.parent/'outputs'/name
    if not path.exists():continue
    archive=json.loads(path.read_text());record=sessions[f'2026:{gp}:Q']
    selections={s['team']:s for s in archive['selections']}
    if not record.get('corners'):record['corners']=archive['corners']
    for team,samples,error in archive['extracted']:
        s=selections[team]
        if error or not samples:continue
        driver=next((d for d in record['data']['drivers'] if d['code']==s['driver']),None)
        lap=next((l for l in driver['laps'] if l['lap']==s['lap']),None) if driver else None
        if not lap or abs(lap['time']-s['time'])>.005:raise ValueError('Recording/lap identity mismatch')
        if any(t['selection']['driver']==s['driver'] and t['selection']['lap']==s['lap'] for t in record['telemetry']):continue
        if abs(samples[-1]['ElapsedSeconds']-s['time'])>.005:raise ValueError('Recording duration mismatch')
        record['telemetry'].append({'selection':s,'samples':samples,
                                  'archive_sha256':hashlib.sha256(path.read_bytes()).hexdigest()})

if len(sessions)!=4:raise ValueError('Need the four retained complete Singapore/Sepang session recordings')
target=ROOT/'verified-sources.json.gz'
target.write_bytes(gzip.compress(json.dumps({'schema':'completed-source-recordings-v1','sessions':sessions},separators=(',',':'),allow_nan=False).encode(),mtime=0))
print(json.dumps({'file':str(target),'compressed_bytes':target.stat().st_size,
                  'sessions':{k:{'drivers':len(v['data']['drivers']),'native_laps':len(v['telemetry'])} for k,v in sessions.items()}}))
