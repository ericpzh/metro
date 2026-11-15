// Plan 19 §2.1 & §4.1 oracle — standalone exploded-view floor classification,
// packing, front-wall perimeter, module/lift ownership, passenger support,
// lift pose clamping, and dashed vertical-circulation connectors from TypeScript.
//
// Reads the exported demo envelopes (`zoo`, `tanwei`, `tianhe`) plus deterministic
// synthetic fixtures, runs the real TypeScript functions (`explodedView`,
// `ExplodedConnections`, `explodedPassengerSupport`, `explodedLiftPoses`), and
// writes `unity/Assets/StationDesigner/Tests/EditMode/station-exploded-view-oracle.json`.
//
// Usage: node tools/unity-parity/record-station-exploded-view.mjs [--out <path>]

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as THREE from '../../game/node_modules/three/build/three.module.js'
import { parse, serialize } from '../../game/src/persistence/save.ts'
import { toData, toState } from '../../game/src/build/model.ts'
import { emptyStation } from '../../game/src/data/reference-station.ts'
import { STOREY_HEIGHT, storeyBand } from '../../game/src/sim/constants.ts'
import { isWallMounted, moduleEnvelope } from '../../game/src/sim/placement.ts'
import {
  EXPLODED_LIFT_ABSENT,
  explodedLiftPoses,
  explodedView,
} from '../../game/src/render/explodedView.ts'
import { ExplodedConnections } from '../../game/src/render/explodedConnections.ts'
import { explodedPassengerSupport } from '../../game/src/render/explodedPassengers.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const DEFAULT_OUT = 'unity/Assets/StationDesigner/Tests/EditMode/station-exploded-view-oracle.json'

const DEMO_FILES = [
  { id: 'zoo', path: 'unity/Assets/StationDesigner/Demos/zoo.metro.json' },
  { id: 'tanwei', path: 'unity/Assets/StationDesigner/Demos/tanwei.metro.json' },
  { id: 'tianhe', path: 'unity/Assets/StationDesigner/Demos/tianhe.metro.json' },
]

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const outPath = resolve(ROOT, args.get('--out') ?? DEFAULT_OUT)

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const round = (value) => (Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value)
const point3 = (p) => [round(p.x), round(p.y), round(p.z)]

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function fileSha(relPath) {
  try {
    return sha256(readFileSync(resolve(ROOT, relPath), 'utf8'))
  } catch {
    return 'missing'
  }
}

function unpackPackedKey(packed) {
  const OFF = 4096
  const SPAN = 8192
  const z = (packed % SPAN) - OFF
  const rem = Math.floor(packed / SPAN)
  const y = (rem % SPAN) - OFF
  const x = Math.floor(rem / SPAN) - OFF
  return [x, y, z]
}

function sortTriples(triples) {
  return [...triples].sort((a, b) => a[2] - b[2] || a[0] - b[0] || a[1] - b[1])
}

function digestTriples(triples) {
  const sorted = sortTriples(triples)
  return sha256(sorted.map(([x, y, z]) => `${x},${y},${z}`).join('\n'))
}

