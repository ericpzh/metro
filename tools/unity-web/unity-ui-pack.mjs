import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Build once at packaging time so the staged resources and their inventory are
// derived from the same source as the host page, not a stale dist directory.
export function buildUnityUI(root) {
  const game = join(root, 'game')
  execFileSync(process.execPath, [join(game, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.unity-ui.config.ts'], { cwd: game, stdio: 'inherit' })
  const dist = join(game, 'dist-unity-ui')
  const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
  const entry = manifest['src/unity-web/main.tsx']?.file
  const css = manifest['src/unity-web/main.tsx']?.css?.[0] ?? Object.values(manifest).find(item => item.file?.endsWith('.css'))?.file
  if (!entry || !css) throw Error('Unity UI entry or stylesheet missing from Vite manifest')
  const files = new Map()
  function walk(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) walk(path)
    else if (item.isFile()) { const name = relative(dist, path).replaceAll('\\', '/'); if (!name.startsWith('.vite/')) files.set('UI/' + name, readFileSync(path)) }
    else throw Error('Unexpected Unity UI output')
  } }
  walk(dist)
  const thumbs = join(game, 'public/module-thumbnails')
  function addThumbnails(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) addThumbnails(path)
    else if (item.isFile()) files.set('UI/module-thumbnails/' + relative(thumbs, path).replaceAll('\\', '/'), readFileSync(path))
    else throw Error('Unexpected thumbnail entry')
  } }
  addThumbnails(thumbs)
  if (!files.has('UI/' + entry) || !files.has('UI/' + css)) throw Error('Unity UI manifest references missing assets')
  return { files, entry: 'UI/' + entry, css: 'UI/' + css }
}

export function attachUnityUI(html, ui, assetBase) {
  if (!html.includes('}).then((unityInstance) => {')) throw Error('Unexpected Unity initialization')
  html = html.replace('</head>', `<link rel="stylesheet" href="${assetBase}/${ui.css}">\n</head>`)
  const setup = `<script type="module">\nwindow.metroUnityUiBase = '${assetBase}/UI/';\nconst ui = await import('${assetBase}/${ui.entry}');\nconst host = document.createElement('div'); host.id = 'metro-unity-ui'; document.body.appendChild(host);\nconst unmount = ui.mountUnityUI(host, document.querySelector('#unity-canvas'));\nwindow.metroUnityUIReady = instance => ui.zooBridge.register(instance);\nif (window.metroUnityInstance) window.metroUnityUIReady(window.metroUnityInstance);\nwindow.addEventListener('pagehide', () => { unmount(); delete window.metroUnityUIReady; delete window.metroUnityInstance; }, { once: true });\n</script>\n`
  html = html.replace('</body>', setup + '</body>')
  return html.replace('}).then((unityInstance) => {', `}).then((unityInstance) => {\n                window.metroUnityInstance = unityInstance; window.metroUnityUIReady?.(unityInstance);`)
}
