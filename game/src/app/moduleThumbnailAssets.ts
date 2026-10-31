import type { CityStyle } from '../sim/cityStyles.ts'
// Build-rail thumbnails are pre-rendered into public PNG assets. Keep their URLs small
// and let <img loading="lazy"> fetch them only as a palette tile nears the viewport.

export function moduleThumbnail(id: string, city: CityStyle = 'guangzhou'): string {
  return `${import.meta.env.BASE_URL}module-thumbnails/${city === 'shenzhen' && (id === 'exit' || id.startsWith('exit-') || id === 'guidepost' || id.startsWith('linemap-')) ? 'shenzhen/' : ''}${encodeURIComponent(id)}.png`
}
