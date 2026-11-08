// Site chrome strings (everything outside the sheet data in artworks.js)
// plus language detection and the canonical /en/ route helper.
//
// The English version is pinned to the `/en/` path, so it is shareable.
// `?lang=en` and `#en` are accepted as aliases on arrival and normalised to the
// path form. The URL is the only signal: `/` always stays Chinese unless the URL
// asks for English — no browser-language or stored-preference redirect.
// The game is a different app on this domain (/game/, /game/en/); its URLs are
// built in site.js.
export const LANGS = ['zh', 'en']

const zh = {
  video: {
    title: '车站设计师 · 游戏演示',
    sheet: '车站设计图', real: '游戏实录', demoPair: '动物园 × 坦尾',
    intro: '把想象，搭成一座车站。', traits: ['自由搭建', '真实客流', '多层换乘'],
    city: '城市风格', cityLead: '一座车站，多种城市气质', cityDetails: ['入口造型', '导向标识'],
    rolling: '列车图鉴', stockLead: '选一列车，驶进你的车站', stockSuffix: '型',
    width: '车体宽度', doors: '每侧车门', metres: '{0} 米', doorCount: '{0} 扇',
    detail: '车站细节', operation: '动手建造', demand: '客流实验',
    begin: '开始建造', beginNote: '从示例车站开始，或从空地搭起。',
    visit: '在线体验', scenePlan: '分镜计划', provenance: '录制信息', credits: '声音来源', contact: '画面总览',
    audioEdit: '沿用游戏内音乐与音效，经剪辑、淡入淡出、叠加和响度调整。',
    musicThanks: '配乐鸣谢', musicLicense: 'CC0 公共领域授权 · 来源：OpenGameArt',
    stages:{empty:'空白新站',city:'城市试验场',bridge:'长桥试验线',equipment:'设备与装饰',colours:'空间配色',placement:'站厅布置'},
    placementStart:'从一块空地开始',placementComplete:'设施齐备，细节就位',
    placementGroups:{'roadside-fence':'沿道路拖放围栏',tactile:'沿路径拖放盲道',gate:'成排拖放闸机',fence:'集中铺设站内玻璃围栏'},
    extendLift:'在顶部继续叠加电梯',dragPlacement:'{0} · 连续拖放',saveName:'演示车站 · 动物园配色',
    buildPhases:{floor:'铺设站厅与站外地面',wall:'建立墙面与空间骨架',deck:'搭建楼层平台',materials:'浅绿搪瓷墙面 · 混凝土与街道'},
    equipmentCatalogue:'车站设备',speedBuild:'八倍速建造',trainLine:'广州地铁 {0} 号线配色',
    storyboard: {
      title: '七十二秒游戏演示 · 分镜计划',
      intro: '使用当前游戏的真实录屏与浅色 Studio 版式。主体沿用网站四段顺序；建造、八城风格与五种车型集中安排在片尾之前。城市每种零点四秒，列车每种零点八秒。建造以作者存档为准：先完成骨架，成组铺设设施，再从东往西布置其余设备与装饰。',
      columns: ['时间', '车站与视图', '画面主题', '内容'], unit: '秒',
      views: {exterior:'全景',exploded:'楼层展开',entrance:'出入口',platform:'站台',flythrough:'站台穿行',editor:'建造界面',detail:'装饰细节',floor:'楼层视图',demand:'客流窗口',bridge:'长桥追踪',showcase:'环绕展示',section:'动态剖切',cube:'视图方块'},
      kinds: {hero:'片头',scenic:'站体展示',city:'城市风格',train:'列车运行',stock:'车型蒙太奇',blocks:'铺设方块',equipment:'放置设备',decor:'设备与装饰蒙太奇',views:'切换视角',demand:'调整客流',cta:'片尾',section:'扫过剖切面',cube:'拖动旋转透视视角',colours:'墙面与地面配色',placement:'站内布置蒙太奇'},
      audio: '配乐使用游戏已收录的《Sunset Plains》，作者 Yoiyami，采用 CC0 授权，并在片尾鸣谢。人群、列车环境声与交互提示音均来自游戏音频清单，按实际操作时刻混音。',
      capture: '读取 video/demo-station.metro.json，保留作者的坐标、材质、标识和模型变体。先搭骨架，盲道、闸机及围栏分组连续拖放，再布置其余设施。电梯由顶部向上叠加。相机保持低侧面视角，从参考图一平滑旋转到参考图二。列车在空地图长桥上运行，城市入口标注动物园 Zoo，片尾保留配乐鸣谢。',
    },
    headlines: {
      '01-reveal': '车站设计师', '02-underground': '深入地下，逐层相连',
      '03-interchange': '让两条线，在这里相遇', '04-boarding': '先下后上，让通行更从容',
      '05-rolling': '一班车，载着人潮出发', '06-blocks': '从一格地面，搭出新的空间',
      '07-equipment': '放下设备，安排车站的日常',
      '07-colours':'给空间添上自己的颜色','montage-placement':'从空地到车站，一镜建成',
      'decor-bench': '坐下来，等下一班车', 'decor-sign': '一眼看懂，下一步往哪走',
      'decor-tree': '留一点绿意，给站外的日常', '05-tianhe-flythrough': '穿行天河公园站台',
      '05-tianhe-concourse': '穿行天河公园站厅',
      '09-demand': '拨动高峰，观察人潮的变化', '10-play': '下一座车站，由你设计',
      '08-section-tianhe':'剖开天河公园，看见层层相通', '08-cube':'拖动视图方块，换一个观察角度',
    },
    notes: {
      '02-underground': '动物园 · 地下站厅与站台', '03-interchange': '坦尾 · 高架与地下线路换乘',
      '04-boarding': '排队、下车、上车，各有自己的空间。', '05-rolling': '停靠、开门、出发，看列车与车站一起运转。',
      '06-blocks': '铺出站厅，再沿外缘建立空间边界。', '07-equipment': '入口售票、连续闸机、靠墙售卖与商店柜台，各有位置。',
      '07-colours':'浅绿搪瓷墙面与混凝土地面。','montage-placement':'先搭骨架，再成组铺设盲道、闸机与围栏。',
      'decor-bench': '座椅、时钟与站台陈设', 'decor-sign': '导向标识、时钟与信息屏',
      'decor-tree': '树木、绿地与站前空间', '05-tianhe-flythrough': '沿十一号线站台前行，四倍速观察客流与列车。',
      '05-tianhe-concourse': '沿地下五米站厅前行，观察往来乘客。',
      '09-demand': '调节入口流量，观察地下五米站厅的人流。',
      '08-section-tianhe':'移动剖切面，逐层展现站厅与站台。','08-cube':'在透视视角中连续旋转，观察车站的不同侧面。',
    },
  },
  doc: {
    title: '车站设计师',
    desc: '《车站设计师》是一款 3D 沙盒小游戏：亲手搭一座车站，看人群在里面挤挤挨挨地走。这里是它的概念图和设计笔记。',
  },
  nav: {
    languageZh: '中文',
    languageEn: 'EN',
    brand: '车站设计师',
    game: '游戏',
    demos: '示例车站',
    gallery: '看图',
    siteLabel: '站点',
    langLabel: '语言',
  },
  hero: {
    eyebrow: '车站设计师 · 游戏',
    line1: '搭一座小小车站。',
    line2: '看人群来来去去。',
    accent: '再想办法，别让它挤爆。',
    facts: [
      ['建造', '从方块到多层换乘站'],
      ['运行', '调节客流，观察排队与滞留'],
      ['观察', '转动、俯视、剖开车站'],
      ['模式', '自由沙盒，专注空间与客流'],
    ],
    play: '开始游戏',
    demos: '示例车站',
    browse: '浏览概念图',
    peekLabel: '前往第一张概念图',
  },
  demos: {
    title: '示例车站',
    intro: '挑一座搭好的真实车站，直接在游戏里打开。',
    close: '关闭示例车站',
    zoo: {
      name: '动物园',
      line: '广州地铁 · 5号线',
      note: '五层地下车站，站前是广场',
    },
    tanwei: {
      name: '坦尾',
      line: '广州地铁 · 5号线 / 6号线',
      note: '高架换乘站，出入口开在地面',
    },
    tianhe: {
      name: '天河公园',
      line: '广州地铁 · 11号线 / 13号线 / 21号线',
      note: '三线换乘大站，站厅铺开球场',
    },
  },
  rail: {
    label: '概念图阅读进度',
  },
  footer: {
    buildTitle: '继续搭你的车站',
    buildBody: '从示例车站开始，或者从空地搭起。运行后看哪里拥堵，再试一种新的布局。',
    buildNote: '这些概念图使用游戏模型与界面，展示你能建造和调整的空间。',
    docsTitle: '文档',
    spec: '游戏设计',
    specSub: '详细说明',
    art: '概念图',
    artSub: 'SVG 原图',
    repo: '代码仓库',
    repoSub: '项目源码',
    benchmark: '性能测试',
    benchmarkSub: '浏览器帧率',
    stats: '全球统计',
    statsSub: '玩家数据',
    name: '车站设计师',
    line: '搭一座车站，看人群来来去去。',
  },
  lightbox: {
    fit: '适应屏幕',
    full: '看原图',
    close: '关掉',
  },
}

