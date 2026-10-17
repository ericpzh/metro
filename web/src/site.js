// Repository and document links. Change `repo` if you fork this elsewhere.
export const repo = 'ericpzh/metro'
export const repoUrl = `https://github.com/${repo}`
export const branch = 'main'
export const specUrl = `${repoUrl}/blob/${branch}/GAME-SPEC.md`
export const artUrl = `${repoUrl}/tree/${branch}/art`

/** Resolve a file in public/art, honouring Vite's configured base path. */
export const sheet = (file) => `${import.meta.env.BASE_URL}art/${file}`

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
