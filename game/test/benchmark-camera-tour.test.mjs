import test from 'node:test'
import assert from 'node:assert/strict'
import { EXAMPLE_STATION_IDS, referenceStationDocument } from '../src/data/reference-station.ts'
import { STOREY_HEIGHT, storeyBand } from '../src/sim/constants.ts'
import {
  CameraTourDriver,
  STATION_CAMERA_TOURS,
  TOUR_FOV_DEG,
  TOUR_LOD0_MAX_DISTANCE,
  TOUR_MIN_DISTANCE,
  TOUR_ORBIT_RADIANS_PER_PIXEL,
  cameraTourPlanFor,
} from '../src/app/benchmark/benchmarkCameraTour.ts'

const TWO_TAN_HALF_FOV = 2 * Math.tan((TOUR_FOV_DEG * Math.PI) / 360)
const ISO_DIR = [1, -1.2, 0.85]

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function rotateAbout(v, axis, rad) {
  const k = norm3(axis)
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const kv = cross3(k, v)
  const kdv = dot3(k, v)
  return [
    v[0] * c + kv[0] * s + k[0] * kdv * (1 - c),
    v[1] * c + kv[1] * s + k[1] * kdv * (1 - c),
    v[2] * c + kv[2] * s + k[2] * kdv * (1 - c),
  ]
}

/** Exact Z-up camera rig matching `CameraSystem.ts` and `StationCameraController.cs`. */
function createVirtualCameraRig(plan, pose) {
  const dir = norm3(plan.initialDirection ?? ISO_DIR)
  let activeLevel = plan.initialLevel
  let target = [pose.centerX, pose.centerY, activeLevel + 1]
  let offset = [dir[0] * pose.initialDistance, dir[1] * pose.initialDistance, dir[2] * pose.initialDistance]

  return {
    apply(delta) {
      for (const step of delta.levelSteps) {
        activeLevel = step.level
        // Matches `frame()` in CameraSystem.ts & StationCameraController.cs
        target = [pose.centerX, pose.centerY, activeLevel + 1]
      }
      if (delta.orbitDx !== 0 || delta.orbitDy !== 0) {
        offset = rotateAbout(offset, [0, 0, 1], -delta.orbitDx * TOUR_ORBIT_RADIANS_PER_PIXEL)
        const forward = norm3(offset)
        let right = cross3([0, 0, 1], forward)
        if (Math.hypot(right[0], right[1], right[2]) < 1e-4) right = [1, 0, 0]
        else right = norm3(right)
        offset = rotateAbout(offset, right, -delta.orbitDy * TOUR_ORBIT_RADIANS_PER_PIXEL)
      }
      if (delta.zoomFactor !== 1) {
        const len = Math.max(4, Math.min(400, Math.hypot(offset[0], offset[1], offset[2]) * delta.zoomFactor))
        const u = norm3(offset)
        offset = [u[0] * len, u[1] * len, u[2] * len]
      }
      if (delta.panRightFrac !== 0 || delta.panForwardFrac !== 0) {
        const dist = Math.hypot(offset[0], offset[1], offset[2])
        const span = TWO_TAN_HALF_FOV * dist
        const flen = Math.hypot(-offset[0], -offset[1])
        const fx = -offset[0] / flen
        const fy = -offset[1] / flen
        const rx = fy
        const ry = -fx
        const mx = rx * (delta.panRightFrac * span) + fx * (delta.panForwardFrac * span)
        const my = ry * (delta.panRightFrac * span) + fy * (delta.panForwardFrac * span)
        target = [target[0] + mx, target[1] + my, target[2]]
      }
    },
    snapshot() {
      const dist = Math.hypot(offset[0], offset[1], offset[2])
      const phiDeg = Math.acos(Math.max(-1, Math.min(1, offset[2] / dist))) * (180 / Math.PI)
      return {
        level: activeLevel,
        target: [...target],
        position: [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]],
        distance: dist,
        phiDeg,
      }
    },
  }
}

function stationStoreyIndex(stationId) {
  const doc = referenceStationDocument(stationId)
  const cellsByBand = new Map()
  const modsByBand = new Map()
  for (const cell of doc.cells) {
    const band = storeyBand(cell.z, doc.levelBase, doc.storeyHeight)
    if (!cellsByBand.has(band)) cellsByBand.set(band, [])
    cellsByBand.get(band).push([cell.x, cell.y])
  }
  for (const mod of doc.modules) {
    const x = mod.x ?? mod.from?.x
    const y = mod.y ?? mod.from?.y
    const z = mod.z ?? mod.from?.z
    if (x == null || y == null || z == null) continue
    const band = storeyBand(z, doc.levelBase, doc.storeyHeight)
    if (!modsByBand.has(band)) modsByBand.set(band, [])
    modsByBand.get(band).push([x, y])
  }
  return { cellsByBand, modsByBand }
}

