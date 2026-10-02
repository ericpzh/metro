// Guangzhou Metro line sign colours — the default palette for a new line.
//
// Confirmed values are the operator's sign colours; a line numbered N is born
// wearing the colour the real 广州地铁 line N wears. The under-construction /
// planned lines are marked provisional: their colours come from a leaked VI
// spec, may be stale, and can change when the line opens. Numbers with no known
// colour (the `bbbbbb` placeholder) are omitted and fall back to the app blue.
//
// ASCII keys per §9.2; this is reference data, not a tuning number.

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

/** The sign colour for a line id, or the app default when it has none. */
export function lineColourFor(id: string): string {
  return GUANGZHOU_LINE_COLOURS[id] ?? DEFAULT_LINE_COLOUR
}
