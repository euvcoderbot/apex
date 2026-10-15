// Shared, geometry-only bend centres. These are estimates, not measured racing
// apexes: no steering angle, track-edge contact or driver's speed minimum is used.
(function(root){
  const finite=Number.isFinite;
  function refineCornerPositions(samples,markers,total, fractionForSample=null){
    const origin=samples?.[0]?.Distance||0;
    const points=(samples||[]).filter(p=>finite(p.X)&&finite(p.Y)&&finite(p.Distance))
      .map(p=>({d:(fractionForSample?fractionForSample(p):(p.Distance-origin)/total)*total,x:p.X,y:p.Y,t:p.ElapsedSeconds,gap:Math.max(p.SourceIntervalSeconds||0,p.PositionIntervalSeconds||0)}))
      .filter((p,i,a)=>finite(p.d)&&(!i||p.d>a[i-1].d));
    const at=d=>{
      let lo=0,hi=points.length-1;
      if(hi<1||d<points[0].d||d>points[hi].d)return null;
      while(lo<hi){const mid=(lo+hi)>>1;if(points[mid].d<d)lo=mid+1;else hi=mid;}
      if(!lo)return points[0];
      const a=points[lo-1],b=points[lo],span=b.d-a.d;
      if(span>80||Math.max(a.gap,b.gap)>1||finite(a.t)&&finite(b.t)&&b.t-a.t>1)return null;
      const k=(d-a.d)/span;return {x:a.x+(b.x-a.x)*k,y:a.y+(b.y-a.y)*k};
    };
    const angle=d=>{
      const a=at(d-20),b=at(d),c=at(d+20);if(!a||!b||!c)return null;
      const ux=b.x-a.x,uy=b.y-a.y,vx=c.x-b.x,vy=c.y-b.y;
      if(Math.hypot(ux,uy)<1e-6||Math.hypot(vx,vy)<1e-6)return null;
      return Math.atan2(ux*vy-uy*vx,ux*vx+uy*vy);
    };
    const ordered=[...markers].sort((a,b)=>a.fraction-b.fraction);
    return ordered.map((m,i)=>{
      const seed=m.fraction*total,left=i?(ordered[i-1].fraction+m.fraction)*total/2:0,
        right=i<ordered.length-1?(m.fraction+ordered[i+1].fraction)*total/2:total;
      const fallback=reason=>({...m,apexFraction:m.fraction,apexMethod:'map-marker fallback',apexConfidence:'uncertain',apexShiftMetres:0,apexReason:reason});
      if(points.length<30||!(total>1000))return fallback('Insufficient native GPS');
      if(!at(seed-20)||!at(seed)||!at(seed+20))return fallback('Unsupported GPS brackets near turn');
      // Never search into a neighbouring named turn or across the timing line.
      const start=Math.max(left+10,seed-125,20),end=Math.min(right-10,seed+125,total-20),grid=[];
      for(let d=start;d<=end;d+=5){
        const values=[-5,0,5].map(o=>angle(d+o)).filter(finite).sort((a,b)=>a-b);
        grid.push({d,a:values.length===3?values[1]:null});
      }
      const candidates=grid.filter(p=>finite(p.a));if(candidates.length<5)return fallback('Unsupported GPS brackets near turn');
      const peak=candidates.reduce((best,p)=>Math.abs(p.a)*(1-.15*Math.abs(p.d-seed)/125)>Math.abs(best.a)*(1-.15*Math.abs(best.d-seed)/125)?p:best);
      if(Math.abs(peak.a)<.03)return fallback('No distinct supported bend');
      const index=grid.indexOf(peak),threshold=Math.abs(peak.a)*.55;
      let lo=index,hi=index;
      while(lo>0&&finite(grid[lo-1].a)&&Math.sign(grid[lo-1].a)===Math.sign(peak.a)&&Math.abs(grid[lo-1].a)>=threshold)lo--;
      while(hi<grid.length-1&&finite(grid[hi+1].a)&&Math.sign(grid[hi+1].a)===Math.sign(peak.a)&&Math.abs(grid[hi+1].a)>=threshold)hi++;
      const lobe=grid.slice(lo,hi+1),weight=lobe.reduce((s,p)=>s+Math.abs(p.a),0);
      if(lobe.length<3||weight*5/40<.08)return fallback('Bend too weak or narrow for reliable GPS centre');
      // An edge-clipped peak is not evidence that the apex sits at our search limit.
      if(index===0||index===grid.length-1)return fallback('Bend maximum outside bounded search');
      const d=lobe.reduce((s,p)=>s+p.d*Math.abs(p.a),0)/weight;
      // A corner envelope follows sustained same-direction curvature, not a
      // fixed distance and not a driver's brake/throttle/speed trough. Three
      // consecutive weak samples end the envelope; neighbours cap both ends.
      const edge=direction=>{let last=d,weak=0;
        for(let p=d+direction*5;p>left+10&&p<right-10&&Math.abs(p-d)<=500;p+=direction*5){
          const a=angle(p),strong=finite(a)&&Math.sign(a)===Math.sign(peak.a)&&Math.abs(a)>=Math.max(.02,Math.abs(peak.a)*.15);
          if(strong){last=p;weak=0;}else if(++weak>=3)break;
        }return Math.max(left,Math.min(right,last+direction*20));};
      const turnStart=edge(-1),turnEnd=edge(1);
      return {...m,apexFraction:d/total,apexMethod:'GPS bend-centre estimate',apexConfidence:'estimated',apexShiftMetres:d-seed,apexReason:null,
        turnStartFraction:turnStart/total,turnEndFraction:turnEnd/total,
        windowMethod:turnEnd-turnStart>=30?'adaptive-geometry-turning':'uncertain-fixed-window'};
    });
  }
  function cornerWindow(marker,index,markers,total,mode='geometry'){
    const f=marker.apexFraction,left=index?(markers[index-1].apexFraction+f)/2:0,right=index<markers.length-1?(f+markers[index+1].apexFraction)/2:1;
    const adaptive=mode!=='legacy'&&marker.windowMethod==='adaptive-geometry-turning'&&finite(marker.turnStartFraction)&&finite(marker.turnEndFraction);
    return {start:adaptive?Math.max(left,marker.turnStartFraction):Math.max(left,f-130/total),
      end:adaptive?Math.min(right,marker.turnEndFraction):Math.min(right,f+100/total),
      windowMethod:adaptive?'adaptive-geometry-turning':'fixed-window'+(mode==='legacy'?'':'-uncertain-fallback')};
  }
  root.APEXCornerPosition=Object.freeze({refineCornerPositions,cornerWindow});
})(globalThis);
