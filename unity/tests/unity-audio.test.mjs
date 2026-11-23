// Unity audio bridge contract (`game/src/unity-web/unityAudio.ts` + `audioSettings.ts` +
// Worker/WebView2 audio base paths): pins all six edit cues, ambience gating, crowd triplet
// forwarding, music/effects lifecycle, full-station-switch stop vs delta preservation, and
// asset base resolution across web, Cloudflare `/game/unity`, and desktop WebView2.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mountUnityAudio } from '../../game/src/unity-web/unityAudio.ts'
import { SCHEMA_VERSION, STATION_DELTA_SCHEMA_VERSION, stationBridge } from '../../game/src/unity-web/stationBridge.ts'
import { gameAudio } from '../../game/src/app/gameAudio.ts'
import { gameMusic } from '../../game/src/app/gameMusic.ts'
import { audioAssetBase, getAudioVolumes, setAudioVolume } from '../../game/src/app/audioSettings.ts'
import { crowdSound } from '../../game/src/render/audioScene.ts'
import localWorker from '../../tools/unity-web/local-worker.mjs'

const repo = resolve(import.meta.dirname, '../..')

function installMinimalDom() {
  const keys = ['window', 'document']
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  globalThis.window = new EventTarget()
  globalThis.document = Object.assign(new EventTarget(), { hidden: false })
  return () => {
    for (const key of keys) {
      const descriptor = originals.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

function sendAudio(sessionId, payload) {
  stationBridge.receive(JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    kind: 'audio',
    sessionId,
    payload,
  }))
}

function restoreVolumes(previous) {
  setAudioVolume('master', previous.master)
  setAudioVolume('effects', previous.effects)
  setAudioVolume('ambient', previous.ambient)
  setAudioVolume('music', previous.music)
}

test('mountUnityAudio forwards all six edit cues, ignores unknown cues, and fences stale sessions', t => {
  const restoreDom = installMinimalDom()
  const played = []
  const scenes = []
  t.mock.method(gameAudio, 'play', cue => played.push(cue))
  t.mock.method(gameAudio, 'updateScene', frame => scenes.push(frame))
  const unmount = mountUnityAudio()
  try {
    stationBridge.register({ SendMessage() {} })
    const session = stationBridge.getSnapshot().sessionId
    const cues = ['place', 'delete', 'move', 'pick', 'select', 'refused']
    for (const cue of cues) sendAudio(session, { cue })
    sendAudio(session, { cue: 'unknown-cue' })
    sendAudio(session, { cue: '' })
    sendAudio('s-stale-session', { cue: 'place' })

    assert.deepEqual(played, cues, 'all six canonical edit cues reach gameAudio.play in order')
    assert.equal(scenes.length, 0, 'cue payloads and unknown cues never reach updateScene')
  } finally {
    unmount()
    stationBridge.unregister()
    restoreDom()
  }
})

test('mountUnityAudio short-circuits muted ambience and guards malformed frames', t => {
  const restoreDom = installMinimalDom()
  const previous = { ...getAudioVolumes() }
  const scenes = []
  t.mock.method(gameAudio, 'updateScene', frame => scenes.push(frame))
  const unmount = mountUnityAudio()
  try {
    stationBridge.register({ SendMessage() {} })
    const session = stationBridge.getSnapshot().sessionId
    const validFrame = () => ({
      position: [0, 0, 10],
      right: [1, 0, 0],
      sources: [{ kind: 'train', position: [12, 0, 0], level: 0.6 }],
      speed: 1,
    })

    setAudioVolume('master', 0)
    setAudioVolume('ambient', 0.45)
    sendAudio(session, validFrame())
    assert.equal(scenes.length, 0, 'master === 0 short-circuits ambient updates')

    setAudioVolume('master', 1)
    setAudioVolume('ambient', 0)
    sendAudio(session, validFrame())
    assert.equal(scenes.length, 0, 'ambient === 0 short-circuits ambient updates')

    setAudioVolume('master', 1)
    setAudioVolume('ambient', 0.45)
    sendAudio(session, { right: [1, 0, 0], sources: [] })
    sendAudio(session, { position: [0, 0, 0], sources: [] })
    sendAudio(session, { position: [0, 0, 0], right: [1, 0, 0] })
    sendAudio(session, { position: 'bad', right: [1, 0, 0], sources: [] })
    assert.equal(scenes.length, 0, 'malformed ambience payloads are ignored')

    const frame = validFrame()
    sendAudio(session, frame)
    assert.equal(scenes.length, 1, 'valid unmuted ambience frame forwards to gameAudio.updateScene')
    assert.deepEqual(scenes[0], frame)
  } finally {
    unmount()
    stationBridge.unregister()
    restoreVolumes(previous)
    restoreDom()
  }
})

test('mountUnityAudio folds float-triplet passengers and sampleWeight into the crowd bed', t => {
  const restoreDom = installMinimalDom()
  const previous = { ...getAudioVolumes() }
  const scenes = []
  t.mock.method(gameAudio, 'updateScene', frame => scenes.push(frame))
  const unmount = mountUnityAudio()
  try {
    setAudioVolume('master', 1)
    setAudioVolume('ambient', 0.45)
    stationBridge.register({ SendMessage() {} })
    const session = stationBridge.getSnapshot().sessionId

    const passengers = [2, 0, 0, 4, 0, 0, 6, 0, 0]
    const position = [0, 0, 10]
    const sampleWeight = 12
    const expectedCrowd = crowdSound(passengers, passengers.length / 3, position, 3, sampleWeight)
    assert.ok(expectedCrowd && expectedCrowd.kind === 'crowd', 'crowdSound produces a crowd source for nearby triplets')

    sendAudio(session, {
      position,
      right: [1, 0, 0],
      sources: [{ kind: 'traffic', position: [15, 0, 0], level: 0.4 }],
      speed: 4,
      passengers,
      sampleWeight,
    })
    assert.equal(scenes.length, 1)
    assert.equal(scenes[0].sources.length, 2, 'crowd source is appended alongside existing sources')
    assert.deepEqual(scenes[0].sources[1], expectedCrowd)

    sendAudio(session, {
      position,
      right: [1, 0, 0],
      sources: [],
      speed: 1,
      passengers: [],
      sampleWeight,
    })
    assert.equal(scenes.length, 2)
    assert.deepEqual(scenes[1].sources, [], 'empty passenger triplets append no crowd source')
  } finally {
    unmount()
    stationBridge.unregister()
    restoreVolumes(previous)
    restoreDom()
  }
})

test('mountUnityAudio manages gameAudio and gameMusic mount/unmount lifecycle cleanly', t => {
  const restoreDom = installMinimalDom()
  const events = []
  t.mock.method(gameAudio, 'mount', () => {
    events.push('effects:mount')
    return () => events.push('effects:unmount')
  })
  t.mock.method(gameMusic, 'mount', () => {
    events.push('music:mount')
    return () => events.push('music:unmount')
  })
  const played = []
  t.mock.method(gameAudio, 'play', cue => played.push(cue))

  const unmount = mountUnityAudio()
  let unmounted = false
  const cleanup = () => { if (!unmounted) { unmounted = true; unmount() } }
  try {
    assert.deepEqual(events, ['effects:mount', 'music:mount'])
    stationBridge.register({ SendMessage() {} })
    const session = stationBridge.getSnapshot().sessionId
    sendAudio(session, { cue: 'select' })
    assert.deepEqual(played, ['select'])

    cleanup()
    assert.deepEqual(events, ['effects:mount', 'music:mount', 'music:unmount', 'effects:unmount'])
    sendAudio(session, { cue: 'place' })
    assert.deepEqual(played, ['select'], 'unmounted audio bridge ignores subsequent cues')
  } finally {
    cleanup()
    stationBridge.unregister()
    restoreDom()
  }
})

test('mountUnityAudio stops active audio on full station switches without interrupting delta edits', t => {
  const restoreDom = installMinimalDom()
  const stops = []
  t.mock.method(gameAudio, 'stop', () => stops.push(stationBridge.getSnapshot().revision))
  const unmount = mountUnityAudio()
  let unmounted = false
  const cleanup = () => { if (!unmounted) { unmounted = true; unmount() } }
  try {
    stationBridge.register({ SendMessage() {} })
    const session = stationBridge.getSnapshot().sessionId

    // Initial full station commit (e.g. station.openDemo zoo).
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: 'commit',
      id: 'c-open-1',
      sessionId: session,
      revision: 0,
      payload: { document: '{"format":"metro-save","rev":0}', sourceId: 'zoo' },
    }))
    assert.deepEqual(stops, [0], 'full document commit stops stale audio cleanly')

    // Sequential same-station delta edit must NOT interrupt live ambient beds.
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: 'commit',
      id: 'c-edit-1',
      sessionId: session,
      revision: 1,
      payload: {
        delta: {
          schemaVersion: STATION_DELTA_SCHEMA_VERSION,
          baseRevision: 0,
          revision: 1,
          removedCells: [],
          changedCells: [{ x: 1, y: 1, z: 0, fill: 'solid' }],
          removedModules: [],
          changedModules: [],
        },
      },
    }))
    assert.deepEqual(stops, [0], 'same-station delta commit does not call gameAudio.stop()')

    // Gapped delta requiring resync must not trigger a premature stop before full document arrives.
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: 'commit',
      id: 'c-gap',
      sessionId: session,
      revision: 5,
      payload: {
        delta: {
          schemaVersion: STATION_DELTA_SCHEMA_VERSION,
          baseRevision: 4,
          revision: 5,
          removedCells: [],
          changedCells: [],
          removedModules: [],
          changedModules: [],
        },
      },
    }))
    assert.deepEqual(stops, [0], 'unapplied gapped delta does not call gameAudio.stop()')

    // Full station switch (`station.new` / `station.open` / `station.openDemo`) stops active audio.
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: 'commit',
      id: 'c-switch',
      sessionId: session,
      revision: 6,
      payload: { document: '{"format":"metro-save","rev":6}', sourceId: 'tanwei' },
    }))
    assert.deepEqual(stops, [0, 6], 'full station switch calls gameAudio.stop()')

    cleanup()
    assert.deepEqual(stops, [0, 6, 6], 'unmounting effects calls gameAudio.stop() once')
    stationBridge.receive(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: 'commit',
      id: 'c-after-unmount',
      sessionId: session,
      revision: 7,
      payload: { document: '{"format":"metro-save","rev":7}', sourceId: 'new' },
    }))
    assert.deepEqual(stops, [0, 6, 6], 'unmounted audio bridge does not stop on later commits')
  } finally {
    cleanup()
    stationBridge.unregister()
    restoreDom()
  }
})

