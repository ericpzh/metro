function redirect(url, pathname) {
  const target = new URL(url)
  target.pathname = pathname
  return Response.redirect(target.toString(), 308)
}

function streamSplitAsset(url, env, relPath, split, firstPart) {
  let index = 0
  let reader = firstPart.body.getReader()
  let transferred = 0
  const source = new ReadableStream({
    async pull(controller) {
      while (true) {
        const chunk = await reader.read()
        if (!chunk.done) {
          transferred += chunk.value.byteLength
          controller.enqueue(chunk.value)
          return
        }
        reader.releaseLock()
        reader = null
        index += 1
        if (index >= split.parts.length) {
          if (transferred !== split.bytes) {
            controller.error(new Error(`Split asset size mismatch for ${relPath}: expected ${split.bytes}, got ${transferred}`))
            return
          }
          controller.close()
          return
        }
        const next = await env.ASSETS.fetch(new Request(new URL('/' + split.parts[index], url), { headers: { 'accept-encoding': 'identity' } }))
        if (!next.ok || !next.body) {
          controller.error(new Error(`Missing split asset part: ${split.parts[index]}`))
          return
        }
        reader = next.body.getReader()
      }
    },
    async cancel(reason) {
      if (!reader) return
      const active = reader
      reader = null
      try {
        await active.cancel(reason)
      } catch {}
    },
  })
  if (typeof FixedLengthStream === 'function') {
    const fixed = new FixedLengthStream(split.bytes)
    source.pipeTo(fixed.writable).catch(() => {})
    return fixed.readable
  }
  return source
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
    }
    const url = new URL(request.url)
    if (url.pathname === '/') return redirect(url, '/game/')
    if (url.pathname === '/en' || url.pathname === '/en/') return redirect(url, '/game/en/')
    if (url.pathname === '/game' || url.pathname === '/game/index.html') return redirect(url, '/game/')
    if (url.pathname === '/game/en' || url.pathname === '/game/en/index.html') return redirect(url, '/game/en/')

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] === 'game' && segments[1] !== '_unity') {
      if (segments.length === 2 && segments[1] !== 'en' && url.pathname.endsWith('/')) {
        return redirect(url, `/game/${segments[1]}`)
      }
      if (segments.length === 3 && segments[1] === 'en' && url.pathname.endsWith('/')) {
        return redirect(url, `/game/en/${segments[2]}`)
      }
      // The player page: `/game/` and `/game/en/`, plus the demo deep links
      // `/game/zoo` and `/game/en/tanwei` that the shell reads and then rewrites to
      // the plain path after the commit (`11 A6`). Assets under `/game/_unity/` are
      // not pages.
      const english = segments[1] === 'en'
      const response = await env.ASSETS.fetch(new Request(new URL('/', url)))
      let html = await response.text()
      html = html.replace('<html lang="en-us">', `<html lang="${english ? 'en' : 'zh-CN'}">`)
      return new Response(request.method === 'HEAD' ? null : html, {
        status: response.status,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    if (url.pathname.startsWith('/game/_unity/')) {
      const assetPath = url.pathname.slice('/game/_unity'.length)
      if (!assetPath || assetPath === '/') return new Response('Not found', { status: 404 })
      const assetUrl = new URL(url)
      assetUrl.pathname = assetPath
      const direct = await env.ASSETS.fetch(new Request(assetUrl, request))
      if (direct.status !== 404) return direct

      const manifestResponse = await env.ASSETS.fetch(new Request(new URL('/manifest.json', url)))
      if (!manifestResponse.ok) return direct
      const manifest = await manifestResponse.json()
      const relPath = assetPath.slice(1)
      const split = manifest?.splitFiles?.[relPath]
      if (!split) return direct
      if (!Array.isArray(split.parts) || split.parts.length === 0 || !Number.isInteger(split.bytes) || split.bytes < 0) {
        return new Response('Invalid split asset metadata', { status: 502 })
      }
      const headers = {
        'content-type': assetPath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
        'content-encoding': 'identity',
        'content-length': String(split.bytes),
        'cache-control': 'no-store',
      }
      if (request.method === 'HEAD') return new Response(null, { headers, encodeBody: 'manual' })
      const firstPart = await env.ASSETS.fetch(new Request(new URL('/' + split.parts[0], url), { headers: { 'accept-encoding': 'identity' } }))
      if (!firstPart.ok || !firstPart.body) return new Response('Missing smoke asset', { status: 502 })
      return new Response(streamSplitAsset(url, env, relPath, split, firstPart), { headers, encodeBody: 'manual' })
    }
    return new Response('Not found', { status: 404 })
  },
}
