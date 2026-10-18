// One lease per document: closing one tab cannot stop another tab's compute.
export function createTabLeases({onEmpty=()=>{},now=Date.now,graceMs=5000,ttlMs=180000,startupMs=60000,pollMs=1000,isConnected=()=>false}={}){
  const tabs=new Map();let emptySince=now(),seen=false,stopping=false;
  const valid=id=>typeof id==='string'&&/^[a-zA-Z0-9-]{20,80}$/.test(id);
  function touch(id){if(!valid(id)||stopping)return false;tabs.set(id,now());seen=true;emptySince=null;return true;}
  function release(id){if(!valid(id))return false;tabs.delete(id);if(!tabs.size&&emptySince===null)emptySince=now();return true;}
  function check(){
    for(const [id,at] of tabs)if(now()-at>ttlMs&&!isConnected(id))release(id);
    if(!stopping&&!tabs.size&&emptySince!==null&&now()-emptySince>=(seen?graceMs:startupMs)){
      stopping=true;onEmpty();
    }
    return {activeTabs:tabs.size,stopping};
  }
  const timer=pollMs?setInterval(check,pollMs):null;timer?.unref();
  return {touch,release,check,state:()=>({activeTabs:tabs.size,stopping}),dispose:()=>clearInterval(timer)};
}
