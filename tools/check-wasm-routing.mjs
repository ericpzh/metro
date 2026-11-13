import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withPage, waitFor } from './browser-harness.mjs'

const base = process.argv[2] ?? 'http://localhost:4174'
const profile = mkdtempSync(join(tmpdir(), 'metro-wasm-browser-'))
const debugPort = Number(process.env.METRO_WASM_DEBUG_PORT ?? 9335)
const page = await withPage({ url: 'about:blank', profile, debugPort })
const evaluate = page.evaluate
const wait = expression => waitFor(evaluate, expression, { what: base })
const run = (fn, ...args) => evaluate(`(${fn})(${args.map(a => JSON.stringify(a)).join(',')})`)
async function open(path) {
  await page.send('Page.navigate', { url: base + path })
  await wait(`!!window.__metro?.getState().metrics && !!window.__routingWorker && location.search === ${JSON.stringify(new URL(base + path).search)}`)
}

try {
  await page.send('Page.enable')
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const OriginalWorker = Worker;
    window.Worker = class extends OriginalWorker {
      postMessage(message, ...args) {
        if (message.type === 'enableWasm' && location.search.includes('switchDuringLoad')) {
          window.__startRouting = () => super.postMessage(message, ...args);
          return;
        }
        if (message.type === 'init') window.__routingWorker = this;
        super.postMessage(message, ...args);
      }
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({data}) => {
          if (data.type === 'state') window.__routingFrame = data;
        });
      }
    };
  }` })

  await open('/benchmark?sim=wasm')
  await wait('window.__metroRouting?.backend === "wasm"')
  assert.equal(await evaluate('window.__metroRouting.probe'), 42)
  assert.equal(await evaluate('location.pathname'), '/benchmark')
  console.log('benchmark worker probe passed')

  await open('/zoo?sim=wasm&switchDuringLoad=1')
  await run(() => {
    const store = window.__metro.getState()
    window.__startRouting()
    store.loadReference('tanwei')
    store.setSpeed(16)
    store.setPlaying(true)
  })
  await wait('window.__metroRouting?.searches > 0 && window.__routingFrame.count > 10')
  assert.equal(await evaluate('window.__metro.getState().station.cells.length'), 16725)
  await run(() => window.__metro.getState().setPlaying(false))
  await wait('window.__routingFrame.metrics.tick === window.__metro.getState().metrics.tick')
  await run(() => {
    const { agents } = window.__routingFrame
    const id = agents[5]
    window.__routingWorker.postMessage({ type: 'selectAgent', id, token: 42 })
  })
  await wait('window.__routingFrame.routeToken === 42')
  assert.ok(await evaluate('window.__routingFrame.routeAgent >= 0'))
  await run(() => {
    window.__seekTick = window.__routingFrame.metrics.tick
    window.__routingWorker.postMessage({ type: 'seek', seconds: 7 * 3600 })
  })
  await wait('window.__routingFrame.metrics.simTime === 7 * 3600')
  assert.equal(await evaluate('window.__routingFrame.metrics.tick === window.__seekTick'), true)
  await run(() => window.__metro.getState().restartSim())
  await wait('window.__routingFrame.count === 0')
  await run(() => {
    const store = window.__metro.getState()
    store.setPlaying(true)
    const station = store.station
    window.__priorSearches = window.__metroRouting.searches
    const gate = station.modules.find(m => m.type === 'gate')
    if (!gate) throw new Error('Tanwei fixture has no gate')
    const modules = station.modules.filter(m => m !== gate)
    store.commit({ ...station, modules })
    window.__savedModuleCount = modules.length
    window.dispatchEvent(new Event('pagehide'))
    const save = JSON.parse(localStorage.getItem('metro-game.autosave.v1'))
    if (save?.format !== 'metro-save' || save.formatVersion !== 1) throw new Error('Expected a v1 autosave')
  })
  await wait('window.__metroRouting?.searches > window.__priorSearches && window.__routingFrame.count > 0')
  const moduleCount = await evaluate('window.__savedModuleCount')
  await open('/?sim=wasm')
  assert.equal(await evaluate('window.__metro.getState().station.modules.length'), moduleCount)
  await wait('window.__metroRouting?.backend === "wasm"')
  console.log('game worker playback, selection, seek, restart, structural edit and autosave passed')

  for (const fault of ['missing', 'search']) {
    await open('/zoo?sim=wasm&wasmFault=' + fault)
    await run(() => {
      window.__fallbackStation = window.__metro.getState().station
      const store = window.__metro.getState()
      store.setSpeed(16)
      store.setPlaying(true)
    })
    await wait('window.__metroRouting?.status === "fallback" && window.__routingFrame.count > 10')
    const { reason, backend } = await evaluate('window.__metroRouting')
    assert.equal(backend, 'ts')
    assert.match(reason, fault === 'search' ? /RuntimeError: unreachable/ : /Could not load WASM binary/)
    const tick = await evaluate('window.__routingFrame.metrics.tick')
    await wait(`window.__routingFrame.metrics.tick > ${tick + 4}`)
    assert.equal(await evaluate('window.__metro.getState().station === window.__fallbackStation'), true)
    console.log(`${fault} fallback passed: ${reason}`)
  }
} finally {
  await page.close()
}
