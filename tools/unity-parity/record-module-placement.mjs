// Exhaustive Web (Three.js) module placement oracle for Unity parity auditing.
//
// Runs the real `game/src/render/models.ts` `buildModule` across:
//   1. Every palette option in `MODULE_OPTIONS` + all supplemental variants/sizes
//      at all 4 quarter-turns (rot = 0..3) and non-zero coordinates.
//   2. Contextual placement cases: curtain-backed edge decor, outdoor-surface-lifted
//      floor equipment (on sidewalk), and ceiling/hanger-mounted fixtures.
//
// Outputs `unity/Assets/StationDesigner/Tests/EditMode/module-placement-oracle.json`
// with exact world-space Three.js bounding boxes (`min`, `max`, `center`, `size`)
// in document axes `(x, y, z)`.
//
// Usage:
//   node tools/unity-parity/record-module-placement.mjs
//   node tools/unity-parity/record-module-placement.mjs --check
//   node tools/unity-parity/record-module-placement.mjs --demos <out.json>
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const assetRequire = createRequire(new URL('../unity-assets/package.json', import.meta.url))
const { Canvas, ImageData, createCanvas } = assetRequire('@napi-rs/canvas')

// Minimal headless 2D canvas shim (matches tools/unity-assets/export-opening.mjs).
globalThis.HTMLCanvasElement = Canvas
globalThis.ImageData = ImageData
globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(1, 1)
    Object.defineProperty(canvas, 'data', { value: undefined })
    return canvas
  },
}

