// TypeScript oracle for packet H's passenger appearance, gait and activity-arm
// semantics.
//
// The values are produced by the real source modules, not by a second
// implementation of them: `passengerAppearance`, `passengerFrames`,
// `passengerWalkDistance`, `passengerActionMode`, `passengerDisplayedActivity`
// and `passengerActionChannel` from `game/src/render/passengerModel.ts`, and
// `passengerIsChild` / `passengerProportions` / `passengerWalkProfile` /
// `passengerWalkSpeed` from `game/src/sim/walking.ts`. The 440-identity pools
// come from the same module, so their order is the source's order.
//
// Output default: `unity/Assets/StationDesigner/Tests/EditMode/passenger-appearance-oracle.json`,
// which `PassengerCatalogueTests` reads from `Application.dataPath`. It also pins
// the exact library manifest (440 rows) the Unity catalogue is built from, and
// finds the smallest stable simulation ID that selects each named specimen
// recipe (commuter, female skirt, bagged).
//
// Usage (repository root):
//   node tools/unity-parity/record-passenger-appearance.mjs [output.json]
//
// The JSON is shaped for Unity's JsonUtility: one root object, arrays of plain
// objects, no dictionaries and no nulls.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  PASSENGER_ADULT_OUTFITS,
  PASSENGER_CHILD_OUTFITS,
  PASSENGER_LIBRARY,
  PASSENGER_WALK_FRAMES,
  PASSENGER_WALK_PROFILES,
  passengerActionChannel,
  passengerActionMode,
  passengerAppearance,
  passengerDisplayedActivity,
  passengerFrames,
  passengerWalkDistance,
} from '../../game/src/render/passengerModel.ts'
import { ACTIVITY_DURATION, ACTIVITY_NAMES } from '../../game/src/sim/activities.ts'
import {
  passengerIsChild,
  passengerProportions,
  passengerWalkProfile,
  passengerWalkSpeed,
} from '../../game/src/sim/walking.ts'

const args = process.argv.slice(2)
const output = resolve(args.find(a => !a.startsWith('--')) ?? 'unity/Assets/StationDesigner/Tests/EditMode/passenger-appearance-oracle.json')
const manifestPath = 'unity/Assets/StationDesigner/Generated/Passengers/passenger-library.manifest.json'
const manifestBytes = readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes.toString('utf8'))
const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const byRecipe = new Map(manifest.assets.map(asset => [asset.recipe, asset]))
const SPECIMENS = [
  'soft-male-commuter-none',
  'soft-female-tee-skirt-none',
  'soft-female-blouse-skirt-handbag-right',
  'soft-male-commuter-daypack',
  'soft-male-commuter-handbag-left',
]
for (const recipe of SPECIMENS) {
  if (!byRecipe.has(recipe)) throw new Error(`manifest is missing specimen ${recipe}`)
}

// The smallest stable simulation ID that selects each specimen, plus the first
// child and the first adult. Scanning identity only, exactly as the renderer
// does: no simulation RNG is consumed.
const specimenIds = new Map(SPECIMENS.map(recipe => [recipe, -1]))
let firstChild = -1
let firstAdult = -1
for (let id = 0; id < 200000 && (firstChild < 0 || firstAdult < 0 || [...specimenIds.values()].includes(-1)); id++) {
  const outfit = passengerAppearance(id)[0]
  const recipe = PASSENGER_LIBRARY[outfit].id
  if (specimenIds.has(recipe) && specimenIds.get(recipe) < 0) specimenIds.set(recipe, id)
  const child = passengerIsChild(id)
  if (child && firstChild < 0) firstChild = id
  if (!child && firstAdult < 0) firstAdult = id
}
for (const [recipe, id] of specimenIds) if (id < 0) throw new Error(`no simulation id selects ${recipe}`)

const ids = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 31, 32, 63, 73, 219, 220, 439, 1000, 6000, 123456, 2147483647, firstChild, firstAdult])
for (const id of specimenIds.values()) ids.add(id)
const orderedIds = [...ids].sort((a, b) => a - b)

const appearance = orderedIds.map(id => {
  const look = passengerAppearance(id)
  const outfit = look[0]
  const profile = passengerWalkProfile(id)
  return {
    id,
    outfit,
    recipe: PASSENGER_LIBRARY[outfit].id,
    child: passengerIsChild(id),
    height: look[1],
    depth: look[2],
    width: look[3],
    tone: look[4],
    walkProfile: profile,
    walkSpeed: passengerWalkSpeed(id),
    stride: PASSENGER_WALK_PROFILES[profile].stride,
    cycleSeconds: PASSENGER_WALK_PROFILES[profile].cycleSeconds,
  }
})

