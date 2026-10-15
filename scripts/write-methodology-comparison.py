"""Compact before/after evidence, with arithmetic and unchanged-crossing checks."""
import json,sys,runpy,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT.parent/'outputs'
sys.path.insert(0,str(ROOT))
checks=runpy.run_path(str(ROOT/'scripts/audit-metric-matrix.py'))['trace_checks']
before=json.loads((OUT/'methodology-before-full.json').read_text());after=json.loads((OUT/'methodology-after-full.json').read_text())
js_before=json.loads((OUT/'methodology-before-js.json').read_text());js_after=json.loads((OUT/'methodology-after-js.json').read_text())
index_before=json.loads((OUT/'window-index-before.json').read_text());index_after=json.loads((OUT/'window-index-after.json').read_text())

def summary(result):
    rows=result.get('teams',{})
    return {'entries':len(rows),'spatially_measured':sum(not t.get('quality',{}).get('native_only') for t in rows.values()),
            'native_peak_entries':len(result.get('native_speed_observations',{})),
            'supported_braking_entries':sum(any(z['quality']=='supported' for z in t.get('braking',[])) for t in rows.values()),
            'observed_braking_intervals':sum(len(t.get('braking',[])) for t in rows.values()),
            'supported_braking_intervals':sum(z['quality']=='supported' for t in rows.values() for z in t.get('braking',[])),
            'settled_straight_entries':sum(t.get('straight_core_gap_s') is not None for t in rows.values()),
            'entry_matched_straight_entries':sum(t.get('straight_core_entry_matched',{}).get('straight_core_gap_s') is not None for t in rows.values()),
            'acceleration_entries':{band:sum(band in t.get('accel_bands',{}) for t in rows.values()) for band in ['100_150','150_200','200_250','250_300','300_320']}}

def values(result, name):
    row=result.get('teams',{}).get(name,{})
    native=result.get('native_speed_observations',{}).get(name,{})
    return {'native_peak_kmh':native.get('top_speed'),
            'settled_window_gap_s':row.get('straight_core_gap_s'),
            'settled_distance_m':row.get('straight_core_distance_m'),
            'entry_matched_gap_s':row.get('straight_core_entry_matched',{}).get('straight_core_gap_s'),
            'braking_supported_intervals':sum(z['quality']=='supported' for z in row.get('braking',[])),
            'spatially_measured':bool(row) and not row.get('quality',{}).get('native_only',False)}

cases=[];all_errors=[];crossings=[]
for name,old in before['telemetry'].items():
    new=after['telemetry'][name];errors=checks(new['result']);all_errors.extend([[name,*e] for e in errors])
    cases.append({'case':name,'before':summary(old['result']),'after':summary(new['result']),
                  'cold_calculation_seconds':{'before':old['seconds'],'after':new['seconds']},
                  'source_sha256':new.get('native_archive_sha256') or hashlib.sha256((OUT/name).read_bytes()).hexdigest(),'math_errors':errors,
                  'entrant_values':{team:{'before':values(old['result'],team),'after':values(new['result'],team)}
                                    for team in sorted(set(old['result'].get('native_speed_observations',{}))|set(new['result'].get('native_speed_observations',{})))}})
    for team,row in old['result'].get('teams',{}).items():
        current=new['result'].get('teams',{}).get(team,{})
        for z in row.get('braking',[]):
            candidates=[n for n in current.get('braking',[]) if n['entry_speed']==z['entry_speed'] and n['exit_speed']==z['exit_speed']
                        and abs(n.get('speed_high_m',0)-z.get('speed_high_m',0))<80]
            if not candidates:continue
            matched=min(candidates,key=lambda n:abs(n.get('speed_high_m',0)-z.get('speed_high_m',0)))
            crossings.append({'case':name,'entrant':team,'speed_drop':[z['entry_speed'],z['exit_speed']],
                              'before_seconds':z['duration'],'after_seconds':matched['duration'],
                              'difference_seconds':matched['duration']-z['duration']})

report={'baseline':{'published_version':111,'commit':'50756fa55eec82fd0f2292007f487163b492fdb9'},
        'scope':'Frozen exact-fastest-lap recordings: 11 cohort replays across 9 GP/year cases; not a full-season ground-truth validation',
        'cases':cases,'math_errors':all_errors,
        'unchanged_speed_drop_checks':{'count':len(crossings),'max_absolute_difference_s':max((abs(c['difference_seconds']) for c in crossings),default=None),'crossings':crossings},
        'known_truth':{'chain':{'before':js_before['chain'],'after':{k:{x:v for x,v in r.items() if x!='diagnostics'} for k,r in js_after['chain'].items()}},
                       'disconnected_race':{'before':list(before['raceDisconnected'][0]),'after':list(after['raceDisconnected'][0])},
                       'late_falloff_stint':{'before_laps_retained':before['tyreCliff']['samples'],'after_laps_retained':after['tyreCliff']['samples'],
                                            'true_steady_s_per_lap':.03,'true_late_s_per_lap':.53,'new_fit':after['tyreCliff']['nonlinear']}},
        'window_index_benchmark':{'before':index_before,'after':index_after,'speedup':index_before['median_seconds']/index_after['median_seconds']},
        'limitations':['Coverage improvement is not independent proof of physical accuracy.','Different turning/straight boundaries change the metric definition; old/new totals are not like-for-like hardware measurements.',
                      'Public telemetry is sparse; three decimals are formatting.','Raw DRS codes do not identify 2026 active aero, battery state or brake pressure.',
                      'Fuel and tyre age cannot be independently identified inside one stint.','Extra diagnostics increase cold calculation cost; caching and indexed source extraction address repeated work.']}
path=ROOT/'docs/methodology-comparison-20261015.json';path.write_text(json.dumps(report,indent=2,allow_nan=False))
print(json.dumps({'path':str(path),'cases':len(cases),'math_errors':len(all_errors),'identical_crossings':report['unchanged_speed_drop_checks']['count'],
                  'max_crossing_difference_s':report['unchanged_speed_drop_checks']['max_absolute_difference_s'],'window_scan_speedup':report['window_index_benchmark']['speedup']}))
for case in cases:print(json.dumps({k:v for k,v in case.items() if k in ('case','before','after','cold_calculation_seconds')}))
if all_errors:raise SystemExit('Arithmetic verification failed')
