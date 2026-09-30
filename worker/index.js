/**
 * Optional Worker entry point — only needed when the site is served from a path
 * prefix (for example example.com/your-route/metro/) rather than a domain root.
 *
 * Enable it by uncommenting `main` in wrangler.jsonc, uncommenting
 * `assets.binding`, and setting `vars.ASSET_PREFIX` to the same prefix you
 * attach the route to.
 *
 * How it works: with `assets` configured and no `run_worker_first`, this fetch
 * handler only runs when no static asset matches the request. Prefixed paths
 * never match, because the assets sit at the root of the Worker — so every
 * prefixed request lands here and gets rewritten before being served.
 *
 * `/<prefix>/game/` is the website's game tab: the same document as the site
 * root, rendered as a full-viewport iframe around the game's own Worker. It is
 * aliased back to the root so the document's relative `./assets/...` resolve
 * under `/game/` without a second HTML entry.
 */
export default {
  async fetch(request, env) {
    const prefix = env.ASSET_PREFIX ?? ''

    // Domain-root hosting: nothing to rewrite.
    if (!prefix) return env.ASSETS.fetch(request)

    const url = new URL(request.url)
    const mine = url.pathname === prefix || url.pathname.startsWith(prefix + '/')
    if (!mine) return env.ASSETS.fetch(request)

    let rest = url.pathname.slice(prefix.length)
    // Where the bare/`index.html` redirects should land — the game tab stays
    // under /game/ rather than snapping back to the art page.
    const game = rest === '/game' || rest.startsWith('/game/')
    const home = game ? prefix + '/game/' : prefix + '/'

    if (rest === '' || rest === '/index.html') {
      url.pathname = home
      return Response.redirect(url.toString(), 308)
    }
    if (game) {
      const sub = rest.slice('/game'.length)
      if (sub === '' || sub === '/index.html') {
        url.pathname = home
        return Response.redirect(url.toString(), 308)
      }
      rest = sub
    }

    url.pathname = rest
    const res = await env.ASSETS.fetch(new Request(url, request))

    // The tab is a client route with no file behind it: serve the document so
    // the app can render it. Anything with an extension is a real 404. Fetch
    // the directory root, not /index.html — asking for /index.html explicitly
    // is itself a redirect.
    if (res.status === 404 && !/\.[a-z0-9]+$/i.test(rest)) {
      url.pathname = '/'
      return env.ASSETS.fetch(new Request(url, request))
    }
    return res
  },
}
