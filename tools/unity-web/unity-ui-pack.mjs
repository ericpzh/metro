import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Build once at packaging time so the staged resources and their inventory are
// derived from the same source as the host page, not a stale dist directory.
export function buildUnityUI(root, entryPath = 'src/unity-web/main.tsx') {
  const game = join(root, 'game')
  execFileSync(process.execPath, [join(game, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.unity-ui.config.ts'], { cwd: game, stdio: 'inherit' })
  const dist = join(game, 'dist-unity-ui')
  const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
  const source = manifest[entryPath] ?? Object.values(manifest).find(item => item.src === entryPath)
  const entry = source?.file
  const css = source?.css?.[0] ?? Object.values(manifest).find(item => item.file?.endsWith('.css'))?.file
  if (!entry || !css) throw Error(`Unity UI entry ${entryPath} or stylesheet missing from Vite manifest`)
  const files = new Map()
  function walk(dir) { for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) walk(path)
    else if (item.isFile()) { const name = relative(dist, path).replaceAll('\\', '/'); if (!name.startsWith('.vite/')) files.set('UI/' + name, readFileSync(path)) }
    else throw Error('Unexpected Unity UI output')
  } }
  walk(dist)
  function addPublicAssets(root, dir, prefix) { for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name)
    if (item.isDirectory()) addPublicAssets(root, path, prefix)
    else if (item.isFile()) files.set(prefix + relative(root, path).replaceAll('\\', '/'), readFileSync(path))
    else throw Error(`Unexpected entry in ${root}`)
  } }
  for (const folder of ['module-thumbnails', 'audio']) {
    const path = join(game, 'public', folder)
    addPublicAssets(path, path, `UI/${folder}/`)
  }
  if (!files.has('UI/' + entry) || !files.has('UI/' + css)) throw Error('Unity UI manifest references missing assets')
  return { files, entry: 'UI/' + entry, css: 'UI/' + css }
}

const LOADING_STYLES = `<style id="metro-loading-style">
  #unity-loading-container, #unity-footer { display:none !important; }
  #game-loading { position:fixed; inset:0; z-index:20000; display:grid; place-items:center; padding:24px; background:#06111d; color:#d6e7f7; font:14px system-ui,sans-serif; }
  #game-loading[hidden] { display:none; }
  #game-loading .loading-card { width:min(390px,100%); padding:28px; border:1px solid #315776; background:#0b1b2c; box-shadow:0 20px 70px #0005; }
  #game-loading .loading-brand { color:#8fc4ee; font-size:11px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; }
  #game-loading h1 { margin:20px 0 8px; font-size:25px; line-height:1.2; }
  #game-loading p { margin:0; line-height:1.6; color:#9ab5cb; }
  #game-loading .loading-track { height:3px; overflow:hidden; margin:24px 0 0; background:#1d3b58; }
  #game-loading .loading-track::after { content:''; display:block; width:38%; height:100%; background:#55b6ff; animation:loading-sweep 1.5s ease-in-out infinite alternate; }
  #game-loading[data-determinate="true"] .loading-track::after { width:var(--loading-progress,0%); transform:none; animation:none; transition:width 120ms linear; }
  #game-loading[data-failed="true"] .loading-track::after { width:100%; transform:none; animation:none; opacity:.45; }
  @keyframes loading-sweep { from { transform:translateX(0); } to { transform:translateX(163%); } }
  @media (prefers-reduced-motion:reduce) { #game-loading .loading-track::after { animation:none; } }
  html[data-ui-theme="site"] #game-loading { background:#070a10; color:#eef3f9; }
  html[data-ui-theme="site"] #game-loading .loading-card { background:#111720; border-color:#303b49; border-radius:6px; }
  html[data-ui-theme="site"] #game-loading .loading-brand { color:#f2b32c; }
  html[data-ui-theme="site"] #game-loading .loading-track { background:#303b49; }
  html[data-ui-theme="site"] #game-loading .loading-track::after { background:#f2b32c; }
  html[data-ui-theme="studio"] #game-loading { background:#f4f3ed; color:#303a30; }
  html[data-ui-theme="studio"] #game-loading .loading-card { background:#fdfef9; border-color:#d8dbce; border-radius:14px; box-shadow:0 20px 60px #35402b1c; }
  html[data-ui-theme="studio"] #game-loading .loading-brand { color:#b94d29; }
  html[data-ui-theme="studio"] #game-loading p { color:#687363; }
  html[data-ui-theme="studio"] #game-loading .loading-track { background:#e1e7d9; border-radius:4px; }
  html[data-ui-theme="studio"] #game-loading .loading-track::after { background:#c94d24; }
</style>`

