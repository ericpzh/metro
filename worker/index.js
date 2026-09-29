/**
 * Optional Worker entry point — only needed when the site is served from a path
 * prefix (for example example.com/metro/*) rather than a domain root.
 *
 * Enable it by uncommenting `main` in wrangler.jsonc and setting
 * `vars.ASSET_PREFIX` to the same prefix you attach the route to.
 *
 * How it works: with `assets` configured and no `run_worker_first`, this fetch
 * handler only runs when no static asset matches the request. Prefixed paths
 * never match, because the assets sit at the root of the Worker — so every
 * /metro/... request lands here and gets rewritten before being served.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const prefix = env.ASSET_PREFIX ?? ''

    if (prefix && (url.pathname === prefix || url.pathname.startsWith(prefix + '/'))) {
      url.pathname = url.pathname.slice(prefix.length) || '/'
    }

    return env.ASSETS.fetch(new Request(url, request))
  },
}
