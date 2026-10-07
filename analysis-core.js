// Shared presentation definitions. Display precision is not measurement accuracy.
(function (root) {
  const version = '2026-10-08-feature-pass';
  const definitions = Object.freeze({
    pace: {title:'Pace', description:'Qualifying uses one fastest valid lap across Q1, Q2 and Q3. Race pace compares screened race laps with adjustments for shared race-lap conditions, compound and tyre age; fuel, traffic and race management remain limitations.'},
    corners: {title:'Cornering', description:'Time through the same mapped corner windows. Low-speed is up to 120 km/h, medium up to 200, high above 200, based on the field reference near the apex. Qualifying uses the fastest eligible lap; race observations are matched separately.'},
    straight: {title:'Straight-line performance', description:'The headline measures settled, near-full-throttle straight sections, trimmed away from corner exits and braking. Acceleration bands, end speed, native peak speed and official speed traps are separate measurements, not an engine-power or drag rating.'},
    braking: {title:'Braking', description:'Both comparisons use the same actual fastest qualifying laps and matched zones. Approach time measures a fixed track section; same-speed slowing measures the time to shed a shared speed range. Public brake data is on/off, not brake pressure or measured brake power.'},
    pits: {title:'Pit stops', description:'Stationary time is published time stopped at the box. Pit-lane time includes entry, the stop and exit, not the loss against staying on track. Raw summaries weight visits; GP-relative lane summaries give each supported GP equal weight. Missing stationary values are never estimated.'},
    tyres: {title:'Tyre trend', description:'Within-driver pace change as tyre age increases, using usable uninterrupted runs and verified exact C grades. Positive means slowing, negative means improving. Raw and assumed fuel-corrected results are selectable; neither isolates physical tyre wear. Matched-rival trends remain a separate comparison.'},
    trend: {title:'Relative qualifying progress', description:'Change in the qualifying gap across observed rounds. Opening/latest medians and a fitted trend are separate summaries. Missing rounds are not zero; a relative improvement does not establish that an upgrade caused it.'},
    results: {title:'Reliability and results', description:'Race results and official retirement statuses, not a speed rating. Points shown here exclude sprints unless explicitly included. Starts count driver entries; unknown retirement causes are not assumed mechanical.'}
  });
  function preference(key, fallback) {
    try { const value=root.localStorage?.getItem('apex:'+key); return value===null||value===undefined?fallback:JSON.parse(value); } catch { return fallback; }
  }
  function savePreference(key, value) { try { root.localStorage?.setItem('apex:'+key,JSON.stringify(value)); } catch {} }
  function format(value, unit='', digits=3, signed=false) {
    if(typeof value!=='number'||!Number.isFinite(value))return '—';
    const rounded=Math.abs(value)<.5*10**(-digits)?0:value;
    return (signed&&rounded>0?'+':'')+rounded.toFixed(digits)+unit;
  }
  function observedBrake(value) {
    if(value===null||value===undefined||value==='')return null;
    if(typeof value==='boolean')return value?100:0;
    const number=Number(value);return Number.isFinite(number)?number>0?100:0:null;
  }
  function observedDRS(value) {
    if(value===null||value===undefined||value==='')return null;
    if(typeof value==='boolean')return value?1:0;
    const number=Number(value);if(!Number.isFinite(number))return null;
    return [1,10,12,14].includes(number)||number>=10?1:0;
  }
  function sortRows(items,getters,key,direction=1) {
    const getter=getters[key];if(!getter)return [...items];
    return [...items].sort((a,b)=>{
      const av=getter(a),bv=getter(b),missing=v=>v===null||v===undefined||typeof v==='number'&&!Number.isFinite(v);
      if(missing(av)||missing(bv))return missing(av)?missing(bv)?0:1:-1;
      return (typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv)))*direction;
    });
  }
  root.ApexAnalysis=Object.freeze({version,definitions,preference,savePreference,format,observedBrake,observedDRS,sortRows});
})(typeof window==='object'?window:globalThis);