function nearbyFeatureCount(index, level, x, y, radius = 10) {
  const cells = index.cellsByBand.get(level) ?? []
  const mods = index.modsByBand.get(level) ?? []
  let count = 0
  for (const [cx, cy] of cells) {
    if (Math.hypot(cx - x, cy - y) <= radius) count++
  }
  for (const [mx, my] of mods) {
    if (Math.hypot(mx - x, my - y) <= radius) count++
  }
  return count
}

test('every station tour zooms way-in to LOD0 (<= 15 m), stays over dense station geometry, and uses valid ±5 m Q/E steps', () => {
  for (const stationId of EXAMPLE_STATION_IDS) {
    const plan = cameraTourPlanFor(stationId)
    assert.equal(plan, STATION_CAMERA_TOURS[stationId])
    const index = stationStoreyIndex(stationId)

    assert.ok((index.cellsByBand.get(plan.initialLevel)?.length ?? 0) >= 100, `${stationId} initial level ${plan.initialLevel} m must be populated`)
    assert.ok(plan.levelSteps.length >= 5, `${stationId} tour exercises multiple Q/E level transitions`)
    assert.ok(plan.initialZoom > 0.45 && plan.initialZoom <= 1, `${stationId} opening zoom stays in safe range`)

    let currentLevel = plan.initialLevel
    let prevAt = 0
    for (const step of plan.levelSteps) {
      assert.ok(step.atMs > prevAt && step.atMs < 30_000, `${stationId} level step at ${step.atMs} ms is ordered inside 30 s`)
      const deltaZ = step.level - currentLevel
      assert.equal(Math.abs(deltaZ), STOREY_HEIGHT, `${stationId} step ${currentLevel} -> ${step.level} must be one ±5 m storey`)
      assert.equal(step.key, deltaZ < 0 ? 'Q' : 'E', `${stationId} key matches direction`)
      assert.ok((index.cellsByBand.get(step.level)?.length ?? 0) >= 100, `${stationId} target storey ${step.level} m must have built cells`)
      for (const seg of plan.motions) {
        assert.ok(
          step.atMs <= seg.startMs || step.atMs >= seg.endMs,
          `${stationId} level switch at ${step.atMs} ms must not overlap motion [${seg.startMs}, ${seg.endMs}]`,
        )
      }
      currentLevel = step.level
      prevAt = step.atMs
    }

    let hasOrbit = false
    let hasZoom = false
    let hasPan = false
    for (let i = 0; i < plan.motions.length; i++) {
      const seg = plan.motions[i]
      assert.ok(seg.startMs >= 0 && seg.endMs > seg.startMs && seg.endMs <= 30_000, `${stationId} motion window inside 30 s`)
      for (let j = i + 1; j < plan.motions.length; j++) {
        const other = plan.motions[j]
        const overlaps = seg.startMs < other.endMs && other.startMs < seg.endMs
        assert.equal(overlaps, false, `${stationId} motion segments must not overlap (${seg.startMs}-${seg.endMs} vs ${other.startMs}-${other.endMs})`)
      }
      if (seg.kind === 'orbitZoom') {
        if (seg.yawDeg || seg.pitchDeg) hasOrbit = true
        if (seg.targetDistance || (seg.zoomFactor && seg.zoomFactor !== 1)) hasZoom = true
      } else {
        hasPan = true
      }
    }
    assert.equal(hasOrbit, true, `${stationId} tour includes camera orbit`)
    assert.equal(hasZoom, true, `${stationId} tour includes camera zoom`)
    assert.equal(hasPan, true, `${stationId} tour includes camera pan`)

    // Simulate full 30 s playback and verify LOD0 close-up distance, safe pitch, and non-void framing
    const driver = new CameraTourDriver(stationId)
    const rig = createVirtualCameraRig(plan, driver.pose)
    for (let t = 100; t <= 30_000; t += 100) {
      rig.apply(driver.advance(t))
      const snap = rig.snapshot()
      assert.ok(
        snap.phiDeg >= 35 && snap.phiDeg <= 65,
        `${stationId} t=${t} ms polar angle ${snap.phiDeg.toFixed(1)}° stays in crisp architectural band`,
      )
      if (t >= 3_500) {
        assert.ok(
          snap.distance >= TOUR_MIN_DISTANCE && snap.distance <= TOUR_LOD0_MAX_DISTANCE,
          `${stationId} t=${t} ms distance ${snap.distance.toFixed(2)} m must stay in LOD0 [${TOUR_MIN_DISTANCE}, ${TOUR_LOD0_MAX_DISTANCE}] m`,
        )
        if (t % 500 === 0) {
          const nearby = nearbyFeatureCount(index, snap.level, snap.target[0], snap.target[1], 12)
          assert.ok(
            nearby >= 50,
            `${stationId} t=${t} ms on z=${snap.level} m target (${snap.target[0].toFixed(1)}, ${snap.target[1].toFixed(1)}) has only ${nearby} nearby cells/modules (void risk)`,
          )
        }
      }
    }
  }
})

