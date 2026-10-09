// Passenger-information TV: three service cards, a video window and blue footer (§5.7).
import { TRAIN_APPROACH_S } from '../sim/constants.ts'
import type { LineDef } from '../sim/types.ts'
import type { TrainService } from '../sim/trainSchedule.ts'

const CJK = '"Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
export interface TvLineStatus {
  name: string
  colour: string
  terminus: string
  arrivals: Array<{ minutes: number; atPlatform: boolean; arriving: boolean }>
}

/** Select the nearest service track in 3D, including rotated rails and both directions. */
export function tvLineStatus(lines: readonly LineDef[], services: readonly TrainService[], at: readonly [number, number, number]): TvLineStatus | null {
  let nearest: TrainService | undefined
  let best = Infinity
  for (const service of services) {
    if (!lines.some((line) => line.id === service.lineId)) continue
    const dx = at[0] - service.x, dy = at[1] - service.y
    const along = Math.max(0, Math.abs(dx * service.fx + dy * service.fy) - service.halfLength)
    const across = dx * service.fy - dy * service.fx
    const distance = along ** 2 + across ** 2 + (at[2] - service.z) ** 2
    if (distance < best) { best = distance; nearest = service }
  }
  const line = lines.find((line) => line.id === nearest?.lineId) ?? lines[0]
  if (!line) return null
  const direction = nearest?.direction ?? line.direction
  return {
    name: line.name, colour: line.colour,
    terminus: (direction === 'up' ? line.upTerminus : line.downTerminus) || (direction === 'up' ? '上行' : '下行'),
    arrivals: nearest?.arrivals.map((arrival) => ({
      minutes: Math.ceil(arrival.seconds / 60), atPlatform: arrival.atPlatform,
      arriving: !arrival.atPlatform && arrival.seconds <= TRAIN_APPROACH_S,
    })) ?? [],
  }
}

export const STATION_PLATE = { width: 960, height: 540 } as const
// The model uses the same rectangle, so the artwork leaves room for the blue footer.
export const TV_POSTER_RECT = { x: 0.25, y: 0, w: 0.75, h: 0.82 } as const
export const CARD_INSET = 12
export function stationDisplayLayout(width = STATION_PLATE.width, height = STATION_PLATE.height) {
  const colW = width * TV_POSTER_RECT.x
  const footerY = height * 0.9
  const cardH = (footerY - 4 * CARD_INSET) / 3
  return {
    poster: { x: colW, y: 0, w: width * TV_POSTER_RECT.w, h: height * TV_POSTER_RECT.h },
    cards: [0, 1, 2].map((i) => ({ x: CARD_INSET, y: CARD_INSET + i * (cardH + CARD_INSET), w: colW - 2 * CARD_INSET, h: cardH })),
    station: { x: CARD_INSET, y: footerY + 3, w: colW - 2 * CARD_INSET, h: height - footerY - 6 },
    strip: { x: colW, y: footerY, w: width - colW - 144, h: height - footerY },
    clock: { x: width - 144, y: footerY, w: 144, h: height - footerY },
  }
}

function fitText(g: CanvasRenderingContext2D, text: string, width: number, start: number, weight = ''): void {
  let size = start
  do { g.font = `${weight} ${size}px ${CJK}`; if (g.measureText(text).width <= width) break } while (--size > 8)
}
function card(g: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }): void {
  g.fillStyle = '#f1f2f0'
  g.beginPath(); g.roundRect(box.x, box.y, box.w, box.h, 12); g.fill()
}

export function drawStationDisplay(g: CanvasRenderingContext2D, status: TvLineStatus | null, stationName: string, clock: string, date = ''): void {
  const { width: W, height: H } = STATION_PLATE
  const layout = stationDisplayLayout()
  g.clearRect(0, 0, W, H)
  g.fillStyle = '#258cdd'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#080a0c'; g.fillRect(layout.poster.x, 0, layout.poster.w, layout.strip.y)
  const labels = [['本趟列车开往', 'The First Train'], ['下趟列车开往', 'The Next Train'], ['第三趟列车开往', 'The Third Train']]
  layout.cards.forEach((box, i) => {
    card(g, box)
    const cx = box.x + box.w / 2
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#101418'
    fitText(g, labels[i][0], box.w - 12, 28, 'bold'); g.fillText(labels[i][0], cx, box.y + 8)
    fitText(g, labels[i][1], box.w - 16, 15, 'bold'); g.fillText(labels[i][1], cx, box.y + 39)
    fitText(g, status?.terminus ?? '暂无线路', box.w - 16, 32); g.fillText(status?.terminus ?? '暂无线路', cx, box.y + 65)
    const arrival = status?.arrivals[i]
    const value = !arrival ? '暂无班次' : arrival.atPlatform ? '列车停站' : arrival.arriving ? '即将到站' : `${arrival.minutes} 分钟`
    fitText(g, value, box.w - 16, 32); g.fillText(value, cx, box.y + box.h - 41)
  })
  card(g, layout.station)
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#101418'
  fitText(g, stationName, layout.station.w - 16, 27)
  g.fillText(stationName, layout.station.x + layout.station.w / 2, layout.station.y + layout.station.h / 2)
  g.textAlign = 'left'; g.fillStyle = '#eef6ff'
  fitText(g, '文明乘车  请注意脚下安全', layout.strip.w - 24, 26)
  g.fillText('文明乘车  请注意脚下安全', layout.strip.x + 16, layout.strip.y + layout.strip.h / 2)
  g.textAlign = 'center'; g.fillStyle = '#062346'; g.textBaseline = 'top'
  g.font = `bold 18px ${CJK}`; g.fillText(date, layout.clock.x + layout.clock.w / 2, layout.clock.y + 3)
  g.font = `bold 29px ${CJK}`; g.fillText(clock, layout.clock.x + layout.clock.w / 2, layout.clock.y + 23)
}
