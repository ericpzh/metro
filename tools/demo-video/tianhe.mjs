import { setTimeout as sleep } from 'node:timers/promises'
import { waitFor } from '../browser-harness.mjs'

// The west aisle of the Line 11 platform stays clear of the stairs and columns.
const platformPath = { x: -13.55, fromY: -54, toY: 12, z: -6.8, lookX: -17.8, lookAhead: 18, minX: -15, maxX: -5 }
const concoursePath = { x: 11.7, fromY: -92, toY: -39, z: -1.8, lookX: 11.7, lookAhead: 18, minX: 0, maxX: 25 }

export async function prepareTianheFlythrough(page, shot) {
  const platform = shot.level === -10
  const path = platform ? platformPath : concoursePath
  await page.evaluate(`(() => {
    const scene = __scene, state = __metro.getState(), c = scene.cameraSys;
    const path = ${JSON.stringify(path)};
    state.setActiveZ(${shot.level});
    state.setOrtho(false);
    state.setHideWalls(false);
    state.setHideRoof(false);
    state.setHideGround(${platform});
    state.setHideUI(true);
    state.setAutoCeiling(false);
    c.setOrtho(false);
    c.setFov(${platform ? 58 : 72});
    c.controls.enableDamping = false;
    window.__tianheFlyPose = t => {
      const y = path.fromY + (path.toY - path.fromY) * t;
      c.camera.position.set(path.x, y, path.z);
      c.controls.target.set(path.lookX, y + path.lookAhead, path.z - .5);
      c.controls.update();
      scene.requestRender();
    };
    window.__tianheTraffic = () => {
      const crowd = scene.crowd, trainBuffer = scene.trains.lastBuffer;
      const passengers = new Map(), trains = [];
      for (let i = 0; i < crowd.agentCount * 6; i += 6) {
        const [x, y, z, , , id] = crowd.cur.subarray(i, i + 6);
        if (x > path.minX && x < path.maxX && y > path.fromY && y < path.toY + path.lookAhead && Math.abs(z - (${shot.level} + 1)) < 1.2) {
          passengers.set(id, [x, y]);
        }
      }
      for (let i = 0; i < trainBuffer.length; i += 10) {
        const [x, y, z, , , doors] = trainBuffer.subarray(i, i + 6);
        if (x < -15 && x > -22 && Math.abs(z + 10) < 1.5) trains.push({ y, doors });
      }
      return { passengers, trains, simTime: __metro.getState().metrics?.simTime ?? 0 };
    };
    window.__tianheDoorsOpenedAt = null;
    __tianheFlyPose(0);
    state.setSpeed(64);
    state.setPlaying(true);
  })()`)

  // Start near the end of a real dwell so departure fits in the shorter pass.
  await waitFor(page.evaluate, `(() => {
    const { passengers, trains, simTime } = __tianheTraffic();
    if (${platform}) {
      const open = trains.some(train => train.doors > .5 && Math.abs(train.y + 12) < 10);
      if (!open) { window.__tianheDoorsOpenedAt = null; return false; }
      window.__tianheDoorsOpenedAt ??= simTime;
      if (simTime - __tianheDoorsOpenedAt < 27) return false;
    }
    if (passengers.size < 8) return false;
    const state = __metro.getState();
    state.setPlaying(false);
    state.setSpeed(${shot.simSpeed});
    return true;
  })()`, { tries: 260, every: 250, what: platform ? 'Line 11 departure window' : 'passengers in the Tianhe concourse' })
}

export async function waitForTianheConcourseCrowd(page) {
  await waitFor(page.evaluate, `(() => {
    const scene = __scene, state = __metro.getState(), crowd = scene.crowd;
    const camera = scene.cameraSys.activeCamera(), point = new camera.position.constructor();
    let visible = 0;
    for (let i = 0; i < crowd.agentCount * 6; i += 6) {
      const [x, y, z] = crowd.cur.subarray(i, i + 3);
      if (Math.abs(z + 4) > .6) continue;
      point.set(x, y, z).project(camera);
      if (Math.abs(point.x) < .85 && Math.abs(point.y) < .8 && Math.abs(point.z) < 1) visible++;
    }
    window.__videoConcoursePassengers = visible;
    if (visible < 45) return false;
    state.setSpeed(4);
    return true;
  })()`, { tries: 320, every: 250, what: '45 visible passengers on Tianhe Park’s −5 m concourse' })
}

export async function flyTianhe(page, shot, recordStart) {
  await page.evaluate(`(() => {
    const state = __metro.getState(), token = __videoMotionToken;
    const start = performance.now(), duration = ${shot.captureSeconds * 1000};
    const initial = __tianheTraffic();
    let previous = initial.passengers, lastSample = -Infinity;
    window.__videoMotionLog = [];
    state.setPlaying(true);
    function fly(now) {
      if (token !== __videoMotionToken) return;
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      __tianheFlyPose(t);
      if (now - lastSample >= 180 || t === 1) {
        const traffic = __tianheTraffic();
        let movingPassengers = 0;
        for (const [id, [x, y]] of traffic.passengers) {
          const old = previous.get(id);
          if (old && Math.hypot(x - old[0], y - old[1]) > .25) movingPassengers++;
        }
        __videoMotionLog.push({ t, simTime: traffic.simTime, passengerCount: traffic.passengers.size, movingPassengers,
          trains: traffic.trains, camera: __scene.cameraSys.camera.position.toArray() });
        previous = traffic.passengers;
        lastSample = now;
      }
      if (t < 1) requestAnimationFrame(fly);
    }
    requestAnimationFrame(fly);
  })()`)

  await sleep(Math.max(0, recordStart + shot.captureSeconds * 1000 - 100 - performance.now()))
  const evidence = await page.evaluate(`(() => {
    const samples = __videoMotionLog;
    const positions = samples.flatMap(s => s.trains.map(train => train.y));
    return { simSpeed: __metro.getState().speed, simSeconds: samples.at(-1)?.simTime - samples[0]?.simTime,
      walkingPassengers: Math.max(0, ...samples.map(s => s.movingPassengers)),
      trainTravel: positions.length ? Math.max(...positions) - Math.min(...positions) : 0 };
  })()`)
  if (evidence.simSpeed !== shot.simSpeed || evidence.simSeconds <= 0 || !evidence.walkingPassengers || (shot.level === -10 && evidence.trainTravel < 3)) {
    throw Error(`Tianhe fly-through is missing live movement: ${JSON.stringify(evidence)}`)
  }
  return [{ at: 0, action: 'tianhe-flythrough', level: shot.level, ...evidence }]
}
