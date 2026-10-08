// Repository and document links. Change `repo` if you fork this elsewhere.
export const repo = 'ericpzh/metro'
export const repoUrl = `https://github.com/${repo}`
export const branch = 'main'
export const specUrl = `${repoUrl}/blob/${branch}/GAME-SPEC.md`
export const artUrl = `${repoUrl}/tree/${branch}/art`

/** Resolve a file in public/art, honouring Vite's configured base path. */
export const sheet = (file) => `${import.meta.env.BASE_URL}art/${file}`

/**
 * The game tab lives at `<site>/game/` (or `<site>/en/game/`), which serves
 * the site document and renders it as a full-viewport iframe around the
 * game's own Worker.
 *
 * The game Worker is deployed separately. In production it sits at
 * `/metro-game/` on the same domain; in development it is the game's Vite
 * server. Point VITE_GAME_URL at something else (its workers.dev URL, a
 * preview URL) to override either.
 */
export const gameUrl =
  import.meta.env.VITE_GAME_URL || (import.meta.env.DEV ? 'http://localhost:5174/' : '/metro-game/')

