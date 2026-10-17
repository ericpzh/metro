// The two example stations the game ships (game/src/app/windows/topbar/exampleStations.ts).
// Their previews are the game's own renders: scripts/sync-stations.mjs copies them
// into public/stations at build time, and a card opens the game's own demo route,
// so the picture on the card is the station the game opens.
export const stations = [
  { id: 'zoo', preview: 'zoo.webp' },
  { id: 'tanwei', preview: 'tanwei.webp' },
]

/** A demo station's path under the game root: `zoo`, or `en/tanwei` for English. */
export const demoPath = (lang, id) => `${lang === 'en' ? 'en/' : ''}${id}`