const en = {
  video: {
    title: 'Station Designer · Gameplay demo',
    sheet: 'Station blueprint', real: 'Game footage', demoPair: 'Zoo × Tanwei',
    intro: 'Build your imagination into a station.', traits: ['Free building', 'Live crowds', 'Multi-level transfers'],
    city: 'City styles', cityLead: 'One station, different city identities', cityDetails: ['Entrance shapes', 'Wayfinding'],
    rolling: 'Rolling stock', stockLead: 'Choose a train for your station', stockSuffix: 'class',
    width: 'Body width', doors: 'Doors per side', metres: '{0} m', doorCount: '{0} doors',
    detail: 'Station details', operation: 'Build by hand', demand: 'Demand study',
    begin: 'Start building', beginNote: 'Start from a demo station, or build from empty ground.',
    visit: 'Play online', scenePlan: 'Scene plan', provenance: 'Capture details', credits: 'Audio credits', contact: 'Contact sheet',
    audioEdit: 'Editorial mix of the game assets; trimmed, faded, layered and loudness-normalized.',
    musicThanks: 'Music credit', musicLicense: 'CC0 public domain · Source: OpenGameArt',
    stages:{empty:'New empty station',city:'City showcase',bridge:'Long bridge test line',equipment:'Equipment and decor',colours:'Surface colours',placement:'Furnishing the hall'},
    placementStart:'Start with empty ground',placementComplete:'Equipment installed, details in place',
    placementGroups:{'roadside-fence':'Drag the roadside fencing',tactile:'Drag the tactile paths',gate:'Drag rows of fare gates',fence:'Place the concourse glass fencing'},
    extendLift:'Stack the lift upward',dragPlacement:'{0} · Drag a continuous run',saveName:'Demo station · Zoo materials',
    buildPhases:{floor:'Lay the hall and forecourt floors',wall:'Build the station frame',deck:'Build the landing decks',materials:'Pale green enamel · Concrete and street'},
    equipmentCatalogue:'Station equipment',speedBuild:'Build at 8×',trainLine:'Guangzhou Metro Line {0} livery',
    storyboard: {
      title: '72-second gameplay demo · Scene plan',
      intro: 'The main tour follows the four website sections. Building, city styles and train types form one closing montage run. Cities last 0.4 seconds each and trains 0.8 seconds each. The user-authored station is built frame first, then furnished in tool groups. One low camera moves continuously from the west-facing exterior reference to the east-facing hall reference.',
      columns: ['Time','Station and view','On-screen title','Action'], unit: 's',
      views: {exterior:'Exterior',exploded:'Exploded floors',entrance:'Entrance',platform:'Platform',flythrough:'Platform fly-through',editor:'Editor',detail:'Decor detail',floor:'Floor view',demand:'Demand window',bridge:'Bridge tracking',showcase:'Orbit showcase',section:'Section sweep',cube:'View cube'},
      kinds: {hero:'Opening',scenic:'Station overview',city:'City style',train:'Running trains',stock:'Stock montage',blocks:'Block building',equipment:'Equipment placement',decor:'Equipment and decor montage',views:'Camera views',demand:'Demand tuning',cta:'Closing',section:'Moving section plane',cube:'Perspective orbit',colours:'Wall and floor colours',placement:'Station furnishing montage'},
      audio: 'Music: Sunset Plains by Yoiyami (CC0), credited in the closing card. Crowd, train and interaction sounds reuse the approved game audio manifests, synchronized to recorded actions.',
      capture: 'Read video/demo-station.metro.json directly, retaining authored coordinates, materials, signs and model variants. Build the frame first, then group native drags for tactile paths, fare gates and fences. Extend the lift by clicking its top. Keep a low continuous orbit between the two reference angles. Trains run on an empty-map bridge and city entrances read Zoo. The closing shot retains music credits.',
    },
    headlines: {
      '01-reveal': 'Station Designer', '02-underground': 'Underground, connected floor by floor',
      '03-interchange': 'Bring two lines together', '04-boarding': 'Room for alighting and boarding',
      '05-rolling': 'A train carries the crowds onward', '06-blocks': 'Build new space, one block at a time',
      '07-equipment': 'Give every space a purpose',
      '07-colours':'Give the space your colours','montage-placement':'From empty ground to a station, in one take',
      'decor-bench': 'Take a seat, wait for the next train', 'decor-sign': 'See where to go at a glance',
      'decor-tree': 'A little green outside the station', '05-tianhe-flythrough': 'Through the platforms at Tianhe Park',
      '05-tianhe-concourse': 'Through the concourse at Tianhe Park',
      '09-demand': 'Tune the peaks, watch the crowds', '10-play': 'Design the next station yourself',
      '08-section-tianhe':'Cut through the levels at Tianhe Park','08-cube':'Turn the view cube, change perspective',
    },
    notes: {
      '02-underground': 'Zoo · Underground concourse and platforms', '03-interchange': 'Tanwei · Elevated and underground interchange',
      '04-boarding': 'Give queues, alighting and boarding their own space.', '05-rolling': 'Stop, open the doors, depart. Trains and station work together.',
      '06-blocks': 'Lay out the hall and build its outer boundaries.', '07-equipment': 'Ticketing, a continuous fare line, wall fixtures and shop counters each have their place.',
      '07-colours':'Zoo’s red enamel walls and concrete floors.','montage-placement':'Build, paint, drag continuous runs and extend the lift upward.',
      'decor-bench': 'Seats, clocks and platform furnishings', 'decor-sign': 'Wayfinding, clocks and information screens',
      'decor-tree': 'Trees, lawns and the station plaza', '05-tianhe-flythrough': 'Glide along Line 11 as passengers walk and trains run at 4×.',
      '05-tianhe-concourse': 'Follow passengers through the concourse five metres below ground.',
      '09-demand': 'Tune entrance demand with the concourse five metres below ground in view.',
      '08-section-tianhe':'Sweep the cut through the concourse and platforms.','08-cube':'Drag the view cube to orbit the station in perspective.',
    },
  },
  doc: {
    title: 'Station Designer',
    desc: 'Station Designer is a 3D sandbox toy: build a station by hand and watch crowds squeeze through it. These are its concept sheets and design notes.',
  },
  nav: {
    languageZh: '中文',
    languageEn: 'EN',
    brand: 'Station Designer',
    game: 'Game',
    demos: 'Demo stations',
    gallery: 'Gallery',
    siteLabel: 'Site',
    langLabel: 'Language',
  },
  hero: {
    eyebrow: 'Station Designer · Game',
    line1: 'Build a tiny station.',
    line2: 'Watch the crowds come and go.',
    accent: "Then keep it from bursting at the seams.",
    facts: [
      ['Build', 'From blocks to multi-level interchanges'],
      ['Run', 'Tune demand, watch queues and stranded passengers'],
      ['Look', 'Orbit, go top-down, cut through the station'],
      ['Mode', 'Free sandbox about space and flow'],
    ],
    play: 'Play the game',
    demos: 'Demo stations',
    browse: 'Browse the concept art',
    peekLabel: 'Jump to the first concept sheet',
  },
  demos: {
    title: 'Demo stations',
    intro: 'Pick a station that is already built and open it straight in the game.',
    close: 'Close demo stations',
    zoo: {
      name: 'Zoo',
      line: 'Guangzhou Metro · Line 5',
      note: 'Five-level underground station with a surface plaza',
    },
    tanwei: {
      name: 'Tanwei',
      line: 'Guangzhou Metro · Lines 5 / 6',
      note: 'Elevated interchange opening at street level',
    },
    tianhe: {
      name: 'Tianhe Park',
      line: 'Guangzhou Metro · Lines 11 / 13 / 21',
      note: 'Three-line interchange with courts across the surface plaza',
    },
  },
  rail: {
    label: 'Concept-art reading progress',
  },
  footer: {
    buildTitle: 'Keep building your station',
    buildBody:
      'Start from the sample station, or from empty ground. Run it, find the jams, try a new layout.',
    buildNote:
      'These concept sheets use in-game models and UI to show the spaces you can build and tune.',
    docsTitle: 'Docs',
    spec: 'Game design',
    specSub: 'full spec',
    art: 'Concept art',
    artSub: 'SVG originals',
    repo: 'Repo',
    repoSub: 'source code',
    benchmark: 'Benchmark',
    benchmarkSub: 'browser performance',
    stats: 'Global stats',
    statsSub: 'player totals',
    name: 'Station Designer',
    line: 'Build a station, watch the crowds come and go.',
  },
  lightbox: {
    fit: 'Fit screen',
    full: 'Full size',
    close: 'Close',
  },
}

