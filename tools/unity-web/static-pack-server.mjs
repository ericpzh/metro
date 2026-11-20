// A plain Node server for local previews and verification of a packed StationGame player.
//
// It serves the same player routes and assets as `local-worker.mjs`:
//
//   * the player page for `/game/`, `/game/en/` and the demo deep links,
//   * static files under `/game/_unity/...`,
//   * reassembly of the split `.wasm`/`.data` parts recorded in `manifest.json`.
//
//   node tools/unity-web/static-pack-server.mjs --pack <pack-dir> [--port 8799] [--ip 127.0.0.1]
//
// or import `createStaticServer(packDir)` and use `{ url, close }`.

import { createReadStream, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

/** Keep a request path inside the pack directory. */
function safeJoin(packDir, relative) {
  const full = resolve(packDir, '.' + normalize('/' + relative))
  if (full !== packDir && !full.startsWith(packDir + sep)) return null
  return full
}

function sendFile(res, path, method) {
  let info
  try { info = statSync(path) } catch { return false }
  if (!info.isFile()) return false
  res.writeHead(200, {
    'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': 'no-store',
  })
  if (method === 'HEAD') { res.end(); return true }
  createReadStream(path).pipe(res)
  return true
}

export function createStaticServer(packDir, requestedPort = 0, host = '127.0.0.1') {
  const pack = resolve(packDir)
  const manifest = JSON.parse(readFileSync(join(pack, 'manifest.json'), 'utf8'))
  const indexHtml = readFileSync(join(pack, 'index.html'), 'utf8')

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end('Method not allowed')
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const pathname = decodeURIComponent(url.pathname)
    const redirect = to => { res.writeHead(308, { location: to }); res.end() }

    if (pathname === '/') return redirect('/game/')
    if (pathname === '/en' || pathname === '/en/') return redirect('/game/en/')
    if (pathname === '/game' || pathname === '/game/index.html') return redirect('/game/')
    if (pathname === '/game/en' || pathname === '/game/en/index.html') return redirect('/game/en/')
    if (pathname === '/game/unity' || pathname === '/game/unity/index.html') return redirect('/game/unity/')
    if (pathname === '/game/unity/en' || pathname === '/game/unity/en/index.html') return redirect('/game/unity/en/')

    const prefix = pathname.startsWith('/game/unity/') ? '/game/unity'
      : pathname.startsWith('/game/') ? '/game'
      : null
    if (prefix) {
      const rest = pathname.slice(prefix.length)
      if (rest.startsWith('/_unity/')) {
        const assetPath = rest.slice('/_unity'.length)
        if (!assetPath || assetPath === '/') { res.writeHead(404); res.end('Not found'); return }
        const relative = assetPath.slice(1)
        const direct = safeJoin(pack, relative)
        if (direct && sendFile(res, direct, method)) return
        const split = manifest?.splitFiles?.[relative]
        if (!split || !Array.isArray(split.parts) || split.parts.length === 0 || !Number.isInteger(split.bytes)) {
          res.writeHead(404); res.end('Not found'); return
        }
        res.writeHead(200, {
          'content-type': relative.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
          'content-encoding': 'identity',
          'content-length': String(split.bytes),
          'cache-control': 'no-store',
        })
        if (method === 'HEAD') { res.end(); return }
        let index = 0
        const next = () => {
          if (index >= split.parts.length) { res.end(); return }
          const part = safeJoin(pack, split.parts[index++])
          if (!part) { res.destroy(); return }
          const stream = createReadStream(part)
          stream.on('end', next)
          stream.on('error', () => res.destroy())
          stream.pipe(res, { end: false })
        }
        next()
        return
      }
      const segments = rest.split('/').filter(Boolean)
      if (segments.length === 1 && segments[0] !== 'en' && rest.endsWith('/')) return redirect(`${prefix}/${segments[0]}`)
      if (segments.length === 2 && (segments[0] === 'en' || (segments[0] === 'benchmark' && segments[1] === 'en')) && rest.endsWith('/')) {
        return redirect(`${prefix}/${segments[0]}/${segments[1]}`)
      }
      const english = segments[0] === 'en' || (segments[0] === 'benchmark' && segments[1] === 'en')
      let html = indexHtml.replace('<html lang="en-us">', `<html lang="${english ? 'en' : 'zh-CN'}">`)
      if (prefix !== '/game') html = html.replaceAll('/game/_unity', `${prefix}/_unity`)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(method === 'HEAD' ? undefined : html)
      return
    }
    res.writeHead(404)
    res.end('Not found')
  })

  return new Promise((ok, bad) => {
    server.once('error', bad)
    server.listen(requestedPort, host, () => {
      const { port } = server.address()
      const urlHost = host.includes(':') ? `[${host}]` : host
      ok({ url: `http://${urlHost}:${port}`, port, close: () => server.close() })
    })
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
  const pack = arg('--pack')
  const port = Number(arg('--port') ?? 0)
  if (!pack) {
    console.error('usage: node tools/unity-web/static-pack-server.mjs --pack <pack-dir> [--port 8799] [--ip 127.0.0.1]')
    process.exit(2)
  }
  const { url } = await createStaticServer(pack, port, arg('--ip'))
  console.log(`static pack server: ${url}/game/ (pack ${pack})`)
}