test('audioAssetBase honours metroUnityAudioBase overrides, /game/unity fallback, Worker rewrite, and WebView2 /audio/', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'metroUnityAudioBase')
  try {
    globalThis.metroUnityAudioBase = '/game/_unity/UI/audio/'
    assert.equal(audioAssetBase('/game/en/zoo'), '/game/_unity/UI/audio/')

    globalThis.metroUnityAudioBase = '/audio/'
    assert.equal(audioAssetBase('/game/unity/en/zoo'), '/audio/')

    delete globalThis.metroUnityAudioBase
    assert.equal(audioAssetBase('/game/unity/en/zoo'), '/game/unity/audio/')
    assert.equal(audioAssetBase('/game/unity/tianhe'), '/game/unity/audio/')
    assert.equal(audioAssetBase('/game/unity/'), '/game/unity/audio/')

    const html = `<!DOCTYPE html><html lang="en-us"><body><script>window.metroUnityAudioBase = '/game/_unity/UI/audio/';</script></body></html>`
    const env = {
      ASSET_PREFIX: '/game/unity',
      ASSETS: {
        async fetch(request) {
          if (new URL(request.url).pathname === '/') {
            return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
          }
          return new Response('Not found', { status: 404 })
        },
      },
    }
    const res = await localWorker.fetch(new Request('https://stationdesigner.com/game/unity/en/zoo'), env)
    assert.equal(res.status, 200)
    const body = await res.text()
    assert.match(body, /window\.metroUnityAudioBase = '\/game\/unity\/_unity\/UI\/audio\/'/)

    const programCs = readFileSync(join(repo, 'tools/unity-editor-ui/Program.cs'), 'utf8')
    assert.match(programCs, /window\.metroUnityAudioBase = '\/audio\/';/, 'WebView2 host pins /audio/ base')
    assert.match(programCs, /path\.StartsWith\("\/audio\/"/, 'WebView2 host serves /audio/ from disk')
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'metroUnityAudioBase', descriptor)
    else delete globalThis.metroUnityAudioBase
  }
})
