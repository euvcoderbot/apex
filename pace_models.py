"""Small, deterministic supported-range models; no extrapolated tyre life."""
import math
import numpy as np


def _median(values):
    """np.median for a 1-D float array without its per-call overhead (same value)."""
    n = len(values)
    if n % 2:
        return float(np.partition(values, n//2)[n//2])
    part = np.partition(values, (n//2-1, n//2))
    return float((part[n//2-1]+part[n//2])/2)


def robust_fit(matrix, target, floor=.03):
    matrix, target = np.asarray(matrix,float), np.asarray(target,float)
    weights = np.ones(len(target)); previous = None; converged = False
    # These designs have 2-4 columns. For a full-rank design the weighted
    # normal equations give the same solution as lstsq at a fraction of the
    # cost (this loop ran ~23,000 times per race analysis); rank-deficient
    # designs keep the minimum-norm lstsq solution.
    full_rank = np.linalg.matrix_rank(matrix) == matrix.shape[1]
    for iteration in range(60):
        if full_rank:
            weighted = matrix*weights[:,None]
            beta = np.linalg.solve(matrix.T@weighted, weighted.T@target)
        else:
            root = np.sqrt(weights)
            beta = np.linalg.lstsq(matrix*root[:,None],target*root,rcond=1e-10)[0]
        residual = target-matrix@beta
        scale = max(floor,1.4826*_median(np.abs(residual-_median(residual))))
        weights = np.minimum(1,1.5*scale/np.maximum(np.abs(residual),1e-12))
        if previous is not None and np.max(np.abs(matrix@(beta-previous)))<1e-8:
            converged = True;break
        previous=beta.copy()
    return beta,residual,{'converged':converged,'iterations':iteration+1,'scale':scale}


def tyre_curve(laps):
    """Robust warm-up + linear + optional late slope change, selected by BIC.

    A slope change is a pace feature, not proof of a physical tyre cliff. The
    model only predicts inside observed age support. Unsupported short runs
    retain a linear diagnostic. Persistent late falloff is not an outlier.
    """
    x=np.array([r['age'] for r in laps],float);y=np.array([r['time'] for r in laps],float)
    origin=float(np.min(x));z=x-origin
    candidates=[(None,False)]
    if len(x)>=12 and np.ptp(x)>=10:
        knots=sorted(set(float(v) for v in x if np.sum(x<=v)>=6 and np.sum(x>v)>=6))
        candidates += [(k,False) for k in knots]
        if np.min(x)<=2 and np.sum(x<=4)>=3:
            candidates += [(None,True)]+[(k,True) for k in knots if k>=8]
    best=None
    for knot,warmup in candidates:
        columns=[np.ones(len(x)),z]
        if warmup:columns.append(np.maximum(0,4-x))
        if knot is not None:columns.append(np.maximum(0,x-knot))
        matrix=np.column_stack(columns)
        beta,residual,diagnostics=robust_fit(matrix,y)
        # Cap isolated mistakes for model selection only; they remain subject
        # to the explicit residual screen, not silently included as tyre shape.
        cap=max(.1,3*diagnostics['scale']);loss=np.mean(np.minimum(residual**2,cap**2))
        bic=len(x)*math.log(max(loss,.01**2))+len(columns)*math.log(len(x))
        if best is None or bic<best[0]:best=(bic,knot,warmup,beta,residual,diagnostics)
    _,knot,warmup,beta,residual,diagnostics=best
    steady=float(beta[1]);late=steady+(float(beta[-1]) if knot is not None else 0)
    curve=[]
    for age in sorted(set(x)):
        value=beta[0]+steady*(age-origin)
        if warmup:value+=beta[2]*max(0,4-age)
        if knot is not None:value+=beta[-1]*max(0,age-knot)
        curve.append({'age':float(age),'time':float(value)})
    return {'method':'robust-supported-piecewise-v1','steady_slope':steady,'late_slope':late,
            'warmup_slope':steady-(float(beta[2]) if warmup else 0),
            'change_age':knot,'warmup_modelled':warmup,'curve':curve,
            'range':[float(np.min(x)),float(np.max(x))],
            'residuals':residual.tolist(),'residual_spread_s':float(np.median(np.abs(residual))),
            'diagnostics':diagnostics,'status':'supported' if len(x)>=12 and np.ptp(x)>=10 else 'linear-diagnostic'}


def compound_age_basis(rows, compounds):
    """Shared nonlinear nuisance terms only where multiple drivers support them."""
    specs=[]
    for compound in compounds:
        own=[r for r in rows if r['compound']==compound]
        ages=np.array([r['age'] for r in own],float)
        specs.append((compound,None))
        if len(own)>=40 and len({r['driver'] for r in own})>=3 and np.ptp(ages)>=12:
            for knot in sorted(set(float(np.quantile(ages,q)) for q in (.33,.67))):
                if sum(ages<knot)>=10 and sum(ages>knot)>=10:specs.append((compound,knot))
    return [[(r['age'] if knot is None else max(0,r['age']-knot))/10 if r['compound']==c else 0 for c,knot in specs] for r in rows], specs


def qualifying_conditions(rows, selections):
    """Optional timestamp diagnostic, never a replacement official lap.

    Fresh, low-age sets of one compound limit set confounding. A shared time
    slope and driver effects cannot isolate track evolution from execution.
    Predict only within each driver's observed timestamp support.
    """
    eligible=[r for r in rows if r.get('end') is not None and r.get('fresh') is True
              and r.get('age') is not None and r['age']<=3 and not r.get('pit')
              and r.get('rain') is False and r.get('accurate') and r.get('track')=='1'
              and not r.get('deleted') and r.get('time') and r.get('compound') in {'SOFT','MEDIUM','HARD'}]
    compounds=sorted({r['compound'] for r in eligible},key=lambda c:-sum(r['compound']==c for r in eligible))
    result={'status':'unsupported','reason':'Need repeated fresh-set laps from at least eight drivers on one dry compound','estimates':{}}
    if not compounds:return result
    eligible=[r for r in eligible if r['compound']==compounds[0]]
    drivers=sorted(d for d in {r['driver'] for r in eligible} if sum(r['driver']==d for r in eligible)>=2)
    eligible=[r for r in eligible if r['driver'] in drivers]
    if len(drivers)<8:return result
    ranges={d:(min(r['end'] for r in eligible if r['driver']==d),max(r['end'] for r in eligible if r['driver']==d)) for d in drivers}
    lo=max(v[0] for v in ranges.values());hi=min(v[1] for v in ranges.values())
    if hi<=lo:
        result['reason']='No common observed timestamp range; no Q3 extrapolation';return result
    reference=(lo+hi)/2
    matrix=np.array([[float(r['driver']==d) for d in drivers]+[(r['end']-reference)/600] for r in eligible])
    if np.linalg.matrix_rank(matrix)<len(drivers)+1:
        result['reason']='Timestamp evolution is not identifiable from driver effects';return result
    beta,residual,diagnostics=robust_fit(matrix,[r['time'] for r in eligible],.05)
    rate=float(beta[-1]/600)
    if not diagnostics['converged'] or abs(rate)*600>2:
        result['reason']='Timestamp fit is unstable or outside the diagnostic plausibility limit';return result
    times={}
    for team,lap in selections.items():
        if lap and lap['driver'] in drivers and lap.get('end') is not None and lap.get('compound')==compounds[0] and lap.get('fresh') is True and lap.get('age') is not None and lap['age']<=3:
            times[team]=float(lap['time']-rate*(lap['end']-reference))
    base=min(times.values(),default=None)
    result.update(status='estimated' if len(times)>=3 else 'unsupported',reason=None if len(times)>=3 else 'Fewer than three selected fastest laps match the condition cohort',
                  estimates={t:(v/base-1)*100 for t,v in times.items()} if len(times)>=3 else {},
                  seconds_per_minute=rate*60,reference_seconds=reference,observed_common_seconds=[lo,hi],compound=compounds[0],
                  drivers=drivers,samples=len(eligible),residual_spread_s=float(np.median(np.abs(residual))),diagnostics=diagnostics,
                  limitation='Execution, wind, temperatures and energy choices are not independently identified; no weather correction is claimed')
    return result
