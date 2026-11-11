import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync} from 'node:fs'
import {referenceStation} from '../../game/src/data/reference-station.ts'
import {World} from '../../game/src/sim/world.ts'
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
const station=referenceStation('zoo'),world=new World(station,7654321),g=world.graph
const start=g.nodeIndex.get('59,16,-15'),end=g.nodeIndex.get('59,20,-15'),gate=g.servers.find(s=>s.kind==='gate'&&g.nodeX[s.node]===59.5&&g.nodeY[s.node]===18.5&&g.nodeZ[s.node]===-14)
if(start===undefined||end===undefined||!gate)throw Error('Zoo gate fixture changed')
const person=world.pool.spawn({origin:'',stops:[],dest:''},g.nodeX[start],g.nodeY[start],g.nodeZ[start],0)
person.state=1;person.needs={stepFree:false,luggage:false};person.path=world.path.search(start,end,person.needs);person.pathIdx=0;person.destNode=end
if(!person.path.includes(gate.node))throw Error('Actual TS route no longer crosses selected gate')
const path=[...person.path].map(node=>({x:g.nodeX[node],y:g.nodeY[node],z:g.nodeZ[node],zone:g.nodeZone[node],gate:node===gate.node}))
// Isolate one real World passenger; ambient spawn is deliberately disabled.
world.spawnStreet=()=>{}
const trace=[];for(let i=0;i<7;i++){world.tickOnce();trace.push({tick:world.tick,x:person.x,y:person.y,z:person.z,state:person.state,pathIndex:person.pathIdx,gateDir:person.gateDir,queue:[...gate.queue],lane:gate.lane,cooldown:gate.cooldown,waitAccum:gate.waitAccum,waitCount:gate.waitCount,dead:person.dead})}
if(trace[2].queue.length!==1||trace[3].waitCount!==1||!trace[6].dead)throw Error('Zoo gate behavior changed')
const result={schemaVersion:1,sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),worldSha256:sha('game/src/sim/world/World.ts'),stationSha256:sha('game/src/data/demo-station.json'),seed:7654321,station:'zoo',gateModule:'gate-243',gateId:gate.id,rate:gate.rate,passengerId:person.id,speed:person.speed,path,trace,limitations:'One injected passenger, TS graph/A* path; ambient spawning disabled; no other agents.'}
writeFileSync('unity/Assets/StationDesigner/Tests/EditMode/zoo-gate-oracle.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({gateId:gate.id,path:path.length,ticks:trace.length,queuedTick:trace.find(t=>t.queue.length)?.tick,servedTick:trace.find(t=>t.waitCount)?.tick}))
