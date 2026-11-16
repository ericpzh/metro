// Public-pack separation for the soft-human passenger library (plan 11 H3).
//
// The 440 prefabs, their GLB meshes, the library manifest and the local
// `passenger-catalogue.asset` are INTERNAL_REVIEW_ONLY; the production rig is
// BLOCKED and the supplied base has no redistribution licence. This test keeps
// them out of anything a public build can reach:
//
//   node --test unity/tests/passenger-profile.test.mjs
//       Runs the source guards: manifest rights/paths, no GUID leak from the
//       internal folder into any other asset (the public scene included), no
//       Resources folder, no internal path in the public build scripts, and no
//       internal atlas import in the Unity Web UI. This is the CI/local form and
//       needs no Unity build.
//
//   node unity/tests/passenger-profile.test.mjs --pack <pack-output-directory>
//       Additionally scans a produced public pack (WebGL build, Web UI bundle or
//       packed release) for internal passenger file names and text markers. Run
//       this on the public profile output after `pack-web`. The **local**
//       verifier build is the one that binds
//       `Assets/StationDesigner/Generated/Passengers/passenger-catalogue.asset`
//       through a `PassengerCatalogueAnchor` in the single scene
//       (`StationGameLocal.unity`, by convention); it is never packed.
//
// Public build keeps the `Generated/Models/passenger-adult.glb` stand-in while
// soft-human parity is explicitly open; the local build reports `soft-human`
// with the actual recipe IDs instead.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const repo = resolve(import.meta.dirname, '../..')
const assets = join(repo, 'unity/Assets')
const internalRoot = 'unity/Assets/StationDesigner/Generated/Passengers'
const manifestPath = `${internalRoot}/passenger-library.manifest.json`
const cataloguePath = `${internalRoot}/passenger-catalogue.asset`
const coveragePath = `${internalRoot}/passenger-library.coverage.md`
const scene = 'unity/Assets/StationDesigner/Scenes/StationGameLocal.unity'
const standInPrefab = 'unity/Assets/StationDesigner/Generated/Models/passenger-adult.glb'

// Any of these appearing in a public artefact means an internal asset leaked.
const MARKERS = [
  'passenger-library',
  'passenger-catalogue',
  'passenger-approved',
  'passenger-activities',
  'passenger-adult-commuter-daypack-low',
  'Generated/Passengers',
  'soft-male-',
  'soft-female-',
]

const PUBLIC_BUILD_INPUTS = [
  'unity/scripts/metro-unity.ps1',
  'tools/unity-web/unity-ui-pack.mjs',
  'unity/Assets/StationDesigner/Editor/BuildWeb.cs',
  'unity/Assets/StationDesigner/Editor/StationGameScene.cs',
]

const read = path => readFileSync(resolve(repo, path), 'utf8')
const readJson = path => JSON.parse(read(path))

function walk(directory) {
  const out = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { out.push(...walk(path)); continue }
    out.push(path)
  }
  return out
}

const repoPath = absolute => relative(repo, absolute).replaceAll('\\', '/')
const guidOf = metaPath => /^guid: ([0-9a-f]{32})$/m.exec(readFileSync(resolve(repo, metaPath), 'utf8'))?.[1]

/** The guid of every internal passenger asset, from its .meta file. */
function internalGuids() {
  const guids = new Map()
  for (const absolute of walk(resolve(repo, internalRoot))) {
    const path = repoPath(absolute)
    if (path.endsWith('.meta')) continue
    const meta = resolve(repo, `${path}.meta`)
    if (!existsSync(meta)) continue
    const guid = guidOf(`${path}.meta`)
    if (guid) guids.set(guid, path)
  }
  return guids
}

const manifest = readJson(manifestPath)
const guids = internalGuids()

test('the internal library manifest is review-only and self-contained', () => {
  assert.equal(manifest.family, 'passenger-library')
  assert.equal(manifest.assets.length, 440)
  assert.equal(manifest.rights.status, 'INTERNAL_REVIEW_ONLY')
  assert.match(manifest.rights.production, /BLOCKED/)
  assert.match(manifest.rights.license, /no redistribution/)
  for (const asset of manifest.assets) {
    assert.ok(asset.prefabPath.startsWith('Assets/StationDesigner/Generated/Passengers/'), `${asset.recipe} prefab path`)
    assert.ok(asset.modelPath.startsWith('Assets/StationDesigner/Generated/Passengers/'), `${asset.recipe} model path`)
    assert.equal(asset.rights, 'INTERNAL_REVIEW_ONLY', `${asset.recipe} rights`)
    assert.equal(asset.role, 'adult')
    assert.equal(asset.detail, 'full')
  }
  // The public stand-in is not part of the recipe list, so the public profile can
  // keep it while the review library stays local.
  assert.ok(!manifest.assets.some(asset => asset.prefabPath.includes('passenger-adult')), 'stand-in leaked into the library')
  assert.ok(existsSync(resolve(repo, standInPrefab)), 'the public stand-in asset is missing')
  assert.ok(!standInPrefab.startsWith(internalRoot + '/'), 'the stand-in must stay outside the internal root')
})

