/**
 * The game's Worker entry point.
 *
 * The game is served at /metro/game/ and /metro-game/. Assets sit at the root
 * of the Worker, so either prefix has to be stripped before the asset layer
 * sees it.
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
    const url = new URL(request.url)
    const prefixes = [env.ASSET_PREFIX ?? '', '/metro/game'].filter(Boolean).sort((a, b) => b.length - a.length)
    const prefix = prefixes.find((candidate) => url.pathname === candidate || url.pathname.startsWith(candidate + '/')) ?? ''

    const mine = prefix !== ''
    let rest = mine ? url.pathname.slice(prefix.length) : url.pathname
    const base = mine ? prefix : ''
    if (rest === '/en' || rest === '/en/index.html') {
      url.pathname = base + '/en/'
      return Response.redirect(url.toString(), 308)
    }
    const english = rest.startsWith('/en/')
    if (english) rest = rest.slice(3)

    // The directory URL must carry its trailing slash or the game's relative
    // `./assets/...` would resolve one level too high. Same for an explicit
    // /index.html, which the asset layer would otherwise redirect to the root.
    if (rest === '' || rest === '/index.html') {
      url.pathname = base + (english ? '/en/' : '/')
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
