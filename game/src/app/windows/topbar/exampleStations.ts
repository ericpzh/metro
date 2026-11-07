import { msg } from '../../../sim/i18n.ts'
import zooPreview from '../../../assets/stations/zoo.webp'
import tanweiPreview from '../../../assets/stations/tanwei.webp'
import tianhePreview from '../../../assets/stations/tianhe.webp'
import { useStore } from '../../store.ts'

// Each example owns its preview and loader so adding a station does not change
// the selection menu or the top-bar button (§9.2).
export const EXAMPLE_STATIONS = [
  {
    id: 'zoo',
    name: msg('zoo'),
    description: msg('guangzhou_metro_line_5'),
    preview: zooPreview,
    load: (): void => useStore.getState().loadReference(),
  },
  {
    id: 'tanwei',
    name: msg('tanwei'),
    description: msg('guangzhou_metro_lines_5_6'),
    preview: tanweiPreview,
    load: (): void => useStore.getState().loadReference('tanwei'),
  },
  {
    id: 'tianhe',
    name: msg('tianhe'),
    description: msg('guangzhou_metro_lines_11_13_21'),
    preview: tianhePreview,
    load: (): void => useStore.getState().loadReference('tianhe'),
  },
] as const
