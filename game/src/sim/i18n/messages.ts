// Shared UI, catalogue, validation and display copy. Keep both locales together.
export const messages = {
  suspended_ceiling: { zh: '吊顶', en: 'Suspended ceiling' },
  settings: { zh: '设置', en: 'Settings' },
  benchmark: { zh: '性能测试', en: 'Benchmark' },
  master_volume: { zh: '总音量', en: 'Master volume' },
  sound_effects: { zh: '音效', en: 'Sound effects' },
  music: { zh: '音乐', en: 'Music' },
  music_volume: { zh: '音乐音量', en: 'Music volume' },
  music_play: { zh: '播放音乐', en: 'Play music' },
  music_pause: { zh: '暂停音乐', en: 'Pause music' },
  music_credits: { zh: '音乐鸣谢', en: 'Music credits' },
  music_now: { zh: '当前曲目', en: 'Current track' },
  music_unavailable: { zh: '音乐暂时无法播放，点击播放重试。', en: 'Music unavailable. Press play to retry.' },
  ambient_sound: { zh: '环境音', en: 'Ambient sound' },
  graphics_quality: { zh: '画质', en: 'Graphics quality' },
  graphics_low: { zh: '低画质', en: 'Low quality' },
  graphics_high: { zh: '高画质', en: 'High quality' },
  graphics_low_short: { zh: '低', en: 'Low' },
  graphics_high_short: { zh: '高', en: 'High' },
  upscaling: { zh: 'FSR 设置', en: 'FSR settings' },
  upscaling_ultra: { zh: '超高', en: 'Ultra' },
  upscaling_quality: { zh: '质量', en: 'Quality' },
  upscaling_balanced: { zh: '平衡', en: 'Balanced' },
  upscaling_performance: { zh: '性能', en: 'Performance' },
  edge_scrolling: { zh: '边缘滚动', en: 'Edge scrolling' },
  share_stats: { zh: '分享匿名统计', en: 'Share anonymous stats' },
  share_stats_on: { zh: '开启', en: 'On' },
  share_stats_off: { zh: '关闭', en: 'Off' },
  share_stats_note: { zh: '只发送车站与客流汇总，不含布局或身份', en: 'Sends station and passenger totals only — no layouts or identity' },
  no_outdoor_surface_here: { zh: "这里没有可移除的人行道或草坪", en: "No matching sidewalk or lawn to remove here" },
  outdoor_surface_already_here: { zh: "这里已经铺设了人行道或草坪", en: "This surface is already covered" },
  sidewalk: { zh: "人行道", en: "Sidewalk" },
  lawn: { zh: "草坪", en: "Lawn" },
  tree: { zh: "树木", en: "Tree" },
  no_road_to_remove: { zh: '这里没有可移除的道路', en: 'No road to remove here' },
  traffic_light: { zh: '交通灯', en: 'Traffic light' },
  road_reverse: { zh: '反向', en: 'Reverse flow' },
  reverse_road: { zh: '切换道路行驶方向', en: 'Reverse road direction' },
  road_nodes_distinct: { zh: '请拖动到另一个道路节点', en: 'Drag to another road node' },
  road_width_value: { zh: '道路宽 {0} m', en: 'Road width {0} m' },
  road_node_hint: { zh: '拖动连接节点 · Tab 宽度 · Shift+Tab 方向', en: 'Drag between nodes · Tab width · Shift+Tab traffic' },
  road: { zh: '道路', en: 'Road' },
  road_one_way: { zh: '单向', en: 'One-way' },
  road_two_way: { zh: '双向', en: 'Two-way' },
  road_measure: { zh: '{0} × {1} m · {2} 车道', en: '{0} × {1} m · {2} lanes' },
  road_width_refusal: { zh: '单向道路至少宽 3 m，双向至少宽 6 m', en: 'Roads need at least 3 m for one-way or 6 m for two-way traffic' },
  road_ground_refusal: { zh: '道路需要 0 m 或以上的完整地面', en: 'Roads need a complete floor at 0 m or above' },

  "language_native_chinese": { "zh": "中文", "en": "中文" },
  "language_native_english": { "zh": "English", "en": "English" },
  "tutorial_bgm_on": { "zh": "音乐：开", "en": "Music: On" },
  "tutorial_bgm_off": { "zh": "音乐：关", "en": "Music: Off" },
  "tutorial_title": { "zh": "新手教程", "en": "Getting started" },
  "tutorial_progress": { "zh": "{0} / {1}", "en": "{0} / {1}" },
  "tutorial_dont_show": { "zh": "不再自动显示教程", "en": "Don't show automatically" },
  "tutorial_skip": { "zh": "跳过", "en": "Skip" },
  "tutorial_back": { "zh": "上一步", "en": "Back" },
  "tutorial_next": { "zh": "下一步", "en": "Next" },
  "tutorial_finish": { "zh": "开始建造", "en": "Start building" },
  "tutorial_move": { "zh": "移动视野", "en": "Move around" },
  "tutorial_move_body": { "zh": "欢迎来到新车站！W / S 前后移动，A / D 左右移动。先认识基本操作，再开始建造；随时可点击顶部的教程按钮重看教程。", "en": "Welcome to your new station! W / S move forward and back; A / D move sideways. Learn the controls, then start building. Reopen this tour anytime with the tutorial button at the top." },
  "tutorial_level": { "zh": "切换建造高度", "en": "Choose a building level" },
  "tutorial_level_body": { "zh": "Q 向下一层，E 向上一层；Ctrl+Q / Ctrl+E 向下或向上移动视野。高度条显示当前建造层，也可以直接点击选择高度。", "en": "Q moves down a level; E moves up. Ctrl+Q lowers the view and Ctrl+E raises it. The height bar shows your current building level. Click it to choose a height directly." },
  "tutorial_zoom": { "zh": "缩放视野", "en": "Zoom in and out" },
  "tutorial_zoom_body": { "zh": "滚动鼠标滚轮即可缩放：拉近查看细节，拉远查看整个车站。", "en": "Scroll the mouse wheel to zoom in for details or out for a view of the whole station." },
  "tutorial_orbit": { "zh": "调整观察角度", "en": "Look from another angle" },
  "tutorial_orbit_body": { "zh": "按住鼠标滚轮并拖动来旋转视野。也可点击视角方块的面、边或角，快速切换视角。", "en": "Hold the middle mouse button and drag to orbit. Click a face, edge or corner of the view cube to snap to a view." },
  "tutorial_inspector": { "zh": "右侧信息栏", "en": "The inspector" },
  "tutorial_inspector_body": { "zh": "右侧显示选中对象的信息、视图控制、出入口和线路设置。点击文件夹标题可展开或收起。模拟速度在顶部。", "en": "The right panel contains selection details, view controls, entrances and line settings. Click folder headers to expand or collapse them. Simulation speed is at the top." },
  "tutorial_ground": { "zh": "看清地下空间", "en": "See underground" },
  "tutorial_ground_body": { "zh": "开启「隐藏地面」可看清地下建造区域。这只改变显示，不会删除地面。", "en": "Turn on Hide ground plane to see your underground building area. This changes visibility without removing the ground." },
  "tutorial_line": { "zh": "先规划线路", "en": "Plan a line first" },
  "tutorial_line_body": { "zh": "点击「新建线路」，选择车型和编组。列车长度决定站台需要预留多长的空间。", "en": "Click New line and choose a train type and formation. The train length determines how much space your platform needs." },
  "tutorial_palette": { "zh": "左侧建造工具栏", "en": "Your building palette" },
  "tutorial_palette_body": { "zh": "左侧按文件夹整理了工具、结构、设备、装饰和材质。点击标题展开，再选择要使用的工具或部件。", "en": "The left panel groups tools, structures, equipment, decorations and finishes into folders. Expand a folder, then select a tool or piece." },
  "tutorial_blocks": { "zh": "铺设地基", "en": "Lay the foundations" },
  "tutorial_blocks_body": { "zh": "选择方块工具（F），左键放置方块，按住左键再拖动可铺出一片地板。建造前先用 Q / E 选好高度。", "en": "Choose Block (F). Left-click to place a block, or hold the left button and drag to lay a patch of floor. Use Q / E to choose the level first." },
  "tutorial_delete": { "zh": "删除与撤销", "en": "Remove and undo" },
  "tutorial_delete_body": { "zh": "使用删除工具（B）。选择对应建造工具时，也可右键点击同类物件删除。点击顶部按钮，或用 Ctrl+Z 撤销、Ctrl+Shift+Z 重做。", "en": "Use Delete (B), or select the matching building tool and right-click an item of the same type to remove it. Use the top buttons or Ctrl+Z to undo and Ctrl+Shift+Z to redo." },
  "tutorial_platform": { "zh": "放置站台", "en": "Place a platform" },
  "tutorial_platform_body": { "zh": "选择站台工具并绑定线路，按 R 旋转，左键放置。先铺好足够长的地板，并留出乘客通行空间；工具会按线路设置生成屏蔽门。", "en": "Choose Platform and assign a line. Press R to rotate, then left-click to place it. Lay a floor long enough for the train and leave room for passengers; screen doors follow the line’s settings." },
  "tutorial_extend": { "zh": "延长轨道", "en": "Extend the tracks" },
  "tutorial_extend_body": { "zh": "地下使用隧道，高架使用轨道桥，从已有轨道端部继续延伸。", "en": "Use tunnels underground or railway bridges above ground to extend from the ends of existing track." },
  "tutorial_equipment": { "zh": "让车站连通起来", "en": "Connect your station" },
  "tutorial_equipment_body": { "zh": "添加出入口、楼梯或扶梯，连通街面与站台，并保留连续的步行通道。再从设备和装饰文件夹中添加闸机、照明、标识等。", "en": "Add entrances, stairs or escalators to connect the street to your platforms, keeping a continuous walking route. Then add gates, lights, signs and more from Equipment and decoration folders." },
  "tutorial_paint": { "zh": "选择材质", "en": "Add finishes" },
  "tutorial_paint_body": { "zh": "展开材质文件夹并选择一种材质，按 Tab 切换单块或整面涂刷，再点击墙面、地面或天花板应用材质。", "en": "Expand Surface and select a material. Press Tab to switch between painting one block or a whole surface, then click a wall, floor or ceiling to apply it." },
  "tutorial_save": { "zh": "命名并保存", "en": "Name and save" },
  "tutorial_save_body": { "zh": "点击顶部站名修改名称。点击保存将车站保存为文件，点击加载打开存档。请经常保存。", "en": "Click the station name to rename it. Use Save to save your station to a file, or Open to load a save. Save often." },
  "tutorial_simulate": { "zh": "看看车站如何运转", "en": "Bring the station to life" },
  "tutorial_simulate_body": { "zh": "准备好后选择顶部模拟速度，观察列车与客流。空格键可随时暂停或继续；若乘客无法到达站台，检查通道与楼梯是否连通。", "en": "Choose a simulation speed at the top to watch trains and passengers. Press Space to pause or resume. If passengers cannot reach a platform, check that walkways and stairs connect." },
  "tutorial_examples": { "zh": "寻找更多灵感", "en": "Find more inspiration" },
  "tutorial_examples_body": { "zh": "点击「示例车站」探索已有设计。打开示例会替换当前车站，记得先保存自己的作品。现在开始建造吧！", "en": "Explore Example stations for ideas. Opening an example replaces your current station, so save your work first. You’re ready to build!" },
  "tutorial_gpu": { "zh": "让浏览器使用独立显卡", "en": "Optional: prefer your dedicated GPU" },
  "tutorial_gpu_body": { "zh": "若您的笔记本带有独立显卡，可在 Windows 设置 > 系统 > 显示 > 图形中添加浏览器，并在「选项」里选择「高性能」，然后重启浏览器。Chrome 和 Edge 还需在浏览器设置中开启硬件加速（Chrome：设置 > 系统；Edge：edge://settings/system）", "en": "If your PC has a dedicated GPU, open Windows Settings > System > Display > Graphics, add your browser, choose Options > High performance, then restart the browser. Also enable hardware acceleration in Chrome (Settings > System) or Edge (edge://settings/system). On some laptops, the integrated GPU still drives the display." },
  "monitor": { "zh": "监视器", "en": "Monitor" },
  "monitor_ceiling": { "zh": "吊挂式", "en": "Hanging" },
  "monitor_wall": { "zh": "壁挂式", "en": "Wall-mounted" },
  "rail_signal": { "zh": "信号机", "en": "Rail signal" },
  "fire_cabinet_medium": { "zh": "中", "en": "Medium" },
  "fire_cabinet_small": { "zh": "小", "en": "Small" },
  "fire_cabinet_large": { "zh": "大", "en": "Large" },
  "fire_station": { "zh": "微型消防站", "en": "Fire station" },
  "fire_alarm_119": { "zh": "火警 119", "en": "Fire 119" },
  // Fixed English captions on bilingual model decals; keep both locales identical.
  "printed_queue": { "zh": "Please queue", "en": "Please queue" },
  "printed_line_value": { "zh": "Line {0}", "en": "Line {0}" },
  "printed_face_payment": { "zh": "Face scan payment", "en": "Face scan payment" },
  "printed_recyclable_waste": { "zh": "Recyclable waste", "en": "Recyclable waste" },
  "printed_other_waste": { "zh": "Other waste", "en": "Other waste" },
  "printed_extinguisher": { "zh": "FIRE EXTINGUISHER", "en": "FIRE EXTINGUISHER" },
  "printed_network_map": { "zh": "Transport System Map", "en": "Transport System Map" },
  "printed_no_lines": { "zh": "no lines yet", "en": "no lines yet" },
  "printed_more_lines": { "zh": "+{0} more lines", "en": "+{0} more lines" },
  "printed_guangzhou_metro": { "zh": "Guangzhou Metro", "en": "Guangzhou Metro" },
  "printed_entrance": { "zh": "Entrance", "en": "Entrance" },
  "printed_ticket": { "zh": "Ticket", "en": "Ticket" },
  "printed_mind_gap_full": { "zh": "Mind the gap between train and platform", "en": "Mind the gap between train and platform" },
  "printed_mind_gap": { "zh": "Mind the gap", "en": "Mind the gap" },
  "printed_closing_doors": { "zh": "Stand clear of closing doors", "en": "Stand clear of closing doors" },
  "printed_do_not_touch": { "zh": "CAUTION! Do not touch", "en": "CAUTION! Do not touch" },
  "printed_exit": { "zh": "EXIT", "en": "EXIT" },
  "printed_first_train": { "zh": "The First Train", "en": "The First Train" },
  "printed_psd_terminal_zh": { "zh": "终点站", "en": "终点站" },
  "printed_psd_terminal": { "zh": "Terminal", "en": "Terminal" },
  "printed_next_train": { "zh": "The Next Train", "en": "The Next Train" },
  "printed_third_train": { "zh": "The Third Train", "en": "The Third Train" },
  "printed_metro_station": { "zh": "Metro Station", "en": "Metro Station" },
  "material_stone": { "zh": "石材", "en": "Stone" },
  "material_metal": { "zh": "金属", "en": "Metal" },
  "material_wood": { "zh": "木材", "en": "Wood" },
  "material_other": { "zh": "其他", "en": "Other" },
  "new_color": { "zh": "新颜色", "en": "New Color" },
  "marble": { "zh": "大理石", "en": "Marble" },
  "limestone": { "zh": "石灰石", "en": "Limestone" },
  "sandstone": { "zh": "砂岩", "en": "Sandstone" },
  "slate": { "zh": "板石", "en": "Slate" },
  "obsidian": { "zh": "黑曜石", "en": "Obsidian" },
  "softwood": { "zh": "软木", "en": "Softwood" },
  "hardwood": { "zh": "硬木", "en": "Hardwood" },
  "aluminum_panels": { "zh": "铝板", "en": "Aluminum panels" },
  "hide_panel": { "zh": "隐藏{0}", "en": "Hide {0}" },
  "show_panel": { "zh": "显示{0}", "en": "Show {0}" },
  "view_cube": { "zh": "视角方块", "en": "view cube" },
  "one_block_one_cell": {
    "zh": "一个方块 = 一个格",
    "en": "One block = one cell"
  },
  "1_1_1_m_with_a_material_on_each_of_six_faces": {
    "zh": "1 × 1 × 1 米，六个面各带一种材质",
    "en": "1 × 1 × 1 m, with a material on each of six faces"
  },
  "the_same_block_viewed_from_below": {
    "zh": "同一个方块，从下面看",
    "en": "The same block, viewed from below"
  },
  "bottom_face_ceiling": {
    "zh": "底面  →  天花板",
    "en": "Bottom face → ceiling"
  },
  "3_3_floor": {
    "zh": "3 × 3 地面",
    "en": "3 × 3 floor"
  },
  "shared_faces_are_hidden_nine_top_faces_form_one_surface": {
    "zh": "相邻的面不画，九个顶面是一整片",
    "en": "Shared faces are hidden; nine top faces form one surface"
  },
  "half_wall": {
    "zh": "半墙",
    "en": "Half wall"
  },
  "half_a_cell_thick_leaving_room_for_equipment": {
    "zh": "整格高、半格厚，另半格可放设备",
    "en": "Half a cell thick, leaving room for equipment"
  },
  "upper_wedge": {
    "zh": "上三角块",
    "en": "Upper wedge"
  },
  "cut_at_45_with_its_flat_face_on_the_ground": {
    "zh": "45° 斜切，水平面在下",
    "en": "Cut at 45°, with its flat face on the ground"
  },
  "lower_wedge": {
    "zh": "下三角块",
    "en": "Lower wedge"
  },
  "cut_at_45_with_its_flat_face_against_the_ceiling": {
    "zh": "45° 斜切，水平面在上",
    "en": "Cut at 45°, with its flat face against the ceiling"
  },
  "three_materials_together": {
    "zh": "三种材质并存",
    "en": "Three materials together"
  },
  "granite_floor_painted_wall_enamel_wall": {
    "zh": "花岗岩地面 · 涂料墙 · 搪瓷板墙",
    "en": "Granite floor · painted wall · enamel wall"
  },
  "value_value_cells": {
    "zh": "{0} × {1} 格",
    "en": "{0} × {1} cells"
  },
  "up_value_down_value_people_min": {
    "zh": "上 {0} / 下 {1} 人/分",
    "en": "Up {0} / down {1} people/min"
  },
  "value_people_min_in_each_direction": {
    "zh": "进出各 {0} 人/分",
    "en": "{0} people/min in each direction"
  },
  "boundary_only_no_passage": {
    "zh": "仅作边界，不可通行",
    "en": "Boundary only; no passage"
  },
  "value_tickets_min_queue_here": {
    "zh": "{0} 张/分，在此排队",
    "en": "{0} tickets/min; queue here"
  },
  "no_service_attracts_passengers": {
    "zh": "无服务，被动吸引客流",
    "en": "No service; attracts passengers"
  },
  "seating_for_1_person": {
    "zh": "舒适度，可坐 1 人",
    "en": "Seating for 1 person"
  },
  "seating_for_2_people": {
    "zh": "舒适度，可坐 2 人",
    "en": "Seating for 2 people"
  },
  "shop_shelving_attracts_shoppers": {
    "zh": "商铺货架，吸引客流",
    "en": "Shop shelving; attracts shoppers"
  },
  "desk_attracts_staff": {
    "zh": "办公位，吸引职员",
    "en": "Desk; attracts staff"
  },
  "restroom_fixture": {
    "zh": "卫生间设施",
    "en": "Restroom fixture"
  },
  "decoration_no_passage": {
    "zh": "装饰，无通行",
    "en": "Decoration; no passage"
  },
  "station_clock_reference": {
    "zh": "全站时间基准",
    "en": "Station clock reference"
  },
  "camera_no_passage": {
    "zh": "监控，无通行",
    "en": "Camera; no passage"
  },
  "information_screen_no_passage": {
    "zh": "信息屏，无通行",
    "en": "Information screen; no passage"
  },
  "wayfinding_hung_overhead": {
    "zh": "导向，吊挂",
    "en": "Wayfinding, hung overhead"
  },
  "wayfinding_mounted_on_a_wall": {
    "zh": "导向，壁挂",
    "en": "Wayfinding, mounted on a wall"
  },
  "one_way_value_people_min": {
    "zh": "单向，{0} 人/分",
    "en": "One way, {0} people/min"
  },
  "accessible_value_people_trip": {
    "zh": "无障碍，每趟 {0} 人",
    "en": "Accessible, {0} people/trip"
  },
  "tab_adds_2_4_m_of_height": {
    "zh": "Tab 切换，每次加高 2 / 3 / 4 / 5 / 6 m",
    "en": "Tab adds 2 / 3 / 4 / 5 / 6 m of height"
  },
  "thin_canopy_can_be_painted": {
    "zh": "薄顶棚，材质可涂刷",
    "en": "Thin canopy; can be painted"
  },
  "longitudinal_truss_roof_4_8_12_m_can_be_painted": {
    "zh": "纵向桁架顶棚，4 / 8 / 12 m，可涂刷",
    "en": "Longitudinal truss roof, 4/8/12 m; can be painted"
  },
  "gabled_roof_without_trusses_4_8_12_m_can_be_painted": {
    "zh": "无桁架双坡屋顶，4 / 8 / 12 m，可涂刷",
    "en": "Gabled roof without trusses, 4/8/12 m; can be painted"
  },
  "tapered_truss_roof_with_a_single_bottom_beam_can_be_painted": {
    "zh": "收束桁架顶棚，单底梁，可涂刷",
    "en": "Tapered truss roof with a single bottom beam; can be painted"
  },
  "open_railway_bridge_extends_the_line": {
    "zh": "开放轨道桥，延伸线路",
    "en": "Open railway bridge; extends the line"
  },
  "set_demand_for_each_exit": {
    "zh": "每个出入口单独设客流",
    "en": "Set demand for each exit"
  },
  "draw_passengers_toward_shops": {
    "zh": "引导客流前往商铺",
    "en": "Draw passengers toward shops"
  },
  "transparent_partition_blocks_passage": {
    "zh": "透明隔断，可透视不可通行",
    "en": "Transparent partition; blocks passage"
  },
  "1_2_people_second_blocks_passage_when_closed": {
    "zh": "1.2 人/秒，关闭时阻断通行",
    "en": "1.2 people/second; blocks passage when closed"
  },
  "station_name_mounted_on_a_wall": {
    "zh": "站名，挂在墙上",
    "en": "Station name, mounted on a wall"
  },
  "network_map_for_wayfinding": {
    "zh": "线网图，用于导向",
    "en": "Network map for wayfinding"
  },
  "type_value": {
    "zh": "{0} 型",
    "en": "Type {0}"
  },
  "value_m_value_m_value_doors_per_side": {
    "zh": "{0} 米 × {1} 米，每侧 {2} 门",
    "en": "{0} m × {1} m, {2} doors per side"
  },
  "doors_open": {
    "zh": "开着门",
    "en": "Doors open"
  },
  "both_leaves_slide_apart_to_reveal_the_interior": {
    "zh": "两扇门叶滑开，可见车厢内部",
    "en": "Both leaves slide apart to reveal the interior"
  },
  "cab": {
    "zh": "车头",
    "en": "Cab"
  },
  "streamlined_d_cab": {
    "zh": "D 型流线车头",
    "en": "Streamlined D cab"
  },
  "the_cab_is_the_last_2_m_of_the_end_car_with_different_front_and_": {
    "zh": "车头并非单独一节：由末节车厢最后 2 米重新蒙皮而成，仅前后车灯不同",
    "en": "The cab is the last 2 m of the end car, with different front and rear lights"
  },
  "full_train": {
    "zh": "整列车",
    "en": "Full train"
  },
  "example_six_car_type_l_train": {
    "zh": "L 型六节编组示例",
    "en": "Example six-car Type L train"
  },
  "type_value_front": {
    "zh": "{0} 型正视图",
    "en": "Type {0}, front"
  },
  "front_view_width_and_height": {
    "zh": "正视图：宽度与高度",
    "en": "Front view: width and height"
  },
  "type_value_side": {
    "zh": "{0} 型侧视图",
    "en": "Type {0}, side"
  },
  "side_view_length_and_door_spacing": {
    "zh": "侧视图：车长与车门间距",
    "en": "Side view: length and door spacing"
  },
  "type_value_isometric": {
    "zh": "{0} 型轴测图",
    "en": "Type {0}, isometric"
  },
  "isometric_projection_uses_the_scene_s_axes": {
    "zh": "轴测投影，与场景坐标一致",
    "en": "Isometric projection uses the scene's axes"
  },
  "type_b_isometric_one_car": {
    "zh": "B 型轴测图（单节）",
    "en": "Type B, isometric (one car)"
  },
  "single_car_train_for_a_short_platform": {
    "zh": "单节编组，适用于短站台",
    "en": "Single-car train for a short platform"
  },
  "type_b_plan": {
    "zh": "B 型平面图",
    "en": "Type B, plan"
  },
  "top_view_two_cars_joined_by_a_gangway": {
    "zh": "俯视图：两节车厢，中间为贯通道",
    "en": "Top view: two cars joined by a gangway"
  },
  "type_b_track_plan": {
    "zh": "B 型轨道平面图",
    "en": "Type B track, plan"
  },
  "a_line_is_a_train_length_track_with_two_rails_and_sleepers": {
    "zh": "一条线路即一段轨道：长度与列车相同，两根钢轨加枕木",
    "en": "A line is a train-length track with two rails and sleepers"
  },
  "overhead_wire": {
    "zh": "接触网",
    "en": "Overhead wire"
  },
  "catenary_style_value": { "zh": "架线：{0}", "en": "Wire: {0}" },
  "catenary_canopy": { "zh": "顶棚式", "en": "Canopy" },
  "catenary_gantry": { "zh": "门架式", "en": "Gantry" },
  "third_rail": {
    "zh": "第三轨",
    "en": "Third rail"
  },
  "material_lab": {
    "zh": "材质试验台",
    "en": "Material lab"
  },
  "an_8_8_slab_with_a_hole_and_steps_at_the_far_side_try_materials_": {
    "zh": "一块 8×8 的板，中间开洞，远侧设台阶。先在此确认观感，再用于游戏本体。",
    "en": "An 8×8 slab with a hole and steps at the far side. Try materials here before using them in the game."
  },
  "auto_tiling": {
    "zh": "自动铺装",
    "en": "Auto tiling"
  },
  "eight_neighbour_masks_shared_faces_are_hidden_blocks_are_right_a": {
    "zh": "：8 邻域掩码，相邻面不绘制，方块为直角立方体。",
    "en": ": eight-neighbour masks; shared faces are hidden; blocks are right-angled cubes."
  },
  "outlines": {
    "zh": "描边",
    "en": "Outlines"
  },
  "inverted_hull_about_0_05_m_0_8_px_at_design_scale": {
    "zh": "：反向外壳，约 0.05 m（设计尺度约 0.8 px）。",
    "en": ": inverted hull, about 0.05 m (≈ 0.8 px at design scale)."
  },
  "contact_shadows": {
    "zh": "接触阴影",
    "en": "Contact shadows"
  },
  "soft_shadow_beneath_every_piece_and_passenger": {
    "zh": "：每个设备与行人下方一张软阴影贴片。",
    "en": ": soft shadow beneath every piece and passenger."
  },
  "ambient_occlusion_lighting": {
    "zh": "环境光遮蔽 + 布光",
    "en": "Ambient occlusion + lighting"
  },
  "baked_vertex_ao_key_sky_fill_lights": {
    "zh": "：顶点 AO 烘焙 + 主光 / 天光 / 补光。",
    "en": ": baked vertex AO + key / sky / fill lights."
  },
  "procedural_materials": {
    "zh": "程序化材质",
    "en": "Procedural materials"
  },
  "granite_speckles_enamel_seams_white_ceiling_grilles_brushed_stee": {
    "zh": "：花岗岩斑点、搪瓷板缝、白色格栅天花、拉丝不锈钢。",
    "en": ": granite speckles, enamel seams, white ceiling grilles, brushed steel."
  },
  "chunk_meshing": {
    "zh": "区块网格构建",
    "en": "Chunk meshing"
  },
  "budget": {
    "zh": "预算",
    "en": "Budget"
  },
  "lt_4_ms_chunk": {
    "zh": "&lt; 4 ms / 区块",
    "en": "&lt; 4 ms / chunk"
  },
  "back_to_game": {
    "zh": "← 回到游戏",
    "en": "← Back to game"
  },
  "metro_station_designer": {
    "zh": "车站设计师",
    "en": "Station Designer"
  },
  "please_open_on_a_computer": {
    "zh": "请在电脑端打开",
    "en": "Please open on a computer"
  },
  "this_game_needs_a_mouse_and_keyboard_phones_and_tablets_are_not_": {
    "zh": "本游戏需要鼠标和键盘，手机和平板暂时无法游玩。",
    "en": "This game needs a mouse and keyboard. Phones and tablets are not supported yet."
  },
  "open_this_url_in_a_desktop_browser_to_start_designing_your_stati": {
    "zh": "请用电脑浏览器打开同一网址，即可开始设计车站。",
    "en": "Open this URL in a desktop browser to start designing your station."
  },
  "use_the_mouse_to_rotate_the_view_build_and_remove_equipment": {
    "zh": "用鼠标旋转视角，建造和拆除设备",
    "en": "Use the mouse to rotate the view, build and remove equipment"
  },
  "use_the_keyboard_to_change_floors_undo_and_redo": {
    "zh": "用键盘切换楼层、撤销和重做",
    "en": "Use the keyboard to change floors, undo and redo"
  },
  "a_wider_screen_lets_you_see_the_whole_station": {
    "zh": "屏幕更宽，才能看清整座车站",
    "en": "A wider screen lets you see the whole station"
  },
  "copied_paste_into_a_desktop_browser": {
    "zh": "已复制，请粘贴到电脑浏览器",
    "en": "Copied; paste into a desktop browser"
  },
  "copy_this_page_s_url": {
    "zh": "复制本页网址",
    "en": "Copy this page's URL"
  },
  "continue_anyway": {
    "zh": "仍要继续",
    "en": "Continue anyway"
  },
  "metro_station": {
    "zh": "地铁站",
    "en": "Metro station"
  },
  "line_2": {
    "zh": "2号线",
    "en": "Line 2"
  },
  "exit_c": {
    "zh": "C口",
    "en": "Exit C"
  },
  "lift_cabin": {
    "zh": "电梯轿厢",
    "en": "Lift cabin"
  },
  "lift_shaft": {
    "zh": "电梯井",
    "en": "Lift shaft"
  },
  "screen_doors": {
    "zh": "屏蔽门",
    "en": "Screen doors"
  },
  "doors": {
    "zh": "有门",
    "en": "Doors"
  },
  "fence": {
    "zh": "围栏",
    "en": "Fence"
  },
  "rotate": {
    "zh": "旋转",
    "en": "Rotate"
  },
  "rotate_value": {
    "zh": "旋转 {0}°",
    "en": "Rotate {0}°"
  },
  "screen_doors_none": { "zh": "无", "en": "None" },
  "half_height": {
    "zh": "半高",
    "en": "Half height"
  },
  "full_height": {
    "zh": "全高",
    "en": "Full height"
  },
  "choose_floor_guide_line": {
    "zh": "选择地面指引线路",
    "en": "Choose floor guide line"
  },
  "no_lines_yet": {
    "zh": "暂无线路",
    "en": "No lines yet"
  },
  "ultra_short": {
    "zh": "超短",
    "en": "Extra short"
  },
  "short": {
    "zh": "短",
    "en": "Short"
  },
  "medium": {
    "zh": "中",
    "en": "Medium"
  },
  "long": {
    "zh": "长",
    "en": "Long"
  },
  "ultra_long": {
    "zh": "超长",
    "en": "Extra long"
  },
  "single_storey": {
    "zh": "单层",
    "en": "Single storey"
  },
  "triple_storey": { "zh": "三层", "en": "Triple storey" },
  "double_storey": {
    "zh": "双层",
    "en": "Double storey"
  },
  "extra_narrow": {
    "zh": "超窄",
    "en": "Extra narrow"
  },
  "narrow": {
    "zh": "窄",
    "en": "Narrow"
  },
  "wide": {
    "zh": "宽",
    "en": "Wide"
  },
  "small": {
    "zh": "小",
    "en": "Small"
  },
  "large": {
    "zh": "大",
    "en": "Large"
  },
  "glass": {
    "zh": "玻璃",
    "en": "Glass"
  },
  "steel": {
    "zh": "钢板",
    "en": "Steel"
  },
  "choose_exit": {
    "zh": "选择出入口",
    "en": "Choose exit"
  },
  "no_exits_yet": {
    "zh": "暂无出入口",
    "en": "No exits yet"
  },
  "exit": {
    "zh": "口",
    "en": "Exit"
  },
  "customise": {
    "zh": "自定义",
    "en": "Customise"
  },
  "tall": {
    "zh": "高",
    "en": "Tall"
  },
  "low": {
    "zh": "矮",
    "en": "Low"
  },
  "up": {
    "zh": "上行",
    "en": "Up"
  },
  "down": {
    "zh": "下行",
    "en": "Down"
  },
  "roof_snap_lower": {
    "zh": "下",
    "en": "Lower"
  },
  "roof_snap_upper": {
    "zh": "上",
    "en": "Upper"
  },
  "floor_track": {
    "zh": "地面 · 轨道",
    "en": "Floor · track"
  },
  "ceiling": {
    "zh": "天花板",
    "en": "Ceiling"
  },
  "wall_surface": {
    "zh": "墙面",
    "en": "Wall surface"
  },
  "single_block": {
    "zh": "单块",
    "en": "Single block"
  },
  "whole_face": {
    "zh": "整面",
    "en": "Whole face"
  },
  "block": {
    "zh": "方块",
    "en": "Block"
  },
  "platform": {
    "zh": "站台",
    "en": "Platform"
  },
  "wall": {
    "zh": "墙",
    "en": "Wall"
  },
  "generate_walls": {
    "zh": "生成墙壁",
    "en": "Generate walls"
  },
  "direction": {
    "zh": "方向",
    "en": "Direction"
  },
  "line": {
    "zh": "线路",
    "en": "Line"
  },
  "tunnel": {
    "zh": "隧道",
    "en": "Tunnel"
  },
  "railway_bridge": {
    "zh": "轨道桥",
    "en": "Railway bridge"
  },
  "selected_value_value_m_value_mvalue": {
    "zh": "已选{0} · {1} m × {2} m{3}",
    "en": "Selected {0} · {1} m × {2} m{3}"
  },
  "track": {
    "zh": "轨道",
    "en": "Track"
  },
  "value_cars_value_m_value_doors": {
    "zh": " · {0} 节 {1} m · {2} 门",
    "en": " · {0} cars, {1} m · {2} doors"
  },
  "select": {
    "zh": "选择",
    "en": "Select"
  },
  "pick": {
    "zh": "吸取",
    "en": "Pick"
  },
  "move": {
    "zh": "移动",
    "en": "Move"
  },
  "delete": {
    "zh": "删除",
    "en": "Delete"
  },
  "show_other_floors": {
    "zh": "显示其他层",
    "en": "Show other floors"
  },
  "section": {
    "zh": "剖切",
    "en": "Section View"
  },
  "hide_ui": {
    "zh": "隐藏UI",
    "en": "Hide UI"
  },
  "hide_ceilings": {
    "zh": "隐藏天花板",
    "en": "Hide ceilings"
  },
  "hide_walls": {
    "zh": "隐藏墙壁",
    "en": "Hide walls"
  },
  "hide_floors": {
    "zh": "隐藏地面",
    "en": "Hide ground plane"
  },
  "hide_roofs": {
    "zh": "隐藏屋顶",
    "en": "Hide roofs"
  },
  "exploded_view": { "zh": "爆炸视图", "en": "Exploded view" },
  "statistics_charts": { "zh": "统计图", "en": "Statistics charts" },
  "exploded_hint": { "zh": "拖动旋转 · 滚轮缩放 · 右键拖动平移 · Esc 返回", "en": "Drag to orbit · Scroll to zoom · Right-drag to pan · Esc to return" },
  "exploded_empty": { "zh": "建造车站后即可查看楼层爆炸图", "en": "Build a station to see its exploded view" },
  "exploded_loading": { "zh": "正在准备楼层爆炸图…", "en": "Preparing exploded view…" },
  "zoom_in": { "zh": "放大", "en": "Zoom in" },
  "zoom_out": { "zh": "缩小", "en": "Zoom out" },
  "zone_map": {
    "zh": "分区图",
    "en": "Zone map"
  },
  "heatmap": {
    "zh": "热力图",
    "en": "Heatmap"
  },
  "hide_section_plane": {
    "zh": "隐藏剖切面",
    "en": "Hide section plane"
  },
  "tools": {
    "zh": "工具",
    "en": "Tools"
  },
  "structure": {
    "zh": "结构",
    "en": "Structure"
  },
  "equipment": {
    "zh": "设备",
    "en": "Equipment"
  },
  "decor": {
    "zh": "装饰",
    "en": "Decor"
  },
  "ceiling_decor": {
    "zh": "天花板装饰",
    "en": "Ceiling decor"
  },
  "wall_decor": {
    "zh": "墙面装饰",
    "en": "Wall decor"
  },
  "ground_decor": {
    "zh": "地面装饰",
    "en": "Ground decor"
  },
  "outside_decor": {
    "zh": "站外装饰",
    "en": "Outside decor"
  },
  "materials": {
    "zh": "材质",
    "en": "Surface"
  },
  "rooms": {
    "zh": "房间",
    "en": "Rooms"
  },
  "zones": {
    "zh": "分区",
    "en": "Zones"
  },
  "info": {
    "zh": "信息",
    "en": "Info"
  },
  "view": {
    "zh": "视图",
    "en": "View"
  },
  "entrances": {
    "zh": "出入口",
    "en": "Entrances"
  },
  "build_palette": {
    "zh": "建造栏",
    "en": "Build palette"
  },
  "position_value_9": {
    "zh": "位置 {0}/9",
    "en": "Position {0}/9"
  },
  "roof_hanger": {
    "zh": "吊装",
    "en": "Roof hanger"
  },
  "post_hanger": {
    "zh": "立柱",
    "en": "Post hanger"
  },
  "air_conditioner": {
    "zh": "空调风机",
    "en": "Air conditioner"
  },
  "equipment_cabinet": {
    "zh": "设备柜",
    "en": "Equipment cabinet"
  },
  "tactile_guide": {
    "zh": "条形导向",
    "en": "Tactile guide"
  },
  "tactile_warning": {
    "zh": "圆点提示",
    "en": "Tactile warning"
  },
  "door_arrows": {
    "zh": "屏蔽门箭头",
    "en": "Door arrows"
  },
  "queue_lines": {
    "zh": "排队等候线",
    "en": "Queue lines"
  },
  "direction_guide": {
    "zh": "方向指引",
    "en": "Direction guide"
  },
  "slim_pillar": {
    "zh": "细支柱",
    "en": "Slim pillar"
  },
  "thick_pillar": {
    "zh": "粗支柱",
    "en": "Thick pillar"
  },
  "slab": {
    "zh": "薄板",
    "en": "Slab"
  },
  "no_truss": {
    "zh": "无桁架",
    "en": "No truss"
  },
  "truss": {
    "zh": "桁架",
    "en": "Truss"
  },
  "column_canopy": {
    "zh": "有柱雨棚",
    "en": "Column canopy"
  },
  "tapered_truss": {
    "zh": "收束桁架",
    "en": "Tapered truss"
  },
  "old": {
    "zh": "旧",
    "en": "Old"
  },
  "new": {
    "zh": "新",
    "en": "New"
  },
  "screen_end_door": {
    "zh": "屏蔽端门",
    "en": "Screen end door"
  },
  "screen_door_cover": {
    "zh": "屏蔽门盖板",
    "en": "Screen door cover"
  },
  "glass_fence": {
    "zh": "玻璃围栏",
    "en": "Glass fence"
  },
  "door": {
    "zh": "门",
    "en": "Door"
  },
  "iron_fence": {
    "zh": "铁围栏",
    "en": "Iron fence"
  },
  "ticket_machine": {
    "zh": "售票机",
    "en": "Ticket machine"
  },
  "vending_machine": {
    "zh": "自动售货机",
    "en": "Vending machine"
  },
  "stainless_steel": {
    "zh": "不锈钢",
    "en": "Stainless steel"
  },
  "backed_seats": {
    "zh": "靠背座椅",
    "en": "Backed seats"
  },
  "desk": {
    "zh": "办公桌",
    "en": "Desk"
  },
  "checkout": {
    "zh": "收银台",
    "en": "Checkout"
  },
  "toilet_cubicle": {
    "zh": "厕所隔间",
    "en": "Toilet cubicle"
  },
  "sink": {
    "zh": "洗手池",
    "en": "Sink"
  },
  "wayfinding_post": {
    "zh": "导向柱",
    "en": "Wayfinding post"
  },
  "bin": {
    "zh": "垃圾桶",
    "en": "Bin"
  },
  "extinguisher": {
    "zh": "灭火器",
    "en": "Extinguisher"
  },
  "vent": {
    "zh": "通风口",
    "en": "Vent"
  },
  "round": {
    "zh": "圆形",
    "en": "Round"
  },
  "strip": {
    "zh": "直条",
    "en": "Strip"
  },
  "clock": {
    "zh": "时钟",
    "en": "Clock"
  },
  "bullet_camera": {
    "zh": "枪机",
    "en": "Bullet camera"
  },
  "post_camera": {
    "zh": "立柱球机",
    "en": "Pole-mounted PTZ"
  },
  "ptz_camera": {
    "zh": "球机",
    "en": "PTZ camera"
  },
  "dome_camera": {
    "zh": "半球机",
    "en": "Dome camera"
  },
  "landscape_16_9": {
    "zh": "横版 16:9",
    "en": "Landscape 16:9"
  },
  "standard_2_25_1": {
    "zh": "标准 2.25:1",
    "en": "Standard 2.25:1"
  },
  "large_landscape_16_9": {
    "zh": "大横版 16:9",
    "en": "Large landscape 16:9"
  },
  "wide_3_75_1": {
    "zh": "长幅 3.75:1",
    "en": "Wide 3.75:1"
  },
  "portrait_0_7_1": {
    "zh": "竖版 0.7:1",
    "en": "Portrait 0.7:1"
  },
  "square_1_1": {
    "zh": "方形 1:1",
    "en": "Square 1:1"
  },
  "tv": {
    "zh": "电视",
    "en": "TV"
  },
  "single_sided": {
    "zh": "单面",
    "en": "Single-sided"
  },
  "double_sided": {
    "zh": "双面",
    "en": "Double-sided"
  },
  "curtain_wall": {
    "zh": "玻璃幕墙",
    "en": "Curtain wall"
  },
  "glass_panel_1_1": {
    "zh": "玻璃板 1×1",
    "en": "Glass panel 1×1"
  },
  "glass_panel_2_1": {
    "zh": "玻璃板 2×1",
    "en": "Glass panel 2×1"
  },
  "glass_panel_3_1": {
    "zh": "玻璃板 3×1",
    "en": "Glass panel 3×1"
  },
  "glass_panel_1_2": {
    "zh": "玻璃板 1×2",
    "en": "Glass panel 1×2"
  },
  "glass_panel_2_2": {
    "zh": "玻璃板 2×2",
    "en": "Glass panel 2×2"
  },
  "glass_panel_3_2": {
    "zh": "玻璃板 3×2",
    "en": "Glass panel 3×2"
  },
  "wood": {
    "zh": "木",
    "en": "Wood"
  },
  "regular_script_horizontal": {
    "zh": "楷书 横排",
    "en": "Regular script, horizontal"
  },
  "regular_script_vertical": {
    "zh": "楷书 竖排",
    "en": "Regular script, vertical"
  },
  "running_script_horizontal": {
    "zh": "行书 横排",
    "en": "Running script, horizontal"
  },
  "running_script_vertical": {
    "zh": "行书 竖排",
    "en": "Running script, vertical"
  },
  "clerical_script_horizontal": {
    "zh": "隶书 横排",
    "en": "Clerical script, horizontal"
  },
  "clerical_script_vertical": {
    "zh": "隶书 竖排",
    "en": "Clerical script, vertical"
  },
  "wei_stele_horizontal": {
    "zh": "魏碑 横排",
    "en": "Wei stele, horizontal"
  },
  "wei_stele_vertical": {
    "zh": "魏碑 竖排",
    "en": "Wei stele, vertical"
  },
  "sans_serif_horizontal": {
    "zh": "黑体 横排",
    "en": "Sans serif, horizontal"
  },
  "sans_serif_vertical": {
    "zh": "黑体 竖排",
    "en": "Sans serif, vertical"
  },
  "song_serif_horizontal": {
    "zh": "宋体 横排",
    "en": "Song serif, horizontal"
  },
  "song_serif_vertical": {
    "zh": "宋体 竖排",
    "en": "Song serif, vertical"
  },
  "wall_network_map": {
    "zh": "墙面线网图",
    "en": "Wall network map"
  },
  "standing_network_map": {
    "zh": "立式线网图",
    "en": "Standing network map"
  },
  "covered_one_way": {
    "zh": "有盖 单向",
    "en": "Covered, one way"
  },
  "covered_two_ways": {
    "zh": "有盖 双向",
    "en": "Covered, two ways"
  },
  "covered_three_ways": {
    "zh": "有盖 三向",
    "en": "Covered, three ways"
  },
  "uncovered_one_way": {
    "zh": "无盖 单向",
    "en": "Uncovered, one way"
  },
  "uncovered_two_ways": {
    "zh": "无盖 双向",
    "en": "Uncovered, two ways"
  },
  "uncovered_three_ways": {
    "zh": "无盖 三向",
    "en": "Uncovered, three ways"
  },
  "ground_one_way": {
    "zh": "地面 单向",
    "en": "Ground, one way"
  },
  "ground_two_ways": {
    "zh": "地面 双向",
    "en": "Ground, two ways"
  },
  "ground_three_ways": {
    "zh": "地面 三向",
    "en": "Ground, three ways"
  },
  "ground_four_ways": {
    "zh": "地面 四向",
    "en": "Ground, four ways"
  },
  "virtual_exit": {
    "zh": "虚拟",
    "en": "Virtual"
  },
  "escalator": {
    "zh": "扶梯",
    "en": "Escalator"
  },
  "walkway": {
    "zh": "自动步道",
    "en": "Moving walkway"
  },
  "lift": {
    "zh": "电梯",
    "en": "Lift"
  },
  "straight_stairs": {
    "zh": "单跑楼梯",
    "en": "Straight stairs"
  },
  "stair_block": {
    "zh": "楼梯块",
    "en": "Stair block"
  },
  "left_quarter_turn_stairs": {
    "zh": "左转角楼梯",
    "en": "Left quarter-turn stairs"
  },
  "right_quarter_turn_stairs": {
    "zh": "右转角楼梯",
    "en": "Right quarter-turn stairs"
  },
  "left_forward_stairs": { "zh": "左直跑楼梯", "en": "Left offset straight stairs" },
  "center_forward_stairs": { "zh": "中直跑楼梯", "en": "Aligned straight stairs" },
  "right_forward_stairs": { "zh": "右直跑楼梯", "en": "Right offset straight stairs" },
  "left_switchback_stairs": {
    "zh": "左双跑楼梯",
    "en": "Left switchback stairs"
  },
  "right_switchback_stairs": {
    "zh": "右双跑楼梯",
    "en": "Right switchback stairs"
  },
  "fare_gate": {
    "zh": "闸机",
    "en": "Fare gate"
  },
  "hanger": {
    "zh": "挂架",
    "en": "Hanger"
  },
  "cctv": {
    "zh": "监控",
    "en": "CCTV"
  },
  "tactile_paving": {
    "zh": "盲道",
    "en": "Tactile paving"
  },
  "floor_markings": {
    "zh": "地面指示",
    "en": "Floor markings"
  },
  "roof": {
    "zh": "屋顶",
    "en": "Roof"
  },
  "pillar": {
    "zh": "柱",
    "en": "Pillar"
  },
  "stairs": {
    "zh": "楼梯",
    "en": "Stairs"
  },
  "bus_stop": {
    "zh": "公交站",
    "en": "Bus stop"
  },
  "light": {
    "zh": "灯具",
    "en": "Light"
  },
  "bench": {
    "zh": "座椅",
    "en": "Bench"
  },
  "shelf": {
    "zh": "货架",
    "en": "Shelf"
  },
  "billboard": {
    "zh": "广告牌",
    "en": "Billboard"
  },
  "glass_panel": {
    "zh": "玻璃板",
    "en": "Glass panel"
  },
  "glass_panel_265": {
    "zh": "玻璃板 ",
    "en": "Glass panel "
  },
  "station_name": {
    "zh": "站名",
    "en": "Station name"
  },
  "network_map": {
    "zh": "线网图",
    "en": "Network map"
  },
  "sign": {
    "zh": "指示牌",
    "en": "Sign"
  },
  "store": {
    "zh": "商店",
    "en": "Store"
  },
  "restroom": {
    "zh": "厕所",
    "en": "Restroom"
  },
  "office": {
    "zh": "办公室",
    "en": "Office"
  },
  "ticket_booth": {
    "zh": "售票亭",
    "en": "Ticket booth"
  },
  "information_desk": {
    "zh": "问讯处",
    "en": "Information desk"
  },
  "support_pillar": {
    "zh": "支柱",
    "en": "Support pillar"
  },
  "station_roof": {
    "zh": "车站屋顶",
    "en": "Station roof"
  },
  "shop": {
    "zh": "商铺",
    "en": "Shop"
  },
  "platform_doors": {
    "zh": "站台门",
    "en": "Platform doors"
  },
  "created_value_new_track_will_bind_automatically": {
    "zh": "已新建 {0}，铺轨时自动绑定",
    "en": "Created {0}; new track will bind automatically"
  },
  "deleted_line_valuevalue": {
    "zh": "已删除线路 {0}{1}",
    "en": "Deleted line {0}{1}"
  },
  "including_value_track_sections": {
    "zh": "，连同 {0} 段轨道",
    "en": ", including {0} track sections"
  },
  "cannot_move_value_remove_it_with_delete_b_then_place_it_again": {
    "zh": "{0}不能移动：用删除 (B) 拆除后重新放置",
    "en": "Cannot move {0}: remove it with Delete (B), then place it again"
  },
  "picked_up_value_click_its_new_location_or_confirm_in_info_cancel": {
    "zh": "已拿起{0}：在目标位置点击，或在信息栏点「确认」；点「取消」放回原位",
    "en": "Picked up {0}: click its new location or Confirm in Info; Cancel returns it"
  },
  "returned_to_the_original_position": {
    "zh": "已放回原位",
    "en": "Returned to the original position"
  },
  "move_the_pointer_to_the_new_location_before_confirming": {
    "zh": "先把指针移到要放的位置，再点「确认」",
    "en": "Move the pointer to the new location before confirming"
  },
  "the_picked_up_item_no_longer_exists": {
    "zh": "拿起的物品已不存在",
    "en": "The picked-up item no longer exists"
  },
  "position_unchanged": {
    "zh": "位置没变",
    "en": "Position unchanged"
  },
  "moved_value_to_value_value_value": {
    "zh": "{0}已移到 ({1}, {2}, {3})",
    "en": "Moved {0} to ({1}, {2}, {3})"
  },
  "pick_cancelled": {
    "zh": "已取消吸取",
    "en": "Pick cancelled"
  },
  "there_is_already_track_here": {
    "zh": "此处已有轨道",
    "en": "There is already track here"
  },
  "track_laid_value_m_generated_value_platform_door_sections": {
    "zh": "轨道已铺设（{0} m），自动生成 {1} 段站台门",
    "en": "Track laid ({0} m); generated {1} platform door sections"
  },
  "track_laid_value_m_no_adjacent_platform_so_no_platform_doors_yet": {
    "zh": "轨道已铺设（{0} m）；旁边没有站台，站台门暂未生成",
    "en": "Track laid ({0} m); no adjacent platform, so no platform doors yet"
  },
  "cannot_connect_tunnel_blocked_by_value": {
    "zh": "隧道无法接通：被{0}阻挡",
    "en": "Cannot connect tunnel: blocked by {0}"
  },
  "cannot_connect_tunnel_equipment_rooms_platforms_or_other_tracks_": {
    "zh": "隧道无法接通：此处被设备、房间、站台或其他轨道阻挡",
    "en": "Cannot connect tunnel: equipment, rooms, platforms or other tracks are in the way"
  },
  "tunnel_connected_value_m": {
    "zh": "隧道已接通（{0} m）",
    "en": "Tunnel connected ({0} m)"
  },
  "platform_doors_regenerated_for_the_current_platform": {
    "zh": "站台门已按当前站台重新生成",
    "en": "Platform doors regenerated for the current platform"
  },
  "track_removed": {
    "zh": "轨道已拆除",
    "en": "Track removed"
  },
  "all_passengers_cleared": {
    "zh": "已清空所有行人",
    "en": "All passengers cleared"
  },
  "saved": {
    "zh": "已保存",
    "en": "Saved"
  },
  "opened_save_vvalue_repair_removed_value_blocks_outside_the_grid": {
    "zh": "已打开（存档 v{0}）：修复时移除 {1} 个网格外方块",
    "en": "Opened save v{0}; repair removed {1} blocks outside the grid"
  },
  "opened_save_vvalue": {
    "zh": "已打开（存档 v{0}）",
    "en": "Opened save v{0}"
  },
  "unnamed_station": {
    "zh": "未命名车站",
    "en": "Unnamed station"
  },
  "example_station_repair_removed_value_blocks_outside_the_grid": {
    "zh": "示例车站修复时移除 {0} 个网格外方块",
    "en": "Example station repair removed {0} blocks outside the grid"
  },
  "length_1_m_width_1_m": {
    "zh": "长 1 m × 宽 1 m",
    "en": "Length 1 m × width 1 m"
  },
  "length_value_m_width_value_m": {
    "zh": "长 {0} m × 宽 {1} m",
    "en": "Length {0} m × width {1} m"
  },
  "drag_area_too_large": {
    "zh": "面积过大：单次拖动最多 {0} 格",
    "en": "The area is too large: a drag covers at most {0} cells"
  },
  "cannot_place_value_here_a_block_already_exists": {
    "zh": "此处无法放置{0}：已有方块",
    "en": "Cannot place {0} here: a block already exists"
  },
  "wedge": {
    "zh": "三角块",
    "en": "Wedge"
  },
  "cannot_place_a_block_here_a_block_already_exists": {
    "zh": "此处无法放置方块：已有方块",
    "en": "Cannot place a block here: a block already exists"
  },
  "cannot_delete_more_keep_at_least_4_blocks_in_the_station": {
    "zh": "无法继续删除：车站至少保留 4 格方块",
    "en": "Cannot delete more: keep at least 4 blocks in the station"
  },
  "no_block_to_delete_here": {
    "zh": "此处没有可删除的方块",
    "en": "No block to delete here"
  },
  "nothing_to_remove_here": {
    "zh": "此处没有可拆除的物品",
    "en": "Nothing to remove here"
  },
  "removed_value_value": {
    "zh": "已拆除 {0} 件{1}",
    "en": "Removed {0} × {1}"
  },
  "removed_value_fence_sections": {
    "zh": "已拆除 {0} 段围栏",
    "en": "Removed {0} fence sections"
  },
  "no_fence_to_remove_here": {
    "zh": "此处没有可拆除的围栏",
    "en": "No fence to remove here"
  },
  "no_floor_marking_to_erase_here": {
    "zh": "此处没有可擦除的地面指示",
    "en": "No floor marking to erase here"
  },
  "select_existing_track_first_the_bridge_connects_to_its_end": {
    "zh": "先点一段现有轨道，轨道桥从端部接出",
    "en": "Select existing track first; the bridge connects to its end"
  },
  "cannot_place_bridge_blocked_by_value": {
    "zh": "轨道桥无法放置：被{0}阻挡",
    "en": "Cannot place bridge: blocked by {0}"
  },
  "cannot_place_bridge_check_its_height_and_obstacles_along_the_rou": {
    "zh": "轨道桥无法放置：检查高度与沿线障碍",
    "en": "Cannot place bridge: check its height and obstacles along the route"
  },
  "remove_shelves_one_at_a_time_point_at_a_shelf_and_right_click": {
    "zh": "货架需逐个拆除：指向货架后右键",
    "en": "Remove shelves one at a time: point at a shelf and right-click"
  },
  "no_decoration_to_remove_here": {
    "zh": "此处没有可拆除的装饰",
    "en": "No decoration to remove here"
  },
  "placed_value_fence_sections_value_cells_blockedvalue": {
    "zh": "围栏已放置 {0} 段，{1} 格被阻挡{2}",
    "en": "Placed {0} fence sections; {1} cells blocked{2}"
  },
  "cannot_place_a_fence_here_value": {
    "zh": "此处无法放置围栏：{0}",
    "en": "Cannot place a fence here: {0}"
  },
  "choose_another_location": {
    "zh": "请另选位置",
    "en": "Choose another location"
  },
  "unnamed_exit": {
    "zh": "未命名口",
    "en": "Unnamed exit"
  },
  "ground_exits_need_a_solid_block_behind_their_wall_facing_side": {
    "zh": "地面出入口须贴实心方块侧面：背后需有实心方块",
    "en": "Ground exits need a solid block behind their wall-facing side"
  },
  "cannot_place_equipment_here_choose_another_location": {
    "zh": "此处无法放置设备：请另选位置",
    "en": "Cannot place equipment here: choose another location"
  },
  "cannot_extend_the_lift_through_this_floor_blocked_by_value": {
    "zh": "该层有设备阻挡，电梯无法延伸：被{0}阻挡",
    "en": "Cannot extend the lift through this floor: blocked by {0}"
  },
  "lift_extended_up_one_floor": {
    "zh": "电梯已向上延伸 {0} m",
    "en": "Lift extended up {0} m"
  },
  "lift_extended_down_one_floor": {
    "zh": "电梯已向下延伸 {0} m",
    "en": "Lift extended down {0} m"
  },
  "picked_value": {
    "zh": "已吸取{0}",
    "en": "Picked {0}"
  },
  "no_track_to_remove_here": {
    "zh": "此处没有可拆除的轨道",
    "en": "No track to remove here"
  },
  "platform_track_needs_a_solid_floor_at_least_three_cells_wide": {
    "zh": "站台轨道需铺在完整地面上（至少三格宽）",
    "en": "Platform track needs a solid floor at least three cells wide"
  },
  "passenger_value": {
    "zh": "行人 #{0}",
    "en": "Passenger #{0}"
  },
  "no_tactile_paving_to_remove_here": {
    "zh": "此处没有可拆除的盲道",
    "en": "No tactile paving to remove here"
  },
  "cannot_place_tactile_paving_here_choose_another_location": {
    "zh": "此处无法放置盲道：请另选位置",
    "en": "Cannot place tactile paving here: choose another location"
  },
  "no_roof_to_remove_here": {
    "zh": "此处没有可拆除的屋顶",
    "en": "No roof to remove here"
  },
  "cannot_place_a_roof_here_choose_another_location": {
    "zh": "此处无法放置屋顶：请另选位置",
    "en": "Cannot place a roof here: choose another location"
  },
  "removed_value": {
    "zh": "已拆除{0}",
    "en": "Removed {0}"
  },
  "select_existing_track_first_the_tunnel_connects_to_its_end": {
    "zh": "先点一段现有轨道，隧道从端部接出",
    "en": "Select existing track first; the tunnel connects to its end"
  },
  "cannot_place_a_wall_here_a_wall_already_exists": {
    "zh": "此处无法放置墙：已有墙",
    "en": "Cannot place a wall here: a wall already exists"
  },
  "no_blocks_to_remove_here": {
    "zh": "此处没有可拆除的方块",
    "en": "No blocks to remove here"
  },
  "no_wall_to_remove_here": {
    "zh": "此处没有可拆除的墙",
    "en": "No wall to remove here"
  },
  "zones_can_only_be_erased_on_floors": {
    "zh": "分区只能在地板上擦除",
    "en": "Zones can only be erased on floors"
  },
  "zones_can_only_be_painted_on_floors": {
    "zh": "分区只能画在地板上",
    "en": "Zones can only be painted on floors"
  },
  "these_cells_have_no_zone": {
    "zh": "这些格子没有分区",
    "en": "These cells have no zone"
  },
  "different_room_types_cannot_overlap": {
    "zh": "不同类型的房间不能重叠",
    "en": "Different room types cannot overlap"
  },
  "room_minimum_is_value_value_current_size_is_value_value_draw_a_l": {
    "zh": "房间最小 {0}×{1}，当前 {2}×{3}，请画大一些",
    "en": "Room minimum is {0}×{1}; current size is {2}×{3}. Draw a larger room"
  },
  "cannot_build_rooms_on_track": {
    "zh": "轨道上不能建房间",
    "en": "Cannot build rooms on track"
  },
  "lay_a_complete_floor_before_drawing_a_room_here": {
    "zh": "此处无法绘制房间：需先铺好完整地面",
    "en": "Lay a complete floor before drawing a room here"
  },
  "room_expanded_to_the_new_bounds": {
    "zh": "房间已扩展至新范围",
    "en": "Room expanded to the new bounds"
  },
  "built_value_with_counters_around_it_serving_from_outside": {
    "zh": "{0}已建成，四周为柜台，从外侧服务",
    "en": "Built {0} with counters around it, serving from outside"
  },
  "top": {
    "zh": "顶",
    "en": "Top"
  },
  "bottom": {
    "zh": "底",
    "en": "Bottom"
  },
  "compass_east": {
    "zh": "东",
    "en": "E"
  },
  "compass_west": {
    "zh": "西",
    "en": "W"
  },
  "compass_north": {
    "zh": "北",
    "en": "N"
  },
  "compass_south": {
    "zh": "南",
    "en": "S"
  },
  "east": {
    "zh": "东",
    "en": "East"
  },
  "west": {
    "zh": "西",
    "en": "West"
  },
  "north": {
    "zh": "北",
    "en": "North"
  },
  "south": {
    "zh": "南",
    "en": "South"
  },
  "reset_view": {
    "zh": "回到默认视角",
    "en": "Reset view"
  },
  "raise_view": {
    "zh": "视角升高",
    "en": "Raise view"
  },
  "lower_view": {
    "zh": "视角降低",
    "en": "Lower view"
  },
  "field_of_view": {
    "zh": "视场角",
    "en": "Field of view"
  },
  "height": {
    "zh": "高度",
    "en": "Height"
  },
  "height_origin": {
    "zh": "高度基准",
    "en": "Height origin"
  },
  "origin": {
    "zh": "基准",
    "en": "Origin"
  },
  "simulation_time_value_open_time_and_passenger_settings": {
    "zh": "模拟时间 {0}，开站时刻与客流设置",
    "en": "Simulation time {0}; open time and passenger settings"
  },
  "open_time_and_passenger_settings": {
    "zh": "开站时刻与客流设置",
    "en": "Open time and passenger settings"
  },
  "paused": {
    "zh": "已暂停",
    "en": "Paused"
  },
  "time": {
    "zh": "时刻 ›",
    "en": "Time ›"
  },
  "open_for_service": {
    "zh": "营业中",
    "en": "Open for service"
  },
  "closed_for_service": {
    "zh": "已闭站",
    "en": "Closed for service"
  },
  "day": {
    "zh": "第",
    "en": "Day"
  },
  "days": {
    "zh": "天",
    "en": " days"
  },
  "name": {
    "zh": "名称",
    "en": "Name"
  },
  "exit_name": {
    "zh": "出入口名",
    "en": "Exit name"
  },
  "exit_name_377": {
    "zh": "出入口名称",
    "en": "Exit name"
  },
  "entering": {
    "zh": "进站",
    "en": "Entering"
  },
  "people_h": {
    "zh": "人/时",
    "en": "people/h"
  },
  "open": {
    "zh": "开放",
    "en": "Open"
  },
  "closed": {
    "zh": "已关闭",
    "en": "Closed"
  },
  "position": {
    "zh": "位置",
    "en": "Position"
  },
  "move_to_the_new_location": {
    "zh": "移到要放的位置",
    "en": "Move to the new location"
  },
  "confirm_move": {
    "zh": "确认移动",
    "en": "Confirm move"
  },
  "cancel_move": {
    "zh": "取消移动",
    "en": "Cancel move"
  },
  "selected": {
    "zh": "已选",
    "en": "Selected"
  },
  "type": {
    "zh": "类型",
    "en": "Type"
  },
  "passenger": {
    "zh": "行人",
    "en": "Passenger"
  },
  "passenger_eye_view": {
    "zh": "乘客视角（Esc 返回）",
    "en": "Passenger eye view (Esc to return)"
  },
  "move_value": {
    "zh": "移动{0}",
    "en": "Move {0}"
  },
  "reverse_escalator": {
    "zh": "切换扶梯方向",
    "en": "Reverse escalator"
  },
  "reverse_walkway": {
    "zh": "切换自动步道方向",
    "en": "Reverse walkway"
  },
  "configure_lift_doors": {
    "zh": "配置电梯门",
    "en": "Configure lift doors"
  },
  "lift_doors": {
    "zh": "电梯门",
    "en": "Lift doors"
  },
  "lift_doors_hint": {
    "zh": "选择每层轿厢门开启的方向。正面为默认；无门表示该层不经停。",
    "en": "Choose which way the cabin doors open on each floor. The front is the default; no door means the car passes the floor."
  },
  "lift_door_front": {
    "zh": "正面",
    "en": "Front"
  },
  "lift_door_back": {
    "zh": "背面",
    "en": "Back"
  },
  "lift_door_both": {
    "zh": "两侧",
    "en": "Both sides"
  },
  "lift_door_none": {
    "zh": "无门",
    "en": "No door"
  },
  "refresh_selected_platform_doors": {
    "zh": "刷新所选站台门",
    "en": "Refresh selected platform doors"
  },
  "edit_sign_board": {
    "zh": "编辑指示牌面板",
    "en": "Edit sign board"
  },
  "nothing_selected_yet": {
    "zh": "尚未选中任何物品。",
    "en": "Nothing selected yet."
  },
  "no_exits_built_yet": {
    "zh": "尚未建出入口。",
    "en": "No exits built yet."
  },
  "no_lines_configured_laying_track_creates_one_automatically_or_ad": {
    "zh": "尚未配置线路。铺下第一段轨道时会自动新建，也可在此手动添加。",
    "en": "No lines configured. Laying track creates one automatically, or add one here."
  },
  "new_line": {
    "zh": "+ 新建线路",
    "en": "+ New line"
  },
  "inspector": {
    "zh": "信息栏",
    "en": "Inspector"
  },
  "line_name": {
    "zh": "线路名",
    "en": "Line name"
  },
  "line_colour": {
    "zh": "线路颜色",
    "en": "Line colour"
  },
  "delete_line": {
    "zh": "删除线路",
    "en": "Delete line"
  },
  "up_terminus": {
    "zh": "上行终点",
    "en": "Up terminus"
  },
  "down_terminus": {
    "zh": "下行终点",
    "en": "Down terminus"
  },
  "type_403": {
    "zh": "型",
    "en": "Type"
  },
  "cars": {
    "zh": "节",
    "en": "cars"
  },
  "train_type": {
    "zh": "车型",
    "en": "Train type"
  },
  "formation": {
    "zh": "编组",
    "en": "Formation"
  },
  "power": {
    "zh": "供电",
    "en": "Power"
  },
  "people_train": {
    "zh": "人/列 ·",
    "en": "people/train ·"
  },
  "capacity_per_car": {
    "zh": "每节载客量",
    "en": "Capacity per car"
  },
  "empty": {
    "zh": "空",
    "en": "Empty"
  },
  "value_drag_to_rearrange_drag_off_the_board_to_delete": {
    "zh": "{0} · 拖动可换位置，拖出面板即删除",
    "en": "{0} · drag to rearrange; drag off the board to delete"
  },
  "no_room_on_this_sign_remove_some_content_first": {
    "zh": "已达容量上限 — 请先删除部分内容",
    "en": "No room on this sign — remove some content first"
  },
  "a_sign_can_hold_at_most": {
    "zh": "一块指示牌最多放",
    "en": "A sign can hold at most"
  },
  "a_sign_can_hold_at_most_value_content_cells": {
    "zh": "一块指示牌最多放 {0} 格内容",
    "en": "A sign can hold at most {0} content cells"
  },
  "sign_editor": {
    "zh": "指示牌编辑器",
    "en": "Sign editor"
  },
  "discard_changes": {
    "zh": "放弃修改",
    "en": "Discard changes"
  },
  "arrow_value": {
    "zh": "箭头 {0}°",
    "en": "Arrow {0}°"
  },
  "drop_content_here_to_delete_or_click_to_clear_both_sides": {
    "zh": "删除拖入的内容，或点击清空正反面",
    "en": "Drop content here to delete, or click to clear both sides"
  },
  "done": {
    "zh": "完成",
    "en": "Done"
  },
  "close_editor": {
    "zh": "关闭编辑器",
    "en": "Close editor"
  },
  "text": {
    "zh": "文字",
    "en": "Text"
  },
  "chinese": {
    "zh": "中文",
    "en": "Chinese"
  },
  "arrow": {
    "zh": "箭头",
    "en": "Arrow"
  },
  "icon": {
    "zh": "图标",
    "en": "Icon"
  },
  "front": {
    "zh": "正面",
    "en": "Front"
  },
  "back": {
    "zh": "背面",
    "en": "Back"
  },
  "front_left_to_right": {
    "zh": "正面（从左到右）",
    "en": "Front (left to right)"
  },
  "back_left_to_right": {
    "zh": "背面（从左到右）",
    "en": "Back (left to right)"
  },
  "text_429": {
    "zh": "文字\nText",
    "en": "Text"
  },
  "line_badge": {
    "zh": "线路牌",
    "en": "Line badge"
  },
  "passengers_inside": {
    "zh": "站内人数",
    "en": "Passengers inside"
  },
  "avg_crowd_level": {
    "zh": "平均拥挤等级",
    "en": "Average crowd level"
  },
  "gate_queue": {
    "zh": "闸机排队",
    "en": "Gate queue"
  },
  "escalator_queue": {
    "zh": "扶梯排队",
    "en": "Escalator queue"
  },
  "lift_queue": {
    "zh": "电梯排队",
    "en": "Lift queue"
  },
  "platform_door_queue": {
    "zh": "站台门排队",
    "en": "Platform door queue"
  },
  "boarded": {
    "zh": "已上车",
    "en": "Boarded"
  },
  "exited": {
    "zh": "已出站",
    "en": "Exited"
  },
  "left_behind": {
    "zh": "滞留",
    "en": "Left behind"
  },
  "data": {
    "zh": "数据",
    "en": "Data"
  },
  "open_data_window": {
    "zh": "打开数据窗口",
    "en": "Open the data window"
  },
  "close_data_window": {
    "zh": "关闭数据窗口",
    "en": "Close the data window"
  },
  "station_numbers": {
    "zh": "站内数值",
    "en": "In-station numbers"
  },
  "passenger_totals": {
    "zh": "客流累计",
    "en": "Passenger totals"
  },
  "cumulative": {
    "zh": "累计",
    "en": "Cumulative"
  },
  "per_minute": {
    "zh": "每分钟",
    "en": "Per minute"
  },
  "no_data_yet": {
    "zh": "暂无数据",
    "en": "No data yet"
  },
  "time_440": {
    "zh": "时间",
    "en": "Time"
  },
  "blocks": {
    "zh": "方块数",
    "en": "Blocks"
  },
  "opening_time": {
    "zh": "开站时间",
    "en": "Opening time"
  },
  "closing_time": {
    "zh": "关站时间",
    "en": "Closing time"
  },
  "morning": {
    "zh": "早",
    "en": "Morning"
  },
  "evening": {
    "zh": "晚",
    "en": "Evening"
  },
  "value_peak_starts": {
    "zh": "{0}高峰开始",
    "en": "{0} peak starts"
  },
  "value_peak_ends": {
    "zh": "{0}高峰结束",
    "en": "{0} peak ends"
  },
  "24_hour_demand_curve_value_now_value_about_value_people_h": {
    "zh": "24 小时客流曲线（{0}），当前 {1}% · 约 {2} 人/时",
    "en": "24-hour demand curve ({0}), now {1}% · about {2} people/h"
  },
  "close_time_window": {
    "zh": "关闭时刻窗口",
    "en": "Close time window"
  },
  "time_and_passengers": {
    "zh": "时刻与客流",
    "en": "Time and passengers"
  },
  "demand": {
    "zh": "客流",
    "en": "Demand"
  },
  "close": {
    "zh": "关闭",
    "en": "Close"
  },
  "demand_curve": {
    "zh": "客流曲线",
    "en": "Demand curve"
  },
  "service": {
    "zh": "营业",
    "en": "Service"
  },
  "morning_peak": {
    "zh": "早高峰",
    "en": "Morning peak"
  },
  "evening_peak": {
    "zh": "晚高峰",
    "en": "Evening peak"
  },
  "morning_demand": {
    "zh": "早高峰量",
    "en": "Morning demand"
  },
  "peak_height_at_08_00": {
    "zh": "08:00 的高峰高度",
    "en": "Peak height at 08:00"
  },
  "evening_demand": {
    "zh": "晚高峰量",
    "en": "Evening demand"
  },
  "peak_height_at_18_00": {
    "zh": "18:00 的高峰高度",
    "en": "Peak height at 18:00"
  },
  "peak_steepness": {
    "zh": "波形陡峭度",
    "en": "Peak steepness"
  },
  "peak_width_100_0_85_hours": {
    "zh": "高峰宽度（100% = 0.85 小时）",
    "en": "Peak width (100% = 0.85 hours)"
  },
  "calendar": {
    "zh": "日历",
    "en": "Calendar"
  },
  "previous_month": {
    "zh": "上个月",
    "en": "Previous month"
  },
  "value_value": {
    "zh": "{0} 年 {1}",
    "en": "{1} {0}"
  },
  "next_month": {
    "zh": "下个月",
    "en": "Next month"
  },
  "value_value_value": {
    "zh": "{0} 月 {1} 日 {2}",
    "en": "{1} {0}, {2}"
  },
  "current_date": {
    "zh": "当前日期",
    "en": "Current date"
  },
  "holiday": {
    "zh": "节假日",
    "en": "Holiday"
  },
  "make_up_workday": {
    "zh": "调休上班",
    "en": "Make-up workday"
  },
  "zoo": {
    "zh": "动物园",
    "en": "Zoo"
  },
  "guangzhou_metro_line_5": {
    "zh": "广州地铁 · 5号线",
    "en": "Guangzhou Metro · Line 5"
  },
  "example_stations_ctrl_shift_n": {
    "zh": "示例车站（Ctrl+Shift+N）",
    "en": "Example stations (Ctrl+Shift+N)"
  },
  "tanwei": {
    "zh": "坦尾",
    "en": "Tanwei"
  },
  "guangzhou_metro_lines_5_6": {
    "zh": "广州地铁 · 5号线 / 6号线",
    "en": "Guangzhou Metro · Lines 5 / 6"
  },
  "value_station_preview": {
    "zh": "{0}站预览",
    "en": "{0} station preview"
  },
  "example_stations": {
    "zh": "示例车站",
    "en": "Example stations"
  },
  "close_example_stations": {
    "zh": "关闭示例车站",
    "en": "Close example stations"
  },
  "open_the_value_example_station": {
    "zh": "打开{0}示例车站",
    "en": "Open the {0} example station"
  },
  "value_station_concourse_preview": {
    "zh": "{0}站大厅预览",
    "en": "{0} station concourse preview"
  },
  "new_station_ctrl_n": {
    "zh": "新建车站（Ctrl+N）",
    "en": "New station (Ctrl+N)"
  },
  "new_479": {
    "zh": "新建",
    "en": "New"
  },
  "new_station": {
    "zh": "新建车站？",
    "en": "New station?"
  },
  "the_current_station_will_be_replaced_save_anything_you_want_to_k": {
    "zh": "当前车站将被替换，请先保存需要保留的内容。",
    "en": "The current station will be replaced. Save anything you want to keep first."
  },
  "cancel": {
    "zh": "取消",
    "en": "Cancel"
  },
  "new_station_483": {
    "zh": "新建车站",
    "en": "New station"
  },
  "station_name_click_to_rename": {
    "zh": "车站名称，点击重命名",
    "en": "Station name; click to rename"
  },
  "edit_station_name": {
    "zh": "编辑车站名称",
    "en": "Edit station name"
  },
  "chinese_station_name": {
    "zh": "中文站名",
    "en": "Primary name"
  },
  "save": {
    "zh": "保存",
    "en": "Save"
  },
  "save_to_file_ctrl_s": {
    "zh": "保存到文件（Ctrl+S）",
    "en": "Save to file (Ctrl+S)"
  },
  "open_save_ctrl_l": {
    "zh": "打开存档（Ctrl+L）",
    "en": "Open save (Ctrl+L)"
  },
  "open_490": {
    "zh": "打开",
    "en": "Open"
  },
  "undo_ctrl_z": {
    "zh": "撤销（Ctrl+Z）",
    "en": "Undo (Ctrl+Z)"
  },
  "undo": {
    "zh": "撤销",
    "en": "Undo"
  },
  "redo_ctrl_y": {
    "zh": "重做（Ctrl+Y）",
    "en": "Redo (Ctrl+Y)"
  },
  "redo": {
    "zh": "重做",
    "en": "Redo"
  },
  "playback_controls": {
    "zh": "播放控制",
    "en": "Playback controls"
  },
  "pause": {
    "zh": "暂停",
    "en": "Pause"
  },
  "value_speed": {
    "zh": "{0} 倍速",
    "en": "{0}× speed"
  },
  "restart_simulation_ctrl_r": {
    "zh": "重启仿真（Ctrl+R）",
    "en": "Restart simulation (Ctrl+R)"
  },
  "restart": {
    "zh": "重启仿真",
    "en": "Restart simulation"
  },
  "report_issue": {
    "zh": "报告问题",
    "en": "Report issue"
  },
  "exit_value": {
    "zh": "{0}口",
    "en": "Exit {0}"
  },
  "exit_a": {
    "zh": "A口",
    "en": "Exit A"
  },
  "line_value": {
    "zh": "{0}号线",
    "en": "Line {0}"
  },
  "blocked_by_value": {
    "zh": "：被{0}阻挡",
    "en": ": blocked by {0}"
  },
  "cannot_place_value_equipment_rooms_platforms_or_other_tracks_are": {
    "zh": "此处有设备、房间、站台或其他轨道阻挡，无法放置{0}",
    "en": "Cannot place {0}: equipment, rooms, platforms or other tracks are in the way"
  },
  "a_wall_crosses_this_track_use_a_tunnel_instead_of_a_platform_her": {
    "zh": "轨道中间有墙，无法放置站台；此处可改用隧道",
    "en": "A wall crosses this track; use a tunnel instead of a platform here"
  },
  "keep_openings_clear_do_not_cover_stairs_escalators_or_entrances_": {
    "zh": "预留开口须保持畅通：不得用方块盖住楼梯、扶梯和出入口",
    "en": "Keep openings clear: do not cover stairs, escalators or entrances with blocks"
  },
  "equipment_occupies_this_cell_move_or_remove_it_before_placing_a_": {
    "zh": "该格已有设备，无法放置方块：请先移开或拆除",
    "en": "Equipment occupies this cell; move or remove it before placing a block"
  },
  "cannot_place_blocks_on_track": {
    "zh": "轨道上不能铺方块",
    "en": "Cannot place blocks on track"
  },
  "cannot_place_a_block_in_this_cell": {
    "zh": "此处无法放置方块",
    "en": "Cannot place a block in this cell"
  },
  "value_blocked_by_value": {
    "zh": "{0}：被{1}阻挡",
    "en": "{0}: blocked by {1}"
  },
  "corrupt_file": {
    "zh": "文件损坏",
    "en": "Corrupt file"
  },
  "this_is_not_a_metro_station_save": {
    "zh": "不是车站存档",
    "en": "This is not a Station Designer save"
  },
  "this_save_is_too_new_update_the_game_first": {
    "zh": "存档版本过新，请先更新游戏",
    "en": "This save is too new; update the game first"
  },
  "missing_station_data": {
    "zh": "缺少车站数据",
    "en": "Missing station data"
  },
  "advertisement": {
    "zh": "广告",
    "en": "Advertisement"
  },
  "unknown": {
    "zh": "未",
    "en": "?"
  },
  "line_5": {
    "zh": "5号线",
    "en": "Line 5"
  },
  "alighting_area": {
    "zh": "下车区",
    "en": "Keep clear"
  },
  "let_passengers_off_first": {
    "zh": "先下后上",
    "en": "Let others off first"
  },
  "network_map_520": {
    "zh": "线网示意图",
    "en": "Network map"
  },
  "station": {
    "zh": "站",
    "en": "Station"
  },
  "value_station": {
    "zh": "{0}站",
    "en": "{0} station"
  },
  "no_lines_laid_yet": {
    "zh": "尚未铺设线路",
    "en": "No lines laid yet"
  },
  "value_lines_value_stations": {
    "zh": "共 {0} 条线路 · {1} 座车站",
    "en": "{0} lines · {1} stations"
  },
  "line_2_525": {
    "zh": "2 号线",
    "en": "Line 2"
  },
  "select_destination": {
    "zh": "选择目的地",
    "en": "Destination"
  },
  "buy_ticket": {
    "zh": "购票",
    "en": "Buy"
  },
  "face_payment": {
    "zh": "刷脸支付",
    "en": "Face scan"
  },
  "tmall_select": {
    "zh": "天猫优选",
    "en": "Special offer"
  },
  "ride_for_0_01": {
    "zh": "1分钱乘车",
    "en": "Save on fares"
  },
  "select_payment_method": {
    "zh": "请选择支付方式",
    "en": "Payment"
  },
  "collection_tray": {
    "zh": "取物口",
    "en": "Collect here"
  },
  "customer_hotline_anmei": {
    "zh": "客服热线 / 安美咨询",
    "en": "Help hotline"
  },
  "recyclables": {
    "zh": "可回收物",
    "en": "Recycling"
  },
  "other_waste": {
    "zh": "其他垃圾",
    "en": "General waste"
  },
  "paper": {
    "zh": "纸类",
    "en": "Paper"
  },
  "plastic": {
    "zh": "塑料",
    "en": "Plastic"
  },
  "metal": {
    "zh": "金属",
    "en": "Metal"
  },
  "peels": {
    "zh": "果皮",
    "en": "Peels"
  },
  "food_waste": {
    "zh": "残渣",
    "en": "Food"
  },
  "tissues": {
    "zh": "纸巾",
    "en": "Tissues"
  },
  "dust": {
    "zh": "尘土",
    "en": "Dust"
  },
  "fire_extinguisher_box": {
    "zh": "灭火器箱",
    "en": "EXTINGUISHER"
  },
  "fire": {
    "zh": "火",
    "en": "FIRE"
  },
  "alarm": {
    "zh": "警",
    "en": "ALARM"
  },
  "customer_service": {
    "zh": "客服中心",
    "en": "Customer service"
  },
  "separator": {
    "zh": "分隔线",
    "en": "Separator"
  },
  "gap": {
    "zh": "空隙",
    "en": "Gap"
  },
  "metro": {
    "zh": "地铁",
    "en": "Metro"
  },
  "guangzhou_metro": {
    "zh": "广州地铁",
    "en": "Guangzhou Metro"
  },
  "entrance": {
    "zh": "入口",
    "en": "Entrance"
  },
  "mind_the_gap_between_the_platform_and_train": {
    "zh": "注意站台与列车之间的空隙",
    "en": "Mind the gap"
  },
  "do_not_board_or_alight_when_lights_flash_and_bells_ring": {
    "zh": "灯闪铃响，勿上下车。",
    "en": "Stand clear of closing doors"
  },
  "do_not_rush_closing_doors": {
    "zh": "冲门危险，顾己及人。",
    "en": "Do not rush"
  },
  "caution_keep_clear": {
    "zh": "小心！别碰我！",
    "en": "Keep clear"
  },
  "toward_value": {
    "zh": "◀ {0}方向",
    "en": "◀ Toward {0}"
  },
  "waiting_area_travel_courteously": {
    "zh": "候车  ·  文明出行",
    "en": "Waiting area"
  },
  "tickets": {
    "zh": "车票",
    "en": "Tickets"
  },
  "out": {
    "zh": "出",
    "en": "Out"
  },
  "no_line_assigned": {
    "zh": "未配线路",
    "en": "No line assigned"
  },
  "this_train_goes_to": {
    "zh": "本趟列车开往",
    "en": "This train goes to"
  },
  "next_train_goes_to": {
    "zh": "下趟列车开往",
    "en": "Next train goes to"
  },
  "third_train_goes_to": {
    "zh": "第三趟列车开往",
    "en": "Third train goes to"
  },
  "no_services": {
    "zh": "暂无班次",
    "en": "No services"
  },
  "train_at_platform": {
    "zh": "列车停站",
    "en": "Train at platform"
  },
  "arriving_soon": {
    "zh": "即将到站",
    "en": "Arriving soon"
  },
  "value_minutes": {
    "zh": "{0} 分钟",
    "en": "{0} minutes"
  },
  "travel_courteously_watch_your_step": {
    "zh": "文明乘车  请注意脚下安全",
    "en": "Travel courteously; watch your step"
  },
  "stainless_steel_1_m": {
    "zh": "不锈钢 1 m",
    "en": "Stainless steel 1 m"
  },
  "stainless_steel_2_m": {
    "zh": "不锈钢 2 m",
    "en": "Stainless steel 2 m"
  },
  "backed_seat_1_m": {
    "zh": "靠背 1 m",
    "en": "Backed seat 1 m"
  },
  "linked_seats_2_m": {
    "zh": "连排 2 m",
    "en": "Linked seats 2 m"
  },
  "guangzhou_metro_security_check": {
    "zh": "广州地铁 进站安检",
    "en": "Guangzhou Metro security check"
  },
  "property_viewing_hotline": {
    "zh": "售楼处预约专线",
    "en": "Property viewing hotline"
  },
  "15th_national_games": {
    "zh": "十五运会 激情全运会",
    "en": "15th National Games"
  },
  "guangdong_super_league": {
    "zh": "粤超 一战城名",
    "en": "Guangdong Super League"
  },
  "what_is_cloud_security": {
    "zh": "云安全是什么",
    "en": "What is cloud security?"
  },
  "heinz_tomatoes_that_want_to_win": {
    "zh": "想赢的番茄在亨氏里",
    "en": "Heinz: tomatoes that want to win"
  },
  "a_meal_for_a_stray_cat": {
    "zh": "一撕一拉 流浪猫一餐",
    "en": "A meal for a stray cat"
  },
  "herbal_rhinitis_spray": {
    "zh": "中药雾化治鼻炎",
    "en": "Herbal rhinitis spray"
  },
  "yupao_recruitment": {
    "zh": "鱼泡直聘 找工作",
    "en": "Yupao recruitment"
  },
  "haoyibao_insurance": {
    "zh": "好医保 支持上海医保",
    "en": "Haoyibao insurance"
  },
  "15th_national_games_guangzhou": {
    "zh": "十五运会 广州开幕",
    "en": "15th National Games, Guangzhou"
  },
  "discover_what_the_body_can_do": {
    "zh": "用身体去回答人体的可能",
    "en": "Discover what the body can do"
  },
  "regular_script": {
    "zh": "楷书",
    "en": "Regular script"
  },
  "running_script": {
    "zh": "行书",
    "en": "Running script"
  },
  "clerical_script": {
    "zh": "隶书",
    "en": "Clerical script"
  },
  "wei_stele": {
    "zh": "魏碑",
    "en": "Wei stele"
  },
  "sans_serif": {
    "zh": "黑体",
    "en": "Sans serif"
  },
  "song_serif": {
    "zh": "宋体",
    "en": "Song serif"
  },
  "horizontal": {
    "zh": "横排",
    "en": "Horizontal"
  },
  "vertical": {
    "zh": "竖排",
    "en": "Vertical"
  },
  "january": {
    "zh": "一月",
    "en": "January"
  },
  "february": {
    "zh": "二月",
    "en": "February"
  },
  "march": {
    "zh": "三月",
    "en": "March"
  },
  "april": {
    "zh": "四月",
    "en": "April"
  },
  "may": {
    "zh": "五月",
    "en": "May"
  },
  "june": {
    "zh": "六月",
    "en": "June"
  },
  "july": {
    "zh": "七月",
    "en": "July"
  },
  "august": {
    "zh": "八月",
    "en": "August"
  },
  "september": {
    "zh": "九月",
    "en": "September"
  },
  "october": {
    "zh": "十月",
    "en": "October"
  },
  "november": {
    "zh": "十一月",
    "en": "November"
  },
  "december": {
    "zh": "十二月",
    "en": "December"
  },
  "mon": {
    "zh": "一",
    "en": "Mon"
  },
  "tue": {
    "zh": "二",
    "en": "Tue"
  },
  "wed": {
    "zh": "三",
    "en": "Wed"
  },
  "thu": {
    "zh": "四",
    "en": "Thu"
  },
  "fri": {
    "zh": "五",
    "en": "Fri"
  },
  "sat": {
    "zh": "六",
    "en": "Sat"
  },
  "sun": {
    "zh": "日",
    "en": "Sun"
  },
  "sunday": {
    "zh": "周日",
    "en": "Sunday"
  },
  "monday": {
    "zh": "周一",
    "en": "Monday"
  },
  "tuesday": {
    "zh": "周二",
    "en": "Tuesday"
  },
  "wednesday": {
    "zh": "周三",
    "en": "Wednesday"
  },
  "thursday": {
    "zh": "周四",
    "en": "Thursday"
  },
  "friday": {
    "zh": "周五",
    "en": "Friday"
  },
  "saturday": {
    "zh": "周六",
    "en": "Saturday"
  },
  "weekday": {
    "zh": "工作日",
    "en": "Weekday"
  },
  "offday": {
    "zh": "非工作日",
    "en": "Non-workday"
  },
  "peak": {
    "zh": "高峰",
    "en": "Peak"
  },
  "off_peak": {
    "zh": "平峰",
    "en": "Off-peak"
  },
  "night": {
    "zh": "夜间",
    "en": "Night"
  },
  "value_value_621": {
    "zh": "{0}月{1}日",
    "en": "{0}/{1}"
  },
  "free_flow": {
    "zh": "畅通",
    "en": "Free flow"
  },
  "comfortable": {
    "zh": "顺畅",
    "en": "Comfortable"
  },
  "busy": {
    "zh": "有点挤",
    "en": "Busy"
  },
  "crowded": {
    "zh": "拥挤",
    "en": "Crowded"
  },
  "very_crowded": {
    "zh": "很挤",
    "en": "Very crowded"
  },
  "overcrowded": {
    "zh": "挤爆",
    "en": "Overcrowded"
  },
  "double": {
    "zh": "双开",
    "en": "Double"
  },
  "single": {
    "zh": "单开",
    "en": "Single"
  },
  "door_value_value": {
    "zh": "门 {0} {1}",
    "en": "Door {0} {1}"
  },
  "granite": {
    "zh": "花岗岩",
    "en": "Granite"
  },
  "concrete": {
    "zh": "混凝土",
    "en": "Concrete"
  },
  "floor_tiles": {
    "zh": "地砖",
    "en": "Floor tiles"
  },
  "track_bed": {
    "zh": "轨道床",
    "en": "Track bed"
  },
  "earth_cover": {
    "zh": "覆土",
    "en": "Earth cover"
  },
  "grille_ceiling": {
    "zh": "格栅天花",
    "en": "Grille ceiling"
  },
  "metal_ceiling": {
    "zh": "金属吊顶",
    "en": "Metal ceiling"
  },
  "paint": {
    "zh": "涂料",
    "en": "Paint"
  },
  "enamel_panels": {
    "zh": "搪瓷板",
    "en": "Enamel panels"
  },
  "brushed_steel": {
    "zh": "拉丝不锈钢",
    "en": "Brushed steel"
  },
  "earth_wall": {
    "zh": "土墙",
    "en": "Earth wall"
  },
  "curtain_wall_extra_narrow_1_4": {
    "zh": "玻璃幕墙 超窄 1×4",
    "en": "Curtain wall, extra narrow 1×4"
  },
  "glass_panel_2_4": {
    "zh": "玻璃板 2×4",
    "en": "Glass panel 2×4"
  },
  "glass_panel_3_4": {
    "zh": "玻璃板 3×4",
    "en": "Glass panel 3×4"
  },
  "glass_panel_4_4": {
    "zh": "玻璃板 4×4",
    "en": "Glass panel 4×4"
  },
  "entrances_must_be_placed_at_ground_level": {
    "zh": "出入口只能放在 0~3 米",
    "en": "Entrances must be placed between 0 and 3 metres"
  },
  "ground_entrances_must_be_at_0_m_or_above": {
    "zh": "地面出入口只能放在 0 米及以上",
    "en": "Ground entrances must be at 0 m or above"
  },
  "the_bridge_underside_must_be_above_ground": {
    "zh": "轨道桥的桥底必须在地面上方",
    "en": "The bridge underside must be above ground"
  },
  "wayfinding_posts_and_bus_stops_need_a_floor_at_0_m_or_above": {
    "zh": "导向柱和公交站只能放在 0 米及以上的地板上",
    "en": "Wayfinding posts and bus stops need a floor at 0 m or above"
  },
  "equipment_needs_a_solid_floor_here": {
    "zh": "此处没有地板，设备需立于实心地板上",
    "en": "Equipment needs a solid floor here"
  },
  "cannot_place_equipment_on_track": {
    "zh": "轨道上不能放置设备",
    "en": "Cannot place equipment on track"
  },
  "equipment_already_occupies_this_location": {
    "zh": "此处已有设备，请另选位置",
    "en": "Equipment already occupies this location"
  },
  "wall_decorations_need_a_solid_wall_behind_them": {
    "zh": "墙面装饰（广告牌、玻璃板、站名、线网图、墙面指示牌、地面出入口）须贴墙安装：背后需有实心墙板",
    "en": "Wall decorations need a solid wall behind them"
  },
  "the_board_is_wider_than_the_booth_header_remove_some_content_or_build_a": {
    "zh": "指示牌比售票亭的顶梁宽，挂不上去：删掉一些内容，或建一个更大的房间",
    "en": "The board is wider than the booth header — remove some content, or build a larger room"
  },
  "hung_signs_tvs_clocks_and_cameras_need_a_slab_4_m_above_wall_sig": {
    "zh": "吊挂指示牌、电视、时钟和监控需安装在天花板下；墙面指示牌贴墙安装即可",
    "en": "Hung signs, TVs, clocks and cameras need a ceiling slab above; wall signs attach to a wall"
  },
  "the_escalator_bottom_needs_a_solid_floor": {
    "zh": "扶梯底端需有实心地板",
    "en": "The escalator bottom needs a solid floor"
  },
  "a_lift_needs_a_floor_under_its_whole_footprint": {
    "zh": "电梯的整个占地都需要地板",
    "en": "A lift needs a floor under every cell of its footprint"
  },
  "lift_footprint_cells": {
    "zh": "2 × 2 或 3 × 3 格",
    "en": "2 × 2 or 3 × 3 cells"
  },
  "value_and_value_items": {
    "zh": "{0}等{1}件",
    "en": "{0} and {1} items"
  },
  "dark_tall_shelf": {
    "zh": "深色高架",
    "en": "Dark tall shelf"
  },
  "white_tall_shelf": {
    "zh": "白色高架",
    "en": "White tall shelf"
  },
  "white_low_shelf": {
    "zh": "白色矮架",
    "en": "White low shelf"
  },
  "mobile_wire_basket": {
    "zh": "移动网篮架",
    "en": "Mobile wire basket"
  },
  "white_cooler": {
    "zh": "白色冷柜",
    "en": "White cooler"
  },
  "dark_cooler": {
    "zh": "深色冷柜",
    "en": "Dark cooler"
  },
  "train": {
    "zh": "列车",
    "en": "Train"
  },
  "accessible": {
    "zh": "无障碍",
    "en": "Accessible"
  },
  "restroom_666": {
    "zh": "卫生间",
    "en": "Restroom"
  },
  "exit_667": {
    "zh": "出口",
    "en": "Exit"
  },
  "prohibited": {
    "zh": "禁止",
    "en": "Prohibited"
  },
  "u_turn_right": {
    "zh": "掉头向右",
    "en": "U-turn right"
  },
  "u_turn_left": {
    "zh": "掉头向左",
    "en": "U-turn left"
  },
  "exit_station": {
    "zh": "出站",
    "en": "Exit station"
  },
  "exit_station_exit": {
    "zh": "出站 + 出口",
    "en": "Exit station + exit"
  },
  "arrow_exit": {
    "zh": "箭头 + 出口",
    "en": "Arrow + exit"
  },
  "hung_sign": {
    "zh": "吊挂指示牌",
    "en": "Hung sign"
  },
  "wall_sign": {
    "zh": "墙面指示牌",
    "en": "Wall sign"
  },
  "entry_gate": {
    "zh": "进站闸机",
    "en": "Entry gate"
  },
  "exit_gate": {
    "zh": "出站闸机",
    "en": "Exit gate"
  },
  "up_escalator": {
    "zh": "上行扶梯",
    "en": "Up escalator"
  },
  "down_escalator": {
    "zh": "下行扶梯",
    "en": "Down escalator"
  },
  "accessible_lift": {
    "zh": "无障碍电梯",
    "en": "Accessible lift"
  },
  "half_height_noise_barrier": {
    "zh": "半高声屏障",
    "en": "Half-height noise barrier"
  },
  "full_height_noise_barrier": {
    "zh": "全高声屏障",
    "en": "Full-height noise barrier"
  },
  "noise_barrier": { "zh": "隔音屏", "en": "Sound barrier" },
  "railing": {
    "zh": "栏杆",
    "en": "Railing"
  },
  "extra_short": {
    "zh": "超短",
    "en": "Extra short"
  },
  "extra_long": {
    "zh": "超长",
    "en": "Extra long"
  },
  "no_zone": {
    "zh": "无分区",
    "en": "No zone"
  },
  "outside": {
    "zh": "站外",
    "en": "Outside"
  },
  "unpaid_area": {
    "zh": "非付费区",
    "en": "Unpaid area"
  },
  "paid_area": {
    "zh": "付费区",
    "en": "Paid area"
  },
  "equipment_area": {
    "zh": "设备区",
    "en": "Equipment area"
  },
  "english_station_name": {
    "zh": "英文站名",
    "en": "Secondary name"
  },
  "english": {
    "zh": "英文",
    "en": "English"
  },
  "primary_sign_text": {
    "zh": "中文",
    "en": "Primary text"
  },
  "secondary_sign_text": {
    "zh": "英文",
    "en": "Secondary text"
  },
  "language": {
    "zh": "语言",
    "en": "Language"
  },
  "switch_language": {
    "zh": "切换语言：English",
    "en": "Switch language: 简体中文"
  },
  "build_caption": {
    "zh": "车站 / 建造",
    "en": "STATION / BUILD"
  },
  "inspector_caption": {
    "zh": "车站 / 信息",
    "en": "STATION / INSPECTOR"
  },
  "fov_label": {
    "zh": "视场角：",
    "en": "FOV:"
  },
  "fps": {
    "zh": "FPS",
    "en": "FPS"
  },
  "milliseconds": {
    "zh": "ms",
    "en": "ms"
  },
  "metres": {
    "zh": "m",
    "en": "m"
  },
  "day_index": {
    "zh": "第 {0} 天",
    "en": "Day {0}"
  },
  "train_formation": {
    "zh": "{0} 型 · {1} 节",
    "en": "Type {0} · {1} cars"
  },
  "peak_headway": {
    "zh": "高峰间隔",
    "en": "Peak headway"
  },
  "offpeak_headway": {
    "zh": "平峰间隔",
    "en": "Off-peak headway"
  },
  "late_headway": {
    "zh": "离峰间隔",
    "en": "Late headway"
  },
  "minutes_short": {
    "zh": "分",
    "en": "min"
  },
  "seconds_short": {
    "zh": "秒",
    "en": "s"
  },
  "trains_h": {
    "zh": "列/时",
    "en": "trains/h"
  },
  "entry_demand_curve": {
    "zh": "进站客流曲线",
    "en": "Entrance demand"
  },
  "train_demand_curve": {
    "zh": "列车客流曲线",
    "en": "Train demand"
  },
  "entry_curve_note": {
    "zh": "经由出入口进站",
    "en": "Via station entrances"
  },
  "train_curve_note": {
    "zh": "各线路下车合计",
    "en": "Alighting across all lines"
  },
  "now_about_value_people_h": {
    "zh": "当前约{0}人/时",
    "en": "Now about {0} people/h"
  },
  "train_curve_now_about_value_people_h": {
    "zh": "列车客流，当前约{0}人/时",
    "en": "Train demand, now about {0} people/h"
  }
} as const
