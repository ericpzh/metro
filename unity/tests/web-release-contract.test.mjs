import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { artifactDigest, classifyGamePath, resourceType, validateReleaseManifest } from '../../tools/unity-web/release-contract.mjs'

const sourceSha = 'a'.repeat(40)
const digest = value => createHash('sha256').update(value).digest('hex')
function fixture() {
  const bytes = new Map(['Build/game.loader.js','Build/game.framework.js','Build/game.wasm','Build/game.data'].map(path => [path,Buffer.from(path)]))
  const files = [...bytes].map(([path,data]) => ({path,bytes:data.length,sha256:digest(data),...resourceType(path)}))
  const artifactSha256 = artifactDigest(files)
  return {bytes,manifest:{sourceSha,artifactSha256,releaseId:`${sourceSha}-${artifactSha256.slice(0,16)}`,files}}
}

test('release manifest binds every byte and stable sorted resource metadata', () => {
  const {bytes,manifest} = fixture()
  assert.equal(validateReleaseManifest(manifest, p=>bytes.get(p)).files,4)
  assert.equal(artifactDigest([...manifest.files].reverse()),manifest.artifactSha256)
  bytes.set('Build/game.data',Buffer.from('tampered'))
  assert.throws(()=>validateReleaseManifest(manifest,p=>bytes.get(p)),/digest mismatch/)
})

test('release manifest rejects duplicate, missing, unsafe and oversized resources', () => {
  const {manifest} = fixture()
  assert.throws(()=>validateReleaseManifest({...manifest,files:[...manifest.files,manifest.files[0]]}),/Duplicate/)
  assert.throws(()=>validateReleaseManifest({...manifest,files:manifest.files.slice(1)}),/Expected exactly one/)
  assert.throws(()=>resourceType('../game.wasm'),/Invalid resource/)
  assert.throws(()=>resourceType('Build/game.symbols.json'),/Invalid resource/)
  assert.throws(()=>resourceType('Library/cache.json'),/Invalid resource/)
  assert.throws(()=>resourceType('Build/game.symbols.json.unknown'),/Unrecognized/)
  assert.throws(()=>validateReleaseManifest({...manifest,files:manifest.files.map((f,i)=>i?f:{...f,bytes:25*1024*1024})}),/Invalid resource metadata/)
  assert.deepEqual(resourceType('Build/game.wasm.br'),{contentType:'application/wasm',compression:'br'})
})

test('route contract preserves mount, locale and known demo routes', () => {
  for (const mount of ['/game','']) {
    const route = p=>classifyGamePath(mount+p,{mount})
    assert.deepEqual(route('/'),{kind:'document',mount,locale:'zh-CN',demoId:null,engine:'unity'})
    assert.equal(route('/en/').locale,'en')
    assert.equal(route('/en/tianhe').demoId,'tianhe')
    assert.deepEqual(route('/en/tianhe/'),{kind:'redirect',path:mount+'/en/tianhe'})
    assert.equal(route('/legacy/en/zoo').engine,'legacy')
    assert.equal(route('/benchmark/en').kind,'legacy-tool')
    assert.equal(route('/unknown').kind,'not-found')
    assert.equal(route('/_unity/missing/file').kind,'not-found')
    assert.equal(route('/_unity/'+sourceSha+'-'+ 'b'.repeat(16)+'/Build/a.wasm').kind,'unity-asset')
  }
  assert.equal(classifyGamePath('/gameplay').kind,'outside')
  assert.equal(classifyGamePath('/en/game/').kind,'outside')
  assert.equal(classifyGamePath('/game/%2e%2e/stats').kind,'not-found')
  assert.equal(classifyGamePath('/game/en%2fzoo').kind,'not-found')
  assert.equal(classifyGamePath('/game/_unity-shell/..%2Fsecret').kind,'not-found')
  assert.deepEqual(classifyGamePath('/game/en'),{kind:'redirect',path:'/game/en/'})
})
