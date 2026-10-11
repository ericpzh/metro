import { msg } from '../../../sim/i18n.ts'
import zooPreview from '../../../assets/stations/zoo.png'
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
] as const
