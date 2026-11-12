import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import localWorker from '../../tools/unity-web/local-worker.mjs'
import { attachUnityUI, buildUnityUI } from '../../tools/unity-web/unity-ui-pack.mjs'
import {
  MUTABLE_BUILD_INPUTS,
  parseUnityStartArgs,
  snapshotDirectoryInputs,
  verifyRawBuild,
} from '../../tools/unity-web/start-unity.mjs'

const repo = resolve(import.meta.dirname, '../..')

function createMockEnv({ parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6, 7, 8, 9])] } = {}) {
  let manifestFetches = 0
  let activePartStreams = 0
  let maxConcurrentPartStreams = 0
  const fetchedParts = []
  const cancelledParts = []

  const totalBytes = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const manifest = {
    splitFiles: {
      'Build/web-Release.data': {
        parts: parts.map((_, index) => `Build/web-Release.data.part${index}`),
        bytes: totalBytes,
      },
      'Build/web-Release.wasm': {
        parts: ['Build/web-Release.wasm.part0'],
        bytes: 4,
      },
    },
  }

  function makeTrackedPartStream(partIndex, bytes) {
    activePartStreams += 1
    maxConcurrentPartStreams = Math.max(maxConcurrentPartStreams, activePartStreams)
    let offset = 0
    return new ReadableStream(
      {
        pull(controller) {
          if (offset < bytes.byteLength) {
            controller.enqueue(bytes.subarray(offset, offset + 1))
            offset += 1
            return
          }
          activePartStreams -= 1
          controller.close()
        },
        cancel() {
          activePartStreams -= 1
          cancelledParts.push(partIndex)
        },
      },
      { highWaterMark: 0 },
    )
  }

  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname
        if (pathname === '/') {
          return new Response('<!DOCTYPE html><html lang="en-us"><body>player</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        }
        if (pathname === '/UI/assets/station.js') {
          return new Response('export const ok = true', {
            status: 200,
            headers: { 'content-type': 'text/javascript' },
          })
        }
        if (pathname === '/manifest.json') {
          manifestFetches += 1
          return Response.json(manifest)
        }
        const dataMatch = /^\/Build\/web-Release\.data\.part(\d+)$/.exec(pathname)
        if (dataMatch) {
          const index = Number(dataMatch[1])
          fetchedParts.push(index)
          if (!parts[index]) return new Response('missing', { status: 404 })
          return new Response(makeTrackedPartStream(index, parts[index]), { status: 200 })
        }
        if (pathname === '/Build/web-Release.wasm.part0') {
          fetchedParts.push('wasm0')
          return new Response(new Uint8Array([0x00, 0x61, 0x73, 0x6d]), { status: 200 })
        }
        return new Response('Not found', { status: 404 })
      },
    },
  }

  return {
    env,
    stats: () => ({ manifestFetches, activePartStreams, maxConcurrentPartStreams, fetchedParts, cancelledParts }),
  }
}

test('local Worker redirects root and canonicalizes game and demo paths', async () => {
  const { env } = createMockEnv()
  const cases = [
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787/game/'],
    ['http://127.0.0.1:8787/en', 'http://127.0.0.1:8787/game/en/'],
    ['http://127.0.0.1:8787/en/', 'http://127.0.0.1:8787/game/en/'],
    ['http://127.0.0.1:8787/game', 'http://127.0.0.1:8787/game/'],
    ['http://127.0.0.1:8787/game/en', 'http://127.0.0.1:8787/game/en/'],
    ['http://127.0.0.1:8787/game/zoo/?debug=1', 'http://127.0.0.1:8787/game/zoo?debug=1'],
    ['http://127.0.0.1:8787/game/en/tianhe/', 'http://127.0.0.1:8787/game/en/tianhe'],
  ]
  for (const [input, expected] of cases) {
    const res = await localWorker.fetch(new Request(input), env)
    assert.equal(res.status, 308, `expected 308 for ${input}`)
    assert.equal(res.headers.get('location'), expected)
  }

  const zh = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/zoo'), env)
  assert.equal(zh.status, 200)
  assert.match(await zh.text(), /<html lang="zh-CN">/)

  const en = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/en/tanwei'), env)
  assert.equal(en.status, 200)
  assert.match(await en.text(), /<html lang="en">/)

  const head = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/en/', { method: 'HEAD' }), env)
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  const post = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/', { method: 'POST' }), env)
  assert.equal(post.status, 405)
})

