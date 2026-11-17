// The approved faces for 站名 inscriptions — one table, two painters.
//
// A station-name inscription is brush lettering: the *hand* the palette offers is a
// real font stack (`sim/calligraphy.ts`'s `CALLIGRAPHY_STYLES[style].family`), not a
// treatment invented by the renderer. Those six stacks live here so the browser
// painter (`render/calligraphyFace.ts`, reached by the game and by the Unity WebGL /
// WebView2 shells through `unity-web/calligraphyFaceProvider.ts`) and the Unity host
// (`unity/Assets/StationDesigner/Runtime/App/Views/StationCalligraphyArtwork.cs`,
// which sends the hand to the browser and keys its texture cache on the manifest
// version below) cannot drift apart.
//
// No font bytes are bundled with this repo: the stacks name faces a machine is
// expected to have installed, the way the web reference always has. `document.fonts`
// cannot prove a *system* face is installed (`check()` reports the same `true` for a
// bogus family), so a painter reports which approved family it could prove and calls
// the paint **missing** — a deliberate last-resort fallback, never a silent
// substitution. Unity keeps `NotoSansSC.ttf` as its own headless fallback.
//
// **Changing any stack, weight or italic below is a manifest version bump.** The
// version is a monotone counter, not a semantic version: it is folded into the
// Unity texture cache key (`StationCalligraphyArtwork.FontVersion`) and echoed in
// every `calligraphy.faceReady` reply, so pixels painted under one manifest can never
// be served under another. Never reuse a previous value.
//
// Pure data — no three, no DOM.

import type { CalligraphyStyle } from './types.ts'

/** The manifest's version, folded into every cache key. Bump by one on any change. */
export const CALLIGRAPHY_FONT_VERSION = 'calligraphy-fonts/1'

/** Generic CSS families: a stack ending here has no approved hand left. */
export const CALLIGRAPHY_GENERIC_FAMILIES: readonly string[] = [
  'serif', 'sans-serif', 'cursive', 'monospace', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong',
]

/**
 * The deliberate last-resort CJK face both painters fall back to when no approved
 * hand is installed. Unity ships `NotoSansSC.ttf`; a browser only has it if the
 * machine does, which is why a missing hand is reported rather than assumed.
 */
export const CALLIGRAPHY_LAST_RESORT_FAMILY = 'Noto Sans SC'

/** One hand's approved face, exactly what the palette tile promises. */
export interface CalligraphyFontFace {
  style: CalligraphyStyle
  /** The CSS font stack, in preference order — the approved hand, then its fallback. */
  family: string
  /** The weight the hand is set at (`400` or `700`). */
  weight: '400' | '700'
  /** Whether the hand leans (行书 is the one running script). */
  italic: boolean
  /** The stack's named families, in order, **without** the generic tail. */
  families: readonly string[]
  /** The generic the stack deliberately ends in (`serif`, `sans-serif` or `cursive`). */
  fallback: string
}

