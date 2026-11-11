import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {deepStrictEqual} from 'node:assert/strict'
const browserStep=readFileSync('tools/unity-feasibility/ts-workload.mjs','utf8').match(/function step\(\)\{[^\n]+/)
const nodeStep=readFileSync(new URL(import.meta.url),'utf8').match(/function step\(\)\{[^\n]+/)
if (!browserStep || !nodeStep || browserStep[0]!==nodeStep[0]) throw Error('Browser and fixed-tick step algorithms differ')
const base='.preview/unity/feasibility/',buffer=readFileSync(base+'graph.bytes');let p=0
const integer=()=>{let v=buffer.readInt32LE(p);p+=4;return v},float=()=>{let v=buffer.readFloatLE(p);p+=4;return v}
if(integer()!==0x4d475231)throw Error('Invalid graph');const n=integer(),e=integer(),servers=integer()
const floats=k=>Float32Array.from({length:k},float),ints=k=>Int32Array.from({length:k},integer)
const x=floats(n),y=floats(n),z=floats(n),starts=ints(n+1),edges=ints(e),serverNodes=new Int32Array(servers),rates=new Float32Array(servers)
for(let i=0;i<servers;i++){serverNodes[i]=integer();rates[i]=float()}if(p!==buffer.length)throw Error('Invalid length')
const population=5171,cap=128,floor=[];for(let i=0;i<n;i++)if(Math.abs(z[i]+5)<.01)floor.push(i)
const nodes=new Int32Array(population),agentQueue=new Int32Array(population).fill(-1),heads=new Int32Array(servers),lengths=new Int32Array(servers),credits=new Float32Array(servers),queue=new Int32Array(servers*cap)
for(let i=0;i<population;i++)nodes[i]=floor[(Math.imul(i,2654435761)>>>0)%floor.length]
let tick=0,queued=0,admitted=0,completed=0
function step(){tick++;for(let s=0;s<servers;s++){credits[s]=Math.min(8,Math.fround(credits[s]+Math.max(0,rates[s])));let capacity=Math.min(8,Math.floor(credits[s]));credits[s]=Math.fround(credits[s]-capacity);while(capacity-->0&&lengths[s]>0){let id=queue[s*cap+heads[s]];heads[s]=(heads[s]+1)%cap;lengths[s]--;agentQueue[id]=-1;queued--;completed++}}for(let i=0;i<population;i++){if(agentQueue[i]>=0)continue;let node=nodes[i];if((i+tick)%97===0){let s=((Math.imul(i,2654435761)+tick)>>>0)%servers;if(serverNodes[s]>=0&&serverNodes[s]<n&&lengths[s]<cap){nodes[i]=serverNodes[s];queue[s*cap+(heads[s]+lengths[s])%cap]=i;lengths[s]++;agentQueue[i]=s;queued++;admitted++;continue}}let count=starts[node+1]-starts[node];if(count>0)nodes[i]=edges[starts[node]+(((Math.imul(i,1103515245)+Math.imul(tick,12345))>>>0)%count)]}}
for(let i=0;i<512;i++)step()
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex')
const result={tick,queued,admitted,completed,nodes:hash(nodes),agentQueue:hash(agentQueue),heads:hash(heads),lengths:hash(lengths),credits:hash(credits),queue:hash(queue)}
writeFileSync(base+'fixed-ts.json',JSON.stringify(result,null,2)+'\n')
const expected=JSON.parse(readFileSync(base+'fixed-cs.json','utf8'));deepStrictEqual(result,expected);console.log('C# and TypeScript synthetic state matched at tick 512')

