"""Index construction + 22 lap-window selections, without network/download time."""
import sys,time,json,statistics
from pathlib import Path
root=sys.argv[sys.argv.index('--module-root')+1] if '--module-root' in sys.argv else str(Path(__file__).resolve().parents[1])
sys.path.insert(0,root)
import session_loader as loader
records=[]
for i in range(20000):
    t=i/10;h=int(t//3600);m=int(t//60)%60;s=t%60
    records.append(f'{h:02}:{m:02}:{s:06.3f}'+ '{}')
measurements=[];counts=[]
for attempt in range(5):
    started=time.perf_counter();source=loader._IndexedRecords(records) if hasattr(loader,'_IndexedRecords') else records
    counts=[len(list(loader._window_records(source,100+i*70,190+i*70))) for i in range(22)]
    measurements.append(time.perf_counter()-started)
result={'records':len(records),'windows':len(counts),'selected_records':sum(counts),'median_seconds':statistics.median(measurements),'runs_seconds':measurements,
        'includes_index_construction':True,'network_included':False}
if len(sys.argv)>1 and not sys.argv[1].startswith('--'):Path(sys.argv[1]).write_text(json.dumps(result,indent=2))
print(json.dumps(result))
