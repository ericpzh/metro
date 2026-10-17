// Site chrome strings (everything outside the sheet data in artworks.js)
// plus language detection and the canonical /en/ route helper.
//
// The English version is pinned to the `/en/` path, so it is shareable.
// `?lang=en` and `#en` are accepted as aliases on arrival and normalised to the
// path form. The URL is the only signal: `/` always stays Chinese unless the URL
// asks for English — no browser-language or stored-preference redirect.
// The game is a different app on this domain (/game/, /game/en/); its URLs are
// built in site.js.
export const LANGS = ['zh', 'en']

const zh = {
  doc: {
    title: '车站设计师 — 概念图',
    desc: '《车站设计师》是一款 3D 沙盒小游戏：亲手搭一座车站，看人群在里面挤挤挨挨地走。这里是它的概念图和设计笔记。',
  },
  nav: {
    languageZh: '中文',
    languageEn: 'EN',
    brand: '车站设计师',
    game: '游戏',
    demos: '示例车站',
    gallery: '看图',
    siteLabel: '站点',
    langLabel: '语言',
  },
  hero: {
    eyebrow: '车站设计师 · 游戏',
    line1: '搭一座小小车站。',
    line2: '看人群来来去去。',
    accent: '再想办法，别让它挤爆。',
    facts: [
      ['建造', '从一米方块到多层换乘站'],
      ['运行', '调节客流，观察排队与滞留'],
      ['观察', '转动、俯视、剖开车站'],
      ['模式', '自由沙盒，专注空间与客流'],
    ],
    play: '开始游戏',
    demos: '示例车站',
    browse: '浏览概念图',
    peekLabel: '前往第一张概念图',
  },
  demos: {
    title: '示例车站',
    intro: '挑一座搭好的真实车站，直接在游戏里打开。',
    close: '关闭示例车站',
    zoo: {
      name: '动物园',
      line: '广州地铁 · 5号线',
      note: '五层地下车站，站前是广场',
    },
    tanwei: {
      name: '坦尾',
      line: '广州地铁 · 5号线 / 6号线',
      note: '高架换乘站，出入口开在地面',
    },
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
    name: '车站设计师',
    line: '搭一座车站，看人群来来去去。',
  },
  lightbox: {
    fit: '适应屏幕',
    full: '看原图',
    close: '关掉',
  },
}

const en = {
  doc: {
    title: 'Station Designer — Concept Art',
    desc: 'Station Designer is a 3D sandbox toy: build a station by hand and watch crowds squeeze through it. These are its concept sheets and design notes.',
  },
  nav: {
    languageZh: '中文',
    languageEn: 'EN',
    brand: 'Station Designer',
    game: 'Game',
    demos: 'Demo stations',
    gallery: 'Gallery',
    siteLabel: 'Site',
    langLabel: 'Language',
  },
  hero: {
    eyebrow: 'Station Designer · Game',
    line1: 'Build a tiny station.',
    line2: 'Watch the crowds come and go.',
    accent: "Then keep it from bursting at the seams.",
    facts: [
      ['Build', 'From one-metre blocks to multi-level interchanges'],
      ['Run', 'Tune demand, watch queues and stranded passengers'],
      ['Look', 'Orbit, go top-down, cut through the station'],
      ['Mode', 'Free sandbox about space and flow'],
    ],
    play: 'Play the game',
    demos: 'Demo stations',
    browse: 'Browse the concept art',
    peekLabel: 'Jump to the first concept sheet',
  },
  demos: {
    title: 'Demo stations',
    intro: 'Pick a station that is already built and open it straight in the game.',
    close: 'Close demo stations',
    zoo: {
      name: 'Zoo',
      line: 'Guangzhou Metro · Line 5',
      note: 'Five-level underground station with a surface plaza',
    },
    tanwei: {
      name: 'Tanwei',
      line: 'Guangzhou Metro · Lines 5 / 6',
      note: 'Elevated interchange opening at street level',
    },
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
    name: 'Station Designer',
    line: 'Build a station, watch the crowds come and go.',
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

/** Canonical shareable path for the site in a language: `/` or `/en/`. */
export function canonicalPath(lang) {
  return lang === 'en' ? '/en/' : '/'
}
