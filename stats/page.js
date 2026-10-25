/**
 * The public stats page, rendered by the Worker.
 *
 * Two URL-pinned languages, the same rule as the rest of the site:
 *
 *   /stats/      Chinese (default)
 *   /stats/en/   English
 *
 * The page is a one-shot snapshot: it calls the totals endpoint once on load
 * and never polls. Copy lives in PAGE_COPY rather than in the markup so both
 * languages share one layout and one stylesheet.
 */
import { FAVICON } from './favicon.js'
import { BRAND_MARK } from './brand-mark.js'
import { renderReportContent, reportScript, REPORT_STYLE } from './report-page.js'

const SITE_URL = 'https://stationdesigner.com/'
const GAME_URL = `${SITE_URL}game/`
const REPO_URL = 'https://github.com/ericpzh/metro'
const SPEC_URL = `${REPO_URL}/blob/main/GAME-SPEC.md`
const ART_URL = `${REPO_URL}/tree/main/art`

const PAGE_COPY = {
  zh: {
    lang: 'zh-CN',
    locale: 'zh-CN',
    title: '全球统计 · 车站设计师',
    description: '车站设计师的匿名全球统计：已建车站、客流与列车到达。',
    brand: '车站设计师',
    brandSub: 'Global stats',
    navLabel: '站点',
    navSite: '主站',
    navGame: '游戏',
    navStats: '全球统计',
    navReport: '问题与建议',
    report: {
      title: '问题与建议', description: '报告问题、提出功能建议，为你关心的事项投票。',
      add: '添加事项', type: '类型', bug: '问题报告', feature: '功能建议',
      subject: '标题', detail: '详细说明', submit: '提交', cancel: '取消',
      privacy: '内容公开，请勿填写个人信息。每个 IP 每天最多提交 5 条、投票 100 次，每个事项可投一票。限额每天按 UTC 时间重置。仅保存带密钥的 IP 散列值，不保存原始 IP。',
      sort: '排序', top: '最多赞同', newest: '最新报告', all: '全部类型',
      loading: '正在读取…', empty: '还没有事项。来提交第一个问题或建议吧。',
      more: '加载更多', vote: '赞同', voted: '已赞同', success: '已提交，谢谢！',
      retry: '重新读取',
      error: '操作失败，请稍后重试。', limited: '今日操作次数已达上限，请稍后重试。',
      unavailable: '暂时无法提交，请稍后重试。',
    },
    langLabel: '语言',
    langZh: '中文',
    langEn: 'EN',
    eyebrow: 'Station Designer · Global stats',
    heroTitle: '全球统计',
    heroAccent: '。',
    lede: '所有玩家匿名汇总的车站与客流数据。',
    loading: '正在读取…',
    statsTitle: '全球统计数字',
    loadingGrid: '正在读取全球统计…',
    aboutTitle: '关于这些数字',
    aboutBody: '数据匿名汇总，只统计车站数量与客流，不保存车站布局或个人身份。为防滥用，提交时会对连接地址做带密钥的不可逆散列并保存该散列值，不保存原始 IP 地址。',
    aboutNote: '页面加载时读取一次，不会自动刷新；需要更新时刷新页面即可。',
    docsTitle: '文档',
    docs: [
      { label: '游戏设计', sub: '详细说明', href: SPEC_URL },
      { label: '概念图', sub: 'SVG 原图', href: ART_URL },
      { label: '代码仓库', sub: '项目源码', href: REPO_URL },
      { label: '主站', sub: 'stationdesigner.com', href: SITE_URL },
    ],
    baseName: '车站设计师',
    baseLine: '搭一座车站，看人群来来去去。',
    devBadge: '开发预览 · 本地数据库',
    noSubmissions: '尚无提交记录',
    updatedPrefix: '更新于 ',
    loadError: '读取失败，请稍后刷新页面重试。',
    dataNotLoaded: '数据未加载',
    metrics: [
      { key: 'stations', label: '已建车站', unit: 'Stations' },
      { key: 'passengersBoarded', label: '已上车', unit: 'Boarded' },
      { key: 'passengersAlighted', label: '已下车', unit: 'Alighted' },
      { key: 'passengersExited', label: '已出站', unit: 'Exited' },
      { key: 'passengersLeftBehind', label: '滞留', unit: 'Left behind' },
      { key: 'simSeconds', label: '模拟时长', unit: 'Sim time' },
      { key: 'trainArrivals', label: '列车到达', unit: 'Train arrivals' },
    ],
  },
  en: {
    lang: 'en',
    locale: 'en-US',
    title: 'Global stats · Station Designer',
    description: 'Anonymous global Station Designer totals: stations built, passenger flow and train arrivals.',
    brand: 'Station Designer',
    brandSub: 'Global stats',
    navLabel: 'Site',
    navSite: 'Main site',
    navGame: 'Game',
    navStats: 'Global stats',
    navReport: 'Issues & ideas',
    report: {
      title: 'Issues & ideas', description: 'Report a bug, suggest a feature, or upvote what matters to you.',
      add: 'Add an issue', type: 'Type', bug: 'Bug report', feature: 'Feature request',
      subject: 'Title', detail: 'Details', submit: 'Submit', cancel: 'Cancel',
      privacy: 'Posts are public. Leave out personal information. Each IP can submit 5 reports and cast 100 upvotes per day, with one upvote per issue. Limits reset daily at midnight UTC. We store a keyed IP hash, never the raw IP.',
      sort: 'Sort by', top: 'Most upvotes', newest: 'Newest reports', all: 'All types',
      loading: 'Loading…', empty: 'No issues yet. Add the first bug report or feature request.',
      more: 'Load more', vote: 'Upvote', voted: 'Upvoted', success: 'Submitted. Thank you!',
      retry: 'Try loading again',
      error: 'Something went wrong. Please try again.', limited: 'Daily limit reached. Please try again later.',
      unavailable: 'Submissions are temporarily unavailable. Please try again later.',
    },
    langLabel: 'Language',
    langZh: '中文',
    langEn: 'EN',
    eyebrow: 'Station Designer · Global stats',
    heroTitle: 'Global stats',
    heroAccent: '.',
    lede: 'Anonymous, aggregate-only totals from Station Designer players.',
    loading: 'Loading…',
    statsTitle: 'Global stats figures',
    loadingGrid: 'Loading global stats…',
    aboutTitle: 'About these numbers',
    aboutBody: 'Anonymous aggregate totals only. We count stations and passenger flow, never layouts or personal identity. To prevent abuse we keep a keyed, irreversible hash of the connection address — never the raw IP.',
    aboutNote: 'Read once when the page loads. It does not auto-refresh; refresh the page to update it.',
    docsTitle: 'Docs',
    docs: [
      { label: 'Game design', sub: 'full spec', href: SPEC_URL },
      { label: 'Concept art', sub: 'SVG originals', href: ART_URL },
      { label: 'Repo', sub: 'source code', href: REPO_URL },
      { label: 'Main site', sub: 'stationdesigner.com', href: SITE_URL },
    ],
    baseName: 'Station Designer',
    baseLine: 'Build a station, watch the crowds come and go.',
    devBadge: 'Development · local database',
    noSubmissions: 'No submissions yet',
    updatedPrefix: 'Updated ',
    loadError: 'Failed to load. Refresh the page to try again.',
    dataNotLoaded: 'Data not loaded',
    metrics: [
      { key: 'stations', label: 'Stations', unit: 'Built' },
      { key: 'passengersBoarded', label: 'Boarded', unit: 'Passengers' },
      { key: 'passengersAlighted', label: 'Alighted', unit: 'Passengers' },
      { key: 'passengersExited', label: 'Exited', unit: 'Passengers' },
      { key: 'passengersLeftBehind', label: 'Left behind', unit: 'Passengers' },
      { key: 'simSeconds', label: 'Sim time', unit: 'Total' },
      { key: 'trainArrivals', label: 'Train arrivals', unit: 'Trains' },
    ],
  },
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]))
}