function recordStationCase(id, data, extraMeta = {}, includeFullLists = false) {
  const base = data.levelBase ?? 0
  const band = (z) => storeyBand(z, base, STOREY_HEIGHT)
  const result = explodedView(data)
  const { levels, offsets, direction } = result
  const [dx, dy] = direction

  const frontWallPackedSet = new Set(
    result.frontWalls.map((c) => `${c.x},${c.y},${c.z}`),
  )

  const cellsByLevel = new Map(levels.map((z) => [z, []]))
  const frontWallsByLevel = new Map(levels.map((z) => [z, []]))

  for (const c of result.data.cells) {
    const level = band(c.z)
    const offset = offsets.get(level) ?? 0
    const sx = c.x - dx * offset
    const sy = c.y - dy * offset
    cellsByLevel.get(level)?.push([sx, sy, c.z])
    if (frontWallPackedSet.has(`${c.x},${c.y},${c.z}`)) {
      frontWallsByLevel.get(level)?.push([sx, sy, c.z])
    }
  }

  // Recover each retained piece's owning level from its applied shift (or band when shift == 0).
  const sourceById = new Map(data.modules.map((m) => [m.id, m]))
  const modulePieces = result.data.modules.map((piece) => {
    const liftMatch = /^(.+):exploded:(-?\d+)$/.exec(piece.id)
    if (liftMatch) {
      const baseId = liftMatch[1]
      const ownerLevel = Number(liftMatch[2])
      return {
        id: piece.id,
        sourceId: baseId,
        type: piece.type,
        ownerLevel,
        isLiftSlice: true,
        fromZ: round(piece.from.z),
        toZ: round(piece.to.z),
      }
    }
    const src = sourceById.get(piece.id)
    let ownerLevel = band(piece.z)
    if (src) {
      const shiftX = piece.x - src.x
      const shiftY = piece.y - src.y
      const shift = dx !== 0 ? shiftX / dx : dy !== 0 ? shiftY / dy : 0
      // Match the exact owner computation in explodedView.ts:
      const matchingLevels = levels.filter((lvl) => (offsets.get(lvl) ?? 0) === shift)
      if (matchingLevels.length === 1) {
        ownerLevel = matchingLevels[0]
      } else {
        // Disambiguate zero-offset levels using the exact midpoint rule via a synthetic probe if needed,
        // or check matchingLevels against band(src.z).
        const probeOffsets = explodedView({
          ...data,
          // Keep identical cells/modules; only read piece owner when multiple levels share shift 0:
        })
        void probeOffsets
        // Since shift === 0 only happens on the lowest level(s) that don't overlap in XY, check if src is wall-mounted:
        for (const candidate of matchingLevels) {
          if (candidate === band(src.z)) ownerLevel = candidate
        }
        // Check if wall-mounted panel midpoint pushed it up a storey:
        if (matchingLevels.length > 1 && ['sign', 'billboard', 'calligraphy', 'linemap', 'glass', 'monitor'].includes(src.type)) {
          // Test with an extra dummy floor cell far below so every level gets a distinct non-zero shift if needed:
          // Actually, only levels that do NOT overlap in XY can share offset 0, and a wall-mounted module at (src.x, src.y)
          // shares XY with the wall at its own column! Wait: let's compute exact owner by shifting one level in a custom check?
          // Even simpler: import isWallMounted & moduleEnvelope from placement.ts!
        }
      }
    }
    return {
      id: piece.id,
      sourceId: piece.id,
      type: piece.type,
      ownerLevel,
      isLiftSlice: false,
      fromZ: piece.from ? round(piece.from.z) : null,
      toZ: piece.to ? round(piece.to.z) : null,
    }
  })

  // Build ExplodedConnections exactly as SceneRenderer.enableExplodedLayout does (lines 109-111):
  const visibleIds = new Set(result.data.modules.map((m) => m.id))
  const retainedSourceModules = data.modules.filter(
    (m) => visibleIds.has(m.id) || (m.type === 'lift' && [...visibleIds].some((vid) => vid.startsWith(`${m.id}:exploded:`))),
  )
  const zeroShifts = levels.map(() => new THREE.Vector3(0, 0, 0))
  const connectionsObj = new ExplodedConnections(
    retainedSourceModules,
    levels,
    offsets,
    direction,
    zeroShifts,
    levels.map(() => true),
  )
  const guides = connectionsObj.connections.map((c) => {
    const src = sourceById.get(c.moduleId)
    return {
      moduleId: c.moduleId,
      kind: src?.type ?? 'unknown',
      lowerIndex: c.lower,
      upperIndex: c.upper,
      lowerLevel: levels[c.lower],
      upperLevel: levels[c.upper],
      point: point3(c.point),
    }
  })
  connectionsObj.dispose()

  const guideCounts = {
    total: guides.length,
    stair: guides.filter((g) => g.kind === 'stair').length,
    escalator: guides.filter((g) => g.kind === 'escalator').length,
    lift: guides.filter((g) => g.kind === 'lift').length,
  }

  // Passenger support in packed space (exact call from ExplodedView.tsx line 209):
  const supportSet = explodedPassengerSupport(result.data, offsets, direction)
  const supportTriples = sortTriples([...supportSet].map(unpackPackedKey))

  const packedOffsets = levels.map((z) => offsets.get(z) ?? 0)

  const trays = levels.map((z) => {
    const cells = sortTriples(cellsByLevel.get(z) ?? [])
    const frontWalls = sortTriples(frontWallsByLevel.get(z) ?? [])
    const ownedPieces = modulePieces
      .filter((p) => p.ownerLevel === z)
      .sort((a, b) => a.id.localeCompare(b.id))
    const tray = {
      level: z,
      packedOffset: offsets.get(z) ?? 0,
      cellCount: cells.length,
      cellDigest: digestTriples(cells),
      frontWallCount: frontWalls.length,
      frontWallDigest: digestTriples(frontWalls),
      pieceCount: ownedPieces.length,
      pieceIdsDigest: sha256(ownedPieces.map((p) => p.id).join('\n')),
    }
    if (includeFullLists) {
      tray.cells = cells
      tray.frontWalls = frontWalls
      tray.pieceIds = ownedPieces.map((p) => p.id)
    }
    return tray
  })

  return {
    id,
    ...extraMeta,
    levelBase: base,
    levels,
    direction: [direction[0], direction[1]],
    packedOffsets,
    totalRetainedCells: result.data.cells.length,
    totalFrontWalls: result.frontWalls.length,
    retainedSourceModuleIds: retainedSourceModules.map((m) => m.id).sort(),
    liftSlices: modulePieces
      .filter((p) => p.isLiftSlice)
      .map((p) => ({ id: p.id, sourceId: p.sourceId, ownerLevel: p.ownerLevel, fromZ: p.fromZ, toZ: p.toZ })),
    trays,
    guideCounts,
    guides,
    passengerSupportCount: supportTriples.length,
    passengerSupportDigest: digestTriples(supportTriples),
    ...(includeFullLists ? { passengerSupport: supportTriples } : {}),
  }
}