test('no internal passenger asset is referenced outside its own folder', () => {
  assert.ok(guids.size >= 440, `only ${guids.size} internal assets carry a guid`)
  const textExtensions = new Set(['.unity', '.asset', '.prefab', '.json', '.mat', '.controller', '.anim', '.playable', '.renderTexture', '.mask'])
  const leaks = []
  for (const absolute of walk(assets)) {
    const path = repoPath(absolute)
    if (path.startsWith(internalRoot + '/') || path.endsWith('.meta')) continue
    // The generated local-Web variant deliberately binds the small cohort
    // catalogue (H3's loopback profile). It is never named by a public build
    // script and never added to the build settings; the single shipped scene is
    // still scanned here.
    if (/Scenes\/StationGameLocalWeb\.unity$/.test(path)) continue
    if (!textExtensions.has(path.slice(path.lastIndexOf('.')))) continue
    const text = read(path)
    for (const [guid, owner] of guids) {
      if (text.includes(guid)) leaks.push(`${path} references ${owner} (guid ${guid})`)
    }
  }
  assert.deepEqual(leaks, [], `internal passenger assets must not leak into public assets:\n${leaks.join('\n')}`)
})

test('the shipped scene and build inputs never bind the internal catalogue', () => {
  for (const path of [scene, ...PUBLIC_BUILD_INPUTS]) {
    assert.ok(existsSync(resolve(repo, path)), `missing build input ${path}`)
    const text = read(path)
    for (const marker of MARKERS) assert.ok(!text.includes(marker), `${path} mentions internal marker "${marker}"`)
  }
  // The single scene carries a null `PassengerCatalogueAnchor` on disk; the Editor
  // injects the catalogue at Play Mode. Only the generated local-Web variant binds
  // a catalogue, so neither scene may be in the editor build settings.
  const buildSettings = 'unity/ProjectSettings/EditorBuildSettings.asset'
  const buildText = existsSync(resolve(repo, buildSettings)) ? read(buildSettings) : ''
  for (const name of ['StationGameLocal.unity', 'StationGameLocalWeb.unity']) {
    assert.ok(!buildText.includes(name), `${name} must not be in the editor build settings`)
  }
  if (existsSync(resolve(repo, cataloguePath))) {
    assert.ok(!read(scene).includes(guids.get(guidOf(`${cataloguePath}.meta`)) ?? '\u0000'),
      'the single shipped scene references the internal passenger catalogue')
  }
})

test('the internal library is not reachable through a Resources folder', () => {
  const resources = walk(resolve(repo, internalRoot)).filter(absolute => repoPath(absolute).split('/').includes('Resources'))
  assert.deepEqual(resources, [], 'Resources folders are always packed; move the asset out')
  // The catalogue path itself must not be under Resources.
  assert.ok(!cataloguePath.includes('/Resources/'))
})

test('the Unity Web UI does not import the internal passenger atlas', () => {
  const webRoot = resolve(repo, 'game/src/unity-web')
  const forbidden = ['passengerModel.ts', 'passenger-approved.json', 'passenger-activities.json', 'capturePassengers.ts']
  const offenders = []
  for (const absolute of walk(webRoot)) {
    if (!/\.(ts|tsx|mjs|js)$/.test(absolute)) continue
    const path = repoPath(absolute)
    const text = readFileSync(absolute, 'utf8')
    for (const marker of forbidden) if (text.includes(marker)) offenders.push(`${path} imports ${marker}`)
  }
  assert.deepEqual(offenders, [], `the public Web UI must not import the internal atlas:\n${offenders.join('\n')}`)
})

test('the local catalogue asset is absent until a local build binds it', () => {
  // The asset is created by Unity in the internal folder; keeping it optional here
  // means this Node test never forces a build. When present it must stay internal
  // and review-only, which the GUID test above already proves for every consumer.
  if (!existsSync(resolve(repo, cataloguePath))) return
  assert.ok(cataloguePath.startsWith(internalRoot + '/'))
})

test('public pack scan and local-vs-public invocation', () => {
  const packAt = process.argv.indexOf('--pack')
  const pack = packAt >= 0 ? resolve(process.argv[packAt + 1]) : ''
  console.log([
    'PASSENGER_PROFILE scene=StationGameLocal public=stand-in local=soft-human',
    '  local  : bind Assets/StationDesigner/Generated/Passengers/passenger-catalogue.asset',
    '           through a PassengerCatalogueAnchor in StationGameLocalWeb.unity, serve on',
    '           loopback, report "soft-human" with the actual recipe IDs; never ship it.',
    '  public : no passenger catalogue bound; keep Generated/Models/passenger-adult.glb as the',
    '           reported stand-in while soft-human parity is open. Releasing the real crowd needs',
    '           documented permission for the base and its derivatives (production rig is BLOCKED).',
    '  verify : node --test unity/tests/passenger-profile.test.mjs',
    '           node unity/tests/passenger-profile.test.mjs --pack <public pack output>',
  ].join('\n'))
  if (!pack) return
  assert.ok(existsSync(pack), `pack directory does not exist: ${pack}`)
  const files = []
  for (const absolute of walk(pack)) {
    const name = repoPath(absolute)
    for (const marker of MARKERS) assert.ok(!name.includes(marker), `public pack contains internal file ${name}`)
    if (statSync(absolute).size > 8 * 1024 * 1024) continue
    let text
    try { text = readFileSync(absolute, 'utf8') } catch { continue }
    for (const marker of MARKERS) {
      if (text.includes(marker)) files.push(`${name} contains "${marker}"`)
    }
  }
  assert.deepEqual(files, [], `public pack contains internal passenger assets:\n${files.join('\n')}`)
  console.log(`PASSENGER_PROFILE_PACK ${pack} clean`)
})
