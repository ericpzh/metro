import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const tool=fileURLToPath(new URL('../../tools/update-editor-action-matrix.mjs',import.meta.url))

test('latest action matrix merges focused captures, sorts by actual time and preserves missing stages',()=>{
  const dir=mkdtempSync(join(tmpdir(),'metro-matrix-')),refs=join(dir,'.agents/skills/metro-repo/references')
  mkdirSync(refs,{recursive:true})
  try{
    const base={_meta:{fullMatrix:true,sourceHash:'old',buildHash:'old-build',scriptHash:'old-script',samplesPerCase:1,demos:[]}}
    const row=(action,time,status='pass')=>({demo:'zoo',case:'item',action,spec:{category:'decor'},status,firstRenderMs:time,cpuMs:1,iteration:0})
    writeFileSync(join(refs,'editor-action-matrix.jsonl'),[base,row('place',200,'over-budget'),row('drop',90),row('preview',100,'over-budget'),row('pickup',null,'unsupported'),row('delete',220,'over-budget'),row('move-preview',130,'over-budget'),{...row('place',50),case:'obsolete'}].map(JSON.stringify).join('\n')+'\n')
    const report={schema:2,driver:'production-api-to-render',profiled:false,complete:true,generatedAt:'2026-11-01T00:00:00.000Z',sourceHash:'new',buildHash:'new-build',scriptHash:'new-script',samples:2,scope:{fullMatrix:false,demos:['zoo'],caseFilter:['item']},host:{cpu:'test'},reports:[{demo:'zoo',expectedCases:1,manifest:[{id:'item',category:'decor'}],cases:[{id:'item',rows:[row('place',40),{...row('place',80),iteration:1}]}],environment:{gpu:'test'}}]}
    const path=join(dir,'report.json'),run=()=>{
      const result=spawnSync(process.execPath,[tool,path],{cwd:dir,encoding:'utf8'})
      if(result.error)throw result.error
      if(result.status!==0)throw Error(result.stderr)
      return result.stdout
    }
    writeFileSync(path,JSON.stringify(report));run()
    const index=readFileSync(join(refs,'editor-action-matrix.jsonl'),'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(index.length,8)
    assert.deepEqual(index.find(r=>r.action==='place').measurements.map(r=>r.firstRenderMs),[40,80])
    assert.equal(index.find(r=>r.action==='drop').measurements[0].firstRenderMs,90)
    const md=readFileSync(join(refs,'editor-action-matrix.md'),'utf8')
    assert.match(md,/Above 100 ms \(2\)/)
    assert.ok(md.indexOf('| delete | 220.00 ms')<md.indexOf('| move-preview | 130.00 ms'))
    assert.ok(md.indexOf('| preview | 100.00 ms')<md.indexOf('| drop | 90.00 ms'))
    assert.ok(md.indexOf('| drop | 90.00 ms')<md.indexOf('| place | 80.00 ms'))
    assert.match(md,/Unsupported or incomplete \(1\)/)
    report.generatedAt='2026-11-03T00:00:00.000Z';report.reports[0].cases[0].capturedAt='2026-10-29T00:00:00.000Z'
    report.reports[0].cases[0].rows[0].firstRenderMs=250
    writeFileSync(path,JSON.stringify(report));run()
    assert.match(readFileSync(join(refs,'editor-action-matrix.md'),'utf8'),/\| place \| 80.00 ms/,'an older resumed checkpoint cannot overwrite a newer observation')
    delete report.reports[0].cases[0].capturedAt
    report.generatedAt='2026-10-27T00:00:00.000Z';report.reports[0].cases[0].rows[0].firstRenderMs=250
    writeFileSync(path,JSON.stringify(report));run()
    assert.match(readFileSync(join(refs,'editor-action-matrix.md'),'utf8'),/\| place \| 80.00 ms/,'older runs cannot replace newer results')
    report.generatedAt='2026-11-02T00:00:00.000Z';report.scope.fullMatrix=true
    report.reports[0].cases[0].rows=['preview','place','pickup','move-preview','drop','delete'].flatMap(action=>[row(action,40),{...row(action,50),iteration:1}])
    writeFileSync(path,JSON.stringify(report));run()
    assert.doesNotMatch(readFileSync(join(refs,'editor-action-matrix.md'),'utf8'),/obsolete/,'a newer full inventory removes obsolete cases')
    report.complete=false;writeFileSync(path,JSON.stringify(report))
    assert.throws(run, 'incomplete captures cannot publish')
    assert.match(readFileSync(join(refs,'editor-action-matrix.md'),'utf8'),/\| place \| 50.00 ms/)
    report.complete=true;report.reports[0].environment.gpu='SwiftShader'
    writeFileSync(path,JSON.stringify(report))
    assert.throws(run, 'software rendering cannot replace hardware timings')
  }finally{rmSync(dir,{recursive:true,force:true})}
})