// Gait: the renderer feeds `travelled / depth` into `passengerFrames` (the
// fore/aft scale changes the physical step), so the oracle records the raw
// travelled distance and the identity-derived depth it divides by.
const gaitId = 7
const gaitLook = passengerAppearance(gaitId)
const gaitDepth = gaitLook[2]
const distances = [0, 0.5, 1.44, 3.7, 10]
const phases = [0, 0.1, 0.33, 0.9]
const weights = [0, 0.5, 1]
const gait = []
for (let profile = 0; profile < PASSENGER_WALK_PROFILES.length; profile++) {
  for (const distance of distances) {
    for (const phase of phases) {
      for (const weight of weights) {
        const frames = passengerFrames(distance / gaitDepth, phase, weight, undefined, profile)
        const firstFrame = PASSENGER_WALK_PROFILES[profile].firstFrame
        const frame = frames[0] - firstFrame + frames[2]
        gait.push({
          profile,
          distance,
          phase,
          weight,
          frameA: frames[0],
          frameB: frames[1],
          blend: frames[2],
          frameWeight: frames[3],
          frame,
          sampleTime: frame / PASSENGER_WALK_FRAMES * PASSENGER_WALK_PROFILES[profile].cycleSeconds,
        })
      }
    }
  }
}

// The hand/arm channel: which side owns the gesture, which escalator-belt clip a
// carried purse switches to, and the packed channel the renderer used.
const actionIds = [7, 73, firstChild]
const activities = []
for (const id of actionIds) {
  const outfit = passengerAppearance(id)[0]
  const profile = passengerWalkProfile(id)
  for (let kind = 0; kind < ACTIVITY_NAMES.length; kind++) {
    for (const time of [0, 3.7, 11.9]) {
      activities.push({
        id,
        kind,
        outfit,
        time,
        mode: passengerActionMode(kind, outfit, id, 0),
        preferredRightMode: passengerActionMode(kind, outfit, id, 1),
        preferredLeftMode: passengerActionMode(kind, outfit, id, 2),
        displayed: passengerDisplayedActivity(kind, outfit, time),
        channel: passengerActionChannel(kind, outfit, id, profile),
      })
    }
  }
}

// Travelled distance by render state: stair travel includes rise, transported
// riders keep planted feet.
const walkDistance = []
for (let state = 0; state <= 9; state++) {
  walkDistance.push({ state, dx: 0.3, dy: 0.4, dz: 0.5, distance: passengerWalkDistance(state, 0.3, 0.4, 0.5) })
}

const childLook = passengerAppearance(firstChild)
const childProportions = passengerProportions(firstChild)

const oracle = {
  schemaVersion: 1,
  generatedBy: 'tools/unity-parity/record-passenger-appearance.mjs',
  sourceSha,
  manifestPath,
  manifestSha256,
  manifestCount: manifest.assets.length,
  manifestAdultRoles: manifest.assets.filter(a => a.role === 'adult').length,
  manifestFullDetails: manifest.assets.filter(a => a.detail === 'full').length,
  recipeSha256: manifest.source.recipeSha256,
  sourceSha256: manifest.source.sha256,
  rights: manifest.rights.status,
  visualScale: 0.98,
  walkFrames: PASSENGER_WALK_FRAMES,
  childChance: 0.2,
  activityNames: [...ACTIVITY_NAMES],
  activityDurations: [...ACTIVITY_DURATION],
  adultPool: [...PASSENGER_ADULT_OUTFITS],
  childPool: [...PASSENGER_CHILD_OUTFITS],
  specimenIds: SPECIMENS.map(recipe => ({ recipe, id: specimenIds.get(recipe) })),
  appearance,
  gait: { id: gaitId, depth: gaitDepth, rows: gait },
  activities,
  walkDistance,
  childSample: {
    id: firstChild,
    child: passengerIsChild(firstChild),
    proportionsHeight: childProportions[0],
    proportionsDepth: childProportions[1],
    proportionsWidth: childProportions[2],
    proportionsTone: childProportions[3],
    height: childLook[1],
    depth: childLook[2],
    width: childLook[3],
    tone: childLook[4],
  },
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(oracle, null, 1) + '\n')
console.log(`PASSENGER_APPEARANCE_ORACLE ${appearance.length} appearances, ${gait.length} gait rows, ${activities.length} activity rows, ${walkDistance.length} walk-distance rows`)
console.log(`PASSENGER_APPEARANCE_IDS firstChild=${firstChild} firstAdult=${firstAdult} ` +
  SPECIMENS.map(r => `${r}=${specimenIds.get(r)}`).join(' '))
console.log(`PASSENGER_APPEARANCE_MANIFEST ${manifest.assets.length} rows sha256=${manifestSha256.slice(0, 12)} rights=${manifest.rights.status}`)
console.log(`wrote ${output}`)
