# 可重复生成的中文游戏演示视频

默认输出 **72 秒、2560×1440、30 fps**。使用 Studio 浅色影片图形；游戏交互仍使用默认蓝图主题。
主体依照网站四段顺序：站里的风景 → 沿轨道出发 → 一格格搭起 → 人潮的一天。
片尾之前集中安排站内布置、城市风格和列车蒙太奇，再进入旋转拉远的配乐鸣谢画面。

## 分镜与内容

共 25 个镜头，包含动物园、坦尾和天河公园。天河公园包含唯一的动态剖切镜头、4 秒的十一号线站台穿行，以及 4.1 秒的地下五米站厅穿行。两段穿行实录四倍速模拟，客流调节以同一站厅为背景。视图方块镜头保留透视旋转。
站内布置与装饰合并成一段 23.5 秒的真实录屏。直接读取用户编辑的 `video/demo-station.metro.json`，保留坐标、ID、朝向、材质和海报配置。
先完成地面、墙面、楼层、玻璃及街道等骨架，再分组拖放道路侧围栏、盲道和闸机。站内玻璃围栏在售票机就位后铺设。相机保持低侧视角，从参考图一的站外朝西视角平滑转到参考图二的站厅朝东视角。
不含屋顶模型。空调机组保留在站外。围栏、盲道和铺装采用真实鼠标连续拖放，电梯在同一井道中向上叠加延长。
商店靠后墙，闸机形成连续票务边界，售票机在非付费区；扶梯、楼梯与电梯连接上层平台。
从空地到全部布置集中在后半段一个不间断镜头中。材质保留用户存档中的浅绿搪瓷墙面、混凝土地面及格栅板底，街道铺装与站厅有明确区分。

八种城市每种 0.4 秒，共 3.2 秒，连续旋转 180°；入口显示动物园 Zoo。
五种列车每种 0.8 秒，共 4 秒，在空地图的 1200 米长桥上运行，每种分配连续 30° 环绕。
车型采用广州一至五号线配色。展开视图保留墙壁并紧凑取景，动物园隐藏地下五米及地面层，坦尾隐藏地下五米层。

## 重新生成

从仓库根目录运行：

```powershell
npm run video:plan
npm run video:demo
```

默认目录：`.preview/demo-video/zh-studio-2k-v6/`。
需要 Node、Chrome、FFmpeg、FFprobe 和已安装的 game/web 依赖。正常命令先构建当前游戏，再录制和合成。

- `station-designer-demo-zh.mp4`：H.264/AAC 成片。
- `review.html`、`poster.jpg`、`contact-sheet.jpg`：播放与逐镜头审查。
- `storyboard.md`、`timeline.json`：中英文目录驱动的分镜。
- `takes/*/before.png`、`after.png`：实际录屏前后画面。
- `takes/*/stage.json`、`after-stage.json`：独立空白录制场景的真实文档状态。
- `takes/*/take.json`：原始帧时间、实际编辑时刻、相机轨迹及源码指纹。
- `sources/*.json`、`manifest.json`：游戏构建、脚本和素材来源。
- `CREDITS.md`、`audio-credits.json`：音乐与音效来源和授权。

## 局部录制与审片

```powershell
npm run video:demo -- --stills --scene montage-placement
npm run video:demo -- --skip-build --scene montage-placement,stock-A
npm run video:demo -- --design-only
npm run video:demo -- --edit-only
npm run video:demo -- --resume
node tools/demo-video/check-playback.mjs
node tools/demo-video/check-authored.mjs --gestures
node --test tools/demo-video/plan.test.mjs
```

`--skip-build` 仅在构建已与源代码一致时使用。`--edit-only` 明确重用已有录屏，再生成当前图形、混音与成片。
`--resume` 只重用源码、设置、镜头定义均匹配的缓存。重排且内容未变的片段可在审查原始素材和构建指纹后保留；每段仍记录自己的录制来源。
其他参数：`--lang zh|en`、`--output <目录>`、`--width <偶数>`、`--height <偶数>`、`--gpu hardware|software`、`--capture-only`。

## 维护与真实录制约束

`plan.mjs` 管理时间和顺序，`authored-layout.mjs` 读取原生存档并自动分组排序，`authored-shot.mjs` 管理真实建造和连续运镜，`video/demo-camera.json` 管理起止角度。
所有模块通过原生 `checkModulePlacements` 验证。整片室外铺装一次拖放，再逐块覆写草地。道路侧围栏先于站内玻璃围栏，售票机在玻璃围栏遮挡前摆放。连续的围栏、盲道、闸机及成排设备通过真实指针拖放；电梯通过真实点击上半段延伸。建造框架时关闭放置音效，设备与装饰落位时恢复。录制后逐字段比较全部方块与模型。
这些是独立录制场景内的游戏编辑，未使用后期贴图代替模型，也不写入玩家存档或原始示例站。
视图方块与客流窗口仍使用实际鼠标输入；列车由真实模拟运行，不注入姿态。

`fixtures.mjs` 和 `montage.mjs` 管理城市、长桥与连续镜头；`views.mjs` 管理剖切与视图操作。重录长桥时按顺序录制 `stock-A,stock-B,stock-C,stock-D,stock-L`。镜头以实际列车模型的车头为基准，每段从上一段的桥上切点继续。
`design.mjs` 生成透明 Studio 图形；所有影片文案留在 `web/src/i18n.js`，模型名称来自游戏目录翻译。
`catalogue.mjs` 读取现有性能表的模型清单，用于保留细节覆盖范围，不产生新的性能结论。
相机保留原生视野下限，需要更近时沿视线推进。静帧与录屏采用 Chrome 合成器，并在静帧前等待实际渲染。
预览用的完整布置静帧必须与真实录制素材分开保存，不得作为放置动画输入。

新增模型、改尺寸或改碰撞后，先跑布局验证，再检查实际放置记录、前后文档和录像；拒绝放置必须终止录制。

## 音乐与交付检查

音乐为《Sunset Plains》，作者 Yoiyami，CC0，来源 OpenGameArt。片尾保留 3.6 秒的鸣谢卡。
沿用游戏已有的人群、列车与交互音效，按实际编辑时间同步，在八倍速建造中保持正常音高。
检查 72 秒总时长、2560×1440、30 fps、标准八位 4:2:0、H.264/AAC、约 −18 LUFS 与不高于 −1 dBTP。
图形检查覆盖全部镜头。还需检查实际模型可见性、连续镜头、两端参考角度和浏览器播放。
此工具不部署网站。

## 用户可编辑的工作存档

`video/demo-station.metro.json` 是可直接通过游戏“打开”载入的原生存档，默认在站厅层打开。
`video/demo-camera.json` 记录低侧面运镜，旧 `demo-station-layout.json` 仅作历史记录。
录制每次输出自己的 `demo-station.metro.json` 快照；已有的 `video/` 工作存档及原始 ID 对照不会被覆盖。
用户编辑后直接替换工作存档，`authored-layout.mjs` 自动读取新位置、方向、拖放路径及模型增删，再验证和重录。
不要用生成器输出覆盖用户已修改的工作文件。

```powershell
node tools/demo-video/export-save.mjs
node tools/demo-video/check-authored.mjs --gestures
```

导出使用原生 `serialize` / `parse` 往返检查；`check-authored.mjs` 通过实际游戏文件输入打开存档，并在独立浏览器副本中验证所有连续拖放路径和电梯向上叠加。
