// The thirteen concept sheets, in the order they are drawn in the spec.
//
// `panel` is where the text card may sit without covering the drawing. The
// values were measured, not guessed: each sheet was rasterised at a 1440px
// reference width and scanned with an edge-energy map for the quietest band
// that keeps the whole card on screen. `mode: 'edge'` hugs the 5% margin;
// `mode: 'free'` marks a genuinely empty pocket in the middle of the sheet.
// Re-run that search before moving a panel by hand.
//
// All rendered strings are Simplified Chinese: the shipping UI language is
// Chinese only (§9.2 of the spec), and the sheets themselves are drawn in it.

export const tagline =
  '《Overcrowd》般清晰可读的娃娃屋剖面，迷你地铁般的客流压力，真实的中国地铁车辆。'

export const artworks = [
  {
    id: '01',
    file: '01-isometric-cutaway.svg',
    nav: '剖切',
    accent: '#e8556a',
    panel: { mode: 'edge', side: 'right', top: '57.5%' },
    kicker: '概念 01 · 等轴测剖视图',
    title: '你正在建造的车站',
    lead:
      '娃娃屋视角下的 B1 站厅，屋顶被切去，透过扶梯竖井还能看到下面的 B2 站台。',
    note:
      '九个清晰可读的分区：闸机、自动售票机、商铺、站台、竖向交通、地面出入口、广告、地面导向、电梯。这里的一切都是可放置的模块，而每一个人都是带目的地的仿真个体。',
    tags: ['2:1 等轴测', '1 格 = 1 米', '屋顶切去'],
    alt:
      '地铁车站站厅的等轴测剖视图：闸机、自动售票机、商铺、通往站台的扶梯，以及成群结队的乘客。',
  },
  {
    id: '02',
    file: '02-vertical-section.svg',
    nav: '剖面',
    accent: '#4aa3e8',
    panel: { mode: 'edge', side: 'right', top: '39.1%' },
    kicker: '概念 02 · 纵剖面',
    title: '深度不是装饰',
    lead:
      '一座车站，四个层：高架桥、地面广场、B1 站厅、屏蔽门后的 B2 站台，以及 B3 站台。',
    note:
      '每一次换层都是一段步行、一次排队和一处通行能力上限。正是这张图驱动了整套仿真设计。',
    tags: ['4 个层', '高架 + 隧道', '竖向交通才是瓶颈'],
    alt:
      '车站剖面图：高架桥、街道广场、B1 站厅，以及上下叠放的 B2/B3 站台。',
  },
  {
    id: '03',
    file: '03-block-system.svg',
    nav: '方块',
    accent: '#f2b32c',
    panel: { mode: 'edge', side: 'left', top: '17.6%' },
    kicker: '概念 03 · 方块系统',
    title: '一块方块，六个面',
    lead:
      '一块方块 = 一个格子，六个面。每个面都承载一种表面：地板、天花板，以及四面的墙。',
    note:
      '八邻域自动拼接掩码决定圆角，倒角的顶边带来厚重、玩具般的轮廓。网格本身很朴素，转角不是。',
    tags: ['每格 6 个面', '八邻域自动拼接', '顶边倒角'],
    alt:
      '单个方块格子的示意图，标注了它的六个面，以及圆角自动拼接掩码。',
  },
  {
    id: '04',
    file: '04-module-catalogue.svg',
    nav: '模块',
    accent: '#46c98b',
    panel: { mode: 'free', left: '32%', top: '11.7%' },
    kicker: '概念 04 · 可放置模块',
    title: '你能放下的东西',
    lead:
      '十五种可放置模块，带真实占地，以及仿真真正会读取的通过量数值。',
    note:
      '模块不是装饰：它是一块占地、一份容量、一段服务时间，以及一组供个体站立的格子。',
    tags: ['15 个模块', '真实占地', '仿真读取的通过量'],
    alt:
      '十五种可放置车站模块的目录图，均以等轴测绘制，每个都标注占地与通过量。',
  },
  {
    id: '05',
    file: '05-trains-and-track.svg',
    nav: '车辆',
    accent: '#a98bf5',
    panel: { mode: 'edge', side: 'left', top: '20.6%' },
    kicker: '概念 05 · 列车与轨道',
    title: '列车定下规则',
    lead:
      '按中国地铁车型分类的 A / B / C 型车：车体宽度决定站台边缘，车门数量决定上车速率，受电方式决定隧道还是高架。',
    note:
      '列车不是布景。它的尺寸会一路传导到屏蔽门、排队通道、停站时间和整个行车间隔预算。',
    tags: ['A / B / C 型', '每侧车门数', '接触网 vs 第三轨'],
    alt:
      '车辆图：A、B、C 型地铁车并排展示，附带轨道、接触网和第三轨细节。',
  },
  {
    id: '06',
    file: '06-crowd-demand.svg',
    nav: '客流',
    accent: '#f4804a',
    panel: { mode: 'free', left: '21.5%', top: '42.7%' },
    kicker: '概念 06 · 客流需求',
    title: '人群从何而来',
    lead:
      '时段曲线、日历倍率、跨深度的换乘路径，以及塑造这一切的逐出口客流控制。',
    note:
      '客流是设计出来的，不是随机的：你能在图上看见早高峰，然后走下站台，亲眼看着它到来。',
    tags: ['时段曲线', '日历倍率', '跨深度换乘'],
    alt:
      '乘客需求图表：时段曲线、日历倍率，以及各层之间的换乘路径。',
  },
  {
    id: '07',
    file: '07-interface.svg',
    nav: '界面',
    accent: '#35c8c8',
    panel: { mode: 'free', left: '10.5%', top: '21.4%' },
    kicker: '概念 07 · 界面',
    title: '建造栏、检查器、小地图',
    lead: '左侧建造栏，右侧检查器，底部是线路管理与小地图。',
    note:
      '相机就是楼层选择器：你能看到什么，就在编辑什么，所以不需要再学一套独立的楼层选择器。',
    tags: ['左侧建造栏', '右侧检查器', '相机 = 楼层选择器'],
    alt:
      '游戏界面线框图：建造面板、3D 视口、检查器面板、线路管理和小地图。',
  },
  {
    id: '08',
    file: '08-architecture.svg',
    nav: '架构',
    accent: '#e2679e',
    panel: { mode: 'free', left: '10.5%', top: '27.7%' },
    kicker: '概念 08 · 软件结构',
    title: '三方，各掌一份真相',
    lead:
      'React 掌管面板与状态，three.js 掌管场景，一个 Worker 掌管三千个正走向列车的个体。',
    note:
      '仿真以固定步长在主线程之外运行，并以缓冲区回报结果。渲染器只读取快照，从不驱动快照。',
    tags: ['React + Vite', 'three.js / R3F', 'Web Worker 仿真'],
    alt:
      '软件结构图：连接 React 界面、three.js 场景，以及运行人群仿真的 Web Worker。',
  },
  {
    id: '09',
    file: '09-camera-and-views.svg',
    nav: '视图',
    accent: '#7f8bf0',
    panel: { mode: 'free', left: '37%', top: '30.8%' },
    kicker: '概念 09 · 相机与视图',
    title: '看一座车站的六种方式',
    lead: '像 CAD 视口一样 360° 自由环绕，外加真正的正交立面。',
    note:
      '同一个车站模型，六种看法——而正对 X-Z 的平立面，正是判断竖向交通到底能不能用的那个视图。',
    tags: ['360° 环绕', '正交立面', '按层切片'],
    alt: '同一个车站模型以六种方式展示：等轴测、平面图，以及四个正交立面。',
  },
  {
    id: '10',
    file: '10-queue-management.svg',
    nav: '排队',
    accent: '#9aa8b8',
    panel: { mode: 'free', left: '24%', top: '45.3%' },
    kicker: '概念 10 · 排队管理',
    title: '游戏里最便宜的运力',
    lead:
      '一团涌来的人群会堵死一切；同样的人群排成单列通道，就有序、可预测，而且只占四分之一的地面。',
    note:
      '导向排队通道把不可预测的拥挤变成可测量的上车速率——这是唯一一种用地面换出余量的升级。',
    tags: ['排队导向', '只占四分之一地面', '可测量的上车速率'],
    alt:
      '平面图对比：未加管理的一团人群，与同样人群排成单列队列通道后的样子。',
  },
  {
    id: '11',
    file: '11-rolling-stock-3d.svg',
    nav: '车辆三维',
    accent: '#5c93f5',
    panel: { mode: 'free', left: '14.5%', top: '36%' },
    kicker: '概念 11 · 列车三维图',
    title: '照游戏的建法绘制',
    lead: 'A、B、C 型编组，用与渲染器相同的等轴测投影绘制。',
    note:
      'A 型：3.0 × 3.8 × 22.0 米，每侧五门，满载 310 人，高架接触网供电。B 型：中国地铁的主力车型，宽 2.8 米，每侧四门，隧道内第三轨供电。C 型：用于自动化支线的轻型断面。',
    tags: ['A：310 人', 'B：240 人', 'C：200 人', '站台接口'],
    alt:
      'A、B、C 型地铁车的三维图，标注了尺寸、车门和受电方式。',
  },
  {
    id: '12',
    file: '12-platform-doors-flow.svg',
    nav: '车门',
    accent: '#ef86ae',
    panel: { mode: 'free', left: '22%', top: '42.5%' },
    kicker: '概念 12 · 站台：车门与客流',
    title: '站台与列车相接之处',
    lead:
      '平面上的上车时序、立面上的车门位置、从车门到街道出口的乘客寻路链条，以及各车型的车门节奏。',
    note:
      '屏蔽门开口落在车门中心上，所以站台边缘不是随手刷上的贴图——它是整套布局必须兑现的承诺。',
    tags: ['车门间距 4.16 米', '屏蔽门对齐车门中心', '下车 → 排队 → 出站'],
    alt:
      '站台车门与客流图：平面上的上车时序、车门立面、寻路步骤，以及各车型的车门节奏。',
  },
  {
    id: '13',
    file: '13-two-line-interchange.svg',
    nav: '换乘',
    accent: '#38b99a',
    panel: { mode: 'edge', side: 'left', top: '56.8%' },
    kicker: '概念 13 · 两条线路，两种深度',
    title: '24.6 米的换乘',
    lead:
      '一条线在街道上方，一条在街道下方：+11.6 米的高架桥面和 −13.0 米的 B2 岛式站台。',
    note:
      '它们之间的 24.6 米才是关键。换乘集中在一处竖井，所以可以当成一次排队来测量，而不是三次；而高架只需要桥墩，因此可以在车站主体建成之后再建。',
    tags: ['用桥墩，不用开挖', '一处换乘竖井', '不计成本，不要员工'],
    alt:
      '双线换乘站的剖切图：B1 站厅上方的地面高架线，以及地下的 B2 岛式站台。',
  },
]