/** JSON embedded in a <script>: the closing-tag sequence must not appear. */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

export function normalizePageLang(lang) {
  return lang === 'en' ? 'en' : 'zh'
}

export function renderPage(environment, lang, section = 'stats') {
  const copy = PAGE_COPY[normalizePageLang(lang)]
  const isEnglish = copy.lang === 'en'
  const isReport = section === 'report'
  const zhPath = isReport ? '/stats/report' : '/stats/'
  const enPath = isReport ? '/stats/en/report' : '/stats/en/'
  const canonical = SITE_URL.slice(0, -1) + (isEnglish ? enPath : zhPath)
  const docs = copy.docs.map(doc =>
    '<li><a href="' + escapeHtml(doc.href) + '" target="_blank" rel="noreferrer">' +
    escapeHtml(doc.label) + ' <span>' + escapeHtml(doc.sub) + '</span></a></li>'
  ).join('\n          ')

  return `<!doctype html>
<html lang="${escapeHtml(copy.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(isReport ? copy.report.title + ' · ' + copy.brand : copy.title)}</title>
<meta name="description" content="${escapeHtml(isReport ? copy.report.description : copy.description)}">
<meta name="theme-color" content="#070a10">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="zh-CN" href="${zhPath}">
<link rel="alternate" hreflang="en" href="${enPath}">
<link rel="alternate" hreflang="x-default" href="${zhPath}">
<link rel="icon" type="image/png" sizes="64x64" href="${FAVICON}">
<style>
  :root {
    color-scheme: dark;
    --bg: #070a10;
    --bg-2: #0a0d13;
    --sheet-top: #151d29;
    --ink: #eef3f9;
    --ink-2: #c2cedd;
    --muted: #8b9aad;
    --muted-2: #66768a;
    --line: rgba(255, 255, 255, 0.09);
    --line-2: rgba(255, 255, 255, 0.17);
    --amber: #f2b32c;
    --glass: rgba(9, 13, 20, 0.55);
    --sans: 'Inter', 'Noto Sans SC', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    --mono: 'JetBrains Mono', 'Noto Sans SC', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --shell: 1200px;
    --shadow: 0 24px 70px -30px rgba(0, 0, 0, 0.85);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    overflow-x: clip;
  }
  a { color: inherit; }
  ::selection { background: var(--amber); color: #0a0d13; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ---------------------------------------------------------------- nav ---- */
  .nav {
    position: sticky;
    top: 0;
    z-index: 30;
    background: rgba(7, 10, 16, 0.74);
    backdrop-filter: saturate(140%) blur(14px);
    border-bottom: 1px solid var(--line);
  }
  .nav__inner {
    max-width: var(--shell);
    margin: 0 auto;
    padding: 12px 32px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .brand__mark {
    width: 38px;
    height: 38px;
    flex: none;
    background: var(--amber);
    -webkit-mask: url("${BRAND_MARK}") center / contain no-repeat;
    mask: url("${BRAND_MARK}") center / contain no-repeat;
  }
  .brand__name {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 0.95rem;
  }
  .brand__name em {
    font-family: var(--mono);
    font-style: normal;
    font-size: 0.6rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted-2);
  }
  .nav__spacer { flex: 1; }
  .nav__links {
    display: flex;
    align-items: center;
    gap: 26px;
    font-size: 0.88rem;
    font-weight: 500;
  }
  .nav__links a {
    padding-bottom: 2px;
    border-bottom: 1px solid transparent;
    color: var(--ink-2);
    text-decoration: none;
    transition: color 0.2s, border-color 0.2s;
  }
  .nav__links a:hover {
    color: var(--amber);
    border-bottom-color: var(--amber);
  }
  .langswitch {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line-2);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.04);
    flex: none;
  }
  .langswitch a {
    padding: 4px 10px;
    border-radius: 999px;
    font-family: var(--mono);
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--muted);
    text-decoration: none;
    transition: color 0.2s, background 0.2s;
  }
  .langswitch a:hover { color: var(--ink); }
  .langswitch a[aria-current="page"] {
    background: var(--amber);
    color: #0a0d13;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid #6b510b;
    background: #3c2c05;
    color: #ffd479;
    white-space: nowrap;
  }
  :focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }

  /* --------------------------------------------------------------- hero ---- */
  .hero {
    position: relative;
    overflow: hidden;
    padding: 92px 0 54px;
    background: linear-gradient(180deg, var(--sheet-top) 0%, #0d1219 55%, var(--bg) 100%);
    border-bottom: 1px solid var(--line);
  }
  .hero__grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      repeating-linear-gradient(26.565deg, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 38px),
      repeating-linear-gradient(-26.565deg, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 38px);
    -webkit-mask-image: radial-gradient(115% 95% at 10% 10%, #000 0%, rgba(0, 0, 0, 0.4) 46%, transparent 76%);
    mask-image: radial-gradient(115% 95% at 10% 10%, #000 0%, rgba(0, 0, 0, 0.4) 46%, transparent 76%);
  }
  .hero__inner {
    position: relative;
    z-index: 1;
    max-width: var(--shell);
    margin: 0 auto;
    padding: 0 32px;
  }
  .eyebrow {
    margin: 0 0 22px;
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--amber);
  }
  h1 {
    margin: 0 0 18px;
    font-size: clamp(2.3rem, 5.6vw, 4.4rem);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.038em;
  }
  h1 .accent { color: var(--amber); }
  .lede {
    margin: 0;
    max-width: 38rem;
    color: var(--muted);
    font-size: clamp(1rem, 1.5vw, 1.12rem);
    line-height: 1.7;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 30px 0 0;
    color: var(--muted-2);
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .dot {
    width: 7px;
    height: 7px;
    flex: none;
    background: var(--amber);
    transform: rotate(45deg);
  }

  /* -------------------------------------------------------------- stats ---- */
  .stats {
    max-width: var(--shell);
    margin: 0 auto;
    padding: 46px 32px 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }
  .card {
    position: relative;
    min-width: 0;
    overflow: hidden;
    padding: 22px 20px 24px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: linear-gradient(160deg, rgba(21, 29, 41, 0.92), rgba(10, 13, 19, 0.94));
    box-shadow: var(--shadow);
    transition: transform 0.2s ease, border-color 0.2s ease;
  }
  .card::before {
    content: '';
    position: absolute;
    inset: 0 auto auto 0;
    width: 100%;
    height: 2px;
    background: linear-gradient(90deg, var(--amber), rgba(242, 179, 44, 0) 72%);
    opacity: 0.72;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: var(--line-2);
  }
  .card__label {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 4px 12px;
    color: var(--muted);
    font-size: 0.82rem;
    font-weight: 500;
  }
  .card__label em {
    font-family: var(--mono);
    font-style: normal;
    font-size: 0.56rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .card__value {
    margin-top: 18px;
    font-size: clamp(1.9rem, 3vw, 2.5rem);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }
  .notice {
    grid-column: 1 / -1;
    padding: 24px;
    border: 1px dashed var(--line-2);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.02);
    color: var(--muted);
    font-size: 0.9rem;
  }
  .notice--error {
    border-color: rgba(255, 120, 120, 0.35);
    background: rgba(107, 42, 42, 0.12);
    color: #ffb4b4;
  }

  /* ------------------------------------------------------------- footer ---- */
  .footer {
    margin-top: 64px;
    padding: 64px 0 28px;
    background: linear-gradient(180deg, var(--bg) 0%, #05070b 100%);
    border-top: 1px solid var(--line);
  }
  .footer__inner {
    max-width: var(--shell);
    margin: 0 auto;
    padding: 0 32px;
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
    gap: 56px;
  }
  .footer h2 {
    margin: 0 0 18px;
    font-family: var(--mono);
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--amber);
  }
  .footer p {
    margin: 0 0 14px;
    max-width: 46rem;
    color: var(--muted);
    font-size: 0.9rem;
    line-height: 1.75;
  }
  .footer__note {
    font-size: 0.82rem;
    color: var(--muted-2);
  }
  .docs {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .docs a {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 13px 0;
    border-top: 1px solid var(--line);
    text-decoration: none;
    color: var(--ink);
    font-size: 0.9rem;
    font-weight: 500;
    transition: color 0.2s ease;
  }
  .docs li:last-child a { border-bottom: 1px solid var(--line); }
  .docs a span {
    font-family: var(--mono);
    font-size: 0.62rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted-2);
    text-align: right;
    white-space: nowrap;
  }
  .docs a:hover { color: var(--amber); }
  .footer__base {
    max-width: var(--shell);
    margin: 48px auto 0;
    padding: 22px 32px 0;
    border-top: 1px solid var(--line);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px 40px;
    color: var(--muted-2);
    font-size: 0.78rem;
  }
  .footer__base p { margin: 0; }

  @media (max-width: 960px) {
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .footer__inner { grid-template-columns: minmax(0, 1fr); gap: 40px; }
  }
  @media (max-width: 760px) {
    .nav__inner { padding: 10px 20px; gap: 10px 12px; flex-wrap: wrap; }
    .nav__spacer { display: none; }
    .nav__links { display: none; }
    .brand { margin-right: auto; }
    .langswitch { order: 2; }
    .badge { order: 3; }
    .brand__name em { display: none; }
    .hero { padding: 70px 0 44px; }
    .hero__inner, .stats, .footer__inner, .footer__base { padding-left: 20px; padding-right: 20px; }
  }
  @media (max-width: 560px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .card { padding: 20px 18px 22px; }
    .card__label em { display: none; }
    .footer { padding-top: 48px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .card { transition: none; }
    .card:hover { transform: none; }
    .nav__links a, .langswitch a { transition: none; }
  }
${isReport ? REPORT_STYLE : ''}
</style>
</head>
<body>
  <header class="nav">
    <div class="nav__inner">
      <a class="brand" href="${SITE_URL}" target="_blank" rel="noreferrer">
        <span class="brand__mark" aria-hidden="true"></span>
        <span class="brand__name">${escapeHtml(copy.brand)} <em>${escapeHtml(copy.brandSub)}</em></span>
      </a>
      <span class="nav__spacer"></span>
      <span id="environment" class="badge" hidden></span>
      <nav class="nav__links" aria-label="${escapeHtml(copy.navLabel)}">
        <a href="${SITE_URL}" target="_blank" rel="noreferrer">${escapeHtml(copy.navSite)}</a>
        <a href="${GAME_URL}" target="_blank" rel="noreferrer">${escapeHtml(copy.navGame)}</a>
        <a href="/stats/${isEnglish ? 'en/' : ''}${isReport ? '' : 'report'}">${escapeHtml(isReport ? copy.navStats : copy.navReport)}</a>
        <a href="${REPO_URL}" target="_blank" rel="noreferrer">GitHub</a>
      </nav>
      <div class="langswitch" role="group" aria-label="${escapeHtml(copy.langLabel)}">
        <a href="${zhPath}" hreflang="zh-CN" lang="zh-CN"${isEnglish ? '' : ' aria-current="page"'}>${escapeHtml(copy.langZh)}</a>
        <a href="${enPath}" hreflang="en" lang="en"${isEnglish ? ' aria-current="page"' : ''}>${escapeHtml(copy.langEn)}</a>
      </div>
    </div>
  </header>

  <main>
    ${isReport ? renderReportContent(copy.report, isEnglish ? '/stats/en/' : '/stats/', copy.navStats) : `
    <section class="hero">
      <div class="hero__grid" aria-hidden="true"></div>
      <div class="hero__inner">
        <p class="eyebrow">${escapeHtml(copy.eyebrow)}</p>
        <h1>${escapeHtml(copy.heroTitle)}<span class="accent">${escapeHtml(copy.heroAccent)}</span></h1>
        <p class="lede">${escapeHtml(copy.lede)}</p>
        <p><a href="/stats/${isEnglish ? 'en/' : ''}report">${escapeHtml(copy.navReport)} →</a></p>
        <p class="meta"><span class="dot" aria-hidden="true"></span><span id="updated">${escapeHtml(copy.loading)}</span></p>
      </div>
    </section>

    <section class="stats" aria-labelledby="stats-title">
      <h2 class="sr-only" id="stats-title">${escapeHtml(copy.statsTitle)}</h2>
      <div class="grid" id="grid" aria-live="polite">
        <div class="notice">${escapeHtml(copy.loadingGrid)}</div>
      </div>
    </section>
    `}
  </main>

  <footer class="footer">
    <div class="footer__inner">
      <div>
        <h2>${escapeHtml(isReport ? copy.navReport : copy.aboutTitle)}</h2>
        <p>${escapeHtml(isReport ? copy.report.privacy : copy.aboutBody)}</p>
        ${isReport ? '' : `<p class="footer__note">${escapeHtml(copy.aboutNote)}</p>`}
      </div>
      <div>
        <h2>${escapeHtml(copy.docsTitle)}</h2>
        <ul class="docs">
          ${docs}
        </ul>
      </div>
    </div>
    <div class="footer__base">
      <p>${escapeHtml(copy.baseName)}</p>
      <p>${escapeHtml(copy.baseLine)}</p>
    </div>
  </footer>

  <script>
    ${isReport ? reportScript(copy.report, copy.locale) : `
    const environment = ${scriptJson(String(environment))};
    const copy = ${scriptJson(copy)};
    const api = '/stats/api/v1/global';

    const badge = document.getElementById('environment');
    if (environment !== 'production') {
      badge.hidden = false;
      badge.textContent = environment === 'development' ? copy.devBadge : environment;
    }

    function formatValue(key, value) {
      const n = Number(value) || 0;
      if (key === 'simSeconds') {
        if (!n) return '0 m';
        if (n < 60) return Math.round(n) + ' s';
        const hours = Math.floor(n / 3600);
        const minutes = Math.round((n % 3600) / 60);
        return hours ? hours.toLocaleString(copy.locale) + ' h ' + minutes + ' m' : minutes.toLocaleString(copy.locale) + ' m';
      }
      return n.toLocaleString(copy.locale);
    }

    function formatUpdated(value) {
      if (!value) return copy.noSubmissions;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return copy.noSubmissions;
      return copy.updatedPrefix + date.toLocaleString(copy.locale, {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
    }

    async function load() {
      const grid = document.getElementById('grid');
      try {
        const response = await fetch(api, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw new Error(data.error || ('HTTP ' + response.status));
        grid.innerHTML = copy.metrics.map(function (metric) {
          return '<article class="card">' +
            '<div class="card__label"><span>' + metric.label + '</span><em>' + metric.unit + '</em></div>' +
            '<div class="card__value">' + formatValue(metric.key, data[metric.key]) + '</div>' +
          '</article>';
        }).join('');
        document.getElementById('updated').textContent = formatUpdated(data.updatedAt);
      } catch (error) {
        grid.innerHTML = '<div class="notice notice--error">' + copy.loadError + '</div>';
        document.getElementById('updated').textContent = copy.dataNotLoaded;
        console.error('stats page failed to load', error);
      }
    }

    // One request per page load: the page is a snapshot, not a live dashboard.
    load();
    `}
  </script>
</body>
</html>`
}
