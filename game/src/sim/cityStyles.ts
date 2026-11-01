/** Station-wide visual identity. Old saves default to Guangzhou. */
export type CityStyle = 'guangzhou' | 'shenzhen' | 'shanghai'
export const DEFAULT_CITY_STYLE: CityStyle = 'guangzhou'
export function normalizeCityStyle(value: unknown): CityStyle {
  return typeof value === 'string' && Object.hasOwn(CITY_STYLES, value) ? value as CityStyle : DEFAULT_CITY_STYLE
}
export interface CityStyleDefinition {
  nameKey: 'city_guangzhou' | 'city_shenzhen' | 'city_shanghai'
  brandKey: 'guangzhou_metro' | 'shenzhen_metro' | 'shanghai_metro'
  brandEnglishKey: 'printed_guangzhou_metro' | 'printed_shenzhen_metro' | 'printed_shanghai_metro'
  logo: 'guangzhou' | 'shenzhen' | 'shanghai'
  logoColour: string
  entrance: 'guangzhou' | 'shenzhen' | 'shanghai'
  entranceColour: string
  lineColours: Readonly<Record<string, string>>
}

export const DEFAULT_LINE_COLOUR = '#2f7ef2'

/** Line number → sign colour. */
export const GUANGZHOU_LINE_COLOURS: Readonly<Record<string, string>> = {
  // In service.
  '1': '#edcf3b', // 一号线 黄
  '2': '#00679e', // 二号线 蓝
  '3': '#e89e47', // 三号线 橙
  '4': '#01824a', // 四号线 绿
  '5': '#c70541', // 五号线 红
  '6': '#6e0346', // 六号线 紫红
  '7': '#9dd32d', // 七号线 柠檬绿
  '8': '#00858a', // 八号线 青
  '9': '#5ec998', // 九号线 浅绿
  '10': '#6e90b6', // 十号线 钢青
  '11': '#f5bb17', // 十一号线 金黄（环线）
  '12': '#59621d', // 十二号线 橄榄
  '13': '#888600', // 十三号线 橄榄黄
  '14': '#792720', // 十四号线 棕
  '18': '#364c9c', // 十八号线 宝蓝
  '21': '#230b55', // 二十一号线 深藏青
  '22': '#d14d23', // 二十二号线 橙红
  Guangfo: '#bbd80a', // 广佛线 黄绿
  APM: '#00bde2', // APM 线 天蓝
  // Under construction / planned — provisional (leaked VI spec).
  '15': '#ae8a79', // 十五号线
  '16': '#9e652e', // 十六号线
  '17': '#8b84d7', // 十七号线
  '19': '#bb29bb', // 十九号线
  '20': '#d9017a', // 二十号线
  '24': '#1fada9', // 二十四号线
  '28': '#d28bb7', // 二十八号线
  // Trams.
  THZ1: '#5eb630', // 海珠有轨电车 1 号线
  THP1: '#bd0000', // 黄埔有轨电车 1 号线
  THP2: '#e4007f', // 黄埔有轨电车 2 号线
}

/** User-supplied Shenzhen palette, including planned lines and the 6B branch. */
export const SHENZHEN_LINE_COLOURS: Readonly<Record<string, string>> = {
  '1': '#00ab39', '2': '#db6d1c', '3': '#00a2e1', '4': '#dc241f',
  '5': '#9950b2', '6': '#3abca8', '6B': '#037776', '7': '#0035ad',
  '8': '#db6d1c', '9': '#846e74', '10': '#f8779e', '11': '#6a1d44',
  '12': '#a192b2', '13': '#de7c00', '14': '#f2c75c', '15': '#76b900',
  '16': '#1e22aa', '17': '#c6afd4', '18': '#034ea2', '19': '#bb16a3',
  '20': '#88dbdf', '21': '#bbbbbb', '22': '#fbe122', '24': '#79abde',
  '25': '#fead77', '27': '#3c8065', '29': '#9f2f47', '32': '#ba5801',
}
/** Shanghai defaults from the supplied network-map reference. Existing lines stay authored. */
export const SHANGHAI_LINE_COLOURS: Readonly<Record<string,string>> = {
  '1':'#e4002b','2':'#8cc220','3':'#fcd600','4':'#461d84','5':'#944d9a',
  '6':'#d40068','7':'#ed6f00','8':'#0094d8','9':'#87caed','10':'#c6afd4',
  '11':'#871c2b','12':'#007a60','13':'#e999c0','14':'#616020','15':'#bda16b',
  '16':'#98d1c0','17':'#bc796f','18':'#c4984f',
}
export const CITY_STYLES: Readonly<Record<CityStyle, CityStyleDefinition>> = {
  guangzhou: { nameKey: 'city_guangzhou', brandKey: 'guangzhou_metro',
    brandEnglishKey: 'printed_guangzhou_metro', logo: 'guangzhou', logoColour: '#d8231c',
    entrance: 'guangzhou', entranceColour: '#c22f28', lineColours: GUANGZHOU_LINE_COLOURS },
  shenzhen: { nameKey: 'city_shenzhen', brandKey: 'shenzhen_metro',
    brandEnglishKey: 'printed_shenzhen_metro', logo: 'shenzhen', logoColour: '#009943',
    entrance: 'shenzhen', entranceColour: '#101b2b', lineColours: SHENZHEN_LINE_COLOURS },
  shanghai: { nameKey: 'city_shanghai', brandKey: 'shanghai_metro', brandEnglishKey: 'printed_shanghai_metro',
    logo: 'shanghai', logoColour: '#e60012', entrance: 'shanghai', entranceColour: '#353b35', lineColours: SHANGHAI_LINE_COLOURS },
}
export const CITY_STYLE_IDS = Object.keys(CITY_STYLES) as CityStyle[]
export function cityStyleFor(value?: CityStyle): CityStyleDefinition {
  return CITY_STYLES[normalizeCityStyle(value)]
}
export function lineColourFor(id: string, city?: CityStyle): string {
  return cityStyleFor(city).lineColours[id] ?? DEFAULT_LINE_COLOUR
}