// Deterministic Math.random for brushed textures / procedural placement.
let rngSeed = 0x5eed1234
Math.random = () => {
  rngSeed = (rngSeed + 0x6d2b79f5) >>> 0
  let t = rngSeed
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const THREE = await import(new URL('../../game/node_modules/three/build/three.module.js', import.meta.url).href)
const { createModelMaterials } = await import('../../game/src/render/models/PieceBuilder.ts')
const { createModule } = await import('../../game/src/build/model/Equipment.ts')
const { buildModule } = await import('../../game/src/render/models.ts')
const { MODULE_OPTIONS } = await import('../../game/src/app/store/catalog.ts')
const { COUNTER_LENGTHS, COUNTER_VARIANTS, counterPaletteId } = await import('../../game/src/sim/counters.ts')
const { tvPairSlot } = await import('../../game/src/sim/tvs.ts')

const mats = createModelMaterials()
const dummyAdMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
const dummyTvTex = new THREE.CanvasTexture(createCanvas(4, 4))
const dummyFinishMat = new THREE.MeshStandardMaterial({ color: 0xcccccc })

function makeCtx(data) {
  const modules = data.modules ?? []
  return {
    mats,
    data,
    ads: {
      adFace(_slug, w, h) {
        return { material: dummyAdMat, geometry: new THREE.PlaneGeometry(w, h) }
      },
      adWindow(w, h) {
        return { material: dummyAdMat, geometry: new THREE.PlaneGeometry(w, h), slug: 'placeholder' }
      },
      load: async () => {},
      dispose: () => {},
    },
    trackCells: new Set(),
    tvPlate: () => dummyTvTex,
    tvPairSlot: (id) => tvPairSlot(id, modules),
    finish: () => dummyFinishMat,
  }
}

const r6 = (v) => Math.round(v * 1e6) / 1e6
const round3 = (arr) => arr.map(r6)

const _v = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _inst = new THREE.Matrix4()

/**
 * Exact transformed vertex AABB (avoids `THREE.Box3.setFromObject` bloating rotated
 * meshes like 30° escalator frames via 8-corner local-box re-expansion, and skips
 * zero-scaled hidden `InstancedMesh` entries such as unused escalator step slots).
 */
function exactWorldBox(obj) {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3()
  obj.traverse((child) => {
    if (!child.visible) return
    const geom = child.geometry
    if (!geom) return
    const pos = geom.getAttribute('position')
    if (!pos || pos.count === 0) return
    if (child.isInstancedMesh) {
      const count = child.count
      for (let i = 0; i < count; i++) {
        child.getMatrixAt(i, _inst)
        const e = _inst.elements
        if (e[0] === 0 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[5] === 0 && e[6] === 0) continue
        _m.multiplyMatrices(child.matrixWorld, _inst)
        for (let k = 0; k < pos.count; k++) {
          _v.fromBufferAttribute(pos, k).applyMatrix4(_m)
          box.expandByPoint(_v)
        }
      }
    } else {
      for (let k = 0; k < pos.count; k++) {
        _v.fromBufferAttribute(pos, k).applyMatrix4(child.matrixWorld)
        box.expandByPoint(_v)
      }
    }
  })
  return box
}

function measureModule(mod, data) {
  const ctx = makeCtx(data)
  const obj = buildModule(mod, ctx)
  if (!obj) return null
  const box = exactWorldBox(obj)
  if (box.isEmpty()) return null
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  return {
    pos: round3(obj.position.toArray()),
    rotZ: r6(obj.rotation.z),
    min: round3(box.min.toArray()),
    max: round3(box.max.toArray()),
    center: round3(center.toArray()),
    size: round3(size.toArray()),
  }
}

function emptyData(modules, cells = [], lines = []) {
  return {
    name: 'Audit',
    nameEn: 'Audit',
    cityStyle: 'guangzhou',
    storeyHeight: 5,
    levelBase: 0,
    cells,
    modules,
    lines,
  }
}

function defaultLine() {
  return {
    id: '1',
    name: '1号线',
    nameEn: 'Line 1',
    colour: '#1b6fd6',
    stock: 'B',
    cars: 6,
    power: 'third-rail',
    psd: 'full',
    direction: 'up',
    upTerminus: '东站',
    downTerminus: '西站',
    headwayProfile: { peak: 180, offpeak: 300, late: 480 },
  }
}

const X = 12
const Y = 24
const Z = 0

function buildCatalogueCases() {
  const cases = []
  const seenKey = new Set()

  function addCase(caseId, mod, extraModules = [], extraCells = [], extraLines = []) {
    assert.ok(!seenKey.has(caseId), `duplicate caseId ${caseId}`)
    seenKey.add(caseId)
    const modules = [mod, ...extraModules]
    const data = emptyData(modules, extraCells, extraLines)
    const measured = measureModule(mod, data)
    assert.ok(measured, `buildModule returned empty/null for ${caseId} (${mod.type})`)
    cases.push({
      caseId,
      group: 'catalogue',
      targetId: mod.id,
      modules,
      cells: extraCells,
      lines: extraLines,
      web: measured,
    })
  }

  // 1. Every palette id in MODULE_OPTIONS at rotations 0..3.
  const paletteIds = MODULE_OPTIONS.map((o) => o.id)
  const supplemental = [
    'bench-steel-2',
    'bench-seat-2',
    'bench-wood-2',
    'door-steel-2',
    'door-wood-2',
    'door-glass-2',
    'glass-1x4',
    'glass-2x4',
    'glass-3x4',
    'glass-4x4',
    'exit-covered-2',
  ]
  for (const variant of COUNTER_VARIANTS) {
    for (const len of COUNTER_LENGTHS.slice(1)) {
      supplemental.push(`${counterPaletteId(variant)}-${len}m`)
    }
  }

  const allIds = [...new Set([...paletteIds, ...supplemental])]
  for (const paletteId of allIds) {
    // Skip `tv-double` here — tested as a real back-to-back pair below.
    if (paletteId === 'tv-double') continue
    // Handle checkout-*-{2,3,4}m via createModule width argument.
    const counterMatch = paletteId.match(/^(checkout(?:-[a-z-]+)?)-(\d)m$/)
    const baseId = counterMatch ? counterMatch[1] : paletteId
    const widthArg = counterMatch ? Number(counterMatch[2]) : undefined

    const rots = paletteId === 'pillar-slim' ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3]
    for (const rot of rots) {
      const id = `m-${paletteId}-r${rot}`
      const mod = createModule(baseId, X, Y, Z, id, rot, widthArg)
      assert.ok(mod, `createModule returned null for ${paletteId}`)
      // Provide a floor pad under surface/exit/stair/etc. only where needed — isolated check uses empty cells
      // except keep floor cells empty so ceiling fallback is identical in Web & Unity.
      addCase(`${paletteId}@r${rot}`, mod)
    }
  }

  // 2. Special variants and config permutations that affect position/pivot/extents.

  // 2a. Standing doors with implicit w omitted (legacy saves) vs explicit w=2.
  for (let rot = 0; rot < 4; rot++) {
    const mod = { id: `m-door-steel-2-now-r${rot}`, type: 'door', x: X, y: Y, z: Z, rot, cfg: { variant: 'steel-2' } }
    addCase(`door-steel-2-implicit-w@r${rot}`, mod)
  }

  // 2b. Paired back-to-back TV (`tv-double`).
  for (let rot = 0; rot < 4; rot++) {
    const tvA = { id: `m-tv-pair-a-r${rot}`, type: 'tv', x: X, y: Y, z: Z, rot, cfg: {} }
    const tvB = { id: `m-tv-pair-b-r${rot}`, type: 'tv', x: X, y: Y, z: Z, rot: (rot + 2) % 4, cfg: {} }
    addCase(`tv-double-primary@r${rot}`, tvA, [tvB])
  }

  // 2c. Lights across all 9 ceiling positions (0..8) for circular and rectangular (rot 0 & 1).
  for (const variant of ['circular', 'rectangular']) {
    for (const rot of variant === 'rectangular' ? [0, 1, 2, 3] : [0, 1]) {
      for (let pos = 0; pos < 9; pos++) {
        const mod = { id: `m-light-${variant}-p${pos}-r${rot}`, type: 'light', x: X, y: Y, z: Z, rot, cfg: { variant, position: pos } }
        addCase(`light-${variant}-pos${pos}@r${rot}`, mod)
      }
    }
  }

  // 2d. Floor marks with explicit cfg.offset.
  for (const variant of ['boarding', 'waiting', 'direction']) {
    for (let rot = 0; rot < 4; rot++) {
      const mod = {
        id: `m-fmark-${variant}-off-r${rot}`,
        type: 'floor-mark',
        x: X,
        y: Y,
        z: Z,
        rot,
        cfg: { variant, offset: { x: 0.25, y: -0.35 } },
      }
      addCase(`floor-mark-${variant}-offset@r${rot}`, mod)
    }
  }

  // 2e. Doorway exits with custom mountZ = 3.
  for (const bays of [1, 2, 3, 4]) {
    for (let rot = 0; rot < 4; rot++) {
      const mod = {
        id: `m-exit-doorway-${bays}-mz3-r${rot}`,
        type: 'exit',
        x: X,
        y: Y,
        z: Z,
        rot,
        cfg: { name: 'A', inRate: 900, open: true, covered: true, bays, style: 'doorway', mountZ: 3 },
      }
      addCase(`exit-doorway-${bays}-mountZ3@r${rot}`, mod)
    }
  }

  // 2f. Gates with door: 'fence' and 'none'.
  for (const variant of ['old', 'new']) {
    for (const door of ['fence', 'none']) {
      for (let rot = 0; rot < 4; rot++) {
        const mod = { id: `m-gate-${variant}-${door}-r${rot}`, type: 'gate', x: X, y: Y, z: Z, rot, cfg: { dir: 'both', door, variant } }
        addCase(`gate-${variant}-${door}@r${rot}`, mod)
      }
    }
  }

  // 2g. PSD ends: full height, half height, cover, and with offset.
  for (const [label, cfg] of [
    ['psd-end-full', { psd: 'full' }],
    ['psd-end-half-offset', { psd: 'half', offset: { x: 0.12, y: -0.08 } }],
    ['psd-end-full-offset', { psd: 'full', offset: { x: 0.12, y: -0.08 } }],
  ]) {
    for (let rot = 0; rot < 4; rot++) {
      const mod = { id: `m-${label}-r${rot}`, type: 'psd-end', x: X, y: Y, z: Z, rot, cfg }
      addCase(`${label}@r${rot}`, mod)
    }
  }

  // 2h. Platform edge runs paired with a track (full, half, none × left, right).
  const line1 = defaultLine()
  for (const psd of ['full', 'half', 'none']) {
    for (const side of ['left', 'right']) {
      for (let rot = 0; rot < 4; rot++) {
        const track = { id: `t-${psd}-${side}-r${rot}`, type: 'track', x: X, y: Y, z: Z, rot, w: 24, d: 3, cfg: { line: '1', power: 'third-rail' } }
        const edge = {
          id: `m-edge-${psd}-${side}-r${rot}`,
          type: 'platform-edge',
          x: X,
          y: Y + (side === 'left' ? 2 : -2),
          z: Z,
          rot,
          w: 24,
          cfg: { line: '1', from: track.id, side, psd, dir: 'up' },
        }
        addCase(`platform-edge-${psd}-${side}@r${rot}`, edge, [track], [], [line1])
      }
    }
  }

  // 2i. Booths (ticket & info, 3x3 and 5x3, front 0..3).
  for (const kind of ['ticket', 'info']) {
    for (const [w, h] of [[3, 3], [5, 3]]) {
      for (let front = 0; front < 4; front++) {
        const mod = { id: `m-booth-${kind}-${w}x${h}-f${front}`, type: 'booth', x: X, y: Y, z: Z, rot: 0, w, h, cfg: { kind, front, stocked: true } }
        addCase(`booth-${kind}-${w}x${h}@f${front}`, mod)
      }
    }
  }

  // 2j. Curtain walls with custom curtainHeight 2, 3, 4.
  for (const curtainHeight of [2, 3]) {
    for (let rot = 0; rot < 4; rot++) {
      const mod = createModule('curtain-wall', X, Y, Z, `m-curtain-h${curtainHeight}-r${rot}`, rot, 2, 'up', 'lane', [], undefined, { curtainHeight })
      addCase(`curtain-wall-h${curtainHeight}@r${rot}`, mod)
    }
  }

  // 2k. Sign with boothOffset (without boothId -> offset ignored, with boothId -> offset applied).
  for (let rot = 0; rot < 4; rot++) {
    const modNoId = createModule('sign-wall', X, Y, Z, `m-sign-wall-booth-r${rot}`, rot)
    modNoId.cfg.boothOffset = { x: 0.35, y: -0.25 }
    addCase(`sign-wall-boothOffset@r${rot}`, modNoId)

    const modWithId = createModule('sign-wall', X, Y, Z, `m-sign-wall-boothid-r${rot}`, rot)
    modWithId.cfg.boothId = 'booth-ctx'
    modWithId.cfg.boothOffset = { x: 0.35, y: -0.25 }
    addCase(`sign-wall-boothId@r${rot}`, modWithId)
  }

  // 2l. Calligraphy: multi-cell horizontal, vertical panelH=2, and pillar-wrapped vertical arc.
  for (let rot = 0; rot < 4; rot++) {
    addCase(`calligraphy-kai-h-w3@r${rot}`, {
      id: `m-cal-h3-r${rot}`, type: 'calligraphy', x: X, y: Y, z: Z, rot, w: 3, panelH: 1, cfg: { style: 'kai', axis: 'h' },
    })
    addCase(`calligraphy-kai-v-h2@r${rot}`, {
      id: `m-cal-v2-r${rot}`, type: 'calligraphy', x: X, y: Y, z: Z, rot, w: 1, panelH: 2, cfg: { style: 'kai', axis: 'v' },
    })
    const pillar = { id: `p-cal-r${rot}`, type: 'pillar', x: X, y: Y, z: Z, rot: 0, cfg: { size: 'thick', height: 5 } }
    addCase(`calligraphy-wei-v-pillar@r${rot}`, {
      id: `m-cal-vp-r${rot}`, type: 'calligraphy', x: X, y: Y, z: Z, rot, w: 1, panelH: 2,
      cfg: { style: 'wei', axis: 'v', pillarId: pillar.id },
    }, [pillar])
  }

  // 2l2. Fractional Z elevation (`ExactZ`) wall fixtures.
  for (let rot = 0; rot < 4; rot++) {
    addCase(`monitor-wall-fracz@r${rot}`, {
      id: `m-mon-fz-r${rot}`, type: 'monitor', x: X, y: Y, z: -4.5, rot, w: 2, cfg: { mount: 'wall' },
    })
    addCase(`billboard-large-fracz@r${rot}`, {
      id: `m-bb-fz-r${rot}`, type: 'billboard', x: X, y: Y, z: -20.085, rot, w: 4, cfg: { variant: 'large' },
    })
    const signFz = createModule('sign-wall', X, Y, -3.15, `m-sign-fz-r${rot}`, rot)
    addCase(`sign-wall-fracz@r${rot}`, signFz)
  }

  // 2l3. Full-height PSD end corner return against both `left` and `right` parent platform-edges.
  for (const cornerSide of ['left', 'right']) {
    for (let rot = 0; rot < 4; rot++) {
      const edge = {
        id: `edge-corner-${cornerSide}-r${rot}`,
        type: 'platform-edge',
        x: X, y: Y, z: Z, rot, w: 12,
        cfg: { line: '1', side: cornerSide, psd: 'full', dir: 'up' },
      }
      const endRot = (rot + 1) % 4
      const end = {
        id: `m-psdend-corner-${cornerSide}-r${rot}`,
        type: 'psd-end',
        x: X, y: Y, z: Z, rot: endRot,
        cfg: { psd: 'full', corner: edge.id, offset: { x: 0.16, y: 0 } },
      }
      addCase(`psd-end-corner-${cornerSide}@r${rot}`, end, [edge], [], [line1])
    }
  }

  // 2l4. Overhead catenary track power (`cfg.power === 'catenary'`).
  const catLine = { ...line1, id: '11', power: 'catenary' }
  for (let rot = 0; rot < 4; rot++) {
    addCase(`track-catenary@r${rot}`, {
      id: `m-track-cat-r${rot}`, type: 'track', x: X, y: Y, z: Z, rot, w: 24, d: 3,
      cfg: { line: '11', power: 'catenary' },
    }, [], [], [catLine])
  }

  // 2l5. Controlled East-West / North-South road junction (guards crosswalk & stop-line axis swap).
  {
    const ew = { id: 'm-road-jct-ew', type: 'road', x: X - 12, y: Y, z: Z, rot: 0, w: 30, d: 6, cfg: { twoWay: true, lanes: 2 } }
    const ns = { id: 'm-road-jct-ns', type: 'road', x: X, y: Y - 12, z: Z, rot: 0, w: 6, d: 30, cfg: { twoWay: true, lanes: 2 } }
    addCase('road-junction-ew', ew, [ns])
    addCase('road-junction-ns', ns, [ew])
  }

  // 2m. Hanger widths 6 and 8.
  for (const mount of ['roof', 'post']) {
    for (const w of [6, 8]) {
      for (let rot = 0; rot < 4; rot++) {
        const mod = createModule(`hanger-${mount}`, X, Y, Z, `m-hanger-${mount}-${w}-r${rot}`, rot, w)
        addCase(`hanger-${mount}-w${w}@r${rot}`, mod)
      }
    }
  }

  // 2n. Stair block half-height (blockHeight = 0.5) & wide escalator/walkway & size-3 lift.
  for (let rot = 0; rot < 4; rot++) {
    addCase(`stair-block-half@r${rot}`, createModule('stair-block', X, Y, Z, `m-sblock-half-r${rot}`, rot, 0.5))
    addCase(`escalator-w2@r${rot}`, createModule('escalator', X, Y, Z, `m-esc-w2-r${rot}`, rot, 2))
    addCase(`walkway-w2@r${rot}`, createModule('walkway', X, Y, Z, `m-walk-w2-r${rot}`, rot, 2))
    addCase(`lift-3x3@r${rot}`, createModule('lift', X, Y, Z, `m-lift-3-r${rot}`, rot, undefined, 'up', 'lane', [], undefined, { liftSize: 3 }))
  }

  // 2o. Contextual: edge decor backed by curtain wall glass (rot 0..3).
  for (const paletteId of ['tvm', 'vending', 'bin', 'shelf-dark-tall', 'shelf-cooler', 'extinguisher', 'extinguisher-glass']) {
    for (let rot = 0; rot < 4; rot++) {
      const mod = createModule(paletteId, X, Y, Z, `m-edgecurtain-${paletteId}-r${rot}`, rot)
      const glass = { id: `g-curtain-${paletteId}-r${rot}`, type: 'glass', x: X, y: Y, z: Z, rot: (rot + 2) % 4, w: 2, cfg: { variant: '2x4' } }
      const modules = [glass, mod]
      const measured = measureModule(mod, emptyData(modules))
      cases.push({
        caseId: `curtain-edge:${paletteId}@r${rot}`,
        group: 'curtain-edge',
        targetId: mod.id,
        modules,
        cells: [],
        lines: [],
        web: measured,
      })
    }
  }

  // 2p. Contextual: floor equipment standing on outdoor sidewalk (+0.10 m outdoorSurfaceLift).
  const sidewalkPad = []
  for (let dx = -4; dx <= 14; dx++) {
    for (let dy = -4; dy <= 10; dy++) {
      sidewalkPad.push({ id: `sw-${dx}-${dy}`, type: 'sidewalk', x: X + dx, y: Y + dy, z: Z, rot: 0, cfg: {} })
    }
  }
  const liftCandidates = [
    'bench-steel-1', 'bench-steel-2', 'bin', 'tvm', 'vending', 'extinguisher', 'shelf-dark-tall',
    'desk', 'checkout', 'ac-unit', 'electrical-cabinet', 'court-divider', 'tree', 'fence',
    'noise-barrier', 'guidepost', 'busstop-short', 'door-steel-1', 'door-steel-2', 'gate',
    'cubicle', 'linemap-stand', 'hanger-post', 'pillar-slim', 'pillar-thick', 'floor-mark-boarding',
    'tactile-guide', 'cctv-post', 'traffic-light', 'rail-signal', 'exit-virtual', 'curtain-wall',
  ]
  for (const paletteId of liftCandidates) {
    const mod = createModule(paletteId, X, Y, Z, `m-lift-${paletteId}`, 0)
    assert.ok(mod, `createModule returned null for lift candidate ${paletteId}`)
    const modules = [...sidewalkPad, mod]
    const measured = measureModule(mod, emptyData(modules))
    cases.push({
      caseId: `outdoor-lift:${paletteId}`,
      group: 'outdoor-lift',
      targetId: mod.id,
      modules: [
        // Keep only the sidewalk tiles under/around the module's footprint to keep JSON compact.
        ...sidewalkPad.filter((s) => Math.abs(s.x - mod.x) <= 8 && Math.abs(s.y - mod.y) <= 4),
        mod,
      ],
      cells: [],
      lines: [],
      web: measured,
    })
  }
  {
    const booth = { id: 'm-lift-booth', type: 'booth', x: X, y: Y, z: Z, rot: 0, w: 3, h: 3, cfg: { kind: 'ticket', front: 0, stocked: true } }
    const modules = [...sidewalkPad.filter((s) => Math.abs(s.x - booth.x) <= 4 && Math.abs(s.y - booth.y) <= 4), booth]
    cases.push({
      caseId: 'outdoor-lift:booth',
      group: 'outdoor-lift',
      targetId: booth.id,
      modules,
      cells: [],
      lines: [],
      web: measureModule(booth, emptyData(modules)),
    })
  }

  // 2q. Contextual: ceiling-hung fixtures under explicit slab (z=4 => underside 4.0) vs under roof hanger.
  const slabCells = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      slabCells.push({ x: X + dx, y: Y + dy, z: Z + 4, fill: 'solid' })
    }
  }
  for (const paletteId of ['light-circular', 'light-rectangular', 'cctv', 'cctv-ptz', 'cctv-dome', 'vent', 'clock', 'clock-digital', 'tv', 'monitor-ceiling', 'sign-ceiling']) {
    const mod = createModule(paletteId, X, Y, Z, `m-slab4-${paletteId}`, 0)
    const measured = measureModule(mod, emptyData([mod], slabCells))
    cases.push({
      caseId: `ceiling-slab4:${paletteId}`,
      group: 'ceiling-slab4',
      targetId: mod.id,
      modules: [mod],
      cells: slabCells,
      lines: [],
      web: measured,
    })
  }

  // Under a hanger-post (at z=0, cross-bar at z+1 + HANGER_POST_BAR_TOP).
  const hangerPost = createModule('hanger-post', X, Y, Z, 'hanger-post-ctx', 0, 4)
  for (const paletteId of ['clock', 'clock-digital', 'tv', 'cctv', 'sign-ceiling']) {
    const mod = createModule(paletteId, X, Y, Z, `m-hanger-${paletteId}`, 0)
    const modules = [hangerPost, mod]
    const measured = measureModule(mod, emptyData(modules))
    cases.push({
      caseId: `hanger-mount:${paletteId}`,
      group: 'hanger-mount',
      targetId: mod.id,
      modules,
      cells: [],
      lines: [],
      web: measured,
    })
  }

  return cases
}