/** Split a CSS font stack into its family names, in order (`"A", B, serif`). */
export function calligraphyFamilyList(family: string): string[] {
  return String(family ?? '')
    .split(',')
    .map(part => part.trim().replace(/^["']|["']$/g, '').trim())
    .filter(part => part.length > 0)
}

/** True for a generic CSS family (`serif`, `sans-serif`, `cursive`, …). */
export function isGenericCalligraphyFamily(family: string): boolean {
  return CALLIGRAPHY_GENERIC_FAMILIES.includes(String(family ?? '').trim().toLowerCase())
}

/** The stack's **approved** families: everything before its generic last resort. */
export function calligraphyApprovedFamilies(family: string): string[] {
  return calligraphyFamilyList(family).filter(name => !isGenericCalligraphyFamily(name))
}

/** The generic a stack ends in, or `serif` when a caller hands over a bare family. */
export function calligraphyFallbackFamily(family: string): string {
  const list = calligraphyFamilyList(family)
  for (let i = list.length - 1; i >= 0; i--) if (isGenericCalligraphyFamily(list[i])) return list[i].toLowerCase()
  return 'serif'
}

function face(style: CalligraphyStyle, family: string, weight: '400' | '700', italic: boolean): CalligraphyFontFace {
  return {
    style,
    family,
    weight,
    italic,
    families: calligraphyApprovedFamilies(family),
    fallback: calligraphyFallbackFamily(family),
  }
}

/**
 * The six approved hands, in palette order: the three brush hands (楷 / 行 / 隶),
 * the stele, then the two a sign shop would print — 黑体 and 宋体.
 *
 * These are the web game's existing `CALLIGRAPHY_STYLES[].family` strings, kept
 * verbatim: the fix for "the Unity inscription's glyphs differ" is to paint with
 * these faces, not to choose new ones.
 */
export const CALLIGRAPHY_FONT_MANIFEST: Record<CalligraphyStyle, CalligraphyFontFace> = {
  kai: face('kai', '"KaiTi", "STKaiti", "Kaiti SC", "Kaiti TC", "DFKai-SB", "SimSun", serif', '400', false),
  xing: face('xing', '"STXingkai", "Xingkai SC", "KaiTi", "STKaiti", "DFKai-SB", cursive', '400', true),
  li: face('li', '"LiSu", "Baoli SC", "SimLi", "STLiti", "STSong", serif', '400', false),
  wei: face('wei', '"STXinwei", "Weibei SC", "SimHei", "Microsoft YaHei", sans-serif', '700', false),
  hei: face('hei', '"Microsoft YaHei", "PingFang SC", "Heiti SC", "SimHei", sans-serif', '700', false),
  song: face('song', '"SimSun", "Songti SC", "STSong", "Noto Serif SC", serif', '400', false),
}

/** Every approved hand, in palette order. */
export const CALLIGRAPHY_FONT_STYLES: readonly CalligraphyStyle[] = ['kai', 'xing', 'li', 'wei', 'hei', 'song']

/** The approved face for a hand; an unknown/legacy style is 楷书, like `calligraphyStyle`. */
export function calligraphyFontFace(style: CalligraphyStyle | undefined): CalligraphyFontFace {
  return CALLIGRAPHY_FONT_MANIFEST[style ?? 'kai'] ?? CALLIGRAPHY_FONT_MANIFEST.kai
}

/** The CSS `font` shorthand a resolver and a painter hand to the canvas. */
export function calligraphyFontShorthand(face: CalligraphyFontFace, sizePx: number): string {
  return `${face.italic ? 'italic ' : ''}${face.weight} ${Math.max(1, Math.round(sizePx))}px ${face.family}`
}

/* ------------------------------------------------------------- resolution */

/** What the environment could prove about one named family. */
export interface CalligraphyFaceProbeResult {
  /** `document.fonts.check` for the family's own shorthand. */
  checked: boolean
  /**
   * Whether the family's advance differs from the generic fallback, `null` when the
   * environment cannot measure. `document.fonts.check` alone cannot tell an installed
   * system face from a silently substituted one, so this is the honest signal.
   */
  measured: boolean | null
}

/** One named family's availability, as far as the environment can say. */
export interface CalligraphyFaceAvailability {
  family: string
  checked: boolean
  measured: boolean | null
}

/**
 * Probe one named family. Returns `null` when presence cannot be detected at all
 * (no `document.fonts`, no canvas), which keeps a headless caller honest: it must
 * not report a face missing just because it cannot look.
 */
export type CalligraphyFaceProbe = (
  family: string,
  weight: string,
  italic: boolean,
  fallback: string,
) => CalligraphyFaceProbeResult | null

/** What the painter actually resolved for one inscription. */
export interface CalligraphyFaceResolution {
  style: CalligraphyStyle
  /** The requested stack, unchanged. */
  family: string
  weight: '400' | '700'
  italic: boolean
  /** The first approved family the environment could prove, `''` when none was. */
  resolved: string
  /** True when every approved family was absent and the paint used the last resort. */
  missing: boolean
  /** True when the environment could prove presence at all. */
  detectable: boolean
  /** The generic the paint fell through to. */
  fallback: string
  /** Per-family detail, for a verifier line. */
  families: CalligraphyFaceAvailability[]
}

/**
 * Resolve which approved face a paint of `style` actually uses.
 *
 * `document.fonts.check` is asked for every named family (it is the only standard
 * probe), but a `true` there does not prove a system face is installed; when the
 * caller can also measure the family's advance against the generic fallback, that
 * measurement decides. A face is **missing** only when the environment can prove it
 * looked and none of the approved families is present — never merely because the
 * probe was unavailable.
 */
export function resolveCalligraphyFace(
  style: CalligraphyStyle | undefined,
  probe?: CalligraphyFaceProbe,
): CalligraphyFaceResolution {
  const face = calligraphyFontFace(style)
  const families: CalligraphyFaceAvailability[] = []
  let detectable = false
  let resolved = ''
  for (const family of face.families) {
    const result = probe ? probe(family, face.weight, face.italic, face.fallback) : null
    if (!result) {
      families.push({ family, checked: false, measured: null })
      continue
    }
    if (result.measured !== null) detectable = true
    families.push({ family, checked: result.checked === true, measured: result.measured })
    if (resolved.length === 0 && (result.measured === true || (result.measured === null && result.checked === true))) {
      resolved = family
    }
  }
  return {
    style: face.style,
    family: face.family,
    weight: face.weight,
    italic: face.italic,
    resolved,
    missing: detectable && resolved.length === 0,
    detectable,
    fallback: face.fallback,
    families,
  }
}

/**
 * One compact line a verifier can read: the hand, the face that actually painted,
 * whether it is a fallback, and every approved family's verdict.
 */
export function describeCalligraphyResolution(resolution: CalligraphyFaceResolution): string {
  const face = resolution.resolved.length > 0
    ? resolution.resolved
    : `fallback:${resolution.fallback}`
  const verdicts = resolution.families.map(entry =>
    `${entry.family}:${entry.measured === null ? (entry.checked ? 'checked' : 'unknown') : entry.measured ? 'yes' : 'no'}`)
  return `style=${resolution.style} face=${face} missing=${resolution.missing ? '1' : '0'}` +
    ` detected=${resolution.detectable ? '1' : '0'} (${verdicts.join(',')})`
}

/** The resolution a caller can print without a DOM: the approved stack and its fallback. */
export function calligraphyFaceSummary(style: CalligraphyStyle | undefined): string {
  const face = calligraphyFontFace(style)
  return `${face.style} ${face.weight}${face.italic ? ' italic' : ''} ${face.family} -> ${face.fallback} (${CALLIGRAPHY_LAST_RESORT_FAMILY} last resort, manifest ${CALLIGRAPHY_FONT_VERSION})`
}
