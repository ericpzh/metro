/**
 * The game's Worker entry point.
 *
 * The game is served from a path prefix — https://ericpzh.rest/metro-game/ —
 * so the website's 游戏 tab can iframe it same-origin. Assets sit at the root of
 * the Worker, so the prefix has to be stripped before the asset layer sees it.
 *
 * With `assets` configured and no `run_worker_first`, this handler only runs
 * when no static asset matches. Prefixed paths never match (the assets are at
 * the root), so every prefixed request lands here.
 *
 * The Worker's own https://metro-game.<account>.workers.dev root keeps working
 * at the same time: non-prefixed requests fall straight through to the assets.
 */
export default {
  async fetch(request, env) {
    const prefix = env.ASSET_PREFIX ?? ''
    const url = new URL(request.url)

    // Domain-root hosting: nothing to rewrite.
    if (!prefix) return env.ASSETS.fetch(request)

    const mine = url.pathname === prefix || url.pathname.startsWith(prefix + '/')
    if (!mine) return env.ASSETS.fetch(request)

    let rest = url.pathname.slice(prefix.length)

    // The directory URL must carry its trailing slash or the game's relative
    // `./assets/...` would resolve one level too high. Same for an explicit
    // /index.html, which the asset layer would otherwise redirect to the root.
    if (rest === '' || rest === '/index.html') {
      url.pathname = prefix + '/'
      return Response.redirect(url.toString(), 308)
    }

    url.pathname = rest
    const res = await env.ASSETS.fetch(new Request(url, request))

    // Client routes such as /lab have no file behind them: serve the document
    // and let the app route. Anything with an extension is a real 404. Fetch
    // the directory root, not /index.html — asking for /index.html explicitly
    // is itself a redirect.
    if (res.status === 404 && !/\.[a-z0-9]+$/i.test(rest)) {
      url.pathname = '/'
      return env.ASSETS.fetch(new Request(url, request))
    }
    return res
  },
}
