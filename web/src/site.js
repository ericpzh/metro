import { demoPath } from './stations.js'

// Repository and document links. Change `repo` if you fork this elsewhere.
export const repo = 'ericpzh/metro'
export const repoUrl = `https://github.com/${repo}`
export const branch = 'main'
export const specUrl = `${repoUrl}/blob/${branch}/GAME-SPEC.md`
export const artUrl = `${repoUrl}/tree/${branch}/art`

/** Resolve a file in public/art, honouring Vite's configured base path. */
export const sheet = (file) => `${import.meta.env.BASE_URL}art/${file}`

/** Resolve an example-station preview, copied into public/stations at build time. */
export const stationPreview = (file) => `${import.meta.env.BASE_URL}stations/${file}`

/**
 * The game is a separate Worker, served from https://stationdesigner.com/game/
 * with the English route at /game/en/. Development is the game's own Vite
 * server instead, where the language pin sits at its root: / (Chinese) and
 * /en/ (English). Point VITE_GAME_URL at something else (its workers.dev URL, a
 * preview URL) to override either.
 */
export const gameRoot = (() => {
  const url = import.meta.env.VITE_GAME_URL || (import.meta.env.DEV ? 'http://localhost:5174/' : '/game/')
  return url.endsWith('/') ? url : `${url}/`
})()

/** Href of the game in a language: `/game/` for Chinese, `/game/en/` for English. */
export const gameHref = (lang) => `${gameRoot}${lang === 'en' ? 'en/' : ''}`

/**
 * The stats page is its own Worker at https://stationdesigner.com/stats/ with an
 * English route at /stats/en/. Development runs `npm run dev:stats` on 5176, so
 * the site footer links there while the site itself is on 5173. Point
 * VITE_STATS_URL at another stats root (a workers.dev /stats/ URL, a preview
 * URL) to override either.
 */
export const statsRoot = (() => {
  const url = import.meta.env.VITE_STATS_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5176/stats/' : '/stats/')
  return url.endsWith('/') ? url : `${url}/`
})()

/** Href of the stats page in a language: `/stats/` or `/stats/en/`. */
export const statsHref = (lang) => `${statsRoot}${lang === 'en' ? 'en/' : ''}`

/**
 * Href that opens a demo station straight in the game: `/game/zoo`,
 * `/game/tanwei`, or `/game/en/zoo` and `/game/en/tanwei` in English. The route
 * carries no trailing slash — its relative `./assets/...` resolve at the game
 * root, and the game replaces it with the plain path once the station is open.
 */
export const demoHref = (lang, id) => `${gameRoot}${demoPath(lang, id)}`
