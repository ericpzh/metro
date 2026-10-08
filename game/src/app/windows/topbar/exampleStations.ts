import zooPreview from '../../../assets/stations/zoo.png'
import { useStore } from '../../store.ts'

// Each example owns its preview and loader so adding a station does not change
// the selection menu or the top-bar button (§9.2).
export const EXAMPLE_STATIONS = [
  {
    id: 'zoo',
    name: '动物园',
    description: '广州地铁 · 5号线',
    preview: zooPreview,
    load: (): void => useStore.getState().loadReference(),
  },
] as const
