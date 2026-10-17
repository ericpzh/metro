// The game's own client routes. `/lab` is the renderer lab (handled in boot);
// `/zoo` and `/tanwei` start the game on one of the shipped example stations:
//
//   https://stationdesigner.com/game/zoo      (English: /game/en/zoo)
//   https://stationdesigner.com/game/tanwei   (English: /game/en/tanwei)
//
// The rule reads the *last* segment, so the deployed `/game` prefix, the dev
// server's root and the README's shareable links all resolve the same way. It is
// pure, so `demo-route.test.mjs` pins it without a browser.
import type { ExampleStationId } from '../data/reference-station.ts'

/**
 * The example station a URL names, or `null` for an ordinary page. A demo link is
 * a start, not a location: `gamePathFor` turns it into the plain game path once
 * the document has been opened, so a reload restores the autosave instead of
 * discarding the player's edits.
 */
export function demoStationForPath(pathname: string): ExampleStationId | null {
  const segments = pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  return last === 'zoo' || last === 'tanwei' ? last : null
}

/**
 * The plain game path a demo link becomes, keeping the language pin: `/game/zoo`
 * and `/game/en/zoo` become `/game/` and `/game/en/`.
 */
export function gamePathFor(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (demoStationForPath(pathname) !== null) segments.pop()
  return segments.length ? `/${segments.join('/')}/` : '/'
}
