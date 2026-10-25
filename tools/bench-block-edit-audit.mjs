// Run browser cases sequentially: never let timing captures compete for the host.
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
const directory=resolve(process.env.BENCH_AUDIT_OUTPUT??'.preview/perf/block-edit-audit')
mkdirSync(directory,{recursive:true})
const defaults=['block','wall','half-wall','tri-upper','tri-lower','stair-block'].flatMap(piece=>[`${piece}:place`,`${piece}:delete`]).concat('wall:erase','stair-block:move')
const cases=process.env.BENCH_CASES?.split(',')??defaults
const reports=[]
for(const entry of cases){
  const [piece,action]=entry.split(':'),output=resolve(directory,`${piece}-${action}.json`)
  const retained=process.env.BENCH_RESUME==='1'&&existsSync(output)&&statSync(output).mtimeMs>=statSync(resolve(process.env.BENCH_DIST??'game/dist','index.html')).mtimeMs&&JSON.parse(readFileSync(output,'utf8')).samples.length===5
  if(!retained)execFileSync(process.execPath,['tools/bench-block-commit.mjs'],{stdio:'inherit',env:{...process.env,BENCH_PIECE:piece,BENCH_ACTION:action,BENCH_OUTPUT:output}})
  const report=JSON.parse(readFileSync(output,'utf8')),times=report.samples.map(s=>s.firstRenderMs)
  reports.push({piece,action,first:times[0],worst:Math.max(...times),times,output})
  writeFileSync(resolve(directory,'summary.json'),JSON.stringify(reports,null,2))
}
console.table(reports.map(({piece,action,first,worst})=>({piece,action,first,worst})))