test('local Worker serves unsplit assets directly and streams split files sequentially with Content-Length', async () => {
  const { env, stats } = createMockEnv()

  // Direct asset hits never touch manifest.json.
  const direct = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/_unity/UI/assets/station.js'), env)
  assert.equal(direct.status, 200)
  assert.equal(await direct.text(), 'export const ok = true')
  assert.equal(stats().manifestFetches, 0)

  // HEAD on split .wasm reports MIME and Content-Length without opening part streams.
  const wasmHead = await localWorker.fetch(
    new Request('http://127.0.0.1:8787/game/_unity/Build/web-Release.wasm', { method: 'HEAD' }),
    env,
  )
  assert.equal(wasmHead.status, 200)
  assert.equal(wasmHead.headers.get('content-type'), 'application/wasm')
  assert.equal(wasmHead.headers.get('content-encoding'), 'identity')
  assert.equal(wasmHead.headers.get('content-length'), '4')
  assert.deepEqual(stats().fetchedParts, [])

  // GET on split .data streams parts one at a time (never concurrently buffering all parts).
  const dataGet = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/_unity/Build/web-Release.data'), env)
  assert.equal(dataGet.status, 200)
  assert.equal(dataGet.headers.get('content-encoding'), 'identity')
  assert.equal(dataGet.headers.get('content-length'), '9')
  const bytes = new Uint8Array(await dataGet.arrayBuffer())
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6, 7, 8, 9])
  assert.equal(stats().maxConcurrentPartStreams, 1)
  assert.equal(stats().activePartStreams, 0)
  assert.deepEqual(stats().fetchedParts, [0, 1, 2])
})

test('local Worker cancels the active part reader and never opens remaining parts on abort', async () => {
  const { env, stats } = createMockEnv()
  const res = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/_unity/Build/web-Release.data'), env)
  const reader = res.body.getReader()
  const first = await reader.read()
  assert.equal(first.done, false)
  assert.deepEqual([...first.value], [1])
  await reader.cancel('page reload')
  assert.deepEqual(stats().fetchedParts, [0])
  assert.deepEqual(stats().cancelledParts, [0])
  assert.equal(stats().activePartStreams, 0)
})

test('local Worker pipes split streams through FixedLengthStream when provided by runtime', async () => {
  let fixedExpectedLength = null
  const previous = globalThis.FixedLengthStream
  globalThis.FixedLengthStream = class MockFixedLengthStream extends TransformStream {
    constructor(expectedLength) {
      super()
      fixedExpectedLength = expectedLength
    }
  }
  try {
    const { env } = createMockEnv()
    const res = await localWorker.fetch(new Request('http://127.0.0.1:8787/game/_unity/Build/web-Release.wasm'), env)
    assert.equal(res.status, 200)
    assert.equal(fixedExpectedLength, 4)
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [0x00, 0x61, 0x73, 0x6d])
  } finally {
    if (previous === undefined) delete globalThis.FixedLengthStream
    else globalThis.FixedLengthStream = previous
  }
})

