import { classifyGamePath } from './route-contract.mjs'

// Local/staging handler only. Production game Worker and routes are untouched.
export default {
 async fetch(request,env) {
  const url=new URL(request.url), mount=env.METRO_MOUNT??'/game'
  if(request.method!=='GET'&&request.method!=='HEAD') return new Response('Method not allowed',{status:405,headers:{allow:'GET, HEAD'}})
  const route=classifyGamePath(url.pathname,{mount})
  if(route.kind==='redirect'){url.pathname=route.path;return Response.redirect(url.toString(),308)}
  if(route.kind!=='document'&&route.kind!=='unity-asset')return new Response('Not found',{status:404})
  const manifestResponse=await env.ASSETS.fetch(new Request(new URL('/_unity-shell/manifest.json',url)))
  if(!manifestResponse.ok)return new Response('Release manifest unavailable',{status:503})
  const manifest=await manifestResponse.json()
  if(!manifest || !/^[a-f0-9]{40}-[a-f0-9]{16}$/.test(manifest.releaseId??'')||!Array.isArray(manifest.files))return new Response('Invalid release manifest',{status:503})
  if(route.kind==='unity-asset') {
   if(route.releaseId!==manifest.releaseId)return new Response('Not found',{status:404})
   const file=manifest.files.find(f=>f.path===route.path)
   if(!file)return new Response('Not found',{status:404})
   const resourceUrl=new URL(`/_unity/${manifest.releaseId}/${file.path}`,url)
   const upstream=await env.ASSETS.fetch(new Request(resourceUrl,{method:request.method,headers:{'accept-encoding':'identity'}}))
   if(!upstream.ok)return new Response('Asset missing',{status:502})
   const headers={'content-type':file.contentType,'content-length':String(file.bytes),'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff','x-metro-release':manifest.releaseId}
   if(file.compression) headers['content-encoding']=file.compression
   return new Response(request.method==='HEAD'?null:upstream.body,{status:200,headers,encodeBody:'manual'})
  }
  if(route.engine!=='unity')return new Response('Legacy route not available in local Unity proof',{status:404})
  const shell=await env.ASSETS.fetch(new Request(new URL('/_unity-shell/index.html',url)))
  if(!shell.ok)return new Response('Unity shell unavailable',{status:503})
  const assetBase=`${mount}/_unity/${manifest.releaseId}`
  const config={mount,locale:route.locale,demoId:route.demoId,releaseId:manifest.releaseId,assetBase,engine:'unity'}
  let html=await shell.text()
  html=html.replaceAll('__METRO_ASSET_BASE__',assetBase).replace('__METRO_LOCALE__',route.locale).replace('__METRO_CONFIG__',JSON.stringify(config).replace(/</g,'\\u003c'))
  if(html.includes('__METRO_'))return new Response('Invalid Unity shell',{status:503})
  return new Response(request.method==='HEAD'?null:html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-metro-release':manifest.releaseId}})
 }
}