function buildDemoAudit(demoName) {
  const path = resolve(`unity/Assets/StationDesigner/Demos/${demoName}.metro.json`)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const data = {
    name: raw.name ?? demoName,
    nameEn: raw.nameEn ?? demoName,
    cityStyle: raw.city ?? 'guangzhou',
    storeyHeight: raw.storeyHeight ?? 5,
    levelBase: raw.levelBase ?? 0,
    cells: raw.static?.cells ?? [],
    modules: raw.static?.modules ?? [],
    lines: raw.static?.lines ?? [],
  }
  const ctx = makeCtx(data)
  const items = []
  for (const mod of data.modules) {
    const obj = buildModule(mod, ctx)
    if (!obj) continue
    const box = exactWorldBox(obj)
    if (box.isEmpty()) continue
    const center = new THREE.Vector3()
    const size = new THREE.Vector3()
    box.getCenter(center)
    box.getSize(size)
    items.push({
      id: mod.id,
      type: mod.type,
      variant: mod.cfg?.variant ?? mod.cfg?.style ?? mod.cfg?.mount ?? '',
      rot: mod.rot ?? 0,
      min: round3(box.min.toArray()),
      max: round3(box.max.toArray()),
      center: round3(center.toArray()),
      size: round3(size.toArray()),
    })
  }
  return { demo: demoName, count: items.length, items }
}

