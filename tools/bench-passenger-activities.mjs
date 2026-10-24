// Reproducible functional/tick diagnostic, not a before/after FPS claim.
import {performance} from 'node:perf_hooks';
import {mkdirSync,writeFileSync} from 'node:fs';
import {referenceStation} from '../game/src/data/reference-station.ts';
import {World} from '../game/src/sim/world.ts';
import {ACTIVITY_NAMES} from '../game/src/sim/activities.ts';
const out=new URL('../.preview/perf/passenger-activities/',import.meta.url);mkdirSync(out,{recursive:true});
const report={seed:99,startSeconds:8*3600,ticks:1200,stations:[]};
for(const name of ['zoo','tanwei']){
 const build=performance.now(),world=new World(referenceStation(name),report.seed);world.simTime=report.startSeconds;
 const built=performance.now()-build,samples=[],seen=new Set(),visits={},frames=Object.fromEntries(ACTIVITY_NAMES.map(n=>[n,0]));
 let maximum=0,conflicts=0;
 for(let i=0;i<report.ticks;i++){
  const before=performance.now();world.tickOnce();samples.push(performance.now()-before);maximum=Math.max(maximum,world.pool.count);
  const busy=new Set();
  for(const a of world.pool.live){
   frames[ACTIVITY_NAMES[Math.floor(world.activityTransfer(a)/1048576)]]++;
   if(!a.activeStop)continue;
   if(busy.has(a.activeStop))conflicts++;busy.add(a.activeStop);
   const key=a.id+':'+a.activeStop;
   if(!seen.has(key)){seen.add(key);const stop=world.graph.stops.find(s=>s.id===a.activeStop);visits[stop?.kind??'unknown']=(visits[stop?.kind??'unknown']??0)+1}
  }
 }
 const sorted=samples.slice(30).sort((a,b)=>a-b),pct=p=>sorted[Math.floor((sorted.length-1)*p)];
 const row={name,buildMs:built,firstTickMs:samples[0],meanTickMs:samples.reduce((a,b)=>a+b,0)/samples.length,p50TickMs:pct(.5),p95TickMs:pct(.95),p99TickMs:pct(.99),maximumAgents:maximum,stops:world.graph.stops.length,visits,frames,conflicts,totals:world.totals,stuck:world.metrics.stuck};
 if(conflicts)throw Error(name+': customers overlap a service slot');report.stations.push(row);console.log(row);
}
writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2));
