import { cpSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
const root = resolve(import.meta.dirname, '../..')
const source = resolve(process.argv[2] ?? '')
const output = resolve(process.argv[3] ?? '')
const allowed = resolve(root, '.preview/unity') + sep
if (!process.argv[2] || !process.argv[3] || !output.startsWith(allowed) || !source.startsWith(allowed)) throw Error('Usage: node tools/unity-web/pack.mjs <raw-build> <new-output>, both under .preview/unity')
if (statSync(source).isDirectory() !== true) throw Error('Raw build missing')
if (output.startsWith(source + sep) || source.startsWith(output + sep) || source === output) throw Error('Input and output must not overlap')
const buildReport=JSON.parse(readFileSync(source+'.report.json','utf8'))
const provenance=JSON.parse(readFileSync(source+'.provenance.json','utf8').replace(/^\uFEFF/,''))
if (buildReport.result !== 'Succeeded' || !/^[a-f0-9]{40}$/i.test(provenance.Head ?? '') || !Array.isArray(provenance.Files) || !Array.isArray(provenance.Fixtures)) throw Error('Successful build report and provenance required')
if (provenance.InputsVerifiedAfterBuild !== true || !Array.isArray(provenance.Inputs)) throw Error('Pre-build input snapshot and post-build comparison required')
for (const name of ['OFL.txt','PROVENANCE.txt']) {
  const path=`Assets/StationDesigner/Fonts/${name}`
  const entry=provenance.Inputs.find(input=>input.Path===path)
  const digest=createHash('sha256').update(readFileSync(join(root,'unity',path))).digest('hex')
  if (!entry || digest.toLowerCase()!==entry.SHA256.toLowerCase()) throw Error(`Font attribution digest mismatch: ${path}`)
}
const fixturePaths=readdirSync(join(root,'unity/tests/fixtures')).map(name=>`unity/tests/fixtures/${name}`)
if (fixturePaths.length!==provenance.Fixtures.length || fixturePaths.some(path=>!provenance.Fixtures.some(fixture=>fixture.Path===path))) throw Error('Fixture files do not match provenance')
for (const fixture of provenance.Fixtures) {
  const path=resolve(root,fixture.Path), fixtureRoot=resolve(root,'unity/tests/fixtures')+sep
  if (!path.startsWith(fixtureRoot)) throw Error('Fixture provenance path escapes fixture directory')
  if (createHash('sha256').update(readFileSync(path)).digest('hex').toLowerCase()!==fixture.SHA256.toLowerCase()) throw Error(`Fixture digest mismatch: ${fixture.Path}`)
}
const actualPaths=[]
function inventory(dir) { for (const entry of readdirSync(dir,{withFileTypes:true})) { const path=join(dir,entry.name); if(entry.isDirectory()) inventory(path); else if(entry.isFile()) actualPaths.push(relative(source,path).replaceAll('\\','/')); else throw Error('Unexpected build entry') } }
inventory(source)
const declared=provenance.Files.map(file=>file.Path)
if (new Set(declared).size!==declared.length || actualPaths.length!==declared.length || actualPaths.some(path=>!declared.includes(path))) throw Error('Build files do not match provenance')
for (const file of provenance.Files) {
  const path=resolve(source,file.Path)
  if (!path.startsWith(source+sep)) throw Error('Build provenance path escapes source')
  const bytes=readFileSync(path)
  if (bytes.length!==file.Bytes || createHash('sha256').update(bytes).digest('hex').toLowerCase()!==file.SHA256.toLowerCase()) throw Error(`Build digest mismatch: ${file.Path}`)
}
const buildNames=readdirSync(join(source,'Build'))
for (const suffix of ['.loader.js','.framework.js','.data','.wasm']) if (buildNames.filter(name=>name.endsWith(suffix)).length!==1) throw Error(`Expected one ${suffix} file`)
mkdirSync(output, { recursive: false })
for (const dir of ['Build', 'TemplateData']) cpSync(join(source, dir), join(output, dir), { recursive: true, errorOnExist: true })
cpSync(join(root, 'unity/tests/fixtures'), join(output, 'fixtures'), { recursive: true, errorOnExist: true })
mkdirSync(join(output, 'licenses'))
for (const name of ['OFL.txt','PROVENANCE.txt']) cpSync(join(root,'unity/Assets/StationDesigner/Fonts',name),join(output,'licenses',name),{errorOnExist:true})
let html = readFileSync(join(source, 'index.html'), 'utf8')
if (!html.includes('var buildUrl = "Build"') || !html.includes('TemplateData/')) throw Error('Unexpected Unity template')
html = html.replace('var buildUrl = "Build"', 'var buildUrl = "/game/_unity/Build"').replaceAll('"TemplateData/', '"/game/_unity/TemplateData/')
writeFileSync(join(output, 'index.html'), html)
writeFileSync(join(output,'build-report.json'),JSON.stringify(buildReport,null,2))
writeFileSync(join(output,'provenance.json'),JSON.stringify(provenance,null,2))
// Local-only Wrangler smoke: preserve raw bytes while respecting its per-file cap.
const splitFiles = {}
for (const name of readdirSync(join(output, 'Build'))) {
  const path = join(output, 'Build', name)
  if (statSync(path).size < 25 * 1024 * 1024) continue
  if (!name.endsWith('.wasm')) throw Error(`Unexpected oversized file: ${name}`)
  const bytes = readFileSync(path), parts = []
  for (let offset = 0; offset < bytes.length; offset += 20 * 1024 * 1024) {
    const part = `Build/${name}.part${parts.length}`
    writeFileSync(join(output, part), bytes.subarray(offset, offset + 20 * 1024 * 1024))
    parts.push(part)
  }
  splitFiles[`Build/${name}`] = { parts, bytes: bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') }
  unlinkSync(path)
}
const files=[]
function walk(dir) { for (const entry of readdirSync(dir, {withFileTypes:true})) { const path=join(dir,entry.name); if(entry.isDirectory()) walk(path); else if(entry.isFile()) { const data=readFileSync(path); files.push({path:relative(output,path).replaceAll('\\','/'),bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}) } else throw Error('Unexpected output entry') } }
walk(output)
const manifest={kind:'local-phase-0-smoke',sourceSha:provenance.Head,dirty:provenance.Dirty,packagingHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),packagingDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),splitFiles,files}
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({output,files:files.length,sourceSha:manifest.sourceSha}))
