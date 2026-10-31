import { normalizeCityStyle, type CityStyle } from '../sim/cityStyles.ts'

export function cityLineMapSlug(city?: CityStyle): string {
  return normalizeCityStyle(city) === 'shenzhen' ? 'shenzhen-map' : 'network-map'
}
export function cityLineMapSuffix(city?: CityStyle): string {
  return normalizeCityStyle(city) === 'shenzhen' ? '|shenzhen' : ''
}
