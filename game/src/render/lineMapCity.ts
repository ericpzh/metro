import { normalizeCityStyle, type CityStyle } from '../sim/cityStyles.ts'

export function cityLineMapSlug(city?: CityStyle): string {
  return normalizeCityStyle(city) === 'guangzhou' ? 'network-map' : `${normalizeCityStyle(city)}-map`
}
export function cityLineMapSuffix(city?: CityStyle): string {
  return normalizeCityStyle(city) === 'guangzhou' ? '' : `|${normalizeCityStyle(city)}`
}
