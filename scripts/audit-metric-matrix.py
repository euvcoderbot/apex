"""Read-only cross-GP metric replay. Writes evidence, never dashboard data."""
import argparse
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from statistics import median
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
import requests
from performance_tracks import measure_field
from performance import slope, compute_development_progression
from session_loader import load_selected_laps_telemetry

BASE = 'https://apex-telemetry-api.vercel.app'
EVENTS = [(2025, gp) for gp in ('Japanese Grand Prix','Italian Grand Prix',
    'Azerbaijan Grand Prix','Monaco Grand Prix','British Grand Prix',
    'Hungarian Grand Prix','Canadian Grand Prix','Dutch Grand Prix')]
EVENTS += [(2026,gp) for gp in ('Japanese Grand Prix','Italian Grand Prix',
    'Azerbaijan Grand Prix','Canadian Grand Prix')]
EVENTS += [(2021,'Portuguese Grand Prix'),(2018,'Bahrain Grand Prix')]

def get(path, **params):
    r=requests.get(BASE+path,params=params,timeout=130)
    r.raise_for_status()
    return r.json()

def finite(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

def numeric(value,prefix=''):
    output={}
    if isinstance(value,dict):
        for key,item in value.items():
            if key in ('selection','quality','straight_core_windows','corners','braking'):continue
            output.update(numeric(item,prefix+'.'+key if prefix else key))
    elif finite(value):output[prefix]=value
    return output

def trace_checks(result):
    errors=[]
    for team,row in result.get('teams',{}).items():
        official=row['selection']['time']; ref=row['reference_lap_time']
        def close(label,actual,expected,tolerance=1e-6):
            if not finite(actual) or abs(actual-expected)>tolerance:
                errors.append([team,label,actual,expected])
        close('partition_seconds',row['straight_time']+row['corner_time'],official)
        close('corner_no_overlap',sum(c['time'] for c in row['corners']),row['corner_time'])
        close('partition_percent',row['straight_contribution']+row['corner_contribution'],row['lap_gap'])
        for band,value in row['categories'].items():
            if value:close('corner_'+band+'_percent',value['deficit'],value['time_lost']/ref*100)
        if finite(row.get('straight_core_gap_s')):
            close('core_units',row['straight_core_delta'],row['straight_core_gap_s']/ref*100)
            close('core_window_distance',row['straight_core_distance_m'],sum(
                w['end_m']-w['start_m'] for w in row['straight_core_windows']))
        for zone in row.get('braking',[]):
            for key,value in zone.items():
                if isinstance(value,float) and not math.isfinite(value):errors.append([team,'nonfinite_braking',key])
            hi,lo=zone['entry_speed']/3.6,zone['exit_speed']/3.6
            duration,distance=zone['duration'],zone['distance']
            close('brake_mean_g',zone['mean_g'],(hi-lo)/duration/9.80665)
            close('brake_distance_normalization',zone['normalized_decel_g'],
                  (hi*hi-lo*lo)/(2*9.80665*distance))
            close('brake_specific_power',zone['power_proxy_kw_per_tonne'],
                  .5*(hi*hi-lo*lo)/duration)
    return errors

def replay(year,gp):
    started=time.perf_counter(); report={'year':year,'gp':gp,'failures':[]}
    for session in ('Q','R'):
        try:report[session]=get('/api/performance',year=year,gp=gp,session=session)
        except Exception as exc:report['failures'].append([session,str(exc)])
    q=report.get('Q',{}); qteams=q.get('teams',[])
    valid=[t for t in qteams if t.get('lap') and finite(t['lap'].get('time'))]
    qerrors=[]
    if valid:
        fastest=min(t['lap']['time'] for t in valid)
        for t in valid:
            expected=(t['lap']['time']/fastest-1)*100
            if abs(t['pace']-expected)>.0001:qerrors.append([t['team'],t['pace'],expected])
    report['qualifying_math_errors']=qerrors
    windows=[dict(lap,team=t['team']+':'+str(i),team_name=t['team'],driver_number=lap['number'])
             for t in qteams for i,lap in enumerate(t.get('telemetry_candidates',[]))]
    report['candidate_count']=len(windows)
    if windows:
        try:
            extracted=load_selected_laps_telemetry(year,gp,'Q',windows)
            report['native_samples']=sum(len(samples or []) for _,samples,_ in extracted)
            report['source_failures']=[[key,error] for key,_,error in extracted if error]
            frame={}
            report['baseline']=measure_field(extracted,windows,[],frame)
            report['trace_math_errors']=trace_checks(report['baseline'])
            alternatives=[]
            for attempt in (1,2):
                chosen=[i for i,w in enumerate(windows) if w['team'].endswith(':'+str(attempt))]
                if len(chosen)<3:continue
                subset=measure_field([extracted[i] for i in chosen],[windows[i] for i in chosen],[],frame)
                alternatives.append({'candidate_index':attempt,'result':subset,'math_errors':trace_checks(subset)})
            report['alternative_laps']=alternatives
            sensitivity={}
            for alt in alternatives:
                for team,row in alt['result'].get('teams',{}).items():
                    base=report['baseline'].get('teams',{}).get(team)
                    if not base:continue
                    old,new=base['selection'],row['selection']
                    if (old['driver'],old.get('phase'),old.get('compound')) != (new['driver'],new.get('phase'),new.get('compound')):continue
                    if old['lap']==new['lap']:continue
                    for key,value in numeric(row).items():
                        before=numeric(base).get(key)
                        if finite(before):sensitivity.setdefault(key,[]).append(
                            {'team':team,'before':before,'after':value,'delta':value-before,
                             'laps':[old['lap'],new['lap']]})
            report['same_driver_phase_compound_sensitivity']=sensitivity
        except Exception as exc:report['failures'].append(['telemetry',str(exc)])
    race=report.get('R',{}); tyre_errors=[]; race_errors=[]
    for team in race.get('teams',[]):
        supported=[d for d in team.get('race_drivers',[]) if finite(d.get('pace'))]
        if supported and finite(team.get('pace')):
            best=min(d['pace'] for d in supported)
            if abs(best-team['pace'])>.001:race_errors.append([team['team'],'teammate_min',team['pace'],best])
        for stint in team.get('tyre_age_stints',[]):
            fit=stint.get('fit',stint); points=fit.get('points',[])
            if len(points)>=6:
                actual=slope([(p['age'],p['time']) for p in points])
                if actual is not None and finite(fit.get('raw_slope')) and abs(actual-fit['raw_slope'])>.00002:
                    tyre_errors.append([team['team'],'raw_slope',fit['raw_slope'],actual])
            if finite(fit.get('raw_slope')) and finite(fit.get('fuel_adjusted_slope')):
                if abs(fit['fuel_adjusted_slope']-fit['raw_slope']-.06)>.00002:
                    tyre_errors.append([team['team'],'fuel_shift',fit['raw_slope'],fit['fuel_adjusted_slope']])
    report['race_math_errors']=race_errors;report['tyre_math_errors']=tyre_errors
    try:report['pits']=get('/api/performance/pits',year=year,gp=gp,schema=2)
    except Exception as exc:report['failures'].append(['pits',str(exc)])
    report['elapsed_s']=round(time.perf_counter()-started,2)
    print(json.dumps({'year':year,'gp':gp,'candidates':len(windows),
          'telemetry_teams':len(report.get('baseline',{}).get('teams',{})),
          'error':report.get('baseline',{}).get('error'),
          'math_errors':len(qerrors)+len(report.get('trace_math_errors',[]))+len(tyre_errors)+len(race_errors),
          'failures':report['failures'],'seconds':report['elapsed_s']}),flush=True)
    return report

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    reports=[]
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs=[pool.submit(replay,*event) for event in EVENTS]
        for future in as_completed(jobs):reports.append(future.result())
    reports.sort(key=lambda r:(r['year'],r['gp']))
    data={'events':reports,'scope':'14 event matrix; real candidate-lap replay; no production writes',
          'caveat':'Alternate laps use fixed reference and corner/braking zones. Straight core eligibility and crossing cohorts can still change; those differences are not isolated car effects.'}
    Path(args.output).write_text(json.dumps(data,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'output':args.output,'events':len(reports),
        'candidate_laps':sum(r.get('candidate_count',0) for r in reports),
        'native_samples':sum(r.get('native_samples',0) for r in reports)}),flush=True)

if __name__=='__main__':main()