const demoArgIdx = process.argv.indexOf('--demos')
if (demoArgIdx >= 0) {
  const outPath = resolve(process.argv[demoArgIdx + 1] ?? '.preview/unity/demo-placement-oracle.json')
  const demos = ['zoo', 'tanwei', 'tianhe'].map(buildDemoAudit)
  writeFileSync(outPath, JSON.stringify({ demos }, null, 2) + '\n')
  console.log(`DEMO_PLACEMENT_ORACLE ${demos.map((d) => `${d.demo}=${d.count}`).join(' ')} -> ${outPath}`)
  process.exit(0)
}

const cases = buildCatalogueCases()
const output = new URL('../../unity/Assets/StationDesigner/Tests/EditMode/module-placement-oracle.json', import.meta.url)
const payload = {
  schemaVersion: 1,
  source: 'game/src/render/models.ts buildModule + game/src/app/store/catalog.ts MODULE_OPTIONS',
  count: cases.length,
  cases,
}
const text = JSON.stringify(payload, null, 2) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== text) throw new Error('module-placement-oracle.json is stale')
  console.log(`MODULE_PLACEMENT_ORACLE_OK ${cases.length} cases`)
} else {
  writeFileSync(output, text)
  console.log(`MODULE_PLACEMENT_ORACLE_WRITTEN ${cases.length} cases`)
}