export const ui = { zh, en }

/** Explicit-locale copy for the repeatable video and its review tools. */
export function videoText(lang, key, ...args) {
  return ui[lang].video[key].replace(/\{(\d+)\}/g, (slot, index) => index in args ? String(args[index]) : slot)
}

/** A standalone `en` (or `zh`) segment anywhere in the path pins the language. */
function langFromPath(pathname) {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.includes('en')) return 'en'
  if (segs.includes('zh')) return 'zh'
  return null
}

function langFromQuery(search) {
  const q = new URLSearchParams(search).get('lang')
  if (!q) return null
  const v = q.trim().toLowerCase()
  if (v === 'en' || v === 'english') return 'en'
  if (v === 'zh' || v === 'cn' || v === 'chinese') return 'zh'
  return null
}

/** Hash aliases: #en, #zh, #/en, #/zh. Anything else is an anchor. */
function langFromHash(hash) {
  const v = hash.replace(/^#\/?/, '').replace(/\/$/, '').toLowerCase()
  if (v === 'en' || v === 'english') return 'en'
  if (v === 'zh' || v === 'cn' || v === 'chinese') return 'zh'
  return null
}

export function isLangHash(hash) {
  return langFromHash(hash) !== null
}

export function detectLang(href = window.location.href) {
  const url = new URL(href)
  return langFromPath(url.pathname) || langFromQuery(url.search) || langFromHash(url.hash) || 'zh'
}

/** Canonical shareable path for the site in a language: `/` or `/en/`. */
export function canonicalPath(lang) {
  return lang === 'en' ? '/en/' : '/'
}
