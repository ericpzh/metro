// The thirteen concept sheets, grouped for reading.
//
// `id` is the sheet's number in the spec (§1.1–§1.14) and is drawn into the
// SVG itself, so it never changes — but the gallery is *not* shown in spec
// order. The sheets are gathered into four sections (see `sections`) so a
// human can read the site top to bottom: overview, then high-level features,
// then the low-level detail, and finally the non-feature engineering sheet.
//
// `panel` is where the text card may sit without covering the drawing. The
// values were measured, not guessed: each sheet was rasterised at a 1440px
// reference width and scanned with an edge-energy map for the quietest band
// that keeps the whole card on screen. `mode: 'edge'` hugs the 5% margin;
// `mode: 'free'` marks a genuinely empty pocket in the middle of the sheet.
// Re-run that search before placing a panel by hand.
//
// NOTE: the panels are currently pinned to the lower-right corner of every
// sheet in Sheet.jsx, so this data is unused for now — it is kept as the
// measured reference in case the per-sheet placement comes back.
//
// `section` must match one of the `sections` ids below; the order of this
// array is the order sheets appear inside each section.
//
// All rendered strings are Simplified Chinese: the shipping UI language is
// Chinese only (§9.2 of the spec), and the sheets themselves are drawn in it.

export const tagline =
  '娃娃屋一样一眼看懂的剖面，挤挤挨挨的客流，还有货真价实的中国地铁车厢。'

// A: the whole picture. B: what the player does. C: how those systems are
// actually built, in detail. D: non-feature engineering.
export const sections = [
  {
    id: 'overview',
    kicker: 'A · 总览',
    label: '概念图总览',
    note: '先看全貌：剖切、剖面，两条线路上下叠着。',
  },
  {
    id: 'features',
    kicker: 'B · 玩法',
    label: '高层特性',
    note: '玩法：能放什么、要照顾哪些车、人群从哪来、界面什么样。',
  },
  {
    id: 'details',
    kicker: 'C · 细节',
    label: '底层特性',
    note: '细节：格子怎么拼、相机怎么看、车怎么造、车门怎么对站台。',
  },
  {
    id: 'technical',
    kicker: 'D · 技术',
    label: '技术实现',
    note: '技术：仿真和渲染是靠什么搭起来的。',
  },
]

