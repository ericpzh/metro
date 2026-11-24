# Tianhe Park Object Placement & Pick Latency Matrix

Real-click end-to-end **placement** and **pick** latency measured on **Tianhe Park (`tianhe`, 151,852 cells, 76,438 modules, 3 lines, 4 booths)** across every placeable object family (including all 5 rooms, 3 fare zones, 8 structural/cut modes, rail/tunnel/bridge, and all equipment & decor variants — **102 canonical cases**) under both **Paused (`0×`)** and **Live Peak Rush (`1×`, Mon 08:00 AM)** simulation speeds.

> All runs execute serially on hardware GPU (`NVIDIA GeForce RTX 4080 SUPER`, `Intel Core i7-14700KF`, `64 GB RAM`, `1600×900`, `high` detail/quality, `native` FSR, `1.0` render scale) using real pointer events (`CDP Input.dispatchMouseEvent`) and undo cleanup between every object so each measurement hits untouched Tianhe Park. Raw captures live in `.preview/perf/tianhe-object-latency/raw/` alongside `summary.json` and `matrix.csv`.

## Test Environment & Baseline

| Build | Speed | Commit | Runtime / Scripting / GPU | Canvas | Baseline FPS | Frame ms | OK / 102 | Local / Fallback | Unsupported / OOM |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| **Unity Desktop (.exe)** | Paused (0×) | `d019f4d2` | Unity 6000.6.8f1 / Mono / Direct3D12 (NVIDIA GeForce RTX 4080 SUPER) | 1600×900 | 243.9 | 4.10 | 99 / 102 | 74 / 25 | 3 / 0 |
| **Unity Desktop (.exe)** | Live (1×) | `d019f4d2` | Unity 6000.6.8f1 / Mono / Direct3D12 (NVIDIA GeForce RTX 4080 SUPER) | 1600×900 | 249.1 | 4.01 | 99 / 102 | 74 / 25 | 3 / 0 |
| **Unity WebGL** | Paused (0×) | `d019f4d2` | Unity 6000.6.8f1 / IL2CPP WASM / OpenGLES3 (ANGLE D3D11 RTX 4080 SUPER) | 1068×810 (in 1600×900) | 42.8 | 23.34 | 97 / 102 | 74 / 23 | 3 / 2 |
| **Unity WebGL** | Live (1×) | `d019f4d2` | Unity 6000.6.8f1 / IL2CPP WASM / OpenGLES3 (ANGLE D3D11 RTX 4080 SUPER) | 1068×810 (in 1600×900) | 48.5 | 20.60 | 97 / 102 | 74 / 23 | 3 / 2 |
| **Web (Three.js)** | Paused (0×) | `d019f4d2` | Chrome V8 / Three.js WebGL2 (ANGLE D3D11 RTX 4080 SUPER) | 1600×900 | 28.7 | 34.88 | 102 / 102 | 102 / 0 | 0 / 0 |
| **Web (Three.js)** | Live (1×) | `d019f4d2` | Chrome V8 / Three.js WebGL2 (ANGLE D3D11 RTX 4080 SUPER) | 1600×900 | 28.0 | 35.69 | 102 / 102 | 102 / 0 | 0 / 0 |

## Timing Boundaries

- **Trigger anchor (`t0`)**: Anchored to the exact input event that triggers the commit — `pointerdown` for single-press tools (e.g. gates, benches, ramps, rails, signs) or `pointerup` for drag/run/surface tools (e.g. rooms, zones, blocks, walls, fences, tactile, floor marks, roofs, roads, sidewalk/lawn) — so synthetic drag hold time is never charged as latency.
- **Unity Desktop (`.exe`) & Unity WebGL**:
  - **Place Present (`ms`)**: Native C# `Stopwatch` elapsed time from `StationGameHost.BrowserCommand` entry to `first-frame-presented` (`WaitForEndOfFrame` after URP `endCameraRendering`). This is the exact host click-to-rendered duration.
  - **Place Click→Reply (`ms`)**: Browser/WebView2 `pointerdown`/`pointerup` to `commit` message received in React shell (includes IPC round-trip + JSON serialization; noticeably exceeds `Place Present` when `delta: false` sends the full 16.8 MB Tianhe save on `sign` fallback).
  - **Pick (`Ack / UI`)**: Two numbers separated by `/` — **Host Ack (`ms`)** (`pointerdown` → Unity `ack` reply; Unity updates the 3D selection highlight / lifted ghost on the next frame) and **UI Adopt (`ms`)** (`pointerdown` → React shell reflects `carried` / `pick` / `selectionKey`). Note: `game/src/unity-web/stationBridge.ts` `reduce()` does not fold `payload.edit` on `kind === "ack"`, so React waits up to the 100 ms `stateIntervalSeconds` periodic state tick before updating UI controls.
- **Web (Three.js)**:
  - **Place Render / Present (`ms`)**: `pointerdown`/`pointerup` → completion of the first post-commit `WebGLRenderer.render()` call (includes synchronous Zustand commit, `useLayoutEffect`, `SceneRenderer.setStation` chunk/module/batch update, and WebGL draw submission) and the subsequent `requestAnimationFrame` swap (`Present`).
  - **Pick (`Render / Present`)**: `pointerdown` → first post-pick `WebGLRenderer.render()` completion (includes synchronous Zustand state adoption + `setMovingModule` / `setSelection`) and subsequent `requestAnimationFrame` swap.

## Overall Latency Summary (All Supported Objects)

