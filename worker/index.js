/**
 * The site's Worker entry point.
 *
 * Assets sit at the root of the Worker — https://stationdesigner.com/ — so a
 * request that matches a file never reaches this handler. Only the English route
 * needs it:
 *
 *   /en          → 308 /en/   so the document's relative `./assets/...` resolve
 *   /en/…        → the site document, aliased back to the asset root
 *
 * The English site is the same document everywhere; the client reads the `/en`
 * segment and renders the English copy (`web/src/i18n.js`), which is why the
 * segment is stripped before the asset layer sees it. Nothing else is rewritten:
 * a path with no file behind it is a real 404, not the site shell.
 *
 * `/game` never arrives here: the game's own Worker owns
 * stationdesigner.com/game and /game/* by a more specific route.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Language pin: a bare /en or /en/index.html snaps to /en/ so relative asset
    // paths resolve one level down.
    if (url.pathname === '/en' || url.pathname === '/en/index.html') {
      url.pathname = '/en/'
      return Response.redirect(url.toString(), 308)
    }

    if (!url.pathname.startsWith('/en/')) return env.ASSETS.fetch(request)

    url.pathname = url.pathname.slice(3) || '/'
    return env.ASSETS.fetch(new Request(url, request))
  },
}