function exactOwnerLevel(src, base) {
  const band = (z) => storeyBand(z, base, STOREY_HEIGHT)
  const box = isWallMounted(src) && ['sign', 'billboard', 'calligraphy', 'linemap', 'glass', 'monitor'].includes(src.type)
    ? moduleEnvelope(src)
    : null
  return box ? band((box.z0 + box.z1) / 2) : band(src.z)
}

function recordExactCase(id, data, extraMeta = {}, includeFullLists = false) {
  const baseRecord = recordStationCase(id, data, extraMeta, includeFullLists)
  const base = data.levelBase ?? 0
  const result = explodedView(data)
  const sourceById = new Map(data.modules.map((m) => [m.id, m]))
  const exactPieces = result.data.modules.map((piece) => {
    const liftMatch = /^(.+):exploded:(-?\d+)$/.exec(piece.id)
    if (liftMatch) {
      return {
        id: piece.id,
        sourceId: liftMatch[1],
        type: piece.type,
        ownerLevel: Number(liftMatch[2]),
        isLiftSlice: true,
        fromZ: round(piece.from.z),
        toZ: round(piece.to.z),
      }
    }
    const src = sourceById.get(piece.id)
    return {
      id: piece.id,
      sourceId: piece.id,
      type: piece.type,
      ownerLevel: exactOwnerLevel(src, base),
      isLiftSlice: false,
      fromZ: piece.from ? round(piece.from.z) : null,
      toZ: piece.to ? round(piece.to.z) : null,
    }
  })

  for (const tray of baseRecord.trays) {
    const owned = exactPieces
      .filter((p) => p.ownerLevel === tray.level)
      .sort((a, b) => a.id.localeCompare(b.id))
    tray.pieceCount = owned.length
    tray.pieceIdsDigest = sha256(owned.map((p) => p.id).join('\n'))
    if (includeFullLists) {
      tray.pieceIds = owned.map((p) => p.id)
    }
  }
  baseRecord.wallMountedOwners = exactPieces
    .filter((p) => !p.isLiftSlice)
    .filter((p) => {
      const src = sourceById.get(p.sourceId)
      return src && ['sign', 'billboard', 'calligraphy', 'linemap', 'glass', 'monitor'].includes(src.type)
    })
    .map((p) => ({ id: p.id, type: p.type, anchorZ: sourceById.get(p.sourceId).z, ownerLevel: p.ownerLevel }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return baseRecord
}

/* ------------------------------------------------------------------ demos */

const demos = DEMO_FILES.map(({ id, path }) => {
  const text = readFileSync(resolve(ROOT, path), 'utf8')
  const parsed = parse(text)
  if (!parsed.ok) throw new Error(`${path} failed to parse: ${parsed.error}`)
  const data = toData(toState(parsed.state))
  return recordExactCase(id, data, { path, textSha256: sha256(text) }, false)
})

/* ------------------------------------------------------ synthetic fixtures */

function buildRectCells(x0, y0, x1, y1, z, extra = {}) {
  const out = []
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      out.push({ x, y, z, fill: 'solid', ...extra })
    }
  }
  return out
}

