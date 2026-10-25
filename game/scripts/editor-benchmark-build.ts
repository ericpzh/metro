import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin } from 'vite'

/** Tie the compiled app to the source captured by the browser audit. A matching
 * catalogue alone cannot detect a renderer edit made after the last build. */
export function editorTreeHash(sourceRoot:string):string {
  const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex')
  const walk=(path:string):string[]=>readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))
    .flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name)):[join(path,entry.name)])
  return hash(walk(sourceRoot).map(path=>relative(sourceRoot,path).replaceAll(String.fromCharCode(92),'/')+' '+hash(readFileSync(path))).join(String.fromCharCode(10)))
}

export function editorBenchmarkBuild():Plugin {
  let sourceRoot='',before=''
  return {
    name:'editor-benchmark-build',
    apply:'build',
    configResolved(config){sourceRoot=join(config.root,'src')},
    buildStart(){before=editorTreeHash(sourceRoot)},
    generateBundle(){
      const after=editorTreeHash(sourceRoot)
      if(after!==before)this.error('Game source changed during build; rebuild before benchmarking')
      this.emitFile({type:'asset',fileName:'editor-benchmark-build.json',source:JSON.stringify({schema:1,sourceHash:after})})
    },
  }
}
