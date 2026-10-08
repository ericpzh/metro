// Player-facing introductions. Each sheet has one main idea.
export const tagline = "自由搭建，逐层连接。让人群走进车站，再把堵住的地方一点点改好。"

export const sections = [
  {
    "id": "overview",
    "label": "站里的风景",
    "note": "从站厅到站台，再把不同线路连接起来。"
  },
  {
    "id": "trains",
    "label": "沿轨道出发",
    "note": "选择车体与编组，再安排停靠和上下车。"
  },
  {
    "id": "building",
    "label": "一格格搭起",
    "note": "用方块搭空间，摆好设备，换个视角检查通路。"
  },
  {
    "id": "simulation",
    "label": "人潮的一天",
    "note": "调整客流，观察排队，再回到建造中改善车站。"
  }
]

export const artworks = [
  {
    "id": "01",
    "section": "overview",
    "file": "01-isometric-cutaway.svg",
    "nav": "剖切",
    "accent": "#e8556a",
    "title": "你要搭的车站",
    "lead": "搭好站厅与站台，运行后观察人群怎样经过闸机、扶梯和车门。",
    "alt": "两层车站的剖切图，展示闸机、换层设施、站台和乘客。"
  },
  {
    "id": "02",
    "section": "overview",
    "file": "02-vertical-section.svg",
    "nav": "剖面",
    "accent": "#4aa3e8",
    "title": "越深的车站，越要照顾换层",
    "lead": "楼层可以上下叠放；连接它们的通路，会影响乘客的步行距离和等待。",
    "alt": "高架、街面、站厅与两层地下站台的垂直剖面。"
  },
  {
    "id": "13",
    "section": "overview",
    "file": "13-two-line-interchange.svg",
    "nav": "换乘",
    "accent": "#38b99a",
    "title": "把两条线路连成一座站",
    "lead": "高架和地下线路共用站厅，换层设施的布局决定换乘是否顺畅。",
    "alt": "高架站台、B1 站厅与 B2 地下站台的双线换乘剖切图。"
  },
  {
    "id": "11",
    "section": "trains",
    "file": "11-rolling-stock-3d.svg",
    "nav": "车体",
    "accent": "#5c93f5",
    "title": "靠近看看你的列车",
    "lead": "四种车型各有外观，停靠后开门，乘客走进车厢。",
    "alt": "四种列车外观、开门车厢与车头细节。"
  },
  {
    "id": "05",
    "section": "trains",
    "file": "05-trains-and-track.svg",
    "nav": "编组",
    "accent": "#a98bf5",
    "title": "让列车装得下等车的人",
    "lead": "选择车型与编组，留出足够长的站台；载客不足时，乘客会滞留。",
    "alt": "A、B、C、L 四种列车的正面、侧面与六节编组规模对比。"
  },
  {
    "id": "12",
    "section": "trains",
    "file": "12-platform-doors-flow.svg",
    "nav": "上下车",
    "accent": "#ef86ae",
    "title": "给上下车的人留出空间",
    "lead": "车门两侧排队，中间留给下车乘客；再把站台接到换层设施和出口。",
    "alt": "站台上下车动画、车门对齐示意与乘客出站路线。"
  },
  {
    "id": "03",
    "section": "building",
    "file": "03-block-system.svg",
    "nav": "方块",
    "accent": "#f2b32c",
    "title": "一米一格，慢慢搭",
    "lead": "拼出地板、墙和天花板，换上喜欢的材质，再用半墙与斜块调整边界。",
    "alt": "方块、连续地面、房间、半墙、三角块与材质示例。"
  },
  {
    "id": "04",
    "section": "building",
    "file": "04-module-catalogue.svg",
    "nav": "设备",
    "accent": "#46c98b",
    "title": "组织客流，也装点车站",
    "lead": "摆放闸机、扶梯和电梯，再用座椅、标识与家具安排空间。",
    "alt": "18 件车站设备与陈设的模型目录。"
  },
  {
    "id": "09",
    "section": "building",
    "file": "09-camera-and-views.svg",
    "nav": "视角",
    "accent": "#7f8bf0",
    "title": "换个角度，看清通路",
    "lead": "俯视检查布局，剖开检查楼层连接，靠近看看站厅的样子。",
    "alt": "同一座车站的建造、俯视、剖切、楼层剖面与平视画面。"
  },
  {
    "id": "06",
    "section": "simulation",
    "file": "06-crowd-demand.svg",
    "nav": "客流",
    "accent": "#f4804a",
    "title": "试试车站能扛住多大的高峰",
    "lead": "直接拖动图里的时间边界，再到游戏中调整入口流量、观察队伍。",
    "alt": "可拖动的客流曲线、日历与出入口流量设置。"
  },
  {
    "id": "07",
    "section": "simulation",
    "file": "07-interface.svg",
    "nav": "界面",
    "accent": "#35c8c8",
    "title": "建造、运行、再修改",
    "lead": "左边选工具，右边调设置。看底栏的排队与滞留，找出下一处要改的地方。",
    "alt": "游戏全屏界面及建造、调整、观察三个操作重点。"
  }
]
