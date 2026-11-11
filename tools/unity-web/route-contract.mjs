export function validResourcePath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 512 &&
    !path.startsWith('/') && !path.includes('\\') && !path.includes('%') &&
    !/(?:^|\/)(?:Library|Temp|Logs|node_modules)(?:\/|$)/i.test(path) &&
    !/\.symbols\.json(?:\.(?:br|gz))?$/i.test(path) &&
    path.split('/').every(s => s && s !== '.' && s !== '..' && /^[A-Za-z0-9_.-]+$/.test(s))
}

// Explicit mount avoids treating the site's / or /gameplay as a game route.
// Pass the unnormalized request path and query separately; redirect callers keep query.
export function classifyGamePath(path, { mount = '/game', demoIds = ['zoo','tanwei','tianhe'], engine = 'unity' } = {}) {
  if (!['','/game'].includes(mount) || !['unity','legacy'].includes(engine)) throw Error('Invalid route configuration')
  if (typeof path !== 'string' || !path.startsWith('/') || /[\\?#]/.test(path) || /%(?:2f|5c|2e)/i.test(path)) return {kind:'not-found'}
  let decoded
  try { decoded = decodeURIComponent(path) } catch { return {kind:'not-found'} }
  if (decoded.includes('%') || decoded.split('/').some(s => s === '.' || s === '..')) return {kind:'not-found'}
  if (mount && path !== mount && !path.startsWith(mount + '/')) return {kind:'outside'}
  let rest = path.slice(mount.length)
  if (rest === '' || rest === '/index.html') return {kind:'redirect',path:mount+'/'}
  if (rest === '/en' || rest === '/en/index.html') return {kind:'redirect',path:mount+'/en/'}
  if (rest.startsWith('/_unity/')) {
    const m = /^\/_unity\/([a-f0-9]{40}-[a-f0-9]{16})\/(.+)$/.exec(rest)
    return m && validResourcePath(m[2]) ? {kind:'unity-asset',releaseId:m[1],path:m[2],mount} : {kind:'not-found'}
  }
  if (rest.startsWith('/_unity-shell/')) {
    const name=rest.slice('/_unity-shell/'.length)
    return validResourcePath(name) ? {kind:'shell-asset',path:name,mount} : {kind:'not-found'}
  }
  if (['/benchmark','/benchmark/en','/lab','/en/lab'].includes(rest)) return {kind:'legacy-tool',path:rest,mount}
  let legacy = false
  if (rest === '/legacy' || rest === '/legacy/index.html') return {kind:'redirect',path:mount+'/legacy/'}
  if (rest.startsWith('/legacy/')) { legacy=true; rest=rest.slice(7) }
  if (legacy && (rest === '/en' || rest === '/en/index.html')) return {kind:'redirect',path:mount+'/legacy/en/'}
  const en = rest.startsWith('/en/')
  if (en) rest=rest.slice(3)
  const locale=en?'en':'zh-CN', prefix=mount+(legacy?'/legacy':'')+(en?'/en':'')
  if (rest === '/') return {kind:'document',mount,locale,demoId:null,engine:legacy?'legacy':engine}
  const demo = /^\/([^/]+)(\/?)$/.exec(rest)
  if (demo && demoIds.includes(demo[1])) {
    if (demo[2]) return {kind:'redirect',path:prefix+'/'+demo[1]}
    return {kind:'document',mount,locale,demoId:demo[1],engine:legacy?'legacy':engine}
  }
  return {kind:'not-found'}
}


