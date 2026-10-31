"""Repeatable offline physics benchmark; optionally compare a local Git baseline.

python scripts/benchmark-physics.py --baseline b799735
The known-input fixture holds car physics and sampling constant. This is not a
claim of real-world accuracy or end-to-end network/UI latency.
"""
import argparse
import json
from pathlib import Path
import runpy
import statistics
import subprocess
import sys
import time
import types
import platform
import hashlib
import tracemalloc
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import car_physics

def run():
    parser=argparse.ArgumentParser()
    parser.add_argument('--baseline')
    parser.add_argument('--repeats',type=int,default=7)
    parser.add_argument('--warmup',type=int,default=1)
    args=parser.parse_args()
    if not 1<=args.repeats<=100:parser.error('repeats must be between 1 and 100')
    if not 0<=args.warmup<=10:parser.error('warmup must be between 0 and 10')
    fixture=runpy.run_path(str(Path(__file__).with_name('test-car-physics.py')),run_name='benchmark_fixture')
    cars={f'car{k}':[fixture['simulate'](rng=fixture['np'].random.default_rng(k))] for k in range(6)}
    models=[]
    if args.baseline:
        if args.baseline.startswith('-'):parser.error('Invalid baseline')
        previous=types.ModuleType('baseline')
        source=subprocess.check_output(['git','show',args.baseline+':car_physics.py']).decode('utf-8')
        exec(compile(source,'baseline/car_physics.py','exec'),previous.__dict__)
        models.append(previous)
    models.append(car_physics)
    outputs=[];report={'environment':{'python':sys.version,'platform':platform.platform(),
        'head':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),
        'baseline':args.baseline,'warmup':args.warmup,'repeats':args.repeats,
        'numpy':fixture['np'].__version__,'dataset':'six-car fixed-seed synthetic; seeds 0..5',
        'dataset_sha256':hashlib.sha256(b''.join(a[0].tobytes() for a in cars.values())).hexdigest()}}
    for model in models:
        for _ in range(args.warmup):model.speed_domain_metrics(cars)
        samples=[]
        for _ in range(args.repeats):
            start=time.perf_counter();result=model.speed_domain_metrics(cars);samples.append(time.perf_counter()-start)
        result.pop('method',None)
        result.pop('reference',None)  # v5 adds provenance, not a numerical score.
        outputs.append(json.dumps(result,sort_keys=True,default=lambda x:x.item()))
        tracemalloc.start();model.speed_domain_metrics(cars);_,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
        report[model.__name__]={'median_seconds':statistics.median(samples),'runs':samples,
            'min_seconds':min(samples),'max_seconds':max(samples),'traced_peak_bytes_separate_run':peak,
            'memory_limit':'Python traced allocations only; not total process RSS or all native allocations'}
    if args.baseline:report['known_input_outputs_identical_except_provenance']=outputs[0]==outputs[1]
    print(json.dumps(report,indent=2))
    if args.baseline and outputs[0]!=outputs[1]:raise SystemExit(1)

if __name__=='__main__':run()