function buildPerimeterWalls(x0, y0, x1, y1, zBase, courses = 4) {
  const out = []
  for (let dz = 1; dz <= courses; dz++) {
    const z = zBase + dz
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) {
          out.push({ x, y, z, fill: 'solid', tags: ['wall'] })
        }
      }
    }
  }
  return out
}

function normalizeFixture(raw) {
  const state = toState({ ...emptyStation(), ...raw })
  const saved = serialize(state)
  const reparsed = parse(saved)
  if (!reparsed.ok) throw new Error('fixture failed round-trip: ' + reparsed.error)
  return { data: toData(toState(reparsed.state)), normalizedJson: saved }
}

// 1. Minimal two-floor underground station (-10 platform, -5 concourse, 0 street with exit)
//    Includes 2x2x3 solid infill core + 1-cell thin branch, front walls on +x/-y,
//    and wall-mounted sign/billboard/calligraphy/linemap/glass/monitor (including high panel crossing band).
const fixtureTwoFloor = (() => {
  const cells = [
    ...buildRectCells(0, 0, 12, 8, -10, { zone: 'platform' }),
    ...buildPerimeterWalls(0, 0, 12, 8, -10, 4),
    // 2x2x3 plain concrete infill block at (2..3, 2..3, -9..-7) + a 1-cell thin spur at (4, 2, -9..-7)
    ...buildRectCells(2, 2, 3, 3, -9),
    ...buildRectCells(2, 2, 3, 3, -8),
    ...buildRectCells(2, 2, 3, 3, -7),
    { x: 4, y: 2, z: -9, fill: 'solid' },
    { x: 4, y: 2, z: -8, fill: 'solid' },
    { x: 4, y: 2, z: -7, fill: 'solid' },
    // Concourse at -5 with untagged ceiling course at -6 over non-infill cells (should be stripped)
    { x: 6, y: 4, z: -6, fill: 'solid' },
    ...buildRectCells(0, 0, 12, 8, -5, { zone: 'unpaid' }),
    ...buildPerimeterWalls(0, 0, 12, 8, -5, 4),
    // Street plate at 0 (not a room, should be stripped)
    ...buildRectCells(-2, -2, 14, 10, 0),
  ]
  const modules = [
    { id: 'trk-1', type: 'track', x: 0, y: 7, z: -10, rot: 0, w: 12, d: 2, cfg: { line: 'L1', tunnel: true } },
    { id: 'psd-1', type: 'platform-edge', x: 0, y: 6, z: -10, rot: 0, w: 12, cfg: { line: 'L1', psd: 'full' } },
    { id: 'stair-1', type: 'stair', x: 5, y: 3, z: -10, rot: 1, from: { x: 5, y: 3, z: -10 }, to: { x: 10, y: 3, z: -5 }, cfg: { style: 'straight', width: 1.36 } },
    { id: 'esc-1', type: 'escalator', x: 2, y: 5, z: -10, rot: 1, from: { x: 2, y: 5, z: -10 }, to: { x: 11, y: 5, z: -5 }, cfg: { incline: 30, dir: 'up', width: 1 } },
    { id: 'lift-1', type: 'lift', x: 9, y: 1, z: -10, rot: 0, from: { x: 9, y: 1, z: -10 }, to: { x: 9, y: 1, z: -5 }, cfg: { size: 2 } },
    { id: 'esc-exit', type: 'escalator', x: 2, y: 4, z: -5, rot: 1, from: { x: 2, y: 4, z: -5 }, to: { x: 11, y: 4, z: 0 }, cfg: { incline: 30, dir: 'up', width: 2 } },
    { id: 'exit-a', type: 'exit', x: 11, y: 4, z: 0, rot: 1, cfg: { name: 'A', inRate: 600, open: true, covered: true, bays: 2 } },
    { id: 'gate-1', type: 'gate', x: 6, y: 4, z: -5, rot: 0, cfg: { mode: 'in', door: 'lane' } },
    // Wall-mounted modules: anchor at z = -7 (course 3 of -10 band) so midpoint (-7 + 1 + 1.65 = -4.35) lands in -5 band!
    { id: 'sign-wall-cross', type: 'sign', x: 1, y: 1, z: -7, rot: 0, cfg: { mount: 'wall' } },
    { id: 'sign-wall-own', type: 'sign', x: 1, y: 1, z: -10, rot: 0, cfg: { mount: 'wall' } },
    { id: 'bb-1', type: 'billboard', x: 3, y: 1, z: -7, rot: 0, w: 2, cfg: { variant: 'standard' } },
    { id: 'cal-1', type: 'calligraphy', x: 6, y: 1, z: -7, rot: 0, w: 3, panelH: 1, cfg: { style: 'kai', axis: 'h' } },
    { id: 'lmap-wall', type: 'linemap', x: 9, y: 1, z: -7, rot: 0, w: 2, cfg: { mount: 'wall' } },
    { id: 'mon-wall', type: 'monitor', x: 11, y: 1, z: -7, rot: 0, w: 1, cfg: { mount: 'wall' } },
    // Exterior road/tree at z = 0 (must be discarded)
    { id: 'tree-ext', type: 'tree', x: -1, y: -1, z: 0, rot: 0, cfg: {} },
  ]
  const lines = [{ id: 'L1', name: '1号线', nameEn: 'Line 1', color: '#f2c94c', stock: 'B', cars: 6, power: 'overhead', psd: 'full', direction: 'right', upTerminus: 'A', downTerminus: 'B' }]
  return normalizeFixture({ name: '二层测试站', levelBase: 0, cells, modules, lines })
})()

