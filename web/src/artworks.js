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
// Re-run that search before moving a panel by hand.
//
// `section` must match one of the `sections` ids below; the order of this
// array is the order sheets appear inside each section.
//
// All rendered strings are Simplified Chinese: the shipping UI language is
// Chinese only (§9.2 of the spec), and the sheets themselves are drawn in it.

export const tagline =
  '像《Overcrowd》那样一眼看懂的娃娃屋剖面，像《迷你地铁》那样的客流压力，还有真材实料的中国地铁车辆。'

// A: the whole picture. B: what the player does. C: how those systems are
// actually built, in detail. D: non-feature engineering.
export const sections = [
  {
    id: 'overview',
    kicker: 'A · 总览',
    label: '概念图总览',
    note: '先看全貌：一座车站的剖切、剖面，以及两条线路上下叠在一起的样子。',
  },
  {
    id: 'features',
    kicker: 'B · 玩法',
    label: '高层特性',
    note: '玩法层面：你能放下的东西、要照顾的车辆、会涌进来的人群，还有手上那套界面。',
  },
  {
    id: 'details',
    kicker: 'C · 细节',
    label: '底层特性',
    note: '沉到细节：格子怎么拼、相机怎么看、车辆怎么造、车门怎么和站台对齐。',
  },
  {
    id: 'technical',
    kicker: 'D · 技术',
    label: '技术实现',
    note: '非玩法的部分：这套仿真和渲染，代码上是靠什么搭起来的。',
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
    title: '你正在建造的车站',
    lead:
      '屋顶整个掀开，就像在看一间娃娃屋：这里是 B1 站厅，顺着扶梯竖井往下，还能看见底下的 B2 站台。',
    note:
      '图上标了九个区域，一眼都能认出来：闸机、售票机、商铺、站台、竖向交通、地面出入口、广告、地面导向、电梯。你能看见的东西，都是可以摆下去的模块；你看见的每一个人，都有自己的目的地。',
    tags: ['2:1 等轴测', '1 格 = 1 米', '屋顶掀开'],
    alt:
      '地铁车站站厅的等轴测剖视图：闸机、自动售票机、商铺、通往站台的扶梯，以及成群结队的乘客。',
  },
  {
    id: '02',
    section: 'overview',
    file: '02-vertical-section.svg',
    nav: '剖面',
    accent: '#4aa3e8',
    panel: { mode: 'edge', side: 'right', top: '39.1%' },
    kicker: '概念 02 · 纵剖面',
    title: '往下挖，就多一段路',
    lead:
      '一座车站叠了好几层：高架桥、地面广场、B1 站厅，以及屏蔽门后面的 B2 站台和更深的 B3 站台。',
    note:
      '每换一层，就多走一段路、多排一次队，也多一个可能卡住的地方。整套仿真，其实就是围着这张图转的。',
    tags: ['高架到地下', '多层叠合', '竖向交通才是瓶颈'],
    alt:
      '车站剖面图：高架桥、街道广场、B1 站厅，以及上下叠放的 B2/B3 站台。',
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
      '一条线架在街道上面，一条线埋在街道下面：+11.6 米的高架桥面，对着 −13.0 米的 B2 岛式站台。',
    note:
      '关键就在中间这 24.6 米。换乘全集中在一个竖井里，所以能当成一次排队来量，而不是三次；高架只需要打桥墩，车站主体建好之后再加也行。',
    tags: ['用桥墩，不用开挖', '一处换乘竖井', '不计成本，不要员工'],
    alt:
      '双线换乘站的剖切图：B1 站厅上方的地面高架线，以及地下的 B2 岛式站台。',
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
      '十五种模块，每一种都有真实占地，也都有仿真真会去读的通行量。',
    note:
      '模块不是摆好看的：它占一块地、带一份容量、有一个服务时间，还给每个人留出站立的位置。',
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
      '按中国地铁的习惯分成 A / B / C 型：车身多宽，站台边缘就退到哪；一侧几扇门，上车就有多快；怎么供电，决定走隧道还是走高架。',
    note:
      '列车不是背景板。它的尺寸会一路往下传：屏蔽门开在哪、队伍怎么排、停站停多久，最后连发车间隔都跟着变。',
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
    title: '人群从何而来',
    lead:
      '一天里的客流曲线、不同日期的倍率、跨楼层的换乘路线，还有管着这一切的每个出口——各自能放多少人进来。',
    note:
      '客流是设计出来的，不是随机刷出来的：先在图上看见早高峰，再走下站台，看着它真的涌进来。',
    tags: ['时段曲线', '日历倍率', '跨深度换乘'],
    alt:
      '乘客需求图表：时段曲线、日历倍率，以及各层之间的换乘路径。',
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
    lead: '左边是建造栏，右边是检查器，底下排着线路管理和一张小地图。',
    note:
      '相机就是楼层选择器：你眼下看得见哪一层，手里改的就是哪一层，不用再单独切一次楼层。',
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
      '人一窝蜂涌上来，什么都能堵死；换成同样这批人排成单列，就变得有序、好预测，占地还只有四分之一。',
    note:
      '导向栏杆能把说不准的拥挤，变成量得出来的上车速度。想用地面换余量，这是最划算的一种办法。',
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
      '一个方块就是一格，一共六个面。顶面铺地板，底面做天花板，剩下四面就是墙。',
    note:
      '八个方向的邻居决定这个转角要不要磨圆；顶边再倒个角，方块立刻有了玩具一样的厚实感。格子本身很朴素，好看的是转角。',
    tags: ['每格 6 个面', '八邻域自动拼接', '顶边倒角'],
    alt:
      '单个方块格子的示意图，标注了它的六个面，以及圆角自动拼接掩码。',
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
      '同一个车站模型，六种看法。其中正对 X-Z 的那个立面最有分量：竖向交通到底够不够用，只有它能说清楚。',
    tags: ['360° 环绕', '正交立面', '按层切片'],
    alt: '同一个车站模型以六种方式展示：等轴测、平面图，以及四个正交立面。',
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
    lead: 'A、B、C 型编组，用的还是渲染器那一套等轴测投影。',
    note:
      'A 型：3.0 × 3.8 × 22.0 米，每侧五门，满载 310 人，靠高架上的接触网供电。B 型：中国地铁里最常见的车型，宽 2.8 米，每侧四门，在隧道里用第三轨供电。C 型：跑自动化支线的轻型车身。',
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
      '平面画的是上车顺序，立面标的是车门位置，中间串起从车门一直到街道出站的整条寻路链，最后对比三种车型各自的车门节奏。',
    note:
      '屏蔽门的开口，正对着车门中心。所以站台边缘不是随手刷条线，而是整套布局必须兑现的一句承诺。',
    tags: ['车门间距 4.16 米', '屏蔽门对齐车门中心', '下车 → 排队 → 出站'],
    alt:
      '站台车门与客流图：平面上的上车时序、车门立面、寻路步骤，以及各车型的车门节奏。',
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
      '界面的面板和状态归 React 管，画面归 three.js 管，那三千个正往列车走的乘客，则交给一个 Worker。',
    note:
      '仿真按固定步长跑在主线程之外，只把结果放进缓冲区交回来。渲染器只读快照，从不反过来推着快照走。',
    tags: ['React + Vite', 'three.js / R3F', 'Web Worker 仿真'],
    alt:
      '软件结构图：连接 React 界面、three.js 场景，以及运行人群仿真的 Web Worker。',
  },
]
