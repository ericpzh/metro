// Mobile mode: the page is open on a phone or tablet (or in a device-emulation
// viewport) where the game's pointer-and-keyboard scene cannot be played. The
// gate in main.tsx then skips the game entirely and shows a plain notice.
//
// Two signals, either one enough:
//   1. a mobile user agent — real phones and DevTools emulation both set it;
//   2. a coarse, hoverless primary pointer — a touch-first device, which also
//      catches iPadOS Safari, whose UA pretends to be a desktop Mac.
// A desktop with a touchscreen still reports a fine, hovering primary pointer,
// so it keeps the game.

const MOBILE_UA = /Mobi|Android|iPhone|iPad|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Silk|Kindle|webOS/i

export function isMobileMode(): boolean {
  if (typeof window === 'undefined') return false
  if (MOBILE_UA.test(navigator.userAgent)) return true
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches
}