const LOADING_SHELL = `<div id="game-loading" role="status" aria-live="polite">
  <div class="loading-card"><div class="loading-brand">Station Designer</div><h1 id="loading-title">正在准备车站</h1><p id="loading-detail">正在加载游戏并构建车站，请稍候。</p><div class="loading-track" aria-hidden="true"></div></div>
</div>
<script>
  (() => {
    const path = location.pathname.replace(/\\/+$/, '');
    const isBenchmark = path.endsWith('/benchmark') || path.endsWith('/benchmark/en');
    let theme, language;
    const route = path.split('/').includes('en') || document.documentElement.lang === 'en' ? 'en' : 'zh-CN';
    try { theme = localStorage.getItem('metro-game.ui-theme'); if (!isBenchmark) language = localStorage.getItem('metro-game.language.' + route); } catch {}
    if (!isBenchmark) document.documentElement.dataset.uiTheme = theme === 'studio' || theme === 'site' ? theme : 'blueprint';
    const resolvedLanguage = !isBenchmark && (language === 'en' || language === 'zh-CN') ? language : route;
    document.documentElement.lang = resolvedLanguage;
    if (resolvedLanguage === 'en') {
      document.getElementById('loading-title').textContent = 'Preparing your station';
      document.getElementById('loading-detail').textContent = 'Loading the game and building your station. This may take a moment.';
    }
    if (isBenchmark) {
      const el = document.getElementById('game-loading');
      if (el) el.hidden = true;
    }
    window.__metroUnityProgress = (progress) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) window.__metroUnityDownloadProgress = progress;
      const el = document.getElementById('game-loading');
      if (!el || el.hidden || el.dataset.failed === 'true') return;
      if (typeof progress === 'number' && progress > 0 && progress < 0.9) {
        el.dataset.determinate = 'true';
        el.style.setProperty('--loading-progress', Math.min(100, Math.round((progress / 0.9) * 100)) + '%');
      } else if (progress >= 0.9) {
        delete el.dataset.determinate;
      }
    };
    window.__metroUnityFail = (error) => {
      console.error(error);
      window.__metroUnityLoadError = error instanceof Error ? error.message : String(error);
      if (isBenchmark) return;
      const el = document.getElementById('game-loading');
      const detail = document.getElementById('loading-detail');
      if (el) { el.hidden = false; delete el.dataset.determinate; el.dataset.failed = 'true'; }
      if (detail) detail.textContent = document.documentElement.lang === 'en'
        ? 'The game could not load. Please reload this page to try again.'
        : '游戏加载失败，请刷新页面重试。';
    };
  })();
</script>`

export function attachUnityUI(html, ui, assetBase, bridge = 'stationBridge') {
  if (!html.includes('}).then((unityInstance) => {')) throw Error('Unexpected Unity initialization')
  html = html.replace(/<title>[^<]*<\/title>/, '<title>车站设计师 · Station Designer</title>')
  const colorScheme = html.includes('name="color-scheme"') ? '' : '<meta name="color-scheme" content="light dark">\n'
  html = html.replace('</head>', `${colorScheme}${LOADING_STYLES}\n<link rel="stylesheet" href="${assetBase}/${ui.css}">\n</head>`)
  html = html.replace(/<body([^>]*)>/, `<body$1>\n${LOADING_SHELL}`)
  html = html.replace(
    'createUnityInstance(canvas, config, (progress) => {',
    'createUnityInstance(canvas, config, (progress) => { window.__metroUnityProgress?.(progress);',
  )
  html = html.replace(
    /\.catch\(\(message\)\s*=>\s*\{\s*alert\(message\);\s*\}\)/,
    '.catch((message) => { window.__metroUnityFail?.(message); })',
  )
  const setup = `<script type="module">\nwindow.metroUnityUiBase = '${assetBase}/UI/';\nwindow.metroUnityAudioBase = '${assetBase}/UI/audio/';\ntry {\n  const ui = await import('${assetBase}/${ui.entry}');\n  const host = document.createElement('div'); host.id = 'metro-unity-ui'; document.body.appendChild(host);\n  const unmount = ui.mountUnityUI(host, document.querySelector('#unity-canvas'));\n  window.metroUnityUIReady = instance => ui.${bridge}.register(instance);\n  if (window.metroUnityInstance) window.metroUnityUIReady(window.metroUnityInstance);\n  window.addEventListener('pagehide', () => { unmount(); delete window.metroUnityUIReady; delete window.metroUnityInstance; }, { once: true });\n} catch (error) { window.__metroUnityFail?.(error); }\n</script>\n`
  html = html.replace('</body>', setup + '</body>')
  return html.replace('}).then((unityInstance) => {', `}).then((unityInstance) => {\n                window.metroUnityInstance = unityInstance; window.metroUnityUIReady?.(unityInstance);`)
}
