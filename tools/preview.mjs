// A local preview of the **built** site and the **built** game, over one origin.
//
//   node tools/preview.mjs [port]        (default 4173)
//
// This is the stand-in for `npm run preview` when wrangler is not available — it
// is the same shape of thing (static files, an SPA fallback, path prefixes),
// minus Cloudflare. It reads only build output:
//
//   /                  web/dist    — the art site
//   /game/             game/dist   — the game
//   /metro-game/       game/dist   — the same build, at the path the deployed
//                                    site points its 游戏 tab at
//
// Two builds spell their assets relatively, and one of them sits a level down, so
// each prefixed request is tried against the game root, then the site root, then
// the game root with the prefix stripped — see the candidates in the handler.
//
// Nothing is rebuilt here: run `npm run build` and `npm run build:game` first.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(repo, 'web', 'dist')
const GAME = join(repo, 'game', 'dist')
const port = Number(process.argv[2] || 4173)

/** The two prefixes the game answers on: this repo's own, and the deployed one. */
const GAME_PREFIXES = ['/game', '/metro-game']

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Resolve one request against a build directory.
 *
 * A path with a file extension is an **asset**, and a missing one is a real 404
 * — answering it with the app shell is how a dropped sheet or a stale asset hash
 * looks like a successful load. Everything else is an app route and gets the
 * shell, which is what the SPA fallback is for.
 */
async function pick(root, rel) {
  const clean = normalize(rel).replace(/^([/\\])+/, '')
  const direct = join(root, clean)
  if (direct.startsWith(root) && clean) {
    try {
      const s = await stat(direct)
      if (s.isFile()) return direct
      if (s.isDirectory()) {
        const idx = join(direct, 'index.html')
        if ((await stat(idx)).isFile()) return idx
      }
    } catch {
      /* not a file: an asset 404s, a route gets the shell */
    }
  }
  if (extname(clean)) return null
  return join(root, 'index.html')
}

const server = createServer((req, res) => {
  void (async () => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    // A game prefix owns the request; everything else is the site.
    const prefix = GAME_PREFIXES.find((p) => url === p || url.startsWith(p + '/'))
    const rest = prefix ? url.slice(prefix.length) || '/' : url

    // Both builds spell their assets relatively, so a prefixed request can mean
    // either of two files:
    //
    //   /game/assets/…        the game, whose own index.html asks for its bundle
    //   /metro-game/assets/…  the same game build, at the deployed prefix
    //
    // The game root is tried first, then the site root (so a prefixed path can
    // still reach the site's own files), then the game root with the prefix
    // stripped — which is where the game's bundle lives. First hit wins.
    const candidates = prefix
      ? [
          { root: GAME, rest },
          { root: SITE, rest },
          { root: GAME, rest: rest.replace(/^\/assets\//, '/') },
        ]
      : [{ root: SITE, rest }]
    let file = null
    for (const c of candidates) {
      file = await pick(c.root, c.rest)
      if (file) break
    }

    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`not found: ${url}`)
      return
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`not found: ${url}\n\nIs the build there?\n  npm run build\n  npm run build:game\n\n${err}`)
    }
  })()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`preview:  http://127.0.0.1:${port}/`)
  console.log(`  site  <- ${SITE}`)
  console.log(`  game  <- ${GAME}   (/game/ and /metro-game/)`)
})
