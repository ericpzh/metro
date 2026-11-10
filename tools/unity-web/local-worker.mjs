export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/game/' || url.pathname === '/game/en/') {
      const response = await env.ASSETS.fetch(new Request(new URL('/', url), request))
      let html = await response.text()
      html = html.replace('<html lang="en-us">', `<html lang="${url.pathname === '/game/en/' ? 'en' : 'zh-CN'}">`)
      return new Response(html, {status:response.status, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})
    }
    if (url.pathname.startsWith('/game/_unity/')) {
      url.pathname = url.pathname.slice('/game/_unity'.length)
      const manifestResponse = await env.ASSETS.fetch(new Request(new URL('/manifest.json', url)))
      const manifest = await manifestResponse.json()
      const split = manifest.splitFiles?.[url.pathname.slice(1)]
      if (split) {
        const headers = {'content-type':'application/wasm','content-length':String(split.bytes),'cache-control':'no-store'}
        if (request.method === 'HEAD') return new Response(null,{headers})
        if (request.method !== 'GET') return new Response('Method not allowed',{status:405})
        const parts = await Promise.all(split.parts.map(part => env.ASSETS.fetch(new Request(new URL('/'+part,url)))))
        if (parts.some(part => !part.ok || !part.body)) return new Response('Missing smoke asset',{status:502})
        let index = 0, reader = parts[0].body.getReader()
        const body = new ReadableStream({async pull(controller) {
          while (index < parts.length) {
            const chunk = await reader.read()
            if (!chunk.done) { controller.enqueue(chunk.value); return }
            if (++index < parts.length) reader = parts[index].body.getReader()
          }
          controller.close()
        }, cancel() { return reader.cancel() }})
        return new Response(body,{headers})
      }
      return env.ASSETS.fetch(new Request(url,request))
    }
    return new Response('Not found',{status:404})
  }
}
