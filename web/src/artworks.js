// The concept sheets, grouped for reading.
//
// `id` is the sheet's number in the spec (§1.1–§1.13) and is drawn into the
// SVG itself, so it never changes — but the gallery is *not* shown in spec
// order. The sheets are gathered into three sections (see `sections`) so a
// human can read the site top to bottom: overview, then high-level features,
// then the low-level detail.
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
// actually built, in detail.
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
    tags: ['等轴测', '1 格 = 1 米', '屋顶掀开'],
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
      '六十二件，各有占地，也各有一份仿真真会去读的通行量。',
    note:
      '占一块地、带一份容量、有服务时间，还给每个人留出站的位置。摆错地方不会报错，会排队。',
    tags: ['62 件', '游戏模型本身', '仿真读取的通行量'],
    alt:
      '六十二件可放置车站模块的目录图，均以等轴测绘制并标注占地与通行量。',
  },
  {
    id: '05',
    section: 'features',
    file: '05-trains-and-track.svg',
    nav: '车辆',
    accent: '#a98bf5',
    panel: { mode: 'edge', side: 'left', top: '20.6%' },
    kicker: '概念 05 · 列车与轨道',
    title: '车多宽，站台就退到哪',
    lead:
      'A / B / C / L 四个等级：车多宽，站台边缘就退到哪；几扇门，上车就多快；怎么供电，决定钻隧道还是走高架。',
    note:
      '车不是背景板：屏蔽门开哪、队伍怎么排、停多久，连发车间隔都得跟着它变。',
    tags: ['A / B / C / L', '每侧车门数', '接触网 vs 第三轨'],
    alt:
      '车辆图：四个等级各一张正面和侧面正视，带尺寸标注，以及屏蔽门全高与半高的断面。',
  },
  {
    id: '06',
    section: 'features',
    file: '06-crowd-demand.svg',
    nav: '客流',
    accent: '#f4804a',
    panel: { mode: 'free', left: '21.5%', top: '42.7%' },
    kicker: '概念 06 · 客流需求',
    title: '一天的客流，自己拖',
    lead:
      '「时刻 · 客流」一个窗口管完：一条曲线、三段时间、三个旋钮，和一整年的日历。',
    note:
      '曲线画的是哪条线，仿真放的就是哪条线 —— 窗口和站台上的人读的是同一份数据。',
    tags: ['六个把手', '三个旋钮', '日历系数 0.35–1.15'],
    alt:
      '「时刻 · 客流」窗口：客流曲线、三段时间、三个旋钮和日历；下面按节假日、工作日、周六、周日分别列出同一条曲线。',
  },
  {
    id: '07',
    section: 'features',
    file: '07-interface.svg',
    nav: '界面',
    accent: '#35c8c8',
    panel: { mode: 'free', left: '10.5%', top: '21.4%' },
    kicker: '概念 07 · 界面',
    title: '一屏四块',
    lead: '顶上控制，左边建造栏，中间工地，右边信息栏，底下一排仿真读数。',
    note:
      '相机就是楼层选择器：看得见哪层，改的就是哪层。视图开关在信息栏里，不在建造栏 —— 图纸怎么画，和车站长什么样，分开管。',
    tags: ['建造栏 232 px', '信息栏 300 px', '相机 = 楼层选择器'],
    alt:
      '整个窗口标出了顶栏、建造栏、工地、信息栏和底栏，下面分别列出建造栏的文件夹、信息栏的视图开关和「时刻 · 客流」窗口。',
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
      '一个方块一格，六个面：顶面铺地板，底面当天花板，四面是墙。材质住在面上，不在格上。',
    note:
      '只有露在外面的面才画墙：和实心邻居贴着的一面什么都不画，两个顶面于是拼成一整片。方块是直角立方体 —— 顶边不倒角，外角也不倒圆。',
    tags: ['每格 6 个面', '直角立方体', '相邻的面不画'],
    alt:
      '同一个方块从上、从下两张示意图，标注了六个面各自当什么用；旁边是 2 × 2 和 L 形的暴露面，以及九个格子拼成一整片的地面。',
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
    title: '四个等级，四种车体',
    lead:
      'A / B / C / L 四个等级，车体长度、车门数和受电方式各不相同。',
    note:
      'A 型最宽最长：22 米，每侧五门，高架接触网。B 型是主力。C 型更窄。L 型是直线电机车 —— 16.8 米，每侧三门，动物园那一列就是它。',
    tags: ['A / B / C / L', '单节 170 – 310 人', '门距 4.1 – 5.6 米'],
    alt:
      '四个等级的列车三维图各一张，加上一列六节编组的整列车，标注了尺寸、车门、定员和受电方式。',
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
      '平面画上车顺序，立面标车门位置，中间串起从车门到出站的整条路，最后对比四个等级的车门节奏。',
    note:
      '屏蔽门开口正对车门中心。站台边缘不是随手刷的，是整套布局要兑现的承诺。',
    tags: ['车门间距 4.60 米（B 型）', '屏蔽门对齐车门中心', '下车 → 排队 → 出站'],
    alt:
      '站台车门与客流图：平面上的上车时序、车门立面、寻路步骤，和各车型的车门节奏。',
  },
]
