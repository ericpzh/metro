# 演示车站工作存档

## 成片与缩略图

- `station-designer-demo-zh.mp4`：最终成片（70.2 秒，2560 × 1440，30 fps，H.264/AAC）。MP4 不入库，仓库统一忽略 `*.mp4`。
- `station-designer-thumbnail-zh.jpg`：中文视频缩略图（3840 × 2160），随仓库提交。
- `station-designer-demo-en.mp4`：英文版成片（70.2 秒，2560 × 1440，30 fps，H.264/AAC）。
- `station-designer-thumbnail-en.jpg`：英文视频缩略图（3840 × 2160）。

## 工作存档

- `demo-station.metro.json`：用户可在游戏中打开、修改并重新保存的真实存档。
- `demo-camera.json`：参考图一到参考图二的连续低角度运镜及建造阶段时长。
- `demo-station-layout.json`：第五版旧布局的原始对应关系，仅作历史记录。

当前工作存档来自用户提供的 `车站.metro.json`，保留全部 1302 个方块、304 个模型，以及浅绿墙面、街道、玻璃、海报与标识配置。空调位于站外，不含屋顶模型。
电梯为同一井道的两个五米段，井道从一米层延伸至十一米层。

这份存档属于用户的编辑工作。视频生成器只会在工作存档不存在时创建它；之后仅刷新录制目录中的快照。
用户修改完成后，把新存档复制到 `demo-station.metro.json`。`tools/demo-video/authored-layout.mjs` 直接读取原生存档，自动分离骨架与设备，合并连续栏杆、盲道和铺装，按东到西排序，并将电梯拆成下段和顶部延长两个动作。新增、移动和删除的模型直接反映在下一次录制中，无需手动维护坐标副本。
运行 `node --test tools/demo-video/plan.test.mjs` 检查原生校验、精确重放和方向顺序。运行 `node tools/demo-video/check-authored.mjs --gestures` 检查导入、参考角度、真实拖放与叠加。之后运行 `npm run video:demo` 重新生成影片。
