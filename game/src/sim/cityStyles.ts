/** Station-wide visual identity. Old saves default to Guangzhou. */
export type CityStyle = 'guangzhou' | 'shenzhen' | 'shanghai' | 'beijing' | 'chengdu' | 'chongqing'
export const DEFAULT_CITY_STYLE: CityStyle = 'guangzhou'
export function normalizeCityStyle(value: unknown): CityStyle {
  return typeof value === 'string' && Object.hasOwn(CITY_STYLES, value) ? value as CityStyle : DEFAULT_CITY_STYLE
}
export interface CityStyleDefinition {
  nameKey: `city_${CityStyle}`
  brandKey: `${CityStyle}_metro`
  brandEnglishKey: `printed_${CityStyle}_metro`
  logo: CityStyle
  logoColour: string
  /** Station identity and train nose artwork can differ. */
  trainMark?: 'beijing-calligraphy'
  trainMarkColour?: string
  entrance: CityStyle
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
/** User-supplied Shanghai defaults. Existing lines keep their saved colours. */
export const SHANGHAI_LINE_COLOURS: Readonly<Record<string,string>> = {
  '1':'#e3002b','2':'#82bf25','3':'#fcd600','4':'#461d84','5':'#944d9a',
  '6':'#e30067','7':'#ed6f00','8':'#0094d8','9':'#87caed','10':'#c6afd4',
  '11':'#871c2b','12':'#007b61','13':'#e999c0','14':'#626020','15':'#bca886',
  '16':'#98d1c0','17':'#bc796f','18':'#c4984f','19':'#f5ab78','20':'#009f65',
  '21':'#f7af00','22':'#5f376f','23':'#b0d478','26':'#5f67a9',
  Pujiang:'#b5b5b6',Maglev:'#1c5f5b',
  '浦江线':'#b5b5b6','磁浮线':'#1c5f5b',
}
/** User-supplied Beijing defaults, including named branches, airports and trams. */
export const BEIJING_LINE_COLOURS: Readonly<Record<string,string>> = {
  '1':'#a4343a','2':'#004b87','3':'#d90627','4':'#008c95','5':'#aa0061',
  '6':'#b58500','7':'#ffc56e','8':'#009b77','9':'#97d700','10':'#0092bc',
  '11':'#ff8674','12':'#9c4f01','13':'#f4da40','14':'#ca9a8e','15':'#653279',
  '16':'#6ba539','17':'#00abab','18':'#685bc7','19':'#d3a3c9','20':'#666666',
  '22':'#f4c1ca','25':'#d86018','28':'#476205',
  Batong:'#a4343a',Daxing:'#008c95',Yizhuang:'#d0006f',Fangshan:'#d86018',
  Yanfang:'#d86018',S1:'#a45a2a',Changping:'#d986ba',Xijiao:'#d22630',
  CapitalAirport:'#a192b2',DaxingAirport:'#0049a5',M101:'#666666',YizhuangT1:'#d22630',
  '八通线':'#a4343a','大兴线':'#008c95','亦庄线':'#d0006f','房山线':'#d86018',
  '燕房线':'#d86018','S1线':'#a45a2a','昌平线':'#d986ba','西郊线':'#d22630',
  '首都机场线':'#a192b2','大兴机场线':'#0049a5','M101线':'#666666','亦庄T1线':'#d22630',
}
/** Colours sampled from the supplied Chengdu network poster (P5). */
export const CHENGDU_LINE_COLOURS: Readonly<Record<string,string>> = {
  '1':'#3c0899','2':'#ff6034','3':'#df007a','4':'#00af66','5':'#a04a98',
  '6':'#b77a2b','7':'#70d1df','8':'#a1cd00','9':'#eabb00','10':'#0052b8',
  '17':'#80e2ae','18':'#1d6b70',Rong2:'#80bc28','蓉2':'#80bc28','蓉2号线':'#80bc28',
}
/** User-supplied Chongqing defaults, including planned and regional lines. */
export const CHONGQING_LINE_COLOURS: Readonly<Record<string,string>> = {
  '0':'#f2a900','环':'#f2a900','环线':'#f2a900',
  '1':'#e4002b','2':'#007a33','3':'#003da5','4':'#dc8633','5':'#00a3e0',
  '6':'#f67599','7':'#008c95','8':'#7a9a01','9':'#861f41','10':'#5f259f',
  '11':'#d986ba','12':'#d2d755','13':'#b89d18','14':'#b94700','15':'#0057b8',
  '16':'#b04a5a','17':'#9f5cc0','18':'#2cd5c4','19':'#0057b8','20':'#0057b8',
  '21':'#319b42','22':'#2f6f7a','23':'#93c90e','24':'#d6a148','25':'#8a75d1',
  '26':'#0057b8','27':'#0057b8','28':'#0057b8','29':'#ff585d',
  jt:'#0057b8',bt:'#0057b8',yc:'#0057b8',nc:'#0057b8',dz:'#0057b8',qw:'#0057b8',
  '江跳':'#0057b8','江跳线':'#0057b8','璧铜':'#0057b8','璧铜线':'#0057b8',
  '永川':'#0057b8','永川线':'#0057b8','南川':'#0057b8','南川线':'#0057b8',
  '大足':'#0057b8','大足线':'#0057b8','綦万':'#0057b8','綦万线':'#0057b8',
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
  beijing: { nameKey:'city_beijing',brandKey:'beijing_metro',brandEnglishKey:'printed_beijing_metro',
    logo:'beijing',logoColour:'#004a95',trainMark:'beijing-calligraphy',trainMarkColour:'#ffffff',
    entrance:'beijing',entranceColour:'#073563',lineColours:BEIJING_LINE_COLOURS },
  chengdu: { nameKey:'city_chengdu',brandKey:'chengdu_metro',brandEnglishKey:'printed_chengdu_metro',
    logo:'chengdu',logoColour:'#006bb1',entrance:'chengdu',entranceColour:'#343433',lineColours:CHENGDU_LINE_COLOURS },
  chongqing: { nameKey:'city_chongqing',brandKey:'chongqing_metro',brandEnglishKey:'printed_chongqing_metro',
    logo:'chongqing',logoColour:'#008c44',entrance:'chongqing',entranceColour:'#f2f0dd',lineColours:CHONGQING_LINE_COLOURS },
}
export const CITY_STYLE_IDS = Object.keys(CITY_STYLES) as CityStyle[]
export function cityStyleFor(value?: CityStyle): CityStyleDefinition {
  return CITY_STYLES[normalizeCityStyle(value)]
}
export function lineColourFor(id: string, city?: CityStyle): string {
  return cityStyleFor(city).lineColours[id] ?? DEFAULT_LINE_COLOUR
}