// 2. Shifted levelBase = 2 (-8, -3, 2)
const fixtureShiftedBase = (() => {
  const cells = [
    ...buildRectCells(0, 0, 10, 6, -8, { zone: 'platform' }),
    ...buildPerimeterWalls(0, 0, 10, 6, -8, 4),
    ...buildRectCells(0, 0, 10, 6, -3, { zone: 'paid' }),
    ...buildPerimeterWalls(0, 0, 10, 6, -3, 4),
    ...buildRectCells(0, 0, 10, 6, 2, { zone: 'unpaid' }),
    ...buildPerimeterWalls(0, 0, 10, 6, 2, 4),
  ]
  const modules = [
    { id: 'stair-b1', type: 'stair', x: 2, y: 2, z: -8, rot: 1, from: { x: 2, y: 2, z: -8 }, to: { x: 7, y: 2, z: -3 }, cfg: { style: 'straight', width: 1.36 } },
    { id: 'stair-b2', type: 'stair', x: 2, y: 4, z: -3, rot: 1, from: { x: 2, y: 4, z: -3 }, to: { x: 7, y: 4, z: 2 }, cfg: { style: 'straight', width: 1.36 } },
    { id: 'lift-b', type: 'lift', x: 8, y: 2, z: -8, rot: 0, from: { x: 8, y: 2, z: -8 }, to: { x: 8, y: 2, z: 2 }, cfg: { size: 2 } },
  ]
  return normalizeFixture({ name: '基准偏移站', levelBase: 2, cells, modules, lines: [] })
})()