| Build | Speed | Place P50 (ms) | Place Mean (ms) | Place P95 (ms) | Place Max (ms) | Local-Only P50 (ms) | Fallback P50 (ms) | Move Pick P50 (ms) | Eye/Sel Pick P50 (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Unity Desktop (.exe)** | Paused (0×) | 441.1 | 1982.9 | 6649.4 | 9586.0 | 235.2 | 6472.1 | 40.3 | 19.6 |
| **Unity Desktop (.exe)** | Live (1×) | 446.7 | 1990.8 | 6681.5 | 9519.0 | 233.2 | 6479.4 | 43.5 | 21.4 |
| **Unity WebGL** | Paused (0×) | 261.2 | 1484.5 | 5709.5 | 5865.2 | 194.4 | 5339.9 | 28.3 | 17.0 |
| **Unity WebGL** | Live (1×) | 287.0 | 1534.4 | 5888.6 | 6777.6 | 206.7 | 5464.3 | 28.4 | 16.9 |
| **Web (Three.js)** | Paused (0×) | 155.3 | 231.9 | 374.0 | 1369.3 | 155.3 | — | 66.0 | 30.9 |
| **Web (Three.js)** | Live (1×) | 168.6 | 244.3 | 386.3 | 1347.6 | 168.6 | — | 67.6 | 33.0 |

## Key Findings & Bottleneck Diagnosis

1. **Unity placement splits into 4 sharp latency tiers on Tianhe Park**:
   - **Tier 1 — Fast local edits (~45–300 ms)**: Wall-mounted billboards/monitors, ceiling lights/clocks/CCTV/TV/vents, fare zones, room zones (`store`/`toilet`/`office`), structural blocks/walls/cuts, fences, tactile strips, floor marks, walkways, lifts, outdoor paving/trees/roads/courts.
   - **Tier 2 — Heavy local edits (~430–1,320 ms, still `local: true`)**: 27 objects stay on the local retained-view path yet take 0.43–1.32 s (`stair-straight` 1327 ms, `stair-left90` 1318 ms, `escalator` 1287 ms, `shelf-dark-tall` 918 ms, `shelf-cooler` 885 ms, `tvm` 874 ms, etc.). C# `topStages` pinpoints two exact hotspots inside `StationEdit.StageLocalWorld`: rebuilding the shared equipment batch (`StageLocal.equipment` ~380–420 ms) and rebuilding station-wide contact shadows (`StageLocal.contact-shadows` ~240 ms) plus ramp corridor cell carving (`StageLocal.cells` ~380 ms on escalators/stairs).
   - **Tier 3 — Full-view fallback families (~6,200–6,900 ms)**: 23 objects trigger a full Tianhe view rebuild because their family is missing from Unity's local retained updater:
     - `local-module-family:booth` (2 cases, median **6407 ms**): `room:ticket`, `room:info`.
     - `local-module-family:track` (3 cases, median **6759 ms**): `platform`, `tunnel`, `bridge`.
     - `local-module-family:pillar` (2 cases, median **6399 ms**): `pillar-slim`, `pillar-thick`.
     - `local-module-family:roof` (5 cases, median **6478 ms**): `roof`, `roof-shell`, `roof-truss`, `roof-tapered`, `roof-canopy`.
     - `local-module-family:exit` (1 case, median **6647 ms**): `exit`.
     - `local-module-family:tv` (2 cases, median **6324 ms**): `tv`, `tv-double`.
     - `local-module-family:glass` (2 cases, median **6398 ms**): `glass-2x2`, `curtain-wall`.
     - `local-module-family:calligraphy` (1 case, median **6378 ms**): `calligraphy-wei-h`.
     - `local-module-family:linemap` (2 cases, median **6351 ms**): `linemap-wall`, `linemap-stand`.
     - `local-module-family:psd-end` (2 cases, median **6512 ms**): `psd-end`, `psd-end-cover`.
     - `local-module-family:guidepost` (1 case, median **6649 ms**): `guidepost`.
   - **Tier 4 — Sign full-document + full-sim fallback (~9,488–9,586 ms host present / ~11,400 ms click→reply, ~1.05 GB allocated)**: `sign-ceiling` and `sign-wall` hit `local-sign-repair + full-stage-install` with `delta: false`, forcing a full 76k-module rebuild plus 16.8 MB full-save JSON serialization over IPC.
2. **Paused (0×) vs Live Peak Rush (1×) delta (Unity Desktop)**: Median placement stays closely aligned (Paused P50 **441.1 ms** vs 1× P50 **446.7 ms**; mean 1982.9 ms vs 1990.8 ms), with live crowd/train updates adding minor frame-budget variance rather than changing algorithmic tier.
3. **Pick latency — Unity host `ack` vs React UI adoption gap**: On Unity Desktop, real-click host `ack` (when 3D pick/selection/lift occurs) is **19.6 ms** median for Eyedropper/Select and **40.3 ms** median for Move pickup, whereas React UI adoption lags to **94.5 ms** median (45–125 ms range) because `stationBridge.ts` `reduce()` omits `payload.edit` when processing `kind === 'ack'` and waits for the 100 ms periodic `state` publish.
4. **Unity placement parity gaps detected**: `exit-doorway-1`, `exit-virtual`, and `traffic-light` return `blocked: no-candidate` in Unity (`StationModuleFamilies.TryParse` does not parse them yet) while placing cleanly in Web Three.js.
5. **Web (Three.js) comparison**: Median click-to-render placement is **155.3 ms** (Paused) / **168.6 ms** (1×) — 2.8× faster at P50 and 8.5× faster at mean than Unity Desktop, with **102/102** objects succeeding and P95 at **374.0 ms** / **386.3 ms**. Only 4 outliers exceed 900 ms (`block/auto-walls` 1369 ms / 1348 ms, `wall` 1207 ms / 1324 ms, `checkout` 1067 ms / 1057 ms, `checkout-cafe-pastry` 960 ms / 1013 ms). Pick rendering takes **66.0 ms** (Move) and **30.9 ms** (Eyedropper/Select) at Paused (and ~100–145 ms to post-swap rAF present at ~28.5 FPS).
6. **Unity WebGL (IL2CPP WASM) vs Unity Desktop (Mono)**: Median host-present placement is **261.2 ms** (Paused) / **287.0 ms** (1×), with local edits at **194.4 ms** and full-rebuild fallbacks at **5339.9 ms** (Paused). Notably, Unity WebGL compiles C# with **IL2CPP AOT (WASM)** whereas the shipped Windows `.exe` uses **Mono** (`MonoBleedingEdge`), making heavy C# rebuild stages (`StationEdit.Build`, `StageLocal.equipment`, `StageLocal.contact-shadows`) ~1.4×–1.7× faster on WebGL despite ~1.8 s of WebGL2 first-frame GPU upload after full rebuilds. However, WebGL is bounded by the 32-bit WASM heap ceiling: `sign-ceiling` and `sign-wall` deterministically crash with `abort("OOM") at abortOnCannotGrowMemory` even in a fresh tab because `local-sign-repair` + `full-stage-install` allocates ~1.05 GB in a single frame.

## Category Summary (Median Place / Median Eye-Sel Pick, ms)

| Category | Cases | Unity Exe 0× Place P50 | Unity Exe 0× Place Max | Unity Exe 0× Pick P50 | Unity Exe 1× Place P50 | Unity Exe 1× Place Max | Unity Exe 1× Pick P50 | Unity WebGL 0× Place P50 | Unity WebGL 0× Place Max | Unity WebGL 0× Pick P50 | Unity WebGL 1× Place P50 | Unity WebGL 1× Place Max | Unity WebGL 1× Pick P50 | Web 0× Place P50 | Web 0× Place Max | Web 0× Pick P50 | Web 1× Place P50 | Web 1× Place Max | Web 1× Pick P50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rooms (房间/亭) | 5 | 208.0 | 6451.2 | 17.3 | 194.3 | 6525.9 | 18.3 | 152.7 | 5407.5 | 15.4 | 183.1 | 6280.2 | 18.0 | 293.0 | 335.8 | 47.3 | 320.7 | 340.2 | 51.9 |
| Fare Zones (分区) | 3 | 179.5 | 616.6 | 16.5 | 173.8 | 565.7 | 17.1 | 147.3 | 421.8 | 14.3 | 158.9 | 445.0 | 14.6 | 353.0 | 353.1 | 46.1 | 298.2 | 327.6 | 47.5 |
| Structural & Roofs (结构/屋顶) | 15 | 375.4 | 6532.3 | 19.0 | 424.5 | 6488.5 | 20.3 | 292.1 | 5772.5 | 16.0 | 335.7 | 5995.6 | 15.2 | 173.7 | 1369.3 | 49.7 | 197.7 | 1347.6 | 48.7 |
| Rail / Tunnel / Bridge (轨道) | 3 | 6758.6 | 6841.3 | 23.7 | 6912.0 | 6979.6 | 29.7 | 5105.5 | 5825.1 | 17.3 | 5520.2 | 5561.0 | 18.0 | 374.0 | 406.5 | 39.3 | 386.3 | 479.5 | 50.3 |
| Equipment & Vertical (设备/扶梯/电梯/出入口) | 15 | 343.8 | 6647.3 | 20.6 | 362.9 | 6535.6 | 21.9 | 261.2 | 5707.4 | 17.2 | 253.2 | 5888.6 | 16.7 | 218.9 | 352.8 | 30.9 | 239.8 | 385.9 | 33.0 |
| Decor — Ceiling (吊顶装饰) | 13 | 469.6 | 9488.0 | 19.6 | 440.5 | 9462.0 | 21.0 | 314.3 | 5277.1 | 16.8 | 345.4 | 5464.3 | 16.8 | 146.9 | 254.2 | 30.3 | 158.4 | 177.5 | 31.0 |
| Decor — Wall (壁挂装饰) | 8 | 70.3 | 9586.0 | 19.2 | 64.9 | 9519.0 | 20.7 | 110.3 | 5676.3 | 16.8 | 116.7 | 5848.8 | 17.1 | 146.4 | 252.2 | 28.6 | 164.3 | 206.3 | 29.3 |
| Decor — Floor (地面装饰) | 29 | 696.4 | 6603.4 | 19.5 | 701.4 | 6648.4 | 21.7 | 413.7 | 5865.2 | 17.3 | 435.6 | 6777.6 | 17.2 | 149.4 | 1066.8 | 29.9 | 162.5 | 1057.0 | 31.4 |
| Decor — Outdoor (室外设施) | 11 | 235.2 | 6649.4 | 21.7 | 233.2 | 6595.3 | 23.5 | 196.0 | 5347.7 | 16.6 | 222.4 | 6770.3 | 16.5 | 213.4 | 347.8 | 37.0 | 217.7 | 377.1 | 43.4 |

## Complete 102-Object Placement Latency Matrix (ms, Click → Rendered)

_Unity columns show native C# `first-frame-presented` (`hostPresentMs`); Web columns show click → first post-commit `WebGLRenderer.render()` completion (`clickToFirstRenderEndMs`)._

| # | Object ID | Label | Category | Gesture | Unity Exe 0× | Unity Exe 1× | Unity WebGL 0× | Unity WebGL 1× | Web 0× | Web 1× | Unity Path / Fallback | Unity Top Stage (Paused) |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | `room:ticket` | Ticket Booth (售票亭) | room | drag | 6451.2 | 6525.9 | 5407.5 | 5883.0 | 287.8 | 320.7 | `local-module-family:booth` | `StationEdit.Build` (6044 ms) |
| 2 | `room:info` | Info Desk (客服中心) | room | drag | 6406.7 | 6406.9 | 5297.0 | 6280.2 | 241.7 | 253.6 | `local-module-family:booth` | `StationEdit.Build` (6038 ms) |
| 3 | `room:store` | Store Room Zone (商铺) | room | drag | 195.8 | 194.3 | 152.7 | 183.1 | 335.8 | 340.2 | `local` | `StationEdit.CommitInstall` (122 ms) |
| 4 | `room:toilet` | Restroom Zone (卫生间) | room | drag | 166.8 | 174.8 | 147.0 | 168.4 | 293.0 | 304.2 | `local` | `StationEdit.CommitInstall` (129 ms) |
| 5 | `room:office` | Office Room Zone (办公区) | room | drag | 208.0 | 171.1 | 145.4 | 151.4 | 330.6 | 327.1 | `local` | `StationEdit.CommitInstall` (138 ms) |
| 6 | `zone:unpaid` | Unpaid Zone (非付费区) | zone | drag | 616.6 | 565.7 | 421.8 | 445.0 | 353.0 | 327.6 | `local` | `StationEdit.StageLocalWorld` (417 ms) |
| 7 | `zone:paid` | Paid Zone (付费区) | zone | drag | 165.0 | 171.7 | 147.3 | 158.9 | 353.1 | 298.2 | `local` | `StationEdit.CommitInstall` (127 ms) |
| 8 | `zone:none` | Erase Zone (无分区) | zone | drag | 179.5 | 173.8 | 144.2 | 152.1 | 236.5 | 248.8 | `local` | `StationEdit.CommitInstall` (133 ms) |
| 9 | `block` | Block (方块) | structural | tap | 172.9 | 169.7 | 161.7 | 165.3 | 197.3 | 204.7 | `local` | `StationEdit.CellFinish` (152 ms) |
| 10 | `block/auto-walls` | Floor + Auto-Walls (自动墙) | structural | tap-hold | 375.4 | 424.5 | 292.1 | 335.7 | 1369.3 | 1347.6 | `local` | `StationEdit.CellFinish` (356 ms) |
| 11 | `wall` | Wall Column 4m (墙) | structural | tap | 165.6 | 173.4 | 156.1 | 164.9 | 1206.6 | 1324.4 | `local` | `StationEdit.CellFinish` (146 ms) |
| 12 | `half-wall` | Half Wall (半墙) | structural | tap | 160.3 | 224.7 | 158.7 | 161.5 | 131.9 | 152.9 | `local` | `StationEdit.CellFinish` (142 ms) |
| 13 | `half-corner` | Half Wall Corner (半墙角) | structural | tap | 165.3 | 169.3 | 162.7 | 164.0 | 132.8 | 153.9 | `local` | `StationEdit.CellFinish` (146 ms) |
| 14 | `tri-upper` | Upper Wedge (三角上) | structural | tap | 162.8 | 177.1 | 158.8 | 165.5 | 207.0 | 221.8 | `local` | `StationEdit.CellFinish` (144 ms) |
| 15 | `tri-lower` | Lower Wedge (三角下) | structural | tap | 162.3 | 173.5 | 160.6 | 163.6 | 149.4 | 150.8 | `local` | `StationEdit.CellFinish` (143 ms) |
| 16 | `suspended-ceiling` | Suspended Ceiling (吊顶) | structural | tap | 160.2 | 169.2 | 158.6 | 164.2 | 151.6 | 177.7 | `local` | `StationEdit.CellFinish` (141 ms) |
| 17 | `platform` | Platform Track (站台轨道) | rail | tap | 6622.0 | 6681.5 | 5825.1 | 5561.0 | 406.5 | 479.5 | `local-module-family:track` | `StationEdit.Build` (5974 ms) |
| 18 | `tunnel` | Tunnel Extension (隧道) | rail | tap | 6841.3 | 6979.6 | 5009.4 | 5520.2 | 374.0 | 386.3 | `local-module-family:track` | `StationEdit.Build` (6005 ms) |
| 19 | `bridge` | Railway Bridge (轨道桥) | rail | tap | 6758.6 | 6912.0 | 5105.5 | 5453.5 | 276.7 | 277.5 | `local-module-family:track` | `StationEdit.Build` (6075 ms) |
| 20 | `pillar-slim` | Slim Pillar (细柱) | structural | tap | 6399.0 | 6467.2 | 4739.5 | 5995.6 | 165.7 | 181.6 | `local-module-family:pillar` | `StationEdit.Build` (5976 ms) |
| 21 | `pillar-thick` | Thick Pillar (粗柱) | structural | tap | 6426.9 | 6431.8 | 5772.5 | 5760.7 | 153.4 | 171.5 | `local-module-family:pillar` | `StationEdit.Build` (6057 ms) |
| 22 | `roof` | Roof Slab (屋顶板) | structural | tap | 6452.3 | 6393.2 | 5570.7 | 5385.9 | 240.7 | 233.9 | `local-module-family:roof` | `StationEdit.Build` (6045 ms) |
| 23 | `roof-shell` | Roof Shell (无桁架屋顶) | structural | tap | 6516.5 | 6464.1 | 5709.5 | 5353.1 | 183.7 | 204.1 | `local-module-family:roof` | `StationEdit.Build` (6109 ms) |
| 24 | `roof-truss` | Roof Truss (桁架屋顶) | structural | tap | 6477.8 | 6488.5 | 5735.6 | 5307.6 | 173.7 | 190.5 | `local-module-family:roof` | `StationEdit.Build` (6048 ms) |
| 25 | `roof-tapered` | Roof Tapered Truss (锥形桁架) | structural | tap | 6472.1 | 6421.0 | 5223.3 | 5410.1 | 163.7 | 197.7 | `local-module-family:roof` | `StationEdit.Build` (6046 ms) |
| 26 | `roof-canopy` | Roof Column Canopy (雨棚) | structural | tap | 6532.3 | 6461.4 | 5286.7 | 5195.7 | 219.8 | 200.1 | `local-module-family:roof` | `StationEdit.Build` (6107 ms) |
| 27 | `gate` | Fare Gate Old (旧闸机) | equipment | tap | 558.4 | 566.8 | 331.0 | 335.7 | 150.6 | 167.9 | `local` | `StationEdit.StageLocalWorld` (350 ms) |
| 28 | `gate-new` | Fare Gate New (新闸机) | equipment | tap | 541.2 | 604.0 | 329.4 | 293.7 | 152.4 | 161.4 | `local` | `StationEdit.StageLocalWorld` (338 ms) |
| 29 | `fence` | Glass Fence (玻璃围栏) | equipment | tap | 187.5 | 187.7 | 167.2 | 202.1 | 146.6 | 158.0 | `local` | `StationEdit.CellFinish` (168 ms) |
| 30 | `fence-gate` | Fence Door (围栏门) | equipment | tap | 184.4 | 191.1 | 172.0 | 164.6 | 143.3 | 159.3 | `local` | `StationEdit.CellFinish` (166 ms) |
| 31 | `fence-steel-blue` | Blue Steel Fence (蓝钢围栏) | equipment | tap | 225.9 | 187.0 | 159.7 | 165.7 | 146.5 | 158.3 | `local` | `StationEdit.CellFinish` (207 ms) |
| 32 | `fence-iron` | Iron Fence (铁艺围栏) | equipment | tap | 182.6 | 188.1 | 180.9 | 189.7 | 147.7 | 148.6 | `local` | `StationEdit.CellFinish` (164 ms) |
| 33 | `escalator` | Escalator (扶梯) | equipment | tap | 1287.3 | 1256.9 | 1038.8 | 1011.8 | 352.8 | 385.9 | `local` | `StationEdit.StageLocalWorld` (819 ms) |
| 34 | `walkway` | Moving Walkway (自动步道) | equipment | tap | 275.6 | 350.9 | 252.2 | 253.2 | 218.9 | 239.8 | `local` | `StationEdit.CommitInstall` (117 ms) |
| 35 | `lift` | Lift / Elevator (电梯) | equipment | tap | 280.5 | 319.5 | 261.2 | 240.2 | 327.9 | 318.8 | `local` | `StationEdit.CommitInstall` (116 ms) |
| 36 | `stair-straight` | Straight Stairs (直跑楼梯) | equipment | tap | 1327.3 | 1259.3 | 990.3 | 840.7 | 327.2 | 331.3 | `local` | `StationEdit.StageLocalWorld` (836 ms) |
| 37 | `stair-block` | Stair Block (楼梯块) | equipment | tap | 343.8 | 362.9 | 243.7 | 241.3 | 149.2 | 161.5 | `local` | `StationEdit.StageLocalWorld` (146 ms) |
| 38 | `stair-left90` | Turning Stairs 90° (左转楼梯) | equipment | tap | 1318.2 | 1245.5 | 842.3 | 844.3 | 314.5 | 360.8 | `local` | `StationEdit.StageLocalWorld` (871 ms) |
| 39 | `exit` | Covered Exit (有棚出入口) | equipment | tap | 6647.3 | 6535.6 | 5707.4 | 5888.6 | 278.4 | 308.7 | `local-module-family:exit` | `StationEdit.Build` (6173 ms) |
| 40 | `exit-doorway-1` | Ground Doorway Exit (地面出入口) | equipment | tap | unsupported | unsupported | unsupported | unsupported | 294.6 | 303.2 | `unsupported` | — |
| 41 | `exit-virtual` | Virtual Exit (虚拟出入口) | equipment | tap | unsupported | unsupported | unsupported | unsupported | 287.6 | 318.4 | `unsupported` | — |
| 42 | `sign-ceiling` | Overhead Sign (吊挂指示牌) | decor-ceiling | tap | 9488.0 | 9462.0 | **WASM OOM** | **WASM OOM** | 254.2 | 177.5 | `local-sign-repair + full-stage-install` | `StationEdit.Build` (6081 ms) |
| 43 | `tv` | Single Ceiling TV (单面电视) | decor-ceiling | tap | 6324.1 | 6420.9 | 5277.1 | 5464.3 | 146.3 | 161.2 | `local-module-family:tv` | `StationEdit.Build` (6085 ms) |
| 44 | `tv-double` | Double Ceiling TV (双面电视) | decor-ceiling | tap | 6410.6 | 6334.0 | 5097.4 | 4843.0 | 160.2 | 165.8 | `local-module-family:tv` | `StationEdit.Build` (6177 ms) |
| 45 | `monitor-ceiling` | Ceiling Monitor (吊顶显示器) | decor-ceiling | tap | 49.1 | 58.4 | 107.6 | 109.4 | 136.7 | 149.3 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 46 | `clock` | Analogue Clock (指针时钟) | decor-ceiling | tap | 53.4 | 54.6 | 74.8 | 88.9 | 155.8 | 169.4 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 47 | `clock-digital` | Digital Clock (数字时钟) | decor-ceiling | tap | 49.9 | 76.8 | 72.6 | 73.9 | 146.9 | 153.5 | `local` | `StationEdit.StageLocalInstall` (12 ms) |
| 48 | `cctv` | Bullet CCTV (枪机监控) | decor-ceiling | tap | 469.6 | 437.1 | 360.1 | 349.3 | 147.9 | 158.2 | `local` | `StationEdit.StageLocalWorld` (418 ms) |
| 49 | `cctv-ptz` | PTZ CCTV (球机监控) | decor-ceiling | tap | 479.6 | 446.7 | 357.6 | 350.1 | 147.3 | 159.9 | `local` | `StationEdit.StageLocalWorld` (420 ms) |
| 50 | `cctv-dome` | Dome CCTV (半球监控) | decor-ceiling | tap | 467.8 | 440.5 | 333.1 | 362.3 | 152.0 | 162.3 | `local` | `StationEdit.StageLocalWorld` (417 ms) |
| 51 | `light-circular` | Circular Light (圆灯) | decor-ceiling | tap | 474.2 | 448.5 | 314.3 | 348.5 | 143.7 | 150.8 | `local` | `StationEdit.StageLocalWorld` (417 ms) |
| 52 | `light-rectangular` | Strip Light (条灯) | decor-ceiling | tap | 492.8 | 447.4 | 350.3 | 345.4 | 138.4 | 153.4 | `local` | `StationEdit.StageLocalWorld` (419 ms) |
| 53 | `vent` | Ceiling Vent (通风口) | decor-ceiling | tap | 50.0 | 50.3 | 71.7 | 73.3 | 141.4 | 148.8 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 54 | `hanger-roof` | Roof Hanger (吊顶挂架) | decor-ceiling | tap | 56.9 | 65.0 | 74.1 | 78.4 | 143.5 | 158.4 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 55 | `sign-wall` | Wall Sign (壁挂指示牌) | decor-wall | tap | 9586.0 | 9519.0 | **WASM OOM** | **WASM OOM** | 135.2 | 167.1 | `local-sign-repair + full-stage-install` | `StationEdit.Build` (6160 ms) |
| 56 | `billboard-wide` | Billboard 16:9 (广告牌) | decor-wall | tap | 47.6 | 64.9 | 110.3 | 116.7 | 141.0 | 149.5 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 57 | `billboard-16x9-4m` | Large Billboard 4m (大型广告牌) | decor-wall | tap | 54.0 | 49.0 | 73.2 | 71.3 | 252.2 | 206.3 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 58 | `glass-2x2` | Wall Glass 2×2 (玻璃板) | decor-wall | tap | 6398.1 | 6333.9 | 5676.3 | 5629.6 | 150.6 | 166.4 | `local-module-family:glass` | `StationEdit.Build` (6162 ms) |
| 59 | `calligraphy-wei-h` | Station Name Calligraphy (站名书法) | decor-wall | tap | 6377.7 | 6384.6 | 5270.4 | 5848.8 | 153.7 | 164.3 | `local-module-family:calligraphy` | `StationEdit.Build` (6101 ms) |
| 60 | `linemap-wall` | Wall Network Map (壁挂线网图) | decor-wall | tap | 6351.3 | 6435.4 | 5305.7 | 5299.0 | 141.8 | 166.5 | `local-module-family:linemap` | `StationEdit.Build` (6085 ms) |
| 61 | `monitor-wall` | Wall Monitor (壁挂显示器) | decor-wall | tap | 48.2 | 50.8 | 80.2 | 115.2 | 150.8 | 159.7 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 62 | `urinal` | Urinal (小便池) | decor-wall | tap | 70.3 | 50.3 | 69.7 | 76.0 | 146.4 | 160.3 | `local` | `StationEdit.StageLocalInstall` (33 ms) |
| 63 | `tvm` | Ticket Machine (售票机) | decor-floor | tap | 873.7 | 890.0 | 539.7 | 563.9 | 152.1 | 168.6 | `local` | `StationEdit.StageLocalWorld` (662 ms) |
| 64 | `vending` | Vending Machine (自动售货机) | decor-floor | tap | 859.1 | 874.6 | 548.4 | 548.6 | 150.4 | 166.0 | `local` | `StationEdit.StageLocalWorld` (657 ms) |
| 65 | `hanger-post` | Post Hanger (立柱挂架) | decor-floor | tap | 511.3 | 561.1 | 256.4 | 267.6 | 157.5 | 173.9 | `local` | `StationEdit.StageLocalWorld` (247 ms) |
| 66 | `electrical-cabinet` | Equipment Cabinet (设备柜) | decor-floor | tap | 863.5 | 883.0 | 517.9 | 538.0 | 152.7 | 170.1 | `local` | `StationEdit.StageLocalWorld` (654 ms) |
| 67 | `tactile-guide` | Tactile Guide (行进盲道) | decor-floor | tap | 140.9 | 150.6 | 122.2 | 104.5 | 166.0 | 194.7 | `local` | `StationEdit.CellFinish` (122 ms) |
| 68 | `tactile-warning` | Tactile Warning (提示盲道) | decor-floor | tap | 141.2 | 145.4 | 90.0 | 93.4 | 148.2 | 159.2 | `local` | `StationEdit.CellFinish` (122 ms) |
| 69 | `tactile-warning-strip` | Tactile Warning Strip (条状盲道) | decor-floor | tap | 152.9 | 143.1 | 90.8 | 93.9 | 146.1 | 169.1 | `local` | `StationEdit.CellFinish` (129 ms) |
| 70 | `floor-mark-boarding` | Boarding Arrows (候车箭头) | decor-floor | tap | 141.2 | 154.5 | 89.9 | 113.5 | 155.3 | 162.8 | `local` | `StationEdit.CellFinish` (122 ms) |
| 71 | `floor-mark-waiting` | Queue Lines (排队线) | decor-floor | tap | 142.0 | 145.0 | 90.1 | 98.0 | 149.4 | 158.0 | `local` | `StationEdit.CellFinish` (123 ms) |
| 72 | `floor-mark-direction` | Direction Guide (方向指引) | decor-floor | tap | 142.0 | 144.1 | 89.0 | 94.9 | 149.1 | 162.1 | `local` | `StationEdit.CellFinish` (123 ms) |
| 73 | `bench-steel-1` | Steel Bench (不锈钢座椅) | decor-floor | tap | 864.6 | 938.3 | 517.3 | 560.6 | 146.0 | 166.0 | `local` | `StationEdit.StageLocalWorld` (655 ms) |
| 74 | `bench-wood-1` | Wooden Bench (木座椅) | decor-floor | tap | 440.4 | 473.6 | 280.7 | 268.4 | 142.4 | 154.6 | `local` | `StationEdit.StageLocalWorld` (237 ms) |
| 75 | `shelf-dark-tall` | Tall Retail Shelf (高货架) | decor-floor | tap | 917.7 | 870.9 | 510.6 | 564.8 | 164.1 | 165.7 | `local` | `StationEdit.StageLocalWorld` (658 ms) |
| 76 | `shelf-cooler` | Cooler Shelf (冷柜货架) | decor-floor | tap | 884.8 | 909.8 | 514.7 | 597.2 | 154.0 | 166.3 | `local` | `StationEdit.StageLocalWorld` (651 ms) |
| 77 | `desk` | Office Desk (办公桌) | decor-floor | tap | 725.0 | 701.4 | 414.5 | 435.6 | 165.3 | 162.5 | `local` | `StationEdit.StageLocalWorld` (653 ms) |
| 78 | `checkout` | Shop Checkout (收银台) | decor-floor | tap | 848.8 | 861.2 | 515.9 | 546.1 | 1066.8 | 1057.0 | `local` | `StationEdit.StageLocalWorld` (654 ms) |
| 79 | `checkout-cafe-pastry` | Cafe Pastry Counter (烘焙柜台) | decor-floor | tap | 441.1 | 465.4 | 251.9 | 287.0 | 960.4 | 1012.9 | `local` | `StationEdit.StageLocalWorld` (238 ms) |
| 80 | `cubicle` | Toilet Cubicle (厕所隔间) | decor-floor | tap | 436.2 | 499.9 | 253.6 | 319.7 | 149.5 | 163.4 | `local` | `StationEdit.StageLocalWorld` (238 ms) |
| 81 | `cubicle-toilet` | Standalone Toilet (独立马桶) | decor-floor | tap | 496.8 | 462.7 | 259.5 | 260.5 | 143.1 | 161.5 | `local` | `StationEdit.StageLocalWorld` (237 ms) |
| 82 | `sink` | Restroom Sink (洗手池) | decor-floor | tap | 863.2 | 933.0 | 519.3 | 527.8 | 147.5 | 159.8 | `local` | `StationEdit.StageLocalWorld` (650 ms) |
| 83 | `bin` | Trash Bin (垃圾桶) | decor-floor | tap | 696.4 | 702.9 | 415.3 | 437.4 | 153.4 | 158.6 | `local` | `StationEdit.StageLocalWorld` (648 ms) |
| 84 | `extinguisher` | Fire Cabinet (灭火器箱) | decor-floor | tap | 708.4 | 717.1 | 413.7 | 440.8 | 146.9 | 159.6 | `local` | `StationEdit.StageLocalWorld` (652 ms) |
| 85 | `curtain-wall` | Glass Curtain Wall (玻璃幕墙) | decor-floor | tap | 6413.1 | 6479.4 | 5061.0 | 4876.5 | 146.7 | 157.2 | `local-module-family:glass` | `StationEdit.Build` (6142 ms) |
| 86 | `psd-end` | PSD End Door (屏蔽端门) | decor-floor | tap | 6511.9 | 6648.4 | 5339.9 | 5161.6 | 149.1 | 158.6 | `local-module-family:psd-end` | `StationEdit.Build` (6117 ms) |
| 87 | `psd-end-cover` | PSD Screen Cover (屏蔽门盖板) | decor-floor | tap | 6603.4 | 6600.1 | 5627.7 | 4701.6 | 162.8 | 160.6 | `local-module-family:psd-end` | `StationEdit.Build` (6176 ms) |
| 88 | `rail-signal` | Rail Signal (信号机) | decor-floor | tap | 295.4 | 307.9 | 185.9 | 198.6 | 147.1 | 163.5 | `local` | `StationEdit.StageLocalWorld` (244 ms) |
| 89 | `linemap-stand` | Standing Network Map (立式线网图) | decor-floor | tap | 6352.0 | 6496.6 | 5865.2 | 6777.6 | 144.3 | 158.9 | `local-module-family:linemap` | `StationEdit.Build` (6111 ms) |
| 90 | `door-steel-1` | Steel Doorway (不锈钢门) | decor-floor | tap | 295.7 | 315.0 | 210.6 | 231.9 | 148.8 | 153.4 | `local` | `StationEdit.CommitInstall` (115 ms) |
| 91 | `noise-barrier` | Noise Barrier (全高声屏障) | decor-floor | tap | 186.3 | 220.1 | 164.5 | 175.0 | 145.6 | 154.3 | `local` | `StationEdit.CellFinish` (168 ms) |
| 92 | `sidewalk` | Sidewalk Tile (人行道) | decor-outdoor | tap | 236.3 | 258.0 | 194.4 | 202.7 | 245.9 | 249.3 | `local` | `StationEdit.CommitInstall` (139 ms) |
| 93 | `lawn` | Lawn Tile (草坪) | decor-outdoor | tap | 235.2 | 232.6 | 198.8 | 236.6 | 225.2 | 253.0 | `local` | `StationEdit.CommitInstall` (143 ms) |
| 94 | `tree` | Street Tree (行道树) | decor-outdoor | tap | 222.5 | 233.2 | 300.6 | 295.0 | 233.5 | 249.7 | `local` | `StationEdit.CommitInstall` (142 ms) |
| 95 | `road` | Road Segment 14m (道路) | decor-outdoor | drag | 253.9 | 261.5 | 197.3 | 222.4 | 347.8 | 377.1 | `local` | `StationEdit.CommitInstall` (142 ms) |
| 96 | `traffic-light` | Traffic Light (红绿灯) | decor-outdoor | tap | unsupported | unsupported | unsupported | unsupported | 192.6 | 206.6 | `unsupported` | — |
| 97 | `ac-unit` | Outdoor AC Unit (空调外机) | decor-outdoor | tap | 229.9 | 242.3 | 196.0 | 236.4 | 213.4 | 217.7 | `local` | `StationEdit.CommitInstall` (140 ms) |
| 98 | `guidepost` | Wayfinding Post (导向柱) | decor-outdoor | tap | 6649.4 | 6595.3 | 5347.7 | 6770.3 | 191.9 | 210.0 | `local-module-family:guidepost` | `StationEdit.Build` (6221 ms) |
| 99 | `busstop-short` | Bus Stop Shelter (公交站) | decor-outdoor | tap | 249.8 | 232.6 | 231.3 | 226.4 | 200.2 | 206.2 | `local` | `StationEdit.CommitInstall` (143 ms) |
| 100 | `cctv-post` | Outdoor Post CCTV (立柱监控) | decor-outdoor | tap | 219.7 | 237.4 | 194.0 | 206.7 | 186.6 | 212.8 | `local` | `StationEdit.CommitInstall` (140 ms) |
| 101 | `court-pickleball` | Pickleball Court (匹克球场) | decor-outdoor | tap | 276.4 | 231.9 | 192.9 | 194.4 | 265.5 | 283.0 | `local` | `StationEdit.CommitInstall` (154 ms) |
| 102 | `court-divider` | Court Divider Net (球场分隔网) | decor-outdoor | tap | 208.5 | 221.0 | 183.8 | 194.9 | 182.6 | 202.6 | `local` | `StationEdit.CellFinish` (188 ms) |

## Complete 102-Object Pick Latency Matrix (ms, Click → Picked / Rendered)

_Format: Unity columns show `Host Ack / React UI Adopt` ms (`n/a` when object is a cell/zone with no movable module); Web columns show `Render End / Presented` ms._

| # | Object ID | Category | Unity Exe 0× Move | Unity Exe 0× Eye/Sel | Unity Exe 1× Move | Unity Exe 1× Eye/Sel | Unity WebGL 0× Move | Unity WebGL 0× Eye/Sel | Unity WebGL 1× Move | Unity WebGL 1× Eye/Sel | Web 0× Move | Web 0× Eye/Sel | Web 1× Move | Web 1× Eye/Sel |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `room:ticket` | room | 38.7 / 62.8 | 20.8 / 85.0 | 38.8 / 79.0 | 22.5 / 89.6 | 25.8 / 68.3 | 16.8 / 77.0 | 27.5 / 66.1 | 18.0 / 67.6 | n/a | 34.8 / 94.0 | n/a | 34.6 / 109.5 |
| 2 | `room:info` | room | 27.8 / 46.0 | 18.8 / 88.1 | 28.7 / 91.8 | 20.3 / 91.7 | 23.7 / 73.3 | 16.6 / 66.4 | 41.8 / 90.6 | 18.1 / 87.2 | n/a | 41.2 / 149.4 | n/a | 36.0 / 111.2 |
| 3 | `room:store` | room | n/a | 16.7 / 66.9 | n/a | 18.3 / 81.2 | n/a | 14.8 / 72.3 | n/a | 18.0 / 86.3 | n/a | 56.3 / 139.7 | n/a | 55.5 / 167.9 |
| 4 | `room:toilet` | room | n/a | 17.0 / 61.5 | n/a | 17.6 / 70.1 | n/a | 15.4 / 74.3 | n/a | 14.8 / 80.0 | n/a | 51.9 / 134.0 | n/a | 53.8 / 156.2 |
| 5 | `room:office` | room | n/a | 17.3 / 76.0 | n/a | 16.9 / 65.7 | n/a | 14.3 / 75.1 | n/a | 15.1 / 80.1 | n/a | 47.3 / 131.0 | n/a | 51.9 / 115.1 |
| 6 | `zone:unpaid` | zone | n/a | 16.3 / 57.1 | n/a | 18.4 / 77.7 | n/a | 14.3 / 102.8 | n/a | 15.1 / 78.5 | n/a | 29.1 / 131.7 | n/a | 29.1 / 86.0 |
| 7 | `zone:paid` | zone | n/a | 18.2 / 63.7 | n/a | 17.1 / 63.2 | n/a | 14.1 / 72.9 | n/a | 14.5 / 65.8 | n/a | 49.3 / 110.4 | n/a | 47.5 / 149.6 |
| 8 | `zone:none` | zone | n/a | 16.5 / 80.6 | n/a | 16.4 / 64.9 | n/a | 14.3 / 57.7 | n/a | 14.6 / 90.1 | n/a | 46.1 / 127.8 | n/a | 49.8 / 128.5 |
| 9 | `block` | structural | n/a | 16.6 / 62.1 | n/a | 17.0 / 63.5 | n/a | 14.4 / 135.5 | n/a | 14.6 / 79.9 | n/a | 46.6 / 102.8 | n/a | 46.9 / 115.8 |
| 10 | `block/auto-walls` | structural | n/a | 17.3 / 70.5 | n/a | 18.0 / 75.1 | n/a | 14.2 / 71.6 | n/a | 14.8 / 76.8 | n/a | 46.0 / 109.7 | n/a | 44.8 / 129.6 |
| 11 | `wall` | structural | n/a | 16.6 / 62.5 | n/a | 16.2 / 55.3 | n/a | 14.4 / 66.8 | n/a | 14.7 / 63.0 | n/a | 49.1 / 131.8 | n/a | 48.8 / 146.3 |
| 12 | `half-wall` | structural | n/a | 19.1 / 69.2 | n/a | 19.9 / 61.4 | n/a | 14.6 / 66.0 | n/a | 14.8 / 60.0 | n/a | 49.7 / 119.1 | n/a | 47.8 / 101.6 |
| 13 | `half-corner` | structural | n/a | 17.6 / 67.1 | n/a | 18.9 / 82.0 | n/a | 14.3 / 65.4 | n/a | 14.6 / 87.2 | n/a | 49.8 / 119.0 | n/a | 48.9 / 120.7 |
| 14 | `tri-upper` | structural | n/a | 17.5 / 58.5 | n/a | 16.9 / 55.8 | n/a | 14.4 / 67.1 | n/a | 15.2 / 55.4 | n/a | 54.9 / 116.9 | n/a | 48.7 / 117.8 |
| 15 | `tri-lower` | structural | n/a | 17.2 / 57.9 | n/a | 20.3 / 57.2 | n/a | 24.5 / 65.7 | n/a | 14.4 / 54.2 | n/a | 57.1 / 132.2 | n/a | 66.6 / 139.8 |
| 16 | `suspended-ceiling` | structural | n/a | 16.4 / 59.9 | n/a | 20.0 / 64.0 | n/a | 14.1 / 64.6 | n/a | 14.6 / 60.3 | n/a | 49.2 / 131.2 | n/a | 52.2 / 128.3 |
| 17 | `platform` | rail | 58.6 / 67.6 | 23.7 / 88.4 | 33.8 / 109.0 | 22.3 / 83.7 | 26.4 / 116.8 | 17.3 / 99.1 | 28.2 / 107.2 | 18.3 / 107.9 | n/a | 43.1 / 112.2 | n/a | 54.1 / 123.5 |
| 18 | `tunnel` | rail | 31.3 / 115.5 | 21.0 / 79.5 | 33.3 / 99.5 | 34.0 / 94.0 | 23.5 / 121.0 | 16.4 / 99.7 | 27.7 / 128.7 | 17.8 / 92.5 | n/a | 39.3 / 110.1 | n/a | 50.3 / 120.4 |
| 19 | `bridge` | rail | 41.0 / 98.6 | 30.6 / 76.1 | 31.7 / 87.4 | 29.7 / 72.9 | 26.5 / 64.2 | 17.5 / 95.6 | 27.0 / 66.2 | 18.0 / 88.9 | n/a | 27.9 / 111.4 | n/a | 34.0 / 108.5 |
| 20 | `pillar-slim` | structural | 37.9 / 99.8 | 19.0 / 106.9 | 39.8 / 99.0 | 22.1 / 111.5 | 28.1 / 116.2 | 17.2 / 140.9 | 30.1 / 63.7 | 16.4 / 143.6 | 78.9 / 148.7 | 29.0 / 143.2 | 66.4 / 141.3 | 30.9 / 137.3 |
| 21 | `pillar-thick` | structural | 36.1 / 86.0 | 20.8 / 114.7 | 41.9 / 75.3 | 21.2 / 96.6 | 31.2 / 76.3 | 17.5 / 155.6 | 29.4 / 80.0 | 17.9 / 114.6 | 68.5 / 128.6 | 28.4 / 145.3 | 67.1 / 141.7 | 32.2 / 138.7 |
| 22 | `roof` | structural | 58.3 / 97.5 | 21.3 / 91.1 | 32.4 / 76.1 | 24.0 / 101.6 | 23.4 / 121.3 | 16.6 / 123.6 | 24.0 / 71.5 | 17.5 / 121.8 | n/a | 37.5 / 121.9 | n/a | 44.4 / 130.0 |
| 23 | `roof-shell` | structural | 33.5 / 106.2 | 20.2 / 94.1 | 44.0 / 101.2 | 23.1 / 45.9 | 27.1 / 80.1 | 17.7 / 103.3 | 25.4 / 61.8 | 18.0 / 125.4 | n/a | 60.6 / 123.0 | n/a | 68.3 / 151.3 |
| 24 | `roof-truss` | structural | 46.9 / 112.8 | 23.0 / 101.8 | 31.6 / 86.4 | 21.7 / 45.2 | 23.4 / 67.1 | 17.0 / 87.9 | 24.1 / 63.1 | 17.2 / 117.8 | n/a | 59.9 / 121.2 | n/a | 67.4 / 150.1 |
| 25 | `roof-tapered` | structural | 37.1 / 94.4 | 21.4 / 108.1 | 38.1 / 94.1 | 22.1 / 95.0 | 22.9 / 65.0 | 16.6 / 102.3 | 23.7 / 74.3 | 16.9 / 74.0 | n/a | 57.3 / 134.8 | n/a | 68.0 / 154.8 |
| 26 | `roof-canopy` | structural | 30.8 / 87.8 | 20.3 / 45.7 | 32.8 / 100.8 | 22.8 / 76.7 | 23.4 / 106.6 | 16.0 / 127.1 | 24.2 / 103.5 | 17.0 / 120.4 | n/a | 161.2 / 214.6 | n/a | 43.8 / 116.4 |
| 27 | `gate` | equipment | 42.9 / 51.5 | 20.0 / 47.2 | 62.1 / 67.1 | 22.5 / 92.3 | 30.2 / 82.6 | 17.0 / 101.5 | 29.3 / 104.0 | 17.4 / 89.7 | 61.6 / 139.5 | 30.3 / 132.8 | 66.0 / 147.3 | 31.0 / 105.7 |
| 28 | `gate-new` | equipment | 48.7 / 55.7 | 22.0 / 113.7 | 49.3 / 111.8 | 22.4 / 101.0 | 30.4 / 122.0 | 18.1 / 72.5 | 27.9 / 109.8 | 17.3 / 74.5 | 56.1 / 114.6 | 29.0 / 143.5 | 62.3 / 124.8 | 31.4 / 105.8 |
| 29 | `fence` | equipment | 138.6 / 220.7 | 18.8 / 104.8 | 32.7 / 94.0 | 20.8 / 106.0 | 23.2 / 66.2 | 17.2 / 121.4 | 23.8 / 60.1 | 16.9 / 107.8 | 58.7 / 128.7 | 29.6 / 98.5 | 58.9 / 131.6 | 29.7 / 106.9 |
| 30 | `fence-gate` | equipment | 28.2 / 53.5 | 20.3 / 112.4 | 36.5 / 63.0 | 20.9 / 83.7 | 22.2 / 64.4 | 17.0 / 72.2 | 22.8 / 114.1 | 16.9 / 155.6 | 56.5 / 116.4 | 29.2 / 114.2 | 67.2 / 140.6 | 33.0 / 93.7 |
| 31 | `fence-steel-blue` | equipment | 30.6 / 59.2 | 19.2 / 102.2 | 48.3 / 85.3 | 21.4 / 89.2 | 24.1 / 106.2 | 17.3 / 127.3 | 23.5 / 90.9 | 16.6 / 75.9 | 57.8 / 115.8 | 28.7 / 130.4 | 62.7 / 134.7 | 30.2 / 90.0 |
| 32 | `fence-iron` | equipment | 30.7 / 53.5 | 19.6 / 101.6 | 70.0 / 97.9 | 20.8 / 95.4 | 23.2 / 120.0 | 17.1 / 139.3 | 23.4 / 98.8 | 16.8 / 77.5 | 58.2 / 115.3 | 29.3 / 115.4 | 57.9 / 115.3 | 29.5 / 134.1 |
| 33 | `escalator` | equipment | 41.3 / 47.1 | 20.7 / 102.8 | 41.6 / 110.0 | 24.1 / 120.0 | 28.6 / 74.9 | 16.6 / 122.1 | 27.0 / 64.1 | 16.2 / 126.0 | 73.9 / 142.4 | 38.0 / 122.2 | 83.3 / 170.9 | 64.1 / 159.2 |
| 34 | `walkway` | equipment | 41.7 / 63.8 | 21.1 / 94.5 | 41.2 / 57.2 | 21.9 / 107.0 | 30.9 / 128.9 | 20.0 / 108.2 | 27.4 / 104.1 | 16.1 / 70.8 | 117.0 / 185.3 | 43.8 / 120.8 | 136.2 / 219.9 | 45.9 / 134.9 |
| 35 | `lift` | equipment | 59.3 / 63.0 | 22.0 / 94.2 | 53.9 / 108.5 | 22.3 / 87.0 | 30.8 / 69.8 | 17.3 / 149.9 | 27.9 / 93.6 | 16.7 / 72.3 | n/a | 36.8 / 120.8 | n/a | 43.5 / 127.4 |
| 36 | `stair-straight` | equipment | 42.2 / 52.6 | 22.7 / 46.9 | 40.4 / 61.9 | 21.8 / 102.3 | 28.4 / 110.6 | 17.3 / 130.2 | 27.3 / 102.0 | 16.5 / 89.1 | 74.9 / 156.1 | 35.5 / 104.0 | 85.1 / 178.3 | 44.2 / 129.2 |
| 37 | `stair-block` | equipment | 37.5 / 48.0 | 18.7 / 101.2 | 40.2 / 71.8 | 21.4 / 96.2 | 31.0 / 121.7 | 17.2 / 124.7 | 27.0 / 93.0 | 16.7 / 97.4 | 64.1 / 134.2 | 30.9 / 98.8 | 63.5 / 131.1 | 30.4 / 139.6 |
| 38 | `stair-left90` | equipment | 38.9 / 75.4 | 20.6 / 114.7 | 55.8 / 76.8 | 22.1 / 98.7 | 27.5 / 92.8 | 16.6 / 125.1 | 27.4 / 74.1 | 16.7 / 79.6 | 74.9 / 143.1 | 39.3 / 120.6 | 87.7 / 167.3 | 44.3 / 128.6 |
| 39 | `exit` | equipment | 59.8 / 63.7 | 21.6 / 98.7 | 48.6 / 60.8 | 22.3 / 104.5 | 30.9 / 82.6 | 16.5 / 111.4 | 30.9 / 84.0 | 17.1 / 107.0 | 71.9 / 144.4 | 43.6 / 113.5 | 84.1 / 157.9 | 44.6 / 140.1 |
| 40 | `exit-doorway-1` | equipment | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 94.6 / 153.6 | 27.2 / 125.7 | 79.5 / 134.9 | 30.4 / 88.1 |
| 41 | `exit-virtual` | equipment | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 62.9 / 128.3 | 40.4 / 107.5 | 73.4 / 159.5 | 45.3 / 142.0 |
| 42 | `sign-ceiling` | decor-ceiling | n/a | 18.5 / 46.4 | n/a | 19.3 / 31.5 | **WASM OOM** | **WASM OOM** | **WASM OOM** | **WASM OOM** | 85.9 / 141.6 | 30.3 / 135.4 | 85.8 / 142.1 | 32.1 / 91.7 |
| 43 | `tv` | decor-ceiling | 38.2 / 102.4 | 18.7 / 46.2 | 42.2 / 74.4 | 21.2 / 106.3 | 32.2 / 81.4 | 17.6 / 98.7 | 30.3 / 66.7 | 17.5 / 119.9 | 92.1 / 163.3 | 29.0 / 115.6 | 90.2 / 150.0 | 29.6 / 104.5 |
| 44 | `tv-double` | decor-ceiling | 41.2 / 80.2 | 21.1 / 120.5 | 39.9 / 52.2 | 21.9 / 102.3 | 29.2 / 63.2 | 17.0 / 125.8 | 29.6 / 117.3 | 16.8 / 125.1 | 89.0 / 153.2 | 29.0 / 144.8 | 91.4 / 157.1 | 30.8 / 90.2 |
| 45 | `monitor-ceiling` | decor-ceiling | 39.4 / 55.3 | 19.1 / 49.6 | 41.7 / 54.2 | 21.4 / 113.1 | 27.9 / 85.4 | 16.8 / 82.2 | 28.5 / 119.7 | 16.5 / 87.2 | 73.9 / 139.3 | 30.4 / 87.7 | 88.4 / 160.7 | 34.6 / 119.3 |
| 46 | `clock` | decor-ceiling | 41.5 / 51.2 | 19.2 / 50.1 | 55.0 / 85.3 | 20.9 / 90.3 | 30.8 / 64.7 | 18.1 / 121.5 | 31.5 / 81.3 | 17.5 / 106.8 | 78.2 / 136.9 | 29.9 / 101.1 | 150.0 / 225.6 | 30.0 / 103.9 |
| 47 | `clock-digital` | decor-ceiling | 39.3 / 84.6 | 20.7 / 119.9 | 38.9 / 51.2 | 19.6 / 37.2 | 26.8 / 82.4 | 17.1 / 136.8 | 28.1 / 131.7 | 22.0 / 138.5 | 73.5 / 137.7 | 30.9 / 131.5 | 74.4 / 139.9 | 29.5 / 77.6 |
| 48 | `cctv` | decor-ceiling | 55.7 / 109.2 | 19.5 / 107.5 | 45.9 / 58.1 | 20.8 / 131.9 | 28.2 / 103.2 | 33.2 / 99.7 | 28.1 / 65.9 | 16.8 / 120.3 | 82.9 / 134.4 | 33.9 / 115.4 | 79.4 / 146.6 | 31.0 / 106.9 |
| 49 | `cctv-ptz` | decor-ceiling | 44.3 / 60.0 | 19.6 / 98.2 | 58.4 / 63.1 | 21.5 / 104.6 | 31.1 / 113.8 | 18.9 / 89.6 | 29.4 / 116.4 | 17.1 / 134.3 | 76.5 / 137.9 | 98.9 / 146.5 | 78.2 / 147.8 | 33.1 / 112.1 |
| 50 | `cctv-dome` | decor-ceiling | 47.8 / 107.9 | 20.1 / 86.6 | 54.1 / 114.5 | 21.9 / 46.6 | 30.7 / 86.5 | 16.6 / 68.6 | 33.7 / 118.7 | 16.9 / 119.9 | 82.6 / 139.5 | 32.0 / 132.5 | 77.0 / 138.3 | 30.8 / 89.8 |
| 51 | `light-circular` | decor-ceiling | 42.6 / 115.6 | 19.9 / 108.6 | 40.2 / 84.2 | 19.8 / 47.0 | 30.6 / 79.3 | 16.5 / 119.0 | 27.0 / 65.7 | 16.4 / 103.8 | 68.0 / 135.7 | 28.5 / 141.9 | 71.5 / 144.4 | 32.9 / 115.0 |
| 52 | `light-rectangular` | decor-ceiling | 39.2 / 61.2 | 19.5 / 91.7 | 111.3 / 181.9 | 21.2 / 100.7 | 27.3 / 95.2 | 16.6 / 126.3 | 27.6 / 87.0 | 16.3 / 124.7 | 68.8 / 137.9 | 30.1 / 132.3 | 72.1 / 133.7 | 31.0 / 91.9 |
| 53 | `vent` | decor-ceiling | 43.8 / 93.0 | 19.7 / 101.8 | 62.1 / 66.7 | 20.1 / 109.6 | 27.8 / 67.6 | 16.7 / 125.6 | 28.4 / 72.7 | 16.8 / 143.9 | 69.9 / 139.6 | 29.0 / 114.5 | 73.1 / 143.0 | 32.8 / 100.5 |
| 54 | `hanger-roof` | decor-ceiling | 59.4 / 89.5 | 19.9 / 108.0 | 60.2 / 64.1 | 21.0 / 98.3 | 32.9 / 79.2 | 16.7 / 110.8 | 33.3 / 106.7 | 16.6 / 122.9 | 74.6 / 137.5 | 30.6 / 135.1 | 78.0 / 153.7 | 35.0 / 124.4 |
| 55 | `sign-wall` | decor-wall | 43.5 / 81.4 | 19.4 / 48.1 | 48.8 / 112.7 | 21.0 / 108.5 | **WASM OOM** | **WASM OOM** | **WASM OOM** | **WASM OOM** | 62.8 / 126.8 | 28.6 / 142.6 | 62.3 / 135.9 | 29.7 / 134.4 |
| 56 | `billboard-wide` | decor-wall | 38.6 / 58.1 | 20.2 / 90.5 | 57.3 / 61.4 | 20.4 / 113.9 | 28.2 / 79.6 | 16.5 / 152.2 | 30.2 / 82.1 | 17.2 / 131.5 | 61.6 / 129.3 | 30.4 / 134.8 | 62.9 / 131.2 | 28.8 / 134.1 |
| 57 | `billboard-16x9-4m` | decor-wall | 37.2 / 77.9 | 18.7 / 46.0 | 39.5 / 78.2 | 21.1 / 116.1 | 27.5 / 62.7 | 16.4 / 125.6 | 27.4 / 66.3 | 16.3 / 105.9 | 153.9 / 231.2 | 37.4 / 119.4 | 164.0 / 222.7 | 29.1 / 114.2 |
| 58 | `glass-2x2` | decor-wall | 36.2 / 96.1 | 18.9 / 121.2 | 39.6 / 62.2 | 21.5 / 97.0 | 26.0 / 66.3 | 16.8 / 113.1 | 26.8 / 73.1 | 17.0 / 101.6 | 72.3 / 137.9 | 37.9 / 128.8 | 75.3 / 136.5 | 29.3 / 102.2 |
| 59 | `calligraphy-wei-h` | decor-wall | 38.0 / 89.4 | 19.7 / 106.1 | 41.5 / 77.3 | 20.7 / 96.0 | 26.8 / 66.8 | 17.0 / 85.2 | 29.0 / 115.4 | 17.3 / 77.2 | 81.3 / 148.4 | 28.2 / 133.8 | 84.6 / 144.1 | 28.9 / 98.1 |
| 60 | `linemap-wall` | decor-wall | 38.3 / 49.3 | 19.2 / 105.5 | 39.9 / 84.1 | 19.9 / 107.1 | 31.4 / 80.8 | 19.7 / 136.0 | 27.8 / 116.6 | 17.1 / 182.4 | 65.9 / 131.7 | 28.2 / 132.3 | 72.3 / 145.0 | 30.9 / 141.4 |
| 61 | `monitor-wall` | decor-wall | 42.8 / 73.7 | 23.4 / 105.3 | 49.3 / 70.0 | 20.8 / 113.1 | 31.7 / 117.3 | 17.5 / 137.9 | 34.8 / 72.7 | 17.1 / 136.4 | 81.9 / 149.2 | 29.7 / 143.8 | 80.7 / 137.9 | 30.6 / 132.6 |
| 62 | `urinal` | decor-wall | n/a | 16.4 / 45.6 | n/a | 16.5 / 46.3 | n/a | 15.0 / 52.2 | n/a | 14.7 / 66.3 | 80.2 / 160.2 | 27.7 / 132.4 | 84.9 / 157.5 | 29.6 / 98.1 |
| 63 | `tvm` | decor-floor | 42.2 / 52.7 | 18.8 / 110.5 | 57.1 / 62.6 | 21.6 / 109.5 | 29.8 / 115.8 | 17.2 / 154.3 | 29.5 / 87.5 | 16.8 / 231.0 | 60.9 / 134.6 | 28.9 / 131.8 | 63.3 / 143.6 | 31.4 / 111.2 |
| 64 | `vending` | decor-floor | 42.8 / 64.7 | 19.2 / 90.7 | 43.9 / 61.1 | 19.9 / 102.6 | 29.4 / 72.1 | 17.0 / 102.0 | 28.5 / 67.0 | 16.6 / 103.1 | 170.5 / 230.7 | 30.0 / 145.1 | 59.2 / 166.6 | 32.8 / 101.8 |
| 65 | `hanger-post` | decor-floor | 38.6 / 55.7 | 19.5 / 48.7 | 60.8 / 65.8 | 20.6 / 103.2 | 27.7 / 73.4 | 17.0 / 118.7 | 27.1 / 65.6 | 16.7 / 118.4 | 63.3 / 137.5 | 29.9 / 102.8 | 64.6 / 135.3 | 33.6 / 103.5 |
| 66 | `electrical-cabinet` | decor-floor | 38.1 / 51.3 | 18.9 / 102.4 | 56.8 / 112.4 | 21.5 / 192.4 | 32.2 / 78.9 | 17.6 / 94.7 | 28.9 / 72.5 | 18.4 / 128.1 | 60.3 / 118.2 | 29.9 / 101.3 | 70.2 / 139.1 | 33.4 / 98.0 |
| 67 | `tactile-guide` | decor-floor | 28.8 / 46.5 | 20.7 / 107.5 | 32.8 / 51.2 | 21.0 / 96.4 | 23.9 / 58.7 | 16.8 / 116.0 | 23.2 / 81.9 | 17.2 / 275.1 | 54.0 / 122.3 | 28.5 / 149.2 | 58.0 / 121.3 | 31.0 / 95.9 |
| 68 | `tactile-warning` | decor-floor | 32.4 / 65.8 | 19.6 / 99.6 | 36.3 / 72.3 | 22.0 / 89.5 | 23.2 / 106.0 | 17.6 / 74.0 | 22.6 / 76.6 | 16.6 / 109.9 | 66.0 / 136.2 | 32.4 / 138.0 | 64.6 / 124.6 | 61.9 / 138.2 |
| 69 | `tactile-warning-strip` | decor-floor | 31.0 / 51.1 | 20.1 / 97.2 | 31.8 / 50.9 | 33.1 / 105.6 | 25.6 / 73.9 | 17.0 / 118.2 | 23.1 / 67.3 | 17.8 / 231.7 | 72.6 / 134.8 | 30.1 / 146.9 | 69.0 / 130.7 | 31.4 / 109.0 |
| 70 | `floor-mark-boarding` | decor-floor | 28.8 / 85.9 | 19.0 / 47.1 | 36.4 / 89.5 | 20.6 / 96.5 | n/a | 14.7 / 65.4 | n/a | 18.0 / 71.4 | 59.4 / 127.8 | 30.2 / 133.0 | 60.6 / 144.0 | 31.8 / 98.2 |
| 71 | `floor-mark-waiting` | decor-floor | 30.0 / 103.4 | 19.6 / 45.7 | 33.3 / 103.4 | 20.5 / 45.8 | 29.6 / 74.3 | 17.0 / 102.6 | 25.5 / 71.2 | 17.3 / 103.2 | 64.8 / 132.8 | 29.3 / 114.9 | 61.8 / 128.8 | 33.0 / 98.7 |
| 72 | `floor-mark-direction` | decor-floor | 31.7 / 85.6 | 19.7 / 100.6 | 36.2 / 69.1 | 19.8 / 107.0 | 22.9 / 73.4 | 17.0 / 237.6 | 23.0 / 118.1 | 16.7 / 88.5 | 59.3 / 129.6 | 29.9 / 87.9 | 60.6 / 125.7 | 31.5 / 92.8 |
| 73 | `bench-steel-1` | decor-floor | n/a | 16.0 / 32.2 | n/a | 22.6 / 45.6 | 27.3 / 100.8 | 17.4 / 149.6 | 27.1 / 85.5 | 16.7 / 119.3 | 54.8 / 127.7 | 28.9 / 85.8 | 55.7 / 120.2 | 31.2 / 108.1 |
| 74 | `bench-wood-1` | decor-floor | 39.7 / 50.9 | 19.3 / 92.2 | 47.8 / 58.2 | 36.6 / 120.8 | 28.3 / 65.7 | 18.6 / 101.4 | 28.6 / 76.2 | 16.7 / 95.1 | 56.9 / 113.7 | 29.2 / 146.4 | 60.2 / 124.3 | 33.1 / 96.3 |
| 75 | `shelf-dark-tall` | decor-floor | 43.7 / 54.3 | 19.3 / 106.6 | 48.4 / 57.2 | 27.5 / 124.8 | 31.7 / 72.5 | 18.0 / 104.6 | 39.2 / 103.3 | 18.3 / 279.1 | 60.4 / 132.2 | 31.9 / 98.4 | 65.8 / 130.1 | 33.4 / 113.0 |
| 76 | `shelf-cooler` | decor-floor | 42.3 / 52.8 | 21.1 / 113.4 | 47.9 / 68.2 | 21.7 / 97.9 | 31.8 / 66.6 | 17.6 / 107.9 | 37.2 / 116.0 | 17.4 / 140.1 | 61.7 / 120.5 | 31.2 / 88.4 | 61.7 / 141.9 | 33.0 / 110.9 |
| 77 | `desk` | decor-floor | 55.9 / 62.0 | 19.9 / 103.2 | 64.6 / 89.9 | 22.6 / 122.8 | 28.8 / 118.0 | 17.3 / 134.3 | 28.7 / 86.2 | 17.1 / 78.2 | 63.6 / 130.5 | 30.8 / 101.4 | 63.6 / 129.0 | 30.5 / 108.8 |
| 78 | `checkout` | decor-floor | 59.1 / 63.8 | 19.0 / 107.7 | 47.5 / 67.5 | 34.5 / 113.5 | 29.0 / 85.9 | 17.1 / 133.3 | 31.6 / 82.6 | 16.8 / 92.9 | 62.2 / 127.7 | 33.5 / 136.6 | 66.3 / 137.2 | 32.4 / 94.6 |
| 79 | `checkout-cafe-pastry` | decor-floor | 62.1 / 67.6 | 21.8 / 106.5 | 61.5 / 67.1 | 21.8 / 282.0 | 28.8 / 66.5 | 17.6 / 121.0 | 32.3 / 102.7 | 17.1 / 143.1 | 87.4 / 223.5 | 30.5 / 114.6 | 63.7 / 128.1 | 42.6 / 194.1 |
| 80 | `cubicle` | decor-floor | 39.0 / 60.9 | 19.0 / 81.8 | 43.5 / 61.7 | 22.8 / 104.9 | 28.5 / 80.3 | 17.3 / 127.5 | 29.9 / 65.7 | 17.1 / 109.4 | 66.1 / 125.3 | 29.3 / 132.5 | 67.6 / 132.2 | 30.1 / 88.8 |
| 81 | `cubicle-toilet` | decor-floor | 41.3 / 55.9 | 19.4 / 104.5 | 43.9 / 68.3 | 23.9 / 69.3 | 27.8 / 85.2 | 17.7 / 72.9 | 30.3 / 102.4 | 17.4 / 126.2 | 59.8 / 132.4 | 29.7 / 132.7 | 60.4 / 136.6 | 30.2 / 90.7 |
| 82 | `sink` | decor-floor | 64.0 / 80.8 | 23.9 / 110.2 | 59.7 / 78.9 | 23.3 / 91.7 | 30.4 / 87.1 | 17.8 / 74.9 | 29.8 / 66.9 | 17.4 / 121.5 | 62.6 / 131.6 | 29.3 / 99.5 | 65.2 / 139.2 | 30.0 / 107.7 |
| 83 | `bin` | decor-floor | 41.1 / 54.8 | 29.1 / 116.9 | 42.9 / 62.9 | 21.4 / 101.6 | 29.3 / 65.2 | 17.4 / 125.5 | 28.5 / 66.5 | 16.9 / 111.9 | 54.3 / 113.6 | 29.0 / 98.1 | 57.9 / 120.3 | 29.4 / 102.7 |
| 84 | `extinguisher` | decor-floor | 40.3 / 61.8 | 20.7 / 90.0 | 56.9 / 113.1 | 20.5 / 46.9 | 28.4 / 85.2 | 17.0 / 155.7 | 29.2 / 86.2 | 17.1 / 124.9 | 56.2 / 115.4 | 29.9 / 131.3 | 56.5 / 135.4 | 30.3 / 90.7 |
| 85 | `curtain-wall` | decor-floor | 35.7 / 73.6 | 18.9 / 107.9 | 39.8 / 81.0 | 22.0 / 105.4 | 27.0 / 67.3 | 16.9 / 119.3 | 27.7 / 73.5 | 17.1 / 105.7 | 61.8 / 125.6 | 29.4 / 101.5 | 64.3 / 152.1 | 32.9 / 98.6 |
| 86 | `psd-end` | decor-floor | 39.2 / 70.4 | 19.5 / 119.7 | 42.5 / 72.2 | 21.3 / 98.0 | 29.4 / 87.1 | 17.8 / 136.7 | 28.4 / 65.9 | 17.4 / 122.2 | 64.6 / 136.1 | 30.8 / 90.7 | 65.9 / 141.5 | 30.8 / 90.8 |
| 87 | `psd-end-cover` | decor-floor | 40.1 / 80.9 | 22.6 / 122.5 | 42.3 / 70.4 | 23.3 / 105.1 | 28.4 / 86.8 | 17.6 / 119.4 | 28.5 / 102.9 | 17.4 / 134.8 | 75.6 / 140.8 | 34.6 / 92.7 | 72.1 / 136.8 | 33.2 / 105.6 |
| 88 | `rail-signal` | decor-floor | 42.3 / 60.2 | 19.5 / 92.9 | 45.2 / 65.1 | 21.1 / 77.8 | 29.7 / 64.5 | 19.2 / 133.6 | 28.9 / 65.7 | 18.5 / 123.3 | 57.1 / 128.6 | 30.9 / 145.8 | 57.2 / 131.3 | 30.9 / 111.2 |
| 89 | `linemap-stand` | decor-floor | 38.0 / 93.6 | 18.6 / 106.1 | 42.2 / 113.6 | 21.3 / 127.8 | 27.7 / 67.2 | 16.8 / 120.0 | 37.0 / 116.4 | 17.6 / 146.5 | 53.6 / 125.7 | 34.0 / 93.8 | 53.8 / 117.8 | 31.0 / 93.2 |
| 90 | `door-steel-1` | decor-floor | 62.4 / 66.6 | 19.3 / 96.0 | 58.0 / 62.4 | 21.7 / 100.7 | 28.1 / 102.3 | 18.9 / 200.8 | 28.9 / 100.9 | 17.4 / 76.9 | 57.9 / 116.0 | 29.0 / 116.5 | 57.7 / 134.2 | 30.8 / 93.5 |
| 91 | `noise-barrier` | decor-floor | 30.6 / 50.2 | 19.0 / 115.5 | 32.8 / 48.3 | 21.9 / 115.2 | 23.2 / 105.1 | 16.7 / 76.1 | 22.5 / 66.5 | 17.3 / 139.1 | 57.4 / 127.9 | 29.5 / 115.3 | 58.1 / 117.9 | 29.5 / 88.0 |
| 92 | `sidewalk` | decor-outdoor | 38.1 / 55.9 | 21.1 / 106.4 | 41.6 / 189.4 | 23.0 / 117.8 | 26.6 / 75.6 | 18.4 / 92.4 | 27.1 / 73.3 | 16.5 / 165.5 | n/a | 40.8 / 110.2 | n/a | 49.5 / 139.6 |
| 93 | `lawn` | decor-outdoor | 40.5 / 59.6 | 32.1 / 92.8 | 41.3 / 56.5 | 25.3 / 94.0 | 26.8 / 125.6 | 16.7 / 125.0 | 35.3 / 80.6 | 17.1 / 138.7 | n/a | 37.1 / 103.2 | n/a | 43.2 / 129.5 |
| 94 | `tree` | decor-outdoor | 51.7 / 108.9 | 22.8 / 101.9 | 62.9 / 67.4 | 24.5 / 103.1 | 28.4 / 72.4 | 17.3 / 124.0 | 28.5 / 78.7 | 16.6 / 132.5 | 69.0 / 154.1 | 36.3 / 111.2 | 77.3 / 160.4 | 43.7 / 136.0 |
| 95 | `road` | decor-outdoor | 46.2 / 65.2 | 22.3 / 101.3 | 57.6 / 101.5 | 23.5 / 108.2 | 34.2 / 92.1 | 16.6 / 138.5 | 32.2 / 137.8 | 16.1 / 62.2 | n/a | 35.7 / 105.0 | n/a | 45.6 / 129.3 |
| 96 | `traffic-light` | decor-outdoor | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 61.4 / 127.4 | 35.8 / 103.4 | 69.4 / 157.5 | 44.4 / 137.2 |
| 97 | `ac-unit` | decor-outdoor | 57.3 / 65.8 | 21.3 / 81.6 | 49.3 / 59.7 | 23.5 / 100.1 | 30.6 / 87.6 | 17.0 / 73.0 | 30.9 / 73.4 | 17.3 / 135.8 | 73.2 / 139.9 | 39.7 / 109.9 | 78.9 / 166.8 | 43.4 / 131.4 |
| 98 | `guidepost` | decor-outdoor | 40.0 / 66.0 | 21.4 / 48.5 | 43.6 / 67.9 | 22.6 / 48.2 | 26.9 / 101.8 | 16.4 / 137.5 | 32.3 / 98.5 | 16.5 / 118.5 | 63.8 / 135.6 | 40.6 / 108.1 | 70.1 / 157.9 | 42.2 / 128.1 |
| 99 | `busstop-short` | decor-outdoor | 41.8 / 52.8 | 21.4 / 94.5 | 67.0 / 91.7 | 21.1 / 83.6 | 28.4 / 66.5 | 16.6 / 105.5 | 31.8 / 74.1 | 16.3 / 138.0 | 69.2 / 123.4 | 37.0 / 87.9 | 77.3 / 166.2 | 43.8 / 133.2 |
| 100 | `cctv-post` | decor-outdoor | 48.9 / 73.7 | 22.2 / 110.3 | 60.0 / 79.7 | 24.1 / 109.8 | 28.6 / 116.8 | 16.1 / 163.9 | 28.0 / 72.7 | 16.7 / 119.8 | 154.8 / 227.9 | 40.0 / 139.9 | 79.5 / 146.3 | 42.9 / 133.7 |
| 101 | `court-pickleball` | decor-outdoor | 48.2 / 111.3 | 21.8 / 47.4 | 61.7 / 66.0 | 24.5 / 113.4 | 30.3 / 85.8 | 16.5 / 161.1 | 28.1 / 102.5 | 16.2 / 133.2 | 147.9 / 212.9 | 36.3 / 104.5 | 151.3 / 246.6 | 43.4 / 129.7 |
| 102 | `court-divider` | decor-outdoor | 31.8 / 63.8 | 21.7 / 76.7 | 44.2 / 63.0 | 22.8 / 73.8 | 25.4 / 127.9 | 17.3 / 119.8 | 22.2 / 65.6 | 16.1 / 137.0 | 68.7 / 133.8 | 34.7 / 102.5 | 70.6 / 158.4 | 43.0 / 128.9 |

