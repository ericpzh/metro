// Site chrome strings (everything outside the sheet data in artworks.js)
// plus language detection and the canonical /en/ route helpers.
//
// The English version is pinned to the `/en/` path (and `/en/game/` for the
// game tab), so it is shareable. `?lang=en` and `#en` are accepted as aliases
// on arrival and normalised to the path form. The URL is the only signal:
// `/metro/` always stays Chinese unless the URL asks for English — no
// browser-language or stored-preference redirect.
export const LANGS = ['zh', 'en']

const zh = {
  doc: {
    title: '地铁车站设计师 — 概念图',
    desc: '《地铁车站设计师》是一款 3D 沙盒小游戏：亲手搭一座地铁车站，看人群在里面挤挤挨挨地走。这里是它的概念图和设计笔记。',
  },
  nav: {
    brand: '地铁站设计师',
    game: '游戏',
    gallery: '看图',
    siteLabel: '站点',
    langLabel: '语言',
  },
  hero: {
    eyebrow: '地铁车站设计师 · 游戏',
    line1: '搭一座小小地铁车站。',
    line2: '看人群来来去去。',
    accent: '再想办法，别让它挤爆。',
    facts: [
      ['建造', '从一米方块到多层换乘站'],
      ['运行', '调节客流，观察排队与滞留'],
      ['观察', '转动、俯视、剖开车站'],
      ['模式', '自由沙盒，专注空间与客流'],
    ],
    play: '开始游戏',
    browse: '浏览概念图',
    peekLabel: '前往第一张概念图',
  },
  rail: {
    label: '概念图阅读进度',
  },
  footer: {
    buildTitle: '继续搭你的车站',
    buildBody: '从示例车站开始，或者从空地搭起。运行后看哪里拥堵，再试一种新的布局。',
    buildNote: '这些概念图使用游戏模型与界面，展示你能建造和调整的空间。',
    docsTitle: '文档',
    spec: '游戏设计',
    specSub: '详细说明',
    art: '概念图',
    artSub: 'SVG 原图',
    repo: '代码仓库',
    repoSub: '项目源码',
    name: '地铁车站设计师',
    line: '搭一座车站，看人群来来去去。',
  },
  game: {
    title: '地铁车站设计师 — 游戏',
    frameTitle: '地铁车站设计师 — 游戏',
    loading: '正在载入游戏…',
    loadingHint: '如果一直没反应，可能是游戏服务没连上。',
  },
  lightbox: {
    fit: '适应屏幕',
    full: '看原图',
    close: '关掉',
  },
}

const en = {
  doc: {
    title: 'Metro Station Designer — Concept Art',
    desc: 'Metro Station Designer is a 3D sandbox toy: build a metro station by hand and watch crowds squeeze through it. These are its concept sheets and design notes.',
  },
  nav: {
    brand: 'Metro Station Designer',
    game: 'Game',
    gallery: 'Gallery',
    siteLabel: 'Site',
    langLabel: 'Language',
  },
  hero: {
    eyebrow: 'Metro Station Designer · Game',
    line1: 'Build a tiny metro station.',
    line2: 'Watch the crowds come and go.',
    accent: "Then keep it from bursting at the seams.",
    facts: [
      ['Build', 'From one-metre blocks to multi-level interchanges'],
      ['Run', 'Tune demand, watch queues and stranded passengers'],
      ['Look', 'Orbit, go top-down, cut through the station'],
      ['Mode', 'Free sandbox about space and flow'],
    ],
    play: 'Play the game',
    browse: 'Browse the concept art',
    peekLabel: 'Jump to the first concept sheet',
  },
  rail: {
    label: 'Concept-art reading progress',
  },
  footer: {
    buildTitle: 'Keep building your station',
    buildBody:
      'Start from the sample station, or from empty ground. Run it, find the jams, try a new layout.',
    buildNote:
      'These concept sheets use in-game models and UI to show the spaces you can build and tune.',
    docsTitle: 'Docs',
    spec: 'Game design',
    specSub: 'full spec',
    art: 'Concept art',
    artSub: 'SVG originals',
    repo: 'Repo',
    repoSub: 'source code',
    name: 'Metro Station Designer',
    line: 'Build a station, watch the crowds come and go.',
  },
  game: {
    title: 'Metro Station Designer — Game',
    frameTitle: 'Metro Station Designer — Game',
    loading: 'Loading the game…',
    loadingHint: 'If nothing happens, the game service may be unreachable.',
  },
  lightbox: {
    fit: 'Fit screen',
    full: 'Full size',
    close: 'Close',
  },
}

export const ui = { zh, en }

/** A standalone `en` (or `zh`) segment anywhere in the path pins the language. */
function langFromPath(pathname) {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.includes('en')) return 'en'
  if (segs.includes('zh')) return 'zh'
  return null
}

function langFromQuery(search) {
  const q = new URLSearchParams(search).get('lang')
  if (!q) return null
  const v = q.trim().toLowerCase()
  if (v === 'en' || v === 'english') return 'en'
  if (v === 'zh' || v === 'cn' || v === 'chinese') return 'zh'
  return null
}

/** Hash aliases: #en, #zh, #/en, #/zh. Anything else is an anchor. */
function langFromHash(hash) {
  const v = hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase()
  if (v === 'en' || v === 'english') return 'en'
  if (v === 'zh' || v === 'cn' || v === 'chinese') return 'zh'
  return null
}

export function isLangHash(hash) {
  return langFromHash(hash) !== null
}

export function detectLang(href = window.location.href) {
  const url = new URL(href)
  return langFromPath(url.pathname) || langFromQuery(url.search) || langFromHash(url.hash) || 'zh'
}

/** The game tab is the same document served from `<site>/game/` (or `<site>/en/game/`). */
export function isGamePath(pathname = window.location.pathname) {
  return /\/game\/?$/.test(pathname)
}

function splitPath(pathname) {
  return pathname.split('/').filter(Boolean)
}

/**
 * Absolute site-root path, derived from the live URL rather than Vite's base
 * (which is relative: './'). The root is whatever is left after peeling the
 * game tab and the language pin — the deploy prefix (/metro/) or / — so the
 * canonical URL below never drops the prefix. Assigning a relative path to
 * `url.pathname` normalises away the prefix (./game/ -> /game/), which is how
 * the tab once escaped to the domain root.
 */
export function siteRoot(pathname = window.location.pathname) {
  const segs = splitPath(pathname)
  if (segs[segs.length - 1] === 'game') segs.pop()
  if (segs[segs.length - 1] === 'en') segs.pop()
  return segs.length ? `/${segs.join('/')}/` : '/'
}

/** Canonical shareable path for a language: `/`, `/en/`, `/game/`, `/en/game/` (under the site root). */
export function canonicalPath(lang, game, pathname = window.location.pathname) {
  const root = siteRoot(pathname)
  return `${root}${lang === 'en' ? 'en/' : ''}${game ? 'game/' : ''}`
}

/**Href of the game tab in a given language. */
export function gameHref(lang, pathname) {
  return canonicalPath(lang, true, pathname)
}
