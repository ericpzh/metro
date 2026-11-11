import type { CityStyle } from '../sim/cityStyles.ts'
// Build-rail thumbnails are pre-rendered into public PNG assets. Keep their URLs small
// and let <img loading="lazy"> fetch them only as a palette tile nears the viewport.

export function moduleThumbnail(id: string, city: CityStyle = 'guangzhou'): string {
  const base = (typeof window === 'undefined' ? undefined : (window as Window & { metroUnityUiBase?: string }).metroUnityUiBase) ?? import.meta.env.BASE_URL
  return `${base}module-thumbnails/${city !== 'guangzhou' && (id === 'exit' || id.startsWith('exit-') || id === 'guidepost' || id.startsWith('linemap-')) ? `${city}/` : ''}${encodeURIComponent(id)}.png`
}
