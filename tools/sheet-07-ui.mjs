// Concept sheet 07 - the interface. The mock is Chinese-only: the shipping UI
// language is Simplified Chinese, so the sheet is drawn in the language the
// player will actually read. Sheet captions stay in English for the doc set.
import { C, T, MUL, title, sheet, n, poly, pstr, sway, breathe, dashFlow, mover, group, pulseBar } from './iso.mjs';

export function artUI() {
  const W = 1600, H = 1000;
  const g = [];
  g.push(title(48, 62, '概念 07 // 界面',
    '建造与观察，同屏完成',
    '相机就是楼层选择器：左边建造，右边改选中的东西，底下管线路、楼层和叠加层。界面只有简体中文。'));
  g.push(`<rect x="48" y="170" width="1504" height="790" rx="16" fill="#0b0f16" stroke="#243040"/>`);
  const panel = (x, y, w, h, t, sub) => {
    g.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#131b26" stroke="#243040"/>`);
    if (t) g.push(T(x + 12, y + 22, t, { size: 12.5, weight: 800, fill: '#8fa0b3', ls: 1.2 }));
    if (sub) g.push(T(x + 12, y + 40, sub, { size: 11, fill: '#5d6d80' }));
  };
  /* ---- top bar ---- */
  panel(60, 182, 1480, 54);
  g.push(T(78, 216, '五丝广场站', { size: 18, weight: 800, fill: '#eaf0f6' }));
  g.push(T(196, 216, '换乘站', { size: 12, fill: '#5d6d80' }));
  g.push(T(310, 216, '周一 07:42   |   工作日   |   4 倍速', { size: 13, fill: '#8fa0b3', mono: true }));
  // a live run indicator, so the mock reads as a running simulation
  g.push(`<circle cx="298" cy="212" r="5" fill="${C.green}" ${breathe(0.15, '1.6s')}/>`);
  g.push(`<rect x="700" y="196" width="180" height="26" rx="7" fill="#1d2731"/>`);
  g.push(T(712, 214, '站内 3,412 人', { size: 12.5, fill: C.yellow, mono: true }));
  g.push(`<rect x="890" y="196" width="150" height="26" rx="7" fill="#1d2731"/>`);
  g.push(T(902, 214, '最差 服务水平 D', { size: 12.5, fill: C.red, mono: true }));
  for (let i = 0; i < 5; i++) {
    g.push(`<rect x="${1220 + i * 62}" y="196" width="52" height="26" rx="7" fill="${i === 3 ? '#2f7ef2' : '#1d2731'}" stroke="#243040"/>`);
  }
  g.push(T(1246, 214, '暂停', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));
  g.push(T(1308, 214, '1x', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));
  g.push(T(1370, 214, '4x', { size: 11.5, fill: '#fff', anchor: 'middle' }));
  g.push(T(1432, 214, '16x', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));
  g.push(T(1494, 214, '保存', { size: 11.5, fill: '#c3d0de', anchor: 'middle' }));

  /* ---- left rail: build tools ---- */
  panel(60, 248, 196, 500, '建造');
  const tools = ['结构', '墙体', '地板', '天花板', '闸机', '商铺', '设备', '楼梯', '扶梯', '电梯', '轨道', '标识'];
  tools.forEach((t, i) => {
    const y = 282 + i * 38;
    const active = i === 4;
    g.push(`<rect x="70" y="${y}" width="176" height="32" rx="8" fill="${active ? '#1d3a66' : '#0f1620'}" stroke="${active ? '#2f7ef2' : '#1d2731'}"/>`);
    g.push(`<rect x="80" y="${y + 8}" width="16" height="16" rx="4" fill="${active ? C.blue : '#39465a'}"/>`);
    g.push(T(106, y + 21, t, { size: 12.5, fill: active ? '#eaf0f6' : '#a9b8c8' }));
    if (active) g.push(T(240, y + 21, '4', { size: 11, fill: C.blue, mono: true, anchor: 'end' }));
  });
  panel(60, 758, 196, 190, '吸附');
  g.push(MUL(72, 800, ['网格 1 x 1 米   开', '楼层吸附   开', '自动转角   开', '蓝图复制   x8', '撤销 14 / 重做 0'], { size: 12, fill: '#a9b8c8', lh: 22, mono: true }));

  /* ---- centre viewport ---- */
  panel(268, 248, 900, 500, null);
  g.push(`<rect x="280" y="260" width="876" height="476" rx="8" fill="#0d141d"/>`);
  const iso = [];
  const TW = 26, TH = 13, ZU = 22, ox = 700, oy = 520;
  const ip = (x, y, z) => [ox + (x - y) * TW, oy + (x + y) * TH - z * ZU];
  const iq = (x, y, z, w, d, col) => poly([ip(x, y, z), ip(x + w, y, z), ip(x + w, y + d, z), ip(x, y + d, z)], col, C.ink, 0.7);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    iso.push(iq(i, j, 0, 1, 1, (i + j) % 2 ? '#2c3a4a' : '#31404f'));
  }
  iso.push(`<polygon points="${pstr([ip(7, 2, 0), ip(10, 2, 0), ip(10, 4, 0), ip(7, 4, 0)])}" fill="${C.blue}" opacity=".35" stroke="${C.blue}" stroke-width="2" stroke-dasharray="5 4" ${dashFlow(9, '0.9s')}/>`);
  iso.push(iq(7, 2, 0.02, 3, 2, '#2f7ef2'));
  iso.push(`<polygon points="${pstr([ip(6, 6, 0), ip(10, 6, 0), ip(10, 6, 1), ip(6, 6, 1)])}" fill="#6e7885" stroke="${C.ink}" stroke-width="0.7"/>`);
  for (let i = 0; i < 8; i++) {
    const gx0 = 1.2 + i * 1.05;
    iso.push(poly([ip(gx0, 7, 0), ip(gx0 + 0.8, 7, 0), ip(gx0 + 0.8, 7, 1), ip(gx0, 7, 1)], '#98a4b1', C.ink, 0.7));
    iso.push(poly([ip(gx0 + 0.8, 7, 0), ip(gx0 + 0.8, 8.4, 0), ip(gx0 + 0.8, 8.4, 1), ip(gx0 + 0.8, 7, 1)], '#6e7885', C.ink, 0.7));
    iso.push(poly([ip(gx0, 7, 1), ip(gx0 + 0.8, 7, 1), ip(gx0 + 0.8, 7, 1.16), ip(gx0, 7, 1.16)], C.green, C.ink, 0.6));
  }
  iso.push(poly([ip(3, 4.5, 0.02), ip(5, 4.5, 0.02), ip(5, 5.5, 0.02), ip(3, 5.5, 0.02)], C.blue, 'none', 0));
  g.push(`<g>${iso.join('')}</g>`);
  const vpPeople = [[2, 3, C.red], [3.4, 3.6, C.teal], [4.6, 2.6, C.purple], [6.4, 8.6, C.orange], [8.2, 9.4, C.blue]];
  g.push(vpPeople.map(([x, y, col], k) => {
    const [psx, psy] = ip(x, y, 0);
    return group(`<use href="#person" x="${n(psx)}" y="${n(psy)}" style="color:${col}"/>`,
      sway(3.4, '2.6s', `${(k * 0.35).toFixed(2)}s`));
  }).join(''));
  g.push(T(300, 288, '视图', { size: 12, fill: '#39465a', ls: 1.4, weight: 700, mono: true }));
  g.push(T(1140, 288, '左键建造  |  右键拆除  |  中键旋转  |  滚轮缩放  |  Q / E 楼层', { size: 11.5, fill: '#39465a', mono: true, anchor: 'end' }));
  /* ---- overlay legend ---- */
  panel(294, 636, 244, 88);
  g.push(T(306, 660, '叠加层：人群密度', { size: 11.5, fill: C.yellow, weight: 700 }));
  for (let i = 0; i < 24; i++) {
    g.push(`<rect x="${306 + i * 9}" y="670" width="9" height="12" fill="${['#2fb344', '#f2b32c', '#f97316', '#e5484d'][Math.min(3, Math.floor(i / 6))]}"/>`);
  }
  g.push(T(306, 708, '服务水平 A  →  D（拥挤）', { size: 11, fill: '#8fa0b3', mono: true }));
  /* ---- level slice ---- */
  panel(912, 626, 234, 98, null);
  g.push(T(924, 650, '楼层切片', { size: 11.5, fill: '#8fa0b3', weight: 700, ls: 1.2 }));
  ['B4', 'B3', 'B2', 'B1', '地面', 'L1'].forEach((t, i) => {
    const x = 926 + i * 35;
    g.push(`<rect x="${x}" y="664" width="28" height="42" rx="6" fill="${i === 3 ? '#2f7ef2' : '#1d2731'}"/>`);
    g.push(T(x + 14, 690, t, { size: i === 4 ? 9.5 : 11, fill: i === 3 ? '#fff' : '#8fa0b3', anchor: 'middle', mono: true }));
  });
  g.push(T(924, 716, '当前：B1', { size: 11, fill: '#2f7ef2', mono: true }));

  /* ---- right inspector ---- */
  panel(1184, 248, 356, 500, '属性');
  g.push(T(1196, 286, '闸机  ×6', { size: 15, weight: 700, fill: '#eaf0f6' }));
  g.push(T(1196, 306, '占地 1 x 2   |   楼层 B1   |   朝向 西', { size: 11.5, fill: '#7d8ea3', mono: true }));
  const fields = [
    ['模式', '双向'], ['通行能力', '25 人 / 分'], ['排队锚点', '南侧'],
    ['权限', '仅付费区'], ['标签', '票务, 排队'], ['高峰服务水平', 'C（队列 4.1 米）'],
  ];
  fields.forEach(([k, v], i) => {
    const y = 336 + i * 36;
    g.push(`<rect x="1196" y="${y}" width="332" height="28" rx="7" fill="#0f1620" stroke="#1d2731"/>`);
    g.push(T(1208, y + 19, k, { size: 12, fill: '#8fa0b3' }));
    g.push(T(1516, y + 19, v, { size: 12, fill: '#dfe7f0', anchor: 'end', mono: true }));
  });
  g.push(`<rect x="1196" y="568" width="332" height="1" fill="#243040"/>`);
  g.push(T(1196, 592, '连接至', { size: 11.5, fill: '#8fa0b3', weight: 700, ls: 1.2 }));
  const conns = [['站厅 B1', C.blue], ['1 号口（进 900 / 时）', C.green], ['2 号线站台 B2', C.lineB], ['1 号线 · 经扶梯', C.lineA]];
  conns.forEach(([t, col], i) => {
    const y = 608 + i * 32;
    g.push(`<rect x="1196" y="${y}" width="332" height="26" rx="7" fill="${col}" opacity=".12" stroke="${col}" stroke-width="1"/>`);
    g.push(`<circle cx="1212" cy="${y + 13}" r="5" fill="${col}"/>`);
    g.push(T(1228, y + 18, t, { size: 12, fill: '#c3d0de' }));
  });
  g.push(T(1196, 736, '线路管理：新增线路，选择 A / B / C 车型，再分配', { size: 11.5, fill: '#7d8ea3' }));

  /* ---- bottom rail: line manager + minimap ---- */
  panel(60, 766, 1480, 182, null);
  g.push(T(76, 794, '线路管理', { size: 12, fill: '#8fa0b3', weight: 800, ls: 1.2 }));
  [['1', C.lineA, 'A 型 / 6 节', '接触网', '2 分', '西塱 – 广州东站'],
    ['2', C.lineB, 'B 型 / 6 节', '第三轨', '2.5 分', '广州南站 – 嘉禾望岗'],
    ['3', C.lineC, 'C 型 / 4 节', '第三轨', '3 分', '番禺广场 – 天河客运站']].forEach(([id, col, stock, pwr, head, name], i) => {
    const x = 76 + i * 292, y = 808;
    g.push(`<rect x="${x}" y="${y}" width="276" height="120" rx="10" fill="#0f1620" stroke="#1d2731"/>`);
    g.push(`<circle cx="${x + 26}" cy="${y + 26}" r="14" fill="${col}"/>`);
    g.push(T(x + 26, y + 31, id, { size: 14, weight: 800, fill: '#0b0e13', anchor: 'middle' }));
    g.push(T(x + 50, y + 24, name, { size: 12.5, weight: 700, fill: '#eaf0f6' }));
    g.push(T(x + 50, y + 42, `${stock}   ·   ${pwr}`, { size: 11.5, fill: '#8fa0b3', mono: true }));
    g.push(T(x + 16, y + 70, `行车间隔 ${head}`, { size: 12, fill: '#c3d0de', mono: true }));
    g.push(`<rect x="${x + 16}" y="${y + 82}" width="244" height="10" rx="5" fill="#1d2731"/>`);
    const hw = 244 * (0.9 - i * 0.18);
    g.push(`<rect x="${x + 16}" y="${y + 82}" width="${hw}" height="10" rx="5" fill="${col}" ${pulseBar(hw, hw * 0.7, (3 + i).toFixed(0) + 's')}/>`);
    g.push(T(x + 16, y + 110, ['贯通运行', '终点站折返', '同台换乘'][i], { size: 11.5, fill: '#7d8ea3' }));
  });
  panel(976, 808, 560, 120, null);
  g.push(T(992, 834, '小地图', { size: 12, fill: '#8fa0b3', weight: 800, ls: 1.2 }));
  g.push(`<rect x="992" y="844" width="200" height="70" rx="8" fill="#0d141d" stroke="#1d2731"/>`);
  g.push(`<path d="M1000,900 L1100,880 L1190,896" stroke="${C.lineA}" stroke-width="3" fill="none"/>`);
  g.push(`<path d="M1000,880 L1120,860 L1190,872" stroke="${C.lineB}" stroke-width="3" fill="none"/>`);
  g.push(mover('M1000,900 L1100,880 L1190,896', C.lineA, 0, { r: 4.2, dur: '6s', f0: 0.02, f1: 0.06, f2: 0.9, f3: 0.94 }));
  g.push(mover('M1000,880 L1120,860 L1190,872', C.lineB, '1.5s', { r: 4.2, dur: '6s', f0: 0.02, f1: 0.06, f2: 0.9, f3: 0.94 }));
  g.push(`<circle cx="1100" cy="874" r="7" fill="${C.yellow}" ${breathe(0.35, '2.2s')}/>`);
  g.push(MUL(1210, 864, [
    '出入口   已建 3 / 计划 2',
    '闸机     进 14   |   出 14',
    '扶梯     上行 6   |   下行 4',
    '电梯     2（无障碍路径正常）',
  ], { size: 11.5, fill: '#a9b8c8', lh: 20, mono: true }));
  g.push(T(992, 946, '整站全中文。数字和线路编号按国标写法，站名、出口、设备也用中文。', { size: 11.5, fill: '#5d6d80' }));
  return sheet(W, H, g.join(''));
}
