// Repository and document links. Change `repo` if you fork this elsewhere.
export const repo = 'ericpzh/metro'
export const repoUrl = `https://github.com/${repo}`
export const branch = 'main'
export const specUrl = `${repoUrl}/blob/${branch}/GAME-SPEC.md`
export const artUrl = `${repoUrl}/tree/${branch}/art`

/** Resolve a file in public/art, honouring Vite's configured base path. */
export const sheet = (file) => `${import.meta.env.BASE_URL}art/${file}`
