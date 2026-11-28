import { DEFAULT_LINE_COLOUR, type CityLineColourPreset } from '../../../sim/cityStyles.ts'

export interface RgbColour {
  r: number
  g: number
  b: number
}

export interface HsvColour {
  /** Hue in degrees `[0, 360)`. */
  h: number
  /** Saturation in `[0, 1]`. */
  s: number
  /** Value / brightness in `[0, 1]`. */
  v: number
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

/** Normalize `#rgb`, `rgb`, `#rrggbb`, or `rrggbb` into lowercase `#rrggbb`, or `null` if invalid. */
export function normalizeHexColour(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.toLowerCase()
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}

/** Parse a hex colour into 0–255 RGB channels. */
export function hexToRgb(input: string): RgbColour | null {
  const hex = normalizeHexColour(input)
  if (!hex) return null
  const packed = Number.parseInt(hex.slice(1), 16)
  return {
    r: (packed >> 16) & 0xff,
    g: (packed >> 8) & 0xff,
    b: packed & 0xff,
  }
}

/** Format 0–255 RGB channels as lowercase `#rrggbb`. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(Number.isFinite(n) ? n : 0)))
  const packed = (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b)
  return `#${packed.toString(16).padStart(6, '0')}`
}

/** Convert `#rrggbb` to HSV (`h` in `[0, 360)`, `s`/`v` in `[0, 1]`), falling back to `DEFAULT_LINE_COLOUR`. */
export function hexToHsv(input: string): HsvColour {
  const rgb = hexToRgb(input) ?? hexToRgb(DEFAULT_LINE_COLOUR)!
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6)
    else if (max === g) h = 60 * ((b - r) / delta + 2)
    else h = 60 * ((r - g) / delta + 4)
  }
  if (h < 0) h += 360
  return {
    h: h >= 360 ? 0 : h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  }
}

/** Convert HSV (`h` in degrees, `s`/`v` in `[0, 1]`) to lowercase `#rrggbb`. */
export function hsvToHex(h: number, s: number, v: number): string {
  const hue = Number.isFinite(h) ? ((h % 360) + 360) % 360 : 0
  const sat = clamp01(s)
  const val = clamp01(v)
  const c = val * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = val - c
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

/** True when dark ink gives better legibility than white ink over `hex`. */
export function isLightHexColour(input: string): boolean {
  const rgb = hexToRgb(input)
  if (!rgb) return false
  const linear = (channel: number): number => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
  return luminance > 0.32
}

const CJK_RE = /[\u3400-\u9fff]/u
const SHORT_CODE_RE = /^(\d+[A-Za-z]?|S\d+|APM|TH[ZP]\d+|M\d+)$/i

/** Compact badge text rendered inside a city preset colour swatch. */
export function presetBadgeLabel(preset: CityLineColourPreset, language: string): string {
  if (language === 'zh-CN') {
    if (preset.id === '0') {
      const cjk = preset.ids.filter((id) => CJK_RE.test(id)).sort((a, b) => a.length - b.length)[0]
      if (cjk) return cjk
    }
    if (SHORT_CODE_RE.test(preset.id)) return preset.id
    const cjk = preset.ids.filter((id) => CJK_RE.test(id)).sort((a, b) => a.length - b.length)[0]
    if (cjk) return cjk.length > 2 && cjk.endsWith('\u7ebf') ? cjk.slice(0, -1) : cjk
  }
  return preset.id
}

/** Descriptive tooltip / accessible label for a city preset swatch. */
export function presetTitle(preset: CityLineColourPreset, language: string): string {
  const isZh = language === 'zh-CN'
  const cjk = preset.ids.filter((id) => CJK_RE.test(id))
  const ascii = preset.ids.filter((id) => !CJK_RE.test(id))
  const picked: string[] = []
  if (isZh) {
    const numeric = ascii.filter((id) => SHORT_CODE_RE.test(id))
    const named = cjk.length > 0 ? cjk : ascii.filter((id) => !SHORT_CODE_RE.test(id))
    for (const id of [...numeric, ...named]) {
      if (!picked.includes(id)) picked.push(id)
    }
  } else {
    for (const id of ascii.length > 0 ? ascii : preset.ids) {
      if (!picked.includes(id)) picked.push(id)
    }
  }
  const summary = picked.slice(0, 3).join(' / ')
  return `${summary} · ${preset.colour.toUpperCase()}`
}
