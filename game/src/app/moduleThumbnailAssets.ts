// Build-rail thumbnails are pre-rendered into public PNG assets. Keep their URLs small
// and let <img loading="lazy"> fetch them only as a palette tile nears the viewport.

export function moduleThumbnail(id: string): string {
  return `${import.meta.env.BASE_URL}module-thumbnails/${encodeURIComponent(id)}.png`
}
