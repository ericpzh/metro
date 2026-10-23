// Paired production-browser comparison of regular and standalone exploded views.
// Frame timings are diagnostic; both modes use a fresh copy of the same fixture.
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { dirname, resolve } from 'node:path'
import { loadExampleStation, serveDir, withPage, waitFor } from './browser-harness.mjs'

const durationMs = Number(process.env.BENCH_SECONDS ?? 8) * 1000
const warmupTicks = Number(process.env.BENCH_WARMUP_TICKS ?? 30)
if (!Number.isFinite(durationMs) || durationMs < 1000 || !Number.isInteger(warmupTicks) || warmupTicks < 0) {
  throw new Error('BENCH_SECONDS must be >= 1 and BENCH_WARMUP_TICKS must be a nonnegative integer')
}

const output = resolve(process.env.BENCH_OUTPUT ?? '.preview/perf/exploded-view/simulation-fps.json')
mkdirSync(dirname(output), { recursive: true })
const server = await serveDir(resolve('game/dist'), 0)
const reports = []

function summarizeFrameIntervals(intervals) {
  if (!intervals.length) throw new Error('benchmark captured no animation frames')
  const sorted = [...intervals].sort((a, b) => a - b)
  const slowestCount = Math.max(1, Math.ceil(sorted.length * 0.01))
  const slowestMean = sorted.slice(-slowestCount).reduce((sum, frame) => sum + frame, 0) / slowestCount
  const elapsed = intervals.reduce((sum, frame) => sum + frame, 0)
  return {
    renderedFrames: intervals.length,
    fps: intervals.length * 1000 / elapsed,
    onePercentLowFps: 1000 / slowestMean,
    frameIntervalMs: {
      mean: elapsed / intervals.length,
      p99: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1)],
      worst: sorted.at(-1),
    },
  }
}

async function measureMode(stationId, mode, quality) {
  const profile = resolve('.preview/perf/exploded-view', `chrome-sim-${stationId}-${mode}-${quality}-${process.pid}`)
  const page = await withPage({
    url: `http://127.0.0.1:${server.address().port}/`,
    profile,
    debugPort: 9400 + (process.pid % 500) + (mode === 'explode' ? 1 : 0),
    windowSize: process.env.BENCH_SIZE ?? '1400,900',
    softwareGpu: false,
  })
  try {
    await waitFor(page.evaluate, '!!window.__scene && !!window.__metro', { what: 'game shell' })
    await page.evaluate(`(() => {
      const state = window.__metro.getState();
      state.setPlaying(false);
      state.setSpeed(16);
      state.setGraphicsQuality('${quality}');
    })()`)
    await loadExampleStation(page, stationId)
    await page.evaluate(`(() => {
      const state = window.__metro.getState();
      const proto = window.__scene.constructor.prototype;
      const setup = proto.setStandalonePresentation;
      proto.setStandalonePresentation = function (...args) {
        window.__explodedScene = this;
        return setup.apply(this, args);
      };
    })()`)
    if (mode === 'explode') {
      await page.evaluate('window.__metro.getState().setExplodedView(true)')
      await waitFor(page.evaluate, 'document.querySelector(".explodedViewer")?.dataset.ready === "true"', {
        tries: 240, every: 250, what: 'exploded view snapshot',
      })
    }
    const raw = await page.evaluate(`(async () => {
        const state = window.__metro.getState();
        const store = window.__metro;
        const scene = ${mode === 'explode' ? 'window.__explodedScene' : 'window.__scene'};
        if (!scene) throw new Error('renderer unavailable for ${mode} view');
        const resetTick = state.metrics.tick;
        state.setPlaying(true);
        await new Promise(resolve => {
          let unsubscribe = () => {};
          const ready = () => {
            if (store.getState().metrics.tick < resetTick + ${warmupTicks}) return false;
            unsubscribe();
            resolve();
            return true;
          };
          unsubscribe = store.subscribe(ready);
          ready();
        });
        const startTick = window.__metro.getState().metrics.tick;
        const startPopulation = window.__metro.getState().metrics.population;
        const startRendererFrames = scene.framesRendered;
        const startTime = performance.now();
        const intervals = [], rafIntervals = [];
        let previous = 0, previousRaf = 0, submissions = scene.framesRendered;
        await new Promise(resolve => {
          const sample = now => {
            if (previousRaf) rafIntervals.push(now - previousRaf);
            previousRaf = now;
            if (scene.framesRendered !== submissions) {
              if (previous) intervals.push(now - previous);
              previous = now;
              submissions = scene.framesRendered;
            }
            if (now - startTime >= ${durationMs}) resolve();
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        const elapsedMs = performance.now() - startTime;
        const end = window.__metro.getState();
        const result = {
          elapsedMs,
          startTick,
          endTick: end.metrics.tick,
          startPopulation,
          population: end.metrics.population,
          rendererFrames: scene.framesRendered - startRendererFrames,
          canvas: { width: scene.renderer.domElement.width, height: scene.renderer.domElement.height },
          frameIntervalsMs: intervals,
          rafIntervalsMs: rafIntervals,
        };
        state.setPlaying(false);
        return result;
      })()`)
    const frameStats = summarizeFrameIntervals(raw.frameIntervalsMs)
    const rafStats = summarizeFrameIntervals(raw.rafIntervalsMs)
    delete raw.frameIntervalsMs
    delete raw.rafIntervalsMs
    const result = {
      mode,
      quality,
      ...frameStats,
      rafStats,
      simulationTicks: raw.endTick - raw.startTick,
      simulationTicksPerSecond: (raw.endTick - raw.startTick) * 1000 / raw.elapsedMs,
      ...raw,
    }
    console.log(`${stationId} ${mode} ${quality}: ${result.fps.toFixed(1)} FPS, ${result.onePercentLowFps.toFixed(1)} 1% low, ${result.simulationTicksPerSecond.toFixed(1)} ticks/s`)
    return result
  } finally {
    await page.close()
  }
}

try {
  for (const stationId of ['zoo', 'tanwei']) {
    const modes = []
    // Alternate which renderer is measured first to reduce order/cache bias.
    const order = stationId === 'zoo' ? ['regular', 'explode'] : ['explode', 'regular']
    for (const mode of order) {
      const qualities = stationId === 'zoo' ? ['high', 'low'] : ['low', 'high']
      const qualityRuns = []
      for (const quality of qualities) qualityRuns.push(await measureMode(stationId, mode, quality))
      const high = qualityRuns.find(run => run.quality === 'high')
      const low = qualityRuns.find(run => run.quality === 'low')
      modes.push({
        mode,
        qualityRuns,
        lowMinusHigh: {
          fps: low.fps - high.fps,
          onePercentLowFps: low.onePercentLowFps - high.onePercentLowFps,
          simulationTicksPerSecond: low.simulationTicksPerSecond - high.simulationTicksPerSecond,
        },
      })
    }
    reports.push({ stationId, modes })
  }
  const report = {
    kind: 'exploded-view-simulation-fps',
    timestamp: new Date().toISOString(),
    environment: {
      cpu: cpus()[0]?.model,
      platform: process.platform,
      browser: 'Google Chrome headless, hardware rendering',
      viewport: process.env.BENCH_SIZE ?? '1400,900',
      gpuBackend: 'hardware ANGLE backend selected by Chrome',
    },
    config: { durationMs, warmupTicks, speed: 16, onePercentLow: '1000 / mean(slowest 1% submitted-frame intervals)' },
    reports,
  }
  writeFileSync(output, JSON.stringify(report, null, 2))
  console.log(`Report: ${output}`)
} finally {
  server.close()
}
