import { createHash } from 'node:crypto'
import { brotliCompressSync, constants as zc } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs'
import { resolve, join, relative, dirname, sep } from 'node:path'
import { buildUnityUI, attachUnityUI } from './unity-ui-pack.mjs'
import { artifactDigest, resourceType, validateReleaseManifest } from './release-contract.mjs'
const root=resolve(import.meta.dirname,'../..'), source=resolve(process.argv[2]??''), output=resolve(process.argv[3]??'')
const allowed=resolve(root,'.preview/unity')+sep
if (!process.argv[2] || !process.argv[3] || !output.startsWith(allowed) || output.startsWith(source+sep) || existsSync(output)) throw Error('Usage: node tools/unity-web/pack-release.mjs <raw-build> <new-output-under-.preview/unity>')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const provenance=JSON.parse(readFileSync(source+'.provenance.json','utf8').replace(/^\uFEFF/,''))
const build=JSON.parse(readFileSync(source+'.report.json','utf8'))
if(build.result!=='Succeeded'||provenance.InputsVerifiedAfterBuild!==true||!Array.isArray(provenance.Files)||!/^[a-f0-9]{40}$/i.test(provenance.Head??'')) throw Error('Successful build and verified provenance required')
const declared=new Map(provenance.Files.map(f=>[f.Path,f]))
const actual=[]
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())walk(path);else if(e.isFile())actual.push(relative(source,path).replaceAll('\\','/'));else throw Error('Unexpected build entry')}}
walk(source)
if(declared.size!==provenance.Files.length||declared.size!==actual.length||actual.some(p=>!declared.has(p)))throw Error('Build inventory differs from provenance')
for(const path of actual){const bytes=readFileSync(join(source,path)),d=declared.get(path);if(bytes.length!==d.Bytes||sha(bytes)!==d.SHA256.toLowerCase())throw Error(`Build digest mismatch: ${path}`)}
const files=[], payloads=new Map()
for(const path of actual.filter(p=>p.startsWith('Build/')||p.startsWith('TemplateData/'))){
 let bytes=readFileSync(join(source,path)),name=path
 if(path.endsWith('.wasm') || (path.endsWith('.data') && bytes.length >= 25 * 1024 * 1024)){bytes=brotliCompressSync(bytes,{params:{[zc.BROTLI_PARAM_QUALITY]:5}});name += '.br'}
 const file={path:name,bytes:bytes.length,sha256:sha(bytes),...resourceType(name)}
 files.push(file);payloads.set(name,bytes)
}
const ui = /\/StationGame[^/]*\.unity$/.test(provenance.Scene ?? '') ? buildUnityUI(root) : null
if (ui) for (const [name, bytes] of ui.files) { files.push({path:name,bytes:bytes.length,sha256:sha(bytes),...resourceType(name)}); payloads.set(name,bytes) }
const artifactSha256=artifactDigest(files),sourceSha=provenance.Head.toLowerCase(),releaseId=`${sourceSha}-${artifactSha256.slice(0,16)}`
const manifest={schemaVersion:1,sourceSha,artifactSha256,releaseId,files}
validateReleaseManifest(manifest,p=>payloads.get(p))
let html=readFileSync(join(source,'index.html'),'utf8')
if(!html.includes('var buildUrl = "Build"')||!html.includes('TemplateData/')||!html.includes('.wasm"'))throw Error('Unexpected Unity template')
html=html.replace('<html lang="en-us">','<html lang="__METRO_LOCALE__">').replaceAll('"TemplateData/','"__METRO_ASSET_BASE__/TemplateData/').replace('var buildUrl = "Build"','var buildUrl = "__METRO_ASSET_BASE__/Build"').replace('.wasm"','.wasm.br"')
if (files.some(file => file.path.endsWith('.data.br'))) html = html.replace('.data"', '.data.br"')
html=html.replace('<head>','<head>\n<script>window.metroLaunch = __METRO_CONFIG__;</script>')
if (ui) html = attachUnityUI(html, ui, '__METRO_ASSET_BASE__')
const temp=output+'.tmp-'+process.pid
try {
 mkdirSync(join(temp,'_unity',releaseId),{recursive:true}); mkdirSync(join(temp,'_unity-shell'),{recursive:true})
 for(const [name,bytes] of payloads){const dest=join(temp,'_unity',releaseId,name);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes)}
 writeFileSync(join(temp,'_unity-shell','index.html'),html)
 writeFileSync(join(temp,'_unity-shell','manifest.json'),JSON.stringify(manifest,null,2))
 mkdirSync(dirname(output),{recursive:true});renameSync(temp,output)
} catch(e){rmSync(temp,{recursive:true,force:true});throw e}
console.log(JSON.stringify({output,releaseId,files:files.length,compressedWasm:files.find(f=>f.path.endsWith('.wasm.br'))?.bytes}))
