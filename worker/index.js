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
 */
export default {
  async fetch(request, env) {
    const prefix = env.ASSET_PREFIX ?? ''

    // Domain-root hosting: nothing to rewrite.
    if (!prefix) return env.ASSETS.fetch(request)

    const url = new URL(request.url)
    const mine = url.pathname === prefix || url.pathname.startsWith(prefix + '/')
    if (!mine) return env.ASSETS.fetch(request)

    const rest = url.pathname.slice(prefix.length)

    // The built site references its assets relatively (Vite `base: './'`), so
    // the directory URL must carry its trailing slash or `./assets/...` would
    // resolve one level too high. Same for an explicit /index.html, which the
    // asset layer would otherwise redirect to the domain root.
    if (rest === '' || rest === '/index.html') {
      url.pathname = prefix + '/'
      return Response.redirect(url.toString(), 308)
    }

    url.pathname = rest
    return env.ASSETS.fetch(new Request(url, request))
  },
}
