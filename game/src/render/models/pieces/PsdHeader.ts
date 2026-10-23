import { drawModelText } from '../../modelLabels.ts'
import { t } from '../../../sim/i18n.ts'
import type { LineDef } from '../../../sim/types.ts'
import type { PlatformEdgeModule } from '../../../sim/track.ts'

/** Full-height fascia, with its space taken from the glazed doorway below. */
export const PSD_HEADER_HEIGHT = 0.53
export const PSD_HEADER_PIXELS = 256

export function psdHeaderInfo(line: LineDef | undefined, mod: PlatformEdgeModule, name: string) {
  const down = mod.cfg.dir === 'down'
  const destination = (down ? line?.downTerminus : line?.upTerminus)?.trim() ?? ''
  return {
    destination: destination || t(down ? 'down' : 'up'),
    destinationEn: (down ? line?.downTerminusEn : line?.upTerminusEn)?.trim() ?? '',
    terminal: !!destination && destination === name.trim(),
    // The platform-facing plane reverses its local x on the left bank.
    arrow: (down ? -1 : 1) * (mod.cfg.side === 'right' ? 1 : -1),
  }
}

export type PsdHeaderInfo = ReturnType<typeof psdHeaderInfo>

/** Bilingual physical signage, GAME-SPEC §5.9. Coordinates cover one panel. */
export function drawPsdHeader(g: CanvasRenderingContext2D, kind: 'route' | 'station', colour: string,
  info: PsdHeaderInfo, name: string, nameEn: string): void {
  g.fillStyle = '#f4f6f8'
  g.fillRect(0, 0, 1024, PSD_HEADER_PIXELS)
  g.fillStyle = colour
  g.fillRect(0, 234, 1024, 22)
  g.fillStyle = '#747c82'
  g.fillRect(0, 0, 2, 234)
  g.fillRect(1022, 0, 2, 234)
  g.fillStyle = '#20262a'
  g.textAlign = 'center'
  if (kind === 'station') {
    g.font = 'bold 76px "Microsoft YaHei", sans-serif'
    drawModelText(g, name, 512, 100, 480)
    g.font = '30px sans-serif'
    drawModelText(g, nameEn, 512, 148, 480)
  } else if (info.terminal) {
    g.font = '72px "Microsoft YaHei", sans-serif'
    drawModelText(g, t('printed_psd_terminal_zh'), 512, 105, 700)
    g.font = '32px sans-serif'
    drawModelText(g, t('printed_psd_terminal'), 512, 166, 700)
  } else {
    // Only schematic stops are known; do not invent station names.
    g.strokeStyle = colour
    g.lineWidth = 6
    g.beginPath(); g.moveTo(70, 76); g.lineTo(954, 76); g.stroke()
    for (let x = 90; x <= 934; x += 84) {
      g.beginPath(); g.arc(x, 76, 7, 0, Math.PI * 2)
      g.fillStyle = '#f4f6f8'; g.fill(); g.stroke()
    }
  }
  // A terminal's destination is the station itself, so its plaque carries no
  // direction arrow — only the name, over the schematic/终点站 strip.
  if (!info.terminal) {
    const sign = info.arrow
    const x = kind === 'station' ? (sign < 0 ? 215 : 809) : (sign < 0 ? 410 : 614)
    const y = kind === 'station' ? 112 : 186
    // The destination occupies only the travel side of a station plaque.
    g.strokeStyle = '#20262a'; g.lineWidth = 4
    g.beginPath(); g.moveTo(x - sign * 22, y); g.lineTo(x + sign * 22, y)
    g.moveTo(x + sign * 8, y - 12); g.lineTo(x + sign * 22, y); g.lineTo(x + sign * 8, y + 12); g.stroke()
    g.fillStyle = '#20262a'
    g.textAlign = sign < 0 ? 'right' : 'left'
    g.font = '30px "Microsoft YaHei", sans-serif'
    drawModelText(g, info.destination, x + sign * 38, y + (info.destinationEn ? -4 : 8), kind === 'station' ? 165 : 280)
    if (info.destinationEn) {
      g.font = '18px sans-serif'
      drawModelText(g, info.destinationEn, x + sign * 38, y + 22, kind === 'station' ? 165 : 280)
    }
  }
}
