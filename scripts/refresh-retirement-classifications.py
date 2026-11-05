"""Rebuild retirement metadata only, from retained complete race classifications.
Original timings, capture times and revision IDs remain unchanged.
"""
import copy, gzip, hashlib, json, sys
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from capture_storage import repository_lock, atomic_bytes
from retirement_sources import reported_retirements, match
from performance import classify_retirement
root=Path(sys.argv[1]).resolve()
revision=sys.argv[2]
folders=['prerendered','local-captures']
indexes={f:json.loads((root/'assets/data'/f/'index.json').read_text()) for f in folders}
sessions={}
def identity(route):
 u=urlsplit(route);q=parse_qs(u.query)
 return u.path,int(q.get('year',['0'])[0]),q.get('gp',[''])[0],q.get('session',[''])[0].lower()
def read(folder,entry):
 return json.loads(gzip.decompress((root/'assets/data'/folder/(entry if isinstance(entry,str) else entry['file'])).read_bytes()))
for folder,index in indexes.items():
 for route,entry in index['entries'].items():
  p,y,g,s=identity(route)
  if p=='/api/session' and s in ('r','race'):
   sessions[y,g]=read(folder,entry)
fields={'retirements','pu_retirements','chassis_retirements','mechanical','incident_retirements','incidents','other_retirements','unknown_retirements'}
def observations(value):
 result=copy.deepcopy(value);result.pop('retirement_annotation_revision',None)
 for team in result.get('teams',[]):
  for field in fields:team.pop(field,None)
 return result
changed=matched=unmatched=0
with repository_lock(root):
 for folder,index in indexes.items():
  for route,entry in list(index['entries'].items()):
   p,y,g,s=identity(route)
   if p!='/api/performance' or s not in ('r','race'):continue
   value=read(folder,entry);original=observations(value)
   drivers={d['code']:d for d in sessions.get((y,g),{}).get('drivers',[])}
   report=reported_retirements(y,g)
   for team in value.get('teams',[]):
    for retirement in team.get('retirements',[]):
     driver=drivers.get(retirement.get('driver'),{})
     laps=driver.get('laps',[])
     last=max((l.get('lap',0) for l in laps),default=None)
     # Require all three identity checks; never enrich from code alone.
     found=match(report,driver.get('number'),driver.get('name',''),last) if driver.get('number') and driver.get('name') and last is not None and driver.get('lap_data_complete',True) else None
     if found:
      classified=classify_retirement(retirement.get('cause','Retired'),g,retirement['driver'],y,{**found,'url':report.get('url')})
      retirement.update(classified);matched+=1
     else:unmatched+=1
    counts={key:0 for key in fields if key!='retirements'}
    for r in team.get('retirements',[]):
     category=r.get('category')
     key={'PU-related':'pu_retirements','Chassis / team-related':'chassis_retirements','Incident / collision':'incident_retirements','Other confirmed':'other_retirements'}.get(category,'unknown_retirements')
     counts[key]+=1
    counts['mechanical']=counts['pu_retirements']+counts['chassis_retirements'];counts['incidents']=counts['incident_retirements']
    for key,v in counts.items():
     if key in team:team[key]=v
   value['retirement_annotation_revision']=revision
   assert observations(value)==original,'Non-retirement observations changed'
   payload=gzip.compress(json.dumps(value,separators=(',',':'),ensure_ascii=False).encode(),mtime=0)
   name=hashlib.sha256(payload).hexdigest()[:24]+'.json.gz'
   atomic_bytes(root/'assets/data'/folder/name,payload)
   if isinstance(entry,str):index['entries'][route]=name
   else:index['entries'][route]={**entry,'file':name}
   changed+=1
  atomic_bytes(root/'assets/data'/folder/'index.json',json.dumps(index,separators=(',',':')).encode())
print(json.dumps({'snapshots':changed,'matched_reports':matched,'retained_without_match':unmatched,'observations_unchanged':True}))