test('start-unity CLI parser and raw build verifier detect input and output drift', () => {
  assert.deepEqual(parseUnityStartArgs([]), {
    buildOnly: false,
    rebuild: false,
    bootstrap: false,
    help: false,
    port: 8787,
    ip: '127.0.0.1',
    scene: 'StationGame',
    configuration: 'Release',
  })
  assert.deepEqual(
    parseUnityStartArgs(['--build-only', '--rebuild', '--port', '8790', '--scene', 'ZooPlayable', '--configuration', 'Development']),
    {
      buildOnly: true,
      rebuild: true,
      bootstrap: false,
      help: false,
      port: 8790,
      ip: '127.0.0.1',
      scene: 'ZooPlayable',
      configuration: 'Development',
    },
  )
  assert.throws(() => parseUnityStartArgs(['--port', '70000']), /Invalid --port/)
  assert.throws(() => parseUnityStartArgs(['--scene', 'Unknown']), /Invalid --scene/)
  assert.throws(() => parseUnityStartArgs(['--bogus']), /Unknown unity option/)

  const sandbox = mkdtempSync(join(tmpdir(), 'metro-unity-verify-'))
  try {
    const proj = join(sandbox, 'project')
    mkdirSync(join(proj, 'Assets/Settings'), { recursive: true })
    mkdirSync(join(proj, 'Packages'), { recursive: true })
    mkdirSync(join(proj, 'ProjectSettings'), { recursive: true })
    mkdirSync(join(sandbox, 'fixtures'), { recursive: true })
    writeFileSync(join(proj, 'Assets/Host.cs'), 'class Host {}')
    writeFileSync(join(proj, 'Assets/Settings/UniversalRenderPipelineGlobalSettings.asset'), 'mutable-1')
    writeFileSync(join(proj, 'Packages/manifest.json'), '{}')
    writeFileSync(join(proj, 'ProjectSettings/ProjectVersion.txt'), 'm_EditorVersion: 6000.6.8f1')
    writeFileSync(join(sandbox, 'fixtures/valid.json'), '{}')

    const inputs = snapshotDirectoryInputs(proj, ['Assets', 'Packages', 'ProjectSettings'], { ignore: MUTABLE_BUILD_INPUTS })
    const fixtures = snapshotDirectoryInputs(sandbox, ['fixtures'])
    assert.ok(!inputs.some(entry => entry.Path.includes('UniversalRenderPipelineGlobalSettings.asset')))

    const raw = join(sandbox, 'web-Release')
    mkdirSync(join(raw, 'Build'), { recursive: true })
    const rawFiles = {
      'index.html': '<html></html>',
      'Build/web-Release.loader.js': 'loader',
      'Build/web-Release.framework.js': 'framework',
      'Build/web-Release.data': 'data',
      'Build/web-Release.wasm': 'wasm',
    }
    const fileEntries = []
    for (const [rel, content] of Object.entries(rawFiles)) {
      const bytes = Buffer.from(content)
      writeFileSync(join(raw, rel), bytes)
      fileEntries.push({
        Path: rel,
        Bytes: bytes.length,
        SHA256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      })
    }
    writeFileSync(`${raw}.report.json`, JSON.stringify({ result: 'Succeeded' }))
    writeFileSync(
      `${raw}.provenance.json`,
      JSON.stringify({
        Scene: 'Assets/StationDesigner/Scenes/StationGame.unity',
        Configuration: 'Release',
        EditorVersionWithRevision: '6000.6.8f1 (237b6593792b)',
        InputsVerifiedAfterBuild: true,
        Inputs: inputs,
        Fixtures: fixtures,
        Files: fileEntries,
      }),
    )

    // Mutable URP asset changes are ignored just like metro-unity.ps1.
    writeFileSync(join(proj, 'Assets/Settings/UniversalRenderPipelineGlobalSettings.asset'), 'mutable-2')
    const inputsAfterMutable = snapshotDirectoryInputs(proj, ['Assets', 'Packages', 'ProjectSettings'], {
      ignore: MUTABLE_BUILD_INPUTS,
    })
    assert.equal(
      verifyRawBuild(raw, {
        inputs: inputsAfterMutable,
        fixtures,
        scene: 'StationGame',
        configuration: 'Release',
        editorVersionWithRevision: '6000.6.8f1 (237b6593792b)',
      }).ok,
      true,
    )

    // Any real C# change invalidates the cached build.
    writeFileSync(join(proj, 'Assets/Host.cs'), 'class Host { int x; }')
    const changedInputs = snapshotDirectoryInputs(proj, ['Assets', 'Packages', 'ProjectSettings'], {
      ignore: MUTABLE_BUILD_INPUTS,
    })
    const stale = verifyRawBuild(raw, {
      inputs: changedInputs,
      fixtures,
      scene: 'StationGame',
      configuration: 'Release',
      editorVersionWithRevision: '6000.6.8f1 (237b6593792b)',
    })
    assert.equal(stale.ok, false)
    assert.match(stale.reason, /Unity project inputs changed/)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('Unity UI bundle excludes Three.js crowd/map payloads and replaces default Unity loader with web #game-loading shell', () => {
  const ui = buildUnityUI(repo, 'src/unity-web/main.tsx')
  assert.match(ui.entry, /^UI\/assets\/(station|main)-.*\.js$/)
  if (existsSync(join(repo, 'game/src/unity-web/zooUi.tsx'))) {
    const zooUi = buildUnityUI(repo, 'src/unity-web/zooUi.tsx')
    assert.match(zooUi.entry, /^UI\/assets\/zoo-.*\.js$/)
  }

  const paths = [...ui.files.keys()]
  assert.ok(!paths.some(path => /passenger-.*\.bin$/.test(path)), 'Three.js passenger binary chunks leaked into Unity UI')
  assert.ok(!paths.some(path => /beijing-map|chengdu-map|shanghai-map/.test(path)), 'Three.js city line maps leaked into Unity UI')
  for (const [path, bytes] of ui.files) {
    assert.ok(bytes.byteLength < 10 * 1024 * 1024, `Unity UI asset unexpectedly large (${bytes.byteLength} bytes): ${path}`)
  }

  const css = ui.files.get(ui.css)?.toString('utf8') ?? ''
  assert.match(css, /#unity-container[\s\S]*z-index:\s*15/)
  assert.match(css, /pointer-events:\s*none/)
  assert.match(css, /#unity-loading-container[\s\S]*display:\s*none\s*!important/)

  const template = `<!DOCTYPE html>
<html lang="en-us">
  <head>
    <meta charset="utf-8">
    <title>Unity Web Player | Metro</title>
  </head>
  <body>
    <div id="unity-container">
      <canvas id="unity-canvas"></canvas>
      <div id="unity-loading-container"><div id="unity-progress-bar-full"></div></div>
    </div>
    <script>
      createUnityInstance(canvas, config, (progress) => {
        progressBarFull.style.width = 100 * progress + "%";
      }).then((unityInstance) => {
        loadingContainer.classList.add("finished");
      }).catch((message) => {
        alert(message);
      });
    </script>
  </body>
</html>`
  const attached = attachUnityUI(template, ui, '/game/_unity')
  assert.match(attached, /<title>车站设计师 · Station Designer<\/title>/)
  assert.match(attached, /id="game-loading"/)
  assert.match(attached, /<div class="loading-brand">Station Designer<\/div>/)
  assert.match(attached, /id="loading-title">正在准备车站<\/h1>/)
  assert.match(attached, /id="loading-detail">正在加载游戏并构建车站，请稍候。<\/p>/)
  assert.match(attached, /html\[data-ui-theme="site"\] #game-loading/)
  assert.match(attached, /html\[data-ui-theme="studio"\] #game-loading/)
  assert.match(attached, /#unity-loading-container,\s*#unity-footer\s*\{\s*display:none\s*!important;\s*\}/)
  assert.match(attached, /window\.__metroUnityProgress\?\.\(progress\)/)
  assert.match(attached, /window\.__metroUnityFail\?\.\(message\)/)
  assert.doesNotMatch(attached, /alert\(message\)/)
})