// 3. Concave L-shaped above-ground rooms + unlabelled bridge piers (0, 5, 10)
const fixtureConcaveAboveGround = (() => {
  const lShape = (z, zone) => {
    const out = []
    for (let x = 0; x <= 14; x++) {
      for (let y = 0; y <= 14; y++) {
        if (x <= 4 || y <= 4) {
          out.push({ x, y, z, fill: 'solid', zone })
        }
      }
    }
    return out
  }
  const cells = [
    ...lShape(0, 'unpaid'),
    ...lShape(5, 'paid'),
    ...lShape(10, 'platform'),
    // Unlabelled pier far outside room plan at z=0..5 (must be filtered by classifyAboveGround)
    { x: 20, y: 20, z: 0, fill: 'solid' },
    { x: 20, y: 20, z: 1, fill: 'solid' },
    { x: 20, y: 20, z: 5, fill: 'solid' },
  ]
  const modules = [
    { id: 'esc-ag1', type: 'escalator', x: 1, y: 2, z: 0, rot: 1, from: { x: 1, y: 2, z: 0 }, to: { x: 10, y: 2, z: 5 }, cfg: { incline: 30, dir: 'up', width: 1 } },
    { id: 'esc-ag2', type: 'escalator', x: 1, y: 3, z: 5, rot: 1, from: { x: 1, y: 3, z: 5 }, to: { x: 10, y: 3, z: 10 }, cfg: { incline: 30, dir: 'up', width: 1 } },
  ]
  return normalizeFixture({ name: '高架凹形站', levelBase: 0, cells, modules, lines: [] })
})()

// 4. Multi-stop vertical circulation: turning stair (`right90` + `u180`), wide escalator (`width: 3`),
//    and lift spanning -15 to 0 while band -10 has NO retained cells/structure (gap band test!).
const fixtureMultiStopVertical = (() => {
  const cells = [
    ...buildRectCells(0, 0, 16, 16, -15, { zone: 'platform' }),
    ...buildRectCells(0, 0, 16, 16, -5, { zone: 'paid' }),
    ...buildRectCells(0, 0, 16, 16, 0, { zone: 'unpaid' }),
  ]
  const modules = [
    // Turning stairs between -5 and 0 (adjacent retained storeys -> guides emitted)
    {
      id: 'stair-turn90',
      type: 'stair',
      x: 3, y: 3, z: -5, rot: 0,
      from: { x: 3, y: 3, z: -5 },
      to: { x: 6, y: 7, z: 0 },
      cfg: {
        style: 'right90',
        width: 2.04,
        flights: [
          { from: { x: 3, y: 3, z: -5 }, to: { x: 3, y: 6, z: -2 } },
          { from: { x: 3, y: 6, z: -2 }, to: { x: 6, y: 6, z: 0 } },
        ],
      },
    },
    // Wide 3-lane escalator between -5 and 0
    {
      id: 'esc-wide3',
      type: 'escalator',
      x: 4, y: 10, z: -5, rot: 1,
      from: { x: 4, y: 10, z: -5 },
      to: { x: 13, y: 10, z: 0 },
      cfg: { incline: 30, dir: 'up', width: 3 },
    },
    // Lift spanning -15 to 0; since -10 is absent from `levels`, only (-5 -> 0) is adjacent!
    {
      id: 'lift-gap',
      type: 'lift',
      x: 12, y: 3, z: -15, rot: 0,
      from: { x: 12, y: 3, z: -15 },
      to: { x: 12, y: 3, z: 0 },
      cfg: { size: 3 },
    },
  ]
  return normalizeFixture({ name: '多跨垂交站', levelBase: 0, cells, modules, lines: [] })
})()