test('CameraTourDriver produces identical 3D world poses across 7 FPS, 60 FPS, 240 FPS, and a 1.5 s stall', () => {
  const sampleAtCheckpoints = (stationId, timestamps) => {
    const plan = cameraTourPlanFor(stationId)
    const driver = new CameraTourDriver(stationId)
    const rig = createVirtualCameraRig(plan, driver.pose)
    const levels = []
    const checkpoints = new Map()
    let prevT = 0
    for (const t of timestamps) {
      const delta = driver.advance(t)
      rig.apply(delta)
      for (const step of delta.levelSteps) levels.push(`${step.key}:${step.level}`)
      if (t % 5_000 === 0 && t > prevT) checkpoints.set(t, rig.snapshot())
      prevT = t
    }
    return { levels, final: rig.snapshot(), checkpoints }
  }

  const uniformTimes = (fps) => {
    const dt = 1000 / fps
    const out = []
    for (let t = dt; t < 30_000; t += dt) out.push(t)
    out.push(30_000)
    return out
  }

  // Simulate a 1.5 s WebGL stall straddling level transitions & motion boundaries
  const stalledTimes = () => {
    const out = []
    for (let t = 100; t <= 30_000; t += 100) {
      if ((t > 9_200 && t < 10_700) || (t > 16_400 && t < 17_900)) continue
      out.push(t)
    }
    return out
  }

  for (const stationId of EXAMPLE_STATION_IDS) {
    const ref = sampleAtCheckpoints(stationId, uniformTimes(60))
    for (const [label, times] of [
      ['7 FPS', uniformTimes(7)],
      ['240 FPS', uniformTimes(240)],
      ['stalled', stalledTimes()],
    ]) {
      const run = sampleAtCheckpoints(stationId, times)
      assert.deepEqual(run.levels, ref.levels, `${stationId} (${label}) level sequence matches 60 FPS`)
      for (let i = 0; i < 3; i++) {
        assert.ok(
          Math.abs(run.final.target[i] - ref.final.target[i]) < 1e-6,
          `${stationId} (${label}) final target[${i}] matches 60 FPS (${run.final.target[i]} vs ${ref.final.target[i]})`,
        )
        assert.ok(
          Math.abs(run.final.position[i] - ref.final.position[i]) < 1e-6,
          `${stationId} (${label}) final position[${i}] matches 60 FPS`,
        )
      }
      assert.ok(
        Math.abs(run.final.distance - ref.final.distance) < 1e-6,
        `${stationId} (${label}) final distance matches 60 FPS`,
      )
    }
  }
})

test('Web groundWindow bounds and Unity StationIndex bounds converge to identical LOD0 world camera poses', () => {
  const unityPoses = {
    zoo: { centerX: 67.5, centerY: 12.5, initialDistance: 86.2 },
    tanwei: { centerX: -1.0, centerY: 15.5, initialDistance: 129.6 },
    tianhe: { centerX: 85.5, centerY: -40.0, initialDistance: 270.0 },
  }

  for (const stationId of EXAMPLE_STATION_IDS) {
    const plan = cameraTourPlanFor(stationId)
    const webDriver = new CameraTourDriver(stationId, plan.defaultPose)
    const unityDriver = new CameraTourDriver(stationId, unityPoses[stationId])
    const webRig = createVirtualCameraRig(plan, webDriver.pose)
    const unityRig = createVirtualCameraRig(plan, unityDriver.pose)

    for (let t = 100; t <= 30_000; t += 100) {
      webRig.apply(webDriver.advance(t))
      unityRig.apply(unityDriver.advance(t))
      if (t >= 3_500) {
        const w = webRig.snapshot()
        const u = unityRig.snapshot()
        assert.equal(w.level, u.level, `${stationId} t=${t} ms level parity`)
        assert.ok(Math.abs(w.distance - u.distance) < 1e-6, `${stationId} t=${t} ms distance parity (${w.distance} vs ${u.distance})`)
        for (let i = 0; i < 3; i++) {
          assert.ok(Math.abs(w.target[i] - u.target[i]) < 1e-6, `${stationId} t=${t} ms target[${i}] parity`)
          assert.ok(Math.abs(w.position[i] - u.position[i]) < 1e-6, `${stationId} t=${t} ms position[${i}] parity`)
        }
      }
    }
  }
})