export const artworks = [
  /* --------------------------------------------------------- A · 总览 ---- */
  {
    id: '01',
    section: 'overview',
    file: '01-isometric-cutaway.svg',
    nav: '剖切',
    accent: '#e8556a',
    panel: { mode: 'edge', side: 'right', top: '57.5%' },
    kicker: '概念 01 · 等轴测剖视图',
    title: '你要搭的车站',
    lead:
      '屋顶掀开，像掀开一间娃娃屋：B1 站厅，顺扶梯往下，能看见底下的 B2 站台。',
    note:
      '九个区域一眼认得：闸机、售票机、商铺、站台、竖向交通、出入口、广告、导向、电梯。能看见的都能放；每个人都带着目的地。',
    tags: ['2:1 等轴测', '1 格 = 1 米', '屋顶掀开'],
    alt:
      '地铁车站站厅的等轴测剖视图：闸机、自动售票机、商铺、通往站台的扶梯，和成群结队的乘客。',
  },
  {
    id: '02',
    section: 'overview',
    file: '02-vertical-section.svg',
    nav: '剖面',
    accent: '#4aa3e8',
    panel: { mode: 'edge', side: 'right', top: '39.1%' },
    kicker: '概念 02 · 纵剖面',
    title: '挖得越深，路就越长',
    lead:
      '一座车站叠好几层：高架桥、地面广场、B1 站厅，再往下是 B2 和更深的 B3。',
    note:
      '每换一层，就多走一段、多排一次，也多一个会卡住的地方。整套仿真就围着这张图转。',
    tags: ['高架到地下', '多层叠合', '竖向交通才是瓶颈'],
    alt:
      '车站剖面图：高架桥、街道广场、B1 站厅，和上下叠放的 B2/B3 站台。',
  },
  {
    id: '13',
    section: 'overview',
    file: '13-two-line-interchange.svg',
    nav: '换乘',
    accent: '#38b99a',
    panel: { mode: 'edge', side: 'left', top: '56.8%' },
    kicker: '概念 13 · 两条线路，两种深度',
    title: '24.6 米的换乘',
    lead:
      '一条线架在街上面，一条线埋在街下面：+11.6 米的高架，对着 −13.0 米的 B2 站台。',
    note:
      '关键就是这 24.6 米。换乘全挤在一个竖井，能当成一次排队来量；高架只要打桥墩，主体建好再加也行。',
    tags: ['用桥墩，不用开挖', '一处换乘竖井', '不计成本，不要员工'],
    alt:
      '双线换乘站的剖切图：B1 站厅上方的地面高架线，和地下的 B2 岛式站台。',
  },

  /* ----------------------------------------------------- B · 高层特性 ---- */
  {
    id: '04',
    section: 'features',
    file: '04-module-catalogue.svg',
    nav: '模块',
    accent: '#46c98b',
    panel: { mode: 'free', left: '32%', top: '11.7%' },
    kicker: '概念 04 · 可放置模块',
    title: '你能放下的东西',
    lead:
      '十五种模块，各有占地，也各有一份仿真真会去读的通行量。',
    note:
      '模块不是摆好看的：占一块地、带一份容量、有服务时间，还给每个人留出站的位置。',
    tags: ['15 个模块', '真实占地', '仿真读取的通行量'],
    alt:
      '十五种可放置车站模块的目录图，均以等轴测绘制，每个都标注占地与通行量。',
  },
  {
    id: '05',
    section: 'features',
    file: '05-trains-and-track.svg',
    nav: '车辆',
    accent: '#a98bf5',
    panel: { mode: 'edge', side: 'left', top: '20.6%' },
    kicker: '概念 05 · 列车与轨道',
    title: '车什么样，车站就跟着什么样',
    lead:
      'A / B / C 三种型号：车多宽，站台边缘就退到哪；几扇门，上车就多快；怎么供电，决定钻隧道还是走高架。',
    note:
      '车不是背景板：屏蔽门开哪、队伍怎么排、停多久，连发车间隔都得跟着它变。',
    tags: ['A / B / C 型', '每侧车门数', '接触网 vs 第三轨'],
    alt:
      '车辆图：A、B、C 型地铁车并排展示，附带轨道、接触网和第三轨细节。',
  },
  {
    id: '06',
    section: 'features',
    file: '06-crowd-demand.svg',
    nav: '客流',
    accent: '#f4804a',
    panel: { mode: 'free', left: '21.5%', top: '42.7%' },
    kicker: '概念 06 · 客流需求',
    title: '人群都从哪儿来',
    lead:
      '一天里的客流起落、不同日子的倍率、跨楼层的换乘，还有每个出口能放多少人进来。',
    note:
      '客流是设计出来的：先在图上看到早高峰，再走下站台，看它真的涌进来。',
    tags: ['时段曲线', '日历倍率', '跨深度换乘'],
    alt:
      '乘客需求图表：时段曲线、日历倍率，和各层之间的换乘路径。',
  },
  {
    id: '07',
    section: 'features',
    file: '07-interface.svg',
    nav: '界面',
    accent: '#35c8c8',
    panel: { mode: 'free', left: '10.5%', top: '21.4%' },
    kicker: '概念 07 · 界面',
    title: '建造栏、检查器、小地图',
    lead: '左边建造栏，右边检查器，底下是线路管理和一张小地图。',
    note:
      '相机就是楼层选择器：看得见哪层，改的就是哪层。',
    tags: ['左侧建造栏', '右侧检查器', '相机 = 楼层选择器'],
    alt:
      '游戏界面线框图：建造面板、3D 视口、检查器面板、线路管理和小地图。',
  },
  {
    id: '10',
    section: 'features',
    file: '10-queue-management.svg',
    nav: '排队',
    accent: '#9aa8b8',
    panel: { mode: 'free', left: '24%', top: '45.3%' },
    kicker: '概念 10 · 排队管理',
    title: '游戏里最便宜的运力',
    lead:
      '人一窝蜂涌上来，什么都堵死；排成单列，就有序、好算，占地只剩四分之一。',
    note:
      '栏杆把说不准的拥挤，变成量得出来的上车速度。想用一点地面换余量，这最划算。',
    tags: ['排队导向', '只占四分之一地面', '可测量的上车速率'],
    alt:
      '平面图对比：未加管理的一团人群，与同样人群排成单列队列通道后的样子。',
  },

  /* ----------------------------------------------------- C · 底层特性 ---- */
  {
    id: '03',
    section: 'details',
    file: '03-block-system.svg',
    nav: '方块',
    accent: '#f2b32c',
    panel: { mode: 'edge', side: 'left', top: '17.6%' },
    kicker: '概念 03 · 方块系统',
    title: '一块方块，六个面',
    lead:
      '一个方块一格，六个面：顶面铺地板，底面当天花板，四面是墙。',
    note:
      '八个方向的邻居决定这个角要不要磨圆；顶边再倒个小角，就有了玩具般的厚实感。',
    tags: ['每格 6 个面', '八邻域自动拼接', '顶边倒角'],
    alt:
      '单个方块格子的示意图，标注了它的六个面，和圆角自动拼接掩码。',
  },
  {
    id: '09',
    section: 'details',
    file: '09-camera-and-views.svg',
    nav: '视图',
    accent: '#7f8bf0',
    panel: { mode: 'free', left: '37%', top: '30.8%' },
    kicker: '概念 09 · 相机与视图',
    title: '看一座车站的六种方式',
    lead: '能像 CAD 视口那样 360° 随便转，也能切到真正的正交立面。',
    note:
      '同一个模型，六种看法。正对 X-Z 的立面最有用：竖向交通够不够，只有它说得清。',
    tags: ['360° 环绕', '正交立面', '按层切片'],
    alt: '同一个车站模型以六种方式展示：等轴测、平面图，和四个正交立面。',
  },
  {
    id: '11',
    section: 'details',
    file: '11-rolling-stock-3d.svg',
    nav: '车辆三维',
    accent: '#5c93f5',
    panel: { mode: 'free', left: '14.5%', top: '36%' },
    kicker: '概念 11 · 列车三维图',
    title: '照游戏的建法绘制',
    lead: 'A、B、C 型编组，用的是渲染器那一套等轴测投影。',
    note:
      'A 型：3.0 × 3.8 × 22.0 米，每侧五门，满载 310 人，高架接触网供电。B 型：最常见，宽 2.8 米，每侧四门，隧道里用第三轨。C 型：自动化支线的轻巧小家伙。',
    tags: ['A：310 人', 'B：240 人', 'C：200 人', '站台接口'],
    alt:
      'A、B、C 型地铁车的三维图，标注了尺寸、车门和受电方式。',
  },
  {
    id: '12',
    section: 'details',
    file: '12-platform-doors-flow.svg',
    nav: '车门',
    accent: '#ef86ae',
    panel: { mode: 'free', left: '22%', top: '42.5%' },
    kicker: '概念 12 · 站台：车门与客流',
    title: '站台和列车怎么对上',
    lead:
      '平面画上车顺序，立面标车门位置，中间串起从车门到出站的整条路，最后对比三种车型的车门节奏。',
    note:
      '屏蔽门开口正对车门中心。站台边缘不是随手刷的，是整套布局要兑现的承诺。',
    tags: ['车门间距 4.16 米', '屏蔽门对齐车门中心', '下车 → 排队 → 出站'],
    alt:
      '站台车门与客流图：平面上的上车时序、车门立面、寻路步骤，和各车型的车门节奏。',
  },

  /* --------------------------------------------------------- D · 技术 ---- */
  {
    id: '08',
    section: 'technical',
    file: '08-architecture.svg',
    nav: '架构',
    accent: '#e2679e',
    panel: { mode: 'free', left: '10.5%', top: '27.7%' },
    kicker: '概念 08 · 软件结构',
    title: '三块，各管一摊',
    lead:
      '面板和状态归 React，画面归 three.js，三千个走向列车的小乘客归一个 Worker。',
    note:
      '仿真跑在主线程之外，把结果丢进缓冲区送回来；渲染器只读快照，不反过来推它。',
    tags: ['React + Vite', 'three.js / R3F', 'Web Worker 仿真'],
    alt:
      '软件结构图：连接 React 界面、three.js 场景，和运行人群仿真的 Web Worker。',
  },
]