const fixtures = [
  recordExactCase('minimal-two-floor', fixtureTwoFloor.data, { normalizedJson: fixtureTwoFloor.normalizedJson }, true),
  recordExactCase('shifted-level-base', fixtureShiftedBase.data, { normalizedJson: fixtureShiftedBase.normalizedJson }, true),
  recordExactCase('concave-above-ground', fixtureConcaveAboveGround.data, { normalizedJson: fixtureConcaveAboveGround.normalizedJson }, true),
  recordExactCase('multi-stop-vertical', fixtureMultiStopVertical.data, { normalizedJson: fixtureMultiStopVertical.normalizedJson }, true),
]

// Record `explodedLiftPoses` terminal clamping & EXPLODED_LIFT_ABSENT cases:
const liftPoseSamples = (() => {
  const offsets = new Map([[-10, 0], [-5, 12], [0, 24]])
  const direction = [1, 1]
  // Source stride 7: [x, y, lo, hi, cabin, doorOpen, openSides]
  const cases = [
    { id: 'bottom-landing', input: [5, 6, -10, 0, -9, 0.8, 1] },
    { id: 'crossing-into-mid', input: [5, 6, -10, 0, -4, 0.5, 2] },
    { id: 'top-terminal-exact', input: [5, 6, -10, 0, 1, 1.0, 3] },
    { id: 'single-band-top', input: [2, 3, -10, -5, -4, 0.75, 1] },
  ]
  return cases.map((c) => {
    const out = Array.from(explodedLiftPoses(new Float32Array(c.input), offsets, direction)).map(round)
    return { id: c.id, input: c.input, direction, offsets: Array.from(offsets.entries()), output: out, absentBit: EXPLODED_LIFT_ABSENT }
  })
})()

const oracle = {
  schemaVersion: 1,
  source: {
    head: gitHead(),
    files: {
      'game/src/render/explodedView.ts': fileSha('game/src/render/explodedView.ts'),
      'game/src/render/explodedConnections.ts': fileSha('game/src/render/explodedConnections.ts'),
      'game/src/render/explodedPassengers.ts': fileSha('game/src/render/explodedPassengers.ts'),
      'game/src/sim/placement.ts': fileSha('game/src/sim/placement.ts'),
      'game/src/sim/escalators.ts': fileSha('game/src/sim/escalators.ts'),
      'game/src/sim/stairs.ts': fileSha('game/src/sim/stairs.ts'),
      'unity/Assets/StationDesigner/Demos/zoo.metro.json': fileSha('unity/Assets/StationDesigner/Demos/zoo.metro.json'),
      'unity/Assets/StationDesigner/Demos/tanwei.metro.json': fileSha('unity/Assets/StationDesigner/Demos/tanwei.metro.json'),
      'unity/Assets/StationDesigner/Demos/tianhe.metro.json': fileSha('unity/Assets/StationDesigner/Demos/tianhe.metro.json'),
    },
  },
  demos,
  fixtures,
  liftPoseSamples,
}

writeFileSync(outPath, JSON.stringify(oracle, null, 2) + '\n', 'utf8')
console.log('wrote ' + outPath)
for (const d of demos) {
  console.log(
    `  demo ${d.id}: levels=[${d.levels.join(', ')}] dir=(${d.direction.join(', ')}) offsets=[${d.packedOffsets.join(', ')}] ` +
    `cells=${d.totalRetainedCells} frontWalls=${d.totalFrontWalls} guides=${d.guideCounts.total} (${d.guideCounts.stair}/${d.guideCounts.escalator}/${d.guideCounts.lift})`,
  )
}
for (const f of fixtures) {
  console.log(
    `  fixture ${f.id}: levels=[${f.levels.join(', ')}] dir=(${f.direction.join(', ')}) offsets=[${f.packedOffsets.join(', ')}] ` +
    `cells=${f.totalRetainedCells} frontWalls=${f.totalFrontWalls} guides=${f.guideCounts.total}`,
  )
}
