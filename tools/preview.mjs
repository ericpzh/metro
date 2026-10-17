// A local preview of the **built** site and the **built** game, over one origin.
//
//   node tools/preview.mjs [port]        (default 4173)
//
// This is the stand-in for `npm run preview` when wrangler is not available — it
// is the same shape of thing (static files, an SPA fallback, the language pins),
// minus Cloudflare. It reads only build output:
//
//   /                  web/dist    — the art site          (English: /en/)
//   /game/             game/dist   — the game              (English: /game/en/)
//
// The game's demo routes (`/game/zoo`, `/game/tanwei`, and their `/game/en/…`
// twins) are client routes like `/game/lab`: the shell is served and the app
// reads the path. Both builds spell their assets relatively, and the game sits a
// level down, so each request has its language segment — and, for the game, its
// prefix — stripped before the file is looked up. Nothing is rebuilt here: run
// `npm run build` and `npm run build:game` first.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_SITE = join(repo, 'web', 'dist')
const DEFAULT_GAME = join(repo, 'game', 'dist')

/** The path the game's Worker is attached to. */
const GAME_PREFIX = '/game'

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
 * looks like a successful load. The game's client routes (`/game/lab`,
 * `/game/zoo`) get the shell; the site has none, so its misses are 404s too.
 */
async function pick(root, rel, shell) {
  const clean = normalize(rel).replace(/^([/\\])+/, '')
  if (!clean) return join(root, 'index.html')
  const direct = join(root, clean)
  if (direct.startsWith(root)) {
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
  if (!shell || extname(clean)) return null
  return join(root, 'index.html')
}

/**
 * The preview server: the built site at `/`, the built game at `/game`, with the
 * Workers' language pins and trailing-slash rules. `tools/check-demos.mjs` serves
 * both builds through this, so its URLs are the URLs the Workers answer.
 */
export function createPreview({ site = DEFAULT_SITE, game = DEFAULT_GAME } = {}) {
  return createServer((req, res) => {
    void (async () => {
      const url = decodeURIComponent((req.url || '/').split('?')[0])

      // The Workers 308 the bare directory forms so the document's relative
      // `./assets/...` resolve one level down instead of at the root.
      if (url === '/en' || url === GAME_PREFIX || url === GAME_PREFIX + '/en') {
        res.writeHead(308, { location: url + '/' })
        res.end()
        return
      }

      // The game owns /game and everything under it; the site owns the rest.
      const isGame = url === GAME_PREFIX || url.startsWith(GAME_PREFIX + '/')
      const under = isGame ? url.slice(GAME_PREFIX.length) || '/' : url
      // Language pin: /en/… is the English side of that app (same document — the
      // client reads the segment). Strip it for file resolution, mirroring the
      // Workers.
      const rest = under === '/en' || under.startsWith('/en/') ? under.slice(3) || '/' : under

      // A client route (/lab, /zoo, /tanwei) is served without a trailing slash:
      // with one, its relative `./assets/...` would resolve inside the route.
      if (rest.length > 1 && rest.endsWith('/') && !rest.slice(1, -1).includes('/')) {
        res.writeHead(308, { location: url.slice(0, -1) })
        res.end()
        return
      }

      const file = await pick(isGame ? game : site, rest, isGame)
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
}

// CLI: `npm run preview:local` / `node tools/preview.mjs [port]`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 4173)
  createPreview().listen(port, '127.0.0.1', () => {
    console.log(`preview:  http://127.0.0.1:${port}/`)
    console.log(`  site  <- ${DEFAULT_SITE}   (/ and /en/)`)
    console.log(`  game  <- ${DEFAULT_GAME}   (/game/, /game/en/, /game/zoo, /game/tanwei)`)
  })
}
