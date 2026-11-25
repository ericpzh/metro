# Tianhe Park Object Placement & Pick Latency Matrix

Real-click end-to-end **placement** and **pick** latency measured on **Tianhe Park (`tianhe`, 151,852 cells, 76,438 modules, 3 lines, 4 booths)** across every placeable object family (including all 5 rooms, 3 fare zones, 8 structural/cut modes, rail/tunnel/bridge, and all equipment & decor variants — **102 canonical cases**) under both **Paused (`0×`)** and **Live Peak Rush (`1×`, Mon 08:00 AM)** simulation speeds.

> All runs execute serially on hardware GPU (`NVIDIA GeForce RTX 4080 SUPER`, `Intel Core i7-14700KF`, `64 GB RAM`, `1600×900`, `high` detail/quality, `native` FSR, `1.0` render scale) using real pointer events (`CDP Input.dispatchMouseEvent`) and undo cleanup between every object so each measurement hits untouched Tianhe Park. Raw captures live in `.preview/perf/tianhe-object-latency/raw/` alongside `summary.json` and `matrix.csv`.

## Test Environment & Baseline

| Build | Speed | Commit | Runtime / Scripting / GPU | Canvas | Baseline FPS | Frame ms | OK / 102 | Local / Fallback | Unsupported / OOM |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| **Unity Desktop (.exe)** | Paused (0×) | `e527757c` | Unity 6000.6.8f1 / Mono / Direct3D12 (NVIDIA GeForce RTX 4080 SUPER) | 1600×900 | 248.0 | 4.03 | 99 / 102 | 99 / 0 | 3 / 0 |
| **Unity Desktop (.exe)** | Live (1×) | `e527757c` | Unity 6000.6.8f1 / Mono / Direct3D12 (NVIDIA GeForce RTX 4080 SUPER) | 1600×900 | 248.7 | 4.02 | 99 / 102 | 99 / 0 | 3 / 0 |
| **Unity WebGL** | Paused (0×) | `e527757c` | Unity 6000.6.8f1 / IL2CPP WASM / OpenGLES3 (ANGLE D3D11 RTX 4080 SUPER) | 1068×810 (in 1600×900) | 43.3 | 23.09 | 99 / 102 | 99 / 0 | 3 / 0 |
| **Unity WebGL** | Live (1×) | `e527757c` | Unity 6000.6.8f1 / IL2CPP WASM / OpenGLES3 (ANGLE D3D11 RTX 4080 SUPER) | 1068×810 (in 1600×900) | 52.6 | 19.01 | 99 / 102 | 99 / 0 | 3 / 0 |
| **Web (Three.js)** | Paused (0×) | `e527757c` | Chrome V8 / Three.js WebGL2 (ANGLE D3D11 RTX 4080 SUPER) | 1600×900 | 28.4 | 35.26 | 102 / 102 | 102 / 0 | 0 / 0 |
| **Web (Three.js)** | Live (1×) | `e527757c` | Chrome V8 / Three.js WebGL2 (ANGLE D3D11 RTX 4080 SUPER) | 1600×900 | 28.7 | 34.88 | 102 / 102 | 102 / 0 | 0 / 0 |

## Timing Boundaries

- **Trigger anchor (`t0`)**: Anchored to the exact input event that triggers the commit — `pointerdown` for single-press tools (e.g. gates, benches, ramps, rails, signs) or `pointerup` for drag/run/surface tools (e.g. rooms, zones, blocks, walls, fences, tactile, floor marks, roofs, roads, sidewalk/lawn) — so synthetic drag hold time is never charged as latency.
- **Unity Desktop (`.exe`) & Unity WebGL**:
  - **Place Present (`ms`)**: Native C# `Stopwatch` elapsed time from `StationGameHost.BrowserCommand` entry to `first-frame-presented` (`WaitForEndOfFrame` after URP `endCameraRendering`). This is the exact host click-to-rendered duration.
  - **Place Click→Reply (`ms`)**: Browser/WebView2 `pointerdown`/`pointerup` to `commit` message received in React shell (includes IPC round-trip + JSON serialization; noticeably exceeds `Place Present` only when `delta: false` sends a full-save payload over IPC).
  - **Pick (`Ack / UI`)**: Two numbers separated by `/` — **Host Ack (`ms`)** (`pointerdown` → Unity `ack` reply; Unity updates the 3D selection highlight / lifted ghost on the next frame) and **UI Adopt (`ms`)** (`pointerdown` → React shell reflects `carried` / `pick` / `selectionKey`; `stationBridge.ts` `reduce()` folds `payload.edit` immediately on `kind === "ack"`).
- **Web (Three.js)**:
  - **Place Render / Present (`ms`)**: `pointerdown`/`pointerup` → completion of the first post-commit `WebGLRenderer.render()` call (includes synchronous Zustand commit, `useLayoutEffect`, `SceneRenderer.setStation` chunk/module/batch update, and WebGL draw submission) and the subsequent `requestAnimationFrame` swap (`Present`).
  - **Pick (`Render / Present`)**: `pointerdown` → first post-pick `WebGLRenderer.render()` completion (includes synchronous Zustand state adoption + `setMovingModule` / `setSelection`) and subsequent `requestAnimationFrame` swap.

## Overall Latency Summary (All Supported Objects)

_Target SLA: **P50 ≤ 100 ms**, **P90 ≤ 500 ms**, **Max ≤ 1,000 ms**._

| Build | Speed | Place P50 (ms) | Place Mean (ms) | Place P90 (ms) | Place P95 (ms) | Place Max (ms) | SLA | Local-Only P50 (ms) | Fallback P50 (ms) | Move Pick P50 (ms) | Eye/Sel Pick P50 (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| **Unity Desktop (.exe)** | Paused (0×) | 48.1 | 61.8 | 101.9 | 127.0 | 237.7 | PASS | 48.1 | — | 39.7 | 20.6 |
| **Unity Desktop (.exe)** | Live (1×) | 52.5 | 66.2 | 109.2 | 157.4 | 271.4 | PASS | 52.5 | — | 42.9 | 21.6 |
| **Unity WebGL** | Paused (0×) | 69.8 | 75.5 | 102.3 | 128.6 | 174.1 | PASS | 69.8 | — | 29.0 | 17.4 |
| **Unity WebGL** | Live (1×) | 80.1 | 86.0 | 113.3 | 137.3 | 182.0 | PASS | 80.1 | — | 30.7 | 17.8 |
| **Web (Three.js)** | Paused (0×) | 59.2 | 92.5 | 180.8 | 216.6 | 331.2 | PASS | 59.2 | — | 63.5 | 30.2 |
| **Web (Three.js)** | Live (1×) | 61.5 | 94.4 | 184.6 | 215.1 | 336.1 | PASS | 61.5 | — | 64.9 | 32.1 |

## Key Findings & Bottleneck Diagnosis

1. **Unity Desktop (`.exe`) local delta coverage & tail**: **99/99** supported objects stay on the local retained-view path (**0** full fallbacks) with P50 **48.1 ms** (0×) / **52.5 ms** (1×), P90 **101.9 ms** / **109.2 ms**, and Max **237.7 ms** / **271.4 ms**.
2. **Pick latency (Unity Desktop)**: Real-click host `ack` is **20.6 ms** (0×) / **21.6 ms** (1×) median for Eyedropper/Select and **39.7 ms** / **42.9 ms** for Move pickup; React UI adoption is **46.7 ms** / **46.7 ms** (Eyedropper/Select) and **48.7 ms** / **48.9 ms** (Move).
3. **Unity placement parity gaps**: `exit-doorway-1`, `exit-virtual`, and `traffic-light` return `blocked: no-candidate` in Unity (`StationModuleFamilies.TryParse` does not parse them yet) while placing cleanly in Web Three.js.
4. **Web (Three.js)**: **102/102** objects succeed with click→render P50 **59.2 ms** (0×) / **61.5 ms** (1×), P90 **180.8 ms** / **184.6 ms**, P95 **216.6 ms** / **215.1 ms**, and Max **331.2 ms** / **336.1 ms** (slowest ≥ 250 ms: `tunnel` 331/336 ms, `platform` 289/282 ms). Pick rendering is **63.5 ms** (Move) and **30.2 ms** (Eyedropper/Select) at Paused.
5. **Unity WebGL (IL2CPP WASM)**: **99/102** objects succeed (**99** local / **0** fallback, **0** WASM OOMs) with host-present P50 **69.8 ms** (0×) / **80.1 ms** (1×), P90 **102.3 ms** / **113.3 ms**, P95 **128.6 ms** / **137.3 ms**, and Max **174.1 ms** / **182.0 ms**.

## Category Summary (Median Place / Median Eye-Sel Pick, ms)

| Category | Cases | Unity Exe 0× Place P50 | Unity Exe 0× Place Max | Unity Exe 0× Pick P50 | Unity Exe 1× Place P50 | Unity Exe 1× Place Max | Unity Exe 1× Pick P50 | Unity WebGL 0× Place P50 | Unity WebGL 0× Place Max | Unity WebGL 0× Pick P50 | Unity WebGL 1× Place P50 | Unity WebGL 1× Place Max | Unity WebGL 1× Pick P50 | Web 0× Place P50 | Web 0× Place Max | Web 0× Pick P50 | Web 1× Place P50 | Web 1× Place Max | Web 1× Pick P50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Rooms (房间/亭) | 5 | 45.7 | 143.8 | 17.1 | 52.5 | 136.4 | 19.8 | 49.5 | 92.5 | 15.3 | 55.8 | 101.9 | 15.2 | 144.8 | 214.2 | 47.5 | 144.9 | 196.7 | 53.9 |
| Fare Zones (分区) | 3 | 40.7 | 46.6 | 15.7 | 46.7 | 55.9 | 16.3 | 47.6 | 52.2 | 15.2 | 56.2 | 60.0 | 15.3 | 156.4 | 157.3 | 46.9 | 143.6 | 168.0 | 47.7 |
| Structural & Roofs (结构/屋顶) | 15 | 49.1 | 127.0 | 19.3 | 59.3 | 133.7 | 20.4 | 69.9 | 115.1 | 15.5 | 88.6 | 126.0 | 15.3 | 81.2 | 173.8 | 45.7 | 80.3 | 174.7 | 46.7 |
| Rail / Tunnel / Bridge (轨道) | 3 | 202.4 | 237.7 | 25.9 | 192.3 | 271.4 | 24.6 | 156.8 | 167.6 | 18.6 | 158.7 | 179.2 | 18.8 | 289.3 | 331.2 | 37.9 | 282.4 | 336.1 | 40.2 |
| Equipment & Vertical (设备/扶梯/电梯/出入口) | 15 | 78.6 | 155.3 | 21.3 | 80.8 | 172.1 | 21.4 | 76.8 | 144.7 | 17.4 | 101.0 | 149.1 | 17.6 | 177.6 | 249.6 | 30.9 | 180.3 | 235.5 | 34.0 |
| Decor — Ceiling (吊顶装饰) | 13 | 41.6 | 87.9 | 20.9 | 44.6 | 98.0 | 21.7 | 64.5 | 107.4 | 17.4 | 70.8 | 137.3 | 17.9 | 54.5 | 69.0 | 29.3 | 56.8 | 118.8 | 31.1 |
| Decor — Wall (壁挂装饰) | 8 | 37.7 | 56.5 | 20.2 | 39.6 | 51.1 | 20.9 | 62.2 | 102.7 | 17.3 | 70.1 | 123.1 | 17.9 | 49.6 | 105.3 | 27.4 | 52.8 | 112.8 | 30.6 |
| Decor — Floor (地面装饰) | 29 | 47.4 | 68.6 | 20.5 | 52.1 | 81.8 | 21.8 | 69.8 | 74.3 | 17.6 | 79.4 | 106.5 | 17.9 | 55.9 | 121.7 | 29.7 | 58.0 | 68.3 | 30.9 |
| Decor — Outdoor (室外设施) | 11 | 83.2 | 95.5 | 21.7 | 89.5 | 167.3 | 22.8 | 88.7 | 174.1 | 17.0 | 102.5 | 182.0 | 17.9 | 127.3 | 245.3 | 36.6 | 127.2 | 256.8 | 36.9 |

## Complete 102-Object Placement Latency Matrix (ms, Click → Rendered)

_Unity columns show native C# `first-frame-presented` (`hostPresentMs`); Web columns show click → first post-commit `WebGLRenderer.render()` completion (`clickToFirstRenderEndMs`)._

| # | Object ID | Label | Category | Gesture | Unity Exe 0× | Unity Exe 1× | Unity WebGL 0× | Unity WebGL 1× | Web 0× | Web 1× | Unity Path / Fallback | Unity Top Stage (Paused) |
| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | `room:ticket` | Ticket Booth (售票亭) | room | drag | 143.8 | 136.4 | 92.5 | 101.9 | 95.8 | 101.6 | `local` | `StationEdit.StageLocalInstall` (38 ms) |
| 2 | `room:info` | Info Desk (客服中心) | room | drag | 45.7 | 56.6 | 66.1 | 80.5 | 66.1 | 90.9 | `local` | `StationEdit.StageLocalInstall` (11 ms) |
| 3 | `room:store` | Store Room Zone (商铺) | room | drag | 52.4 | 52.5 | 49.5 | 52.6 | 214.2 | 196.7 | `local` | `StationEdit.StageLocalWorld` (16 ms) |
| 4 | `room:toilet` | Restroom Zone (卫生间) | room | drag | 41.2 | 41.9 | 47.8 | 53.1 | 160.4 | 160.4 | `local` | `StationEdit.StageLocalWorld` (11 ms) |
| 5 | `room:office` | Office Room Zone (办公区) | room | drag | 40.7 | 43.0 | 46.8 | 55.8 | 144.8 | 144.9 | `local` | `StationEdit.StageLocalWorld` (11 ms) |
| 6 | `zone:unpaid` | Unpaid Zone (非付费区) | zone | drag | 46.6 | 46.7 | 52.2 | 56.2 | 157.3 | 168.0 | `local` | `StationEdit.StageLocalWorld` (14 ms) |
| 7 | `zone:paid` | Paid Zone (付费区) | zone | drag | 40.5 | 55.9 | 46.6 | 60.0 | 156.4 | 143.6 | `local` | `StationEdit.StageLocalWorld` (11 ms) |
| 8 | `zone:none` | Erase Zone (无分区) | zone | drag | 40.7 | 43.8 | 47.6 | 53.4 | 84.8 | 83.8 | `local` | `StationEdit.StageLocalWorld` (11 ms) |
| 9 | `block` | Block (方块) | structural | tap | 35.5 | 39.4 | 60.3 | 65.0 | 46.3 | 60.3 | `local` | `StationEdit.CellFinish` (16 ms) |
| 10 | `block/auto-walls` | Floor + Auto-Walls (自动墙) | structural | tap-hold | 127.0 | 133.7 | 115.1 | 126.0 | 173.8 | 174.7 | `local` | `StationEdit.CellFinish` (103 ms) |
| 11 | `wall` | Wall Column 4m (墙) | structural | tap | 35.6 | 40.3 | 59.9 | 63.2 | 84.9 | 84.6 | `local` | `StationEdit.CellFinish` (17 ms) |
| 12 | `half-wall` | Half Wall (半墙) | structural | tap | 34.0 | 38.4 | 58.0 | 79.1 | 48.0 | 50.2 | `local` | `StationEdit.CellFinish` (15 ms) |
| 13 | `half-corner` | Half Wall Corner (半墙角) | structural | tap | 33.5 | 37.9 | 57.7 | 90.9 | 47.2 | 44.1 | `local` | `StationEdit.CellFinish` (15 ms) |
| 14 | `tri-upper` | Upper Wedge (三角上) | structural | tap | 38.2 | 39.8 | 57.6 | 63.8 | 45.1 | 47.6 | `local` | `StationEdit.CellFinish` (17 ms) |
| 15 | `tri-lower` | Lower Wedge (三角下) | structural | tap | 33.1 | 37.8 | 60.3 | 62.3 | 46.2 | 62.9 | `local` | `StationEdit.CellFinish` (15 ms) |
| 16 | `suspended-ceiling` | Suspended Ceiling (吊顶) | structural | tap | 34.5 | 38.8 | 64.7 | 64.0 | 81.2 | 80.3 | `local` | `StationEdit.CellFinish` (16 ms) |
| 17 | `platform` | Platform Track (站台轨道) | rail | tap | 237.7 | 271.4 | 167.6 | 158.7 | 289.3 | 282.4 | `local` | `StationEdit.StageLocalWorld` (90 ms) |
| 18 | `tunnel` | Tunnel Extension (隧道) | rail | tap | 202.4 | 192.3 | 156.8 | 179.2 | 331.2 | 336.1 | `local` | `StationEdit.StageLocalWorld` (80 ms) |
| 19 | `bridge` | Railway Bridge (轨道桥) | rail | tap | 52.4 | 65.0 | 68.2 | 72.7 | 150.4 | 147.1 | `local` | `StationEdit.StageLocalInstall` (10 ms) |
| 20 | `pillar-slim` | Slim Pillar (细柱) | structural | tap | 67.2 | 59.3 | 72.3 | 93.4 | 62.9 | 63.1 | `local` | `StationEdit.StageLocalInstall` (12 ms) |
| 21 | `pillar-thick` | Thick Pillar (粗柱) | structural | tap | 49.1 | 80.0 | 69.9 | 80.1 | 52.6 | 56.1 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 22 | `roof` | Roof Slab (屋顶板) | structural | tap | 122.6 | 72.2 | 87.1 | 88.6 | 110.8 | 110.2 | `local` | `StationEdit.StageLocalInstall` (63 ms) |
| 23 | `roof-shell` | Roof Shell (无桁架屋顶) | structural | tap | 97.2 | 84.7 | 92.8 | 105.5 | 94.0 | 94.4 | `local` | `StationEdit.StageLocalInstall` (37 ms) |
| 24 | `roof-truss` | Roof Truss (桁架屋顶) | structural | tap | 79.2 | 105.4 | 91.0 | 98.4 | 95.9 | 84.6 | `local` | `StationEdit.StageLocalInstall` (34 ms) |
| 25 | `roof-tapered` | Roof Tapered Truss (锥形桁架) | structural | tap | 125.9 | 84.2 | 93.8 | 98.9 | 86.1 | 83.4 | `local` | `StationEdit.StageLocalInstall` (60 ms) |
| 26 | `roof-canopy` | Roof Column Canopy (雨棚) | structural | tap | 89.1 | 71.7 | 80.2 | 106.4 | 92.9 | 95.2 | `local` | `StationEdit.StageLocalInstall` (37 ms) |
| 27 | `gate` | Fare Gate Old (旧闸机) | equipment | tap | 78.6 | 80.1 | 76.8 | 119.8 | 66.2 | 64.2 | `local` | `StationEdit.StageLocalWorld` (28 ms) |
| 28 | `gate-new` | Fare Gate New (新闸机) | equipment | tap | 51.7 | 55.6 | 73.4 | 78.3 | 54.3 | 58.1 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 29 | `fence` | Glass Fence (玻璃围栏) | equipment | tap | 36.9 | 40.8 | 67.2 | 62.3 | 54.1 | 55.0 | `local` | `StationEdit.CellFinish` (19 ms) |
| 30 | `fence-gate` | Fence Door (围栏门) | equipment | tap | 55.1 | 38.5 | 57.0 | 63.4 | 52.4 | 57.6 | `local` | `StationEdit.CellFinish` (33 ms) |
| 31 | `fence-steel-blue` | Blue Steel Fence (蓝钢围栏) | equipment | tap | 33.6 | 38.2 | 56.6 | 65.1 | 54.5 | 54.6 | `local` | `StationEdit.CellFinish` (15 ms) |
| 32 | `fence-iron` | Iron Fence (铁艺围栏) | equipment | tap | 33.7 | 37.9 | 57.3 | 64.4 | 52.0 | 53.8 | `local` | `StationEdit.CellFinish` (15 ms) |
| 33 | `escalator` | Escalator (扶梯) | equipment | tap | 113.3 | 172.1 | 128.6 | 113.1 | 234.8 | 235.5 | `local` | `StationEdit.StageLocalInstall` (27 ms) |
| 34 | `walkway` | Moving Walkway (自动步道) | equipment | tap | 98.6 | 82.1 | 98.8 | 101.0 | 196.9 | 203.0 | `local` | `StationEdit.StageLocalInstall` (48 ms) |
| 35 | `lift` | Lift / Elevator (电梯) | equipment | tap | 101.9 | 105.9 | 96.9 | 104.2 | 216.6 | 215.1 | `local` | `StationEdit.StageLocalInstall` (36 ms) |
| 36 | `stair-straight` | Straight Stairs (直跑楼梯) | equipment | tap | 102.9 | 99.7 | 98.8 | 103.0 | 215.1 | 204.7 | `local` | `StationEdit.StageLocalInstall` (26 ms) |
| 37 | `stair-block` | Stair Block (楼梯块) | equipment | tap | 57.9 | 80.8 | 75.8 | 81.5 | 69.9 | 65.8 | `local` | `StationEdit.StageLocalWorld` (15 ms) |
| 38 | `stair-left90` | Turning Stairs 90° (左转楼梯) | equipment | tap | 95.8 | 109.2 | 97.8 | 106.7 | 249.6 | 230.7 | `local` | `StationEdit.StageLocalInstall` (33 ms) |
| 39 | `exit` | Covered Exit (有棚出入口) | equipment | tap | 155.3 | 157.4 | 144.7 | 149.1 | 177.6 | 184.6 | `local` | `StationEdit.StageLocalWorld` (71 ms) |
| 40 | `exit-doorway-1` | Ground Doorway Exit (地面出入口) | equipment | tap | unsupported | unsupported | unsupported | unsupported | 180.8 | 180.3 | `unsupported` | — |
| 41 | `exit-virtual` | Virtual Exit (虚拟出入口) | equipment | tap | unsupported | unsupported | unsupported | unsupported | 200.7 | 215.1 | `unsupported` | — |
| 42 | `sign-ceiling` | Overhead Sign (吊挂指示牌) | decor-ceiling | tap | 49.1 | 98.0 | 74.6 | 85.9 | 69.0 | 62.9 | `local` | `StationEdit.CommitInstall` (6 ms) |
| 43 | `tv` | Single Ceiling TV (单面电视) | decor-ceiling | tap | 79.5 | 83.1 | 107.4 | 109.7 | 57.5 | 59.6 | `local` | `StationEdit.CommitLocalWorld` (42 ms) |
| 44 | `tv-double` | Double Ceiling TV (双面电视) | decor-ceiling | tap | 87.9 | 96.9 | 102.3 | 137.3 | 63.2 | 61.4 | `local` | `StationEdit.CommitLocalWorld` (42 ms) |
| 45 | `monitor-ceiling` | Ceiling Monitor (吊顶显示器) | decor-ceiling | tap | 38.3 | 40.2 | 63.3 | 66.2 | 49.7 | 118.8 | `local` | `StationEdit.StageLocalInstall` (4 ms) |
| 46 | `clock` | Analogue Clock (指针时钟) | decor-ceiling | tap | 42.7 | 47.6 | 67.7 | 101.1 | 55.0 | 57.8 | `local` | `StationEdit.CommitLocalWorld` (4 ms) |
| 47 | `clock-digital` | Digital Clock (数字时钟) | decor-ceiling | tap | 56.4 | 42.3 | 61.7 | 68.0 | 50.5 | 54.5 | `local` | `StationEdit.StageLocalInstall` (12 ms) |
| 48 | `cctv` | Bullet CCTV (枪机监控) | decor-ceiling | tap | 38.3 | 52.2 | 63.8 | 68.8 | 54.5 | 58.2 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 49 | `cctv-ptz` | PTZ CCTV (球机监控) | decor-ceiling | tap | 38.9 | 41.1 | 65.6 | 70.8 | 55.9 | 56.7 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 50 | `cctv-dome` | Dome CCTV (半球监控) | decor-ceiling | tap | 38.8 | 41.1 | 62.8 | 69.6 | 55.5 | 56.8 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 51 | `light-circular` | Circular Light (圆灯) | decor-ceiling | tap | 37.5 | 44.6 | 62.0 | 72.4 | 48.0 | 50.5 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 52 | `light-rectangular` | Strip Light (条灯) | decor-ceiling | tap | 41.6 | 39.8 | 63.1 | 70.2 | 47.0 | 47.7 | `local` | `StationEdit.CommitInstall` (5 ms) |
| 53 | `vent` | Ceiling Vent (通风口) | decor-ceiling | tap | 38.5 | 43.5 | 64.5 | 70.0 | 49.5 | 50.6 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 54 | `hanger-roof` | Roof Hanger (吊顶挂架) | decor-ceiling | tap | 51.2 | 47.4 | 66.8 | 71.9 | 51.9 | 53.9 | `local` | `StationEdit.CommitInstall` (5 ms) |
| 55 | `sign-wall` | Wall Sign (壁挂指示牌) | decor-wall | tap | 40.1 | 51.1 | 74.3 | 107.5 | 44.9 | 49.8 | `local` | `StationEdit.CommitInstall` (2 ms) |
| 56 | `billboard-wide` | Billboard 16:9 (广告牌) | decor-wall | tap | 36.8 | 38.5 | 62.2 | 85.7 | 44.5 | 46.4 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 57 | `billboard-16x9-4m` | Large Billboard 4m (大型广告牌) | decor-wall | tap | 36.7 | 41.4 | 60.4 | 74.5 | 105.3 | 112.8 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 58 | `glass-2x2` | Wall Glass 2×2 (玻璃板) | decor-wall | tap | 56.5 | 40.0 | 63.3 | 68.9 | 48.2 | 52.8 | `local` | `StationEdit.StageLocalInstall` (18 ms) |
| 59 | `calligraphy-wei-h` | Station Name Calligraphy (站名书法) | decor-wall | tap | 37.7 | 39.6 | 102.7 | 123.1 | 60.5 | 61.3 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 60 | `linemap-wall` | Wall Network Map (壁挂线网图) | decor-wall | tap | 41.9 | 42.4 | 60.0 | 66.6 | 49.6 | 52.6 | `local` | `StationEdit.CommitInstall` (5 ms) |
| 61 | `monitor-wall` | Wall Monitor (壁挂显示器) | decor-wall | tap | 37.6 | 39.1 | 64.6 | 70.1 | 57.2 | 59.6 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 62 | `urinal` | Urinal (小便池) | decor-wall | tap | 38.4 | 37.5 | 60.5 | 69.5 | 55.2 | 59.6 | `local` | `StationEdit.BuildCommitPayload` (4 ms) |
| 63 | `tvm` | Ticket Machine (售票机) | decor-floor | tap | 48.1 | 64.2 | 73.3 | 93.1 | 61.5 | 61.2 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 64 | `vending` | Vending Machine (自动售货机) | decor-floor | tap | 48.1 | 54.0 | 70.4 | 78.5 | 59.2 | 58.6 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 65 | `hanger-post` | Post Hanger (立柱挂架) | decor-floor | tap | 61.5 | 54.1 | 74.3 | 101.4 | 63.3 | 66.9 | `local` | `StationEdit.StageLocalInstall` (18 ms) |
| 66 | `electrical-cabinet` | Equipment Cabinet (设备柜) | decor-floor | tap | 45.7 | 52.5 | 71.0 | 81.1 | 57.2 | 68.3 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 67 | `tactile-guide` | Tactile Guide (行进盲道) | decor-floor | tap | 31.3 | 33.6 | 57.4 | 62.3 | 55.9 | 58.0 | `local` | `StationEdit.CellFinish` (13 ms) |
| 68 | `tactile-warning` | Tactile Warning (提示盲道) | decor-floor | tap | 36.6 | 33.2 | 55.1 | 71.1 | 55.5 | 57.0 | `local` | `StationEdit.CellFinish` (17 ms) |
| 69 | `tactile-warning-strip` | Tactile Warning Strip (条状盲道) | decor-floor | tap | 30.4 | 32.6 | 53.8 | 60.2 | 54.9 | 57.7 | `local` | `StationEdit.CellFinish` (12 ms) |
| 70 | `floor-mark-boarding` | Boarding Arrows (候车箭头) | decor-floor | tap | 30.8 | 40.1 | 54.8 | 58.1 | 53.9 | 56.4 | `local` | `StationEdit.CellFinish` (12 ms) |
| 71 | `floor-mark-waiting` | Queue Lines (排队线) | decor-floor | tap | 46.0 | 33.4 | 54.5 | 59.5 | 56.8 | 58.1 | `local` | `StationEdit.CellFinish` (24 ms) |
| 72 | `floor-mark-direction` | Direction Guide (方向指引) | decor-floor | tap | 30.6 | 33.4 | 55.5 | 58.8 | 121.7 | 59.3 | `local` | `StationEdit.CellFinish` (12 ms) |
| 73 | `bench-steel-1` | Steel Bench (不锈钢座椅) | decor-floor | tap | 47.6 | 52.9 | 71.4 | 89.5 | 56.9 | 55.5 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 74 | `bench-wood-1` | Wooden Bench (木座椅) | decor-floor | tap | 47.7 | 81.8 | 68.6 | 88.9 | 48.4 | 51.3 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 75 | `shelf-dark-tall` | Tall Retail Shelf (高货架) | decor-floor | tap | 62.0 | 55.1 | 71.4 | 82.6 | 60.3 | 61.6 | `local` | `StationEdit.StageLocalInstall` (12 ms) |
| 76 | `shelf-cooler` | Cooler Shelf (冷柜货架) | decor-floor | tap | 49.6 | 55.3 | 72.9 | 84.1 | 57.5 | 60.4 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 77 | `desk` | Office Desk (办公桌) | decor-floor | tap | 60.8 | 44.5 | 67.3 | 73.1 | 55.8 | 60.8 | `local` | `StationEdit.StageLocalWorld` (16 ms) |
| 78 | `checkout` | Shop Checkout (收银台) | decor-floor | tap | 47.7 | 54.3 | 71.3 | 79.8 | 55.9 | 61.5 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 79 | `checkout-cafe-pastry` | Cafe Pastry Counter (烘焙柜台) | decor-floor | tap | 47.3 | 52.6 | 71.0 | 80.2 | 59.2 | 61.6 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 80 | `cubicle` | Toilet Cubicle (厕所隔间) | decor-floor | tap | 47.4 | 52.5 | 69.9 | 79.4 | 57.3 | 65.2 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 81 | `cubicle-toilet` | Standalone Toilet (独立马桶) | decor-floor | tap | 50.8 | 52.0 | 70.9 | 80.2 | 57.1 | 55.1 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 82 | `sink` | Restroom Sink (洗手池) | decor-floor | tap | 48.4 | 53.7 | 71.0 | 79.2 | 65.5 | 65.0 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 83 | `bin` | Trash Bin (垃圾桶) | decor-floor | tap | 61.1 | 44.3 | 68.2 | 106.5 | 52.9 | 53.6 | `local` | `StationEdit.StageLocalInstall` (17 ms) |
| 84 | `extinguisher` | Fire Cabinet (灭火器箱) | decor-floor | tap | 42.8 | 44.6 | 66.3 | 72.8 | 52.8 | 56.5 | `local` | `StationEdit.StageLocalWorld` (6 ms) |
| 85 | `curtain-wall` | Glass Curtain Wall (玻璃幕墙) | decor-floor | tap | 37.2 | 39.4 | 62.4 | 68.0 | 53.4 | 52.9 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 86 | `psd-end` | PSD End Door (屏蔽端门) | decor-floor | tap | 68.6 | 50.5 | 71.2 | 86.7 | 52.3 | 56.8 | `local` | `StationEdit.StageLocalInstall` (22 ms) |
| 87 | `psd-end-cover` | PSD Screen Cover (屏蔽门盖板) | decor-floor | tap | 62.7 | 53.9 | 69.8 | 83.6 | 42.1 | 46.1 | `local` | `StationEdit.StageLocalInstall` (24 ms) |
| 88 | `rail-signal` | Rail Signal (信号机) | decor-floor | tap | 40.9 | 52.1 | 71.2 | 74.1 | 59.0 | 60.5 | `local` | `StationEdit.StageLocalWorld` (4 ms) |
| 89 | `linemap-stand` | Standing Network Map (立式线网图) | decor-floor | tap | 37.7 | 40.1 | 62.1 | 67.3 | 50.9 | 53.7 | `local` | `StationEdit.StageLocalInstall` (2 ms) |
| 90 | `door-steel-1` | Steel Doorway (不锈钢门) | decor-floor | tap | 46.6 | 53.1 | 67.4 | 80.1 | 52.3 | 54.3 | `local` | `StationEdit.StageLocalInstall` (9 ms) |
| 91 | `noise-barrier` | Noise Barrier (全高声屏障) | decor-floor | tap | 34.0 | 40.5 | 57.7 | 71.8 | 51.9 | 55.4 | `local` | `StationEdit.CellFinish` (15 ms) |
| 92 | `sidewalk` | Sidewalk Tile (人行道) | decor-outdoor | tap | 91.3 | 89.5 | 88.7 | 109.3 | 135.5 | 143.7 | `local` | `StationEdit.StageLocalInstall` (27 ms) |
| 93 | `lawn` | Lawn Tile (草坪) | decor-outdoor | tap | 83.2 | 139.9 | 83.2 | 93.0 | 128.0 | 127.3 | `local` | `StationEdit.StageLocalInstall` (27 ms) |
| 94 | `tree` | Street Tree (行道树) | decor-outdoor | tap | 92.8 | 79.6 | 174.1 | 182.0 | 127.3 | 127.2 | `local` | `StationEdit.StageLocalInstall` (25 ms) |
| 95 | `road` | Road Segment 14m (道路) | decor-outdoor | drag | 95.5 | 167.3 | 95.8 | 106.1 | 245.3 | 256.8 | `local` | `StationEdit.StageLocalInstall` (30 ms) |
| 96 | `traffic-light` | Traffic Light (红绿灯) | decor-outdoor | tap | unsupported | unsupported | unsupported | unsupported | 103.4 | 119.0 | `unsupported` | — |
| 97 | `ac-unit` | Outdoor AC Unit (空调外机) | decor-outdoor | tap | 87.7 | 94.3 | 90.5 | 97.7 | 102.6 | 102.5 | `local` | `StationEdit.StageLocalInstall` (39 ms) |
| 98 | `guidepost` | Wayfinding Post (导向柱) | decor-outdoor | tap | 92.3 | 83.5 | 119.5 | 119.0 | 175.5 | 175.4 | `local` | `StationEdit.StageLocalInstall` (31 ms) |
| 99 | `busstop-short` | Bus Stop Shelter (公交站) | decor-outdoor | tap | 71.4 | 77.6 | 87.1 | 102.5 | 96.6 | 106.4 | `local` | `StationEdit.StageLocalInstall` (24 ms) |
| 100 | `cctv-post` | Outdoor Post CCTV (立柱监控) | decor-outdoor | tap | 72.8 | 111.2 | 90.6 | 113.3 | 100.7 | 99.5 | `local` | `StationEdit.StageLocalInstall` (24 ms) |
| 101 | `court-pickleball` | Pickleball Court (匹克球场) | decor-outdoor | tap | 74.6 | 104.8 | 85.6 | 100.6 | 176.8 | 174.4 | `local` | `StationEdit.StageLocalInstall` (25 ms) |
| 102 | `court-divider` | Court Divider Net (球场分隔网) | decor-outdoor | tap | 82.0 | 83.1 | 74.7 | 85.6 | 99.3 | 100.2 | `local` | `StationEdit.CellFinish` (62 ms) |

## Complete 102-Object Pick Latency Matrix (ms, Click → Picked / Rendered)

_Format: Unity columns show `Host Ack / React UI Adopt` ms (`n/a` when object is a cell/zone with no movable module); Web columns show `Render End / Presented` ms._

| # | Object ID | Category | Unity Exe 0× Move | Unity Exe 0× Eye/Sel | Unity Exe 1× Move | Unity Exe 1× Eye/Sel | Unity WebGL 0× Move | Unity WebGL 0× Eye/Sel | Unity WebGL 1× Move | Unity WebGL 1× Eye/Sel | Web 0× Move | Web 0× Eye/Sel | Web 1× Move | Web 1× Eye/Sel |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `room:ticket` | room | 38.8 / 52.7 | 21.9 / 46.4 | 38.2 / 48.0 | 22.3 / 47.4 | 27.6 / 110.8 | 17.6 / 58.9 | 27.2 / 84.5 | 17.8 / 129.6 | n/a | 33.1 / 86.5 | n/a | 58.9 / 225.4 |
| 2 | `room:info` | room | 28.1 / 62.1 | 20.4 / 47.1 | 28.3 / 48.6 | 19.8 / 45.2 | 27.5 / 85.3 | 17.4 / 67.8 | 24.4 / 68.1 | 18.0 / 59.3 | n/a | 30.6 / 137.1 | n/a | 31.5 / 99.5 |
| 3 | `room:store` | room | n/a | 17.1 / 46.6 | n/a | 17.3 / 46.8 | n/a | 15.3 / 67.7 | n/a | 15.1 / 68.3 | n/a | 53.9 / 119.8 | n/a | 53.9 / 143.4 |
| 4 | `room:toilet` | room | n/a | 16.9 / 45.0 | n/a | 31.3 / 46.0 | n/a | 14.8 / 67.8 | n/a | 15.2 / 65.5 | n/a | 48.3 / 153.1 | n/a | 54.4 / 119.2 |
| 5 | `room:office` | room | n/a | 16.3 / 45.5 | n/a | 18.8 / 47.2 | n/a | 14.7 / 54.8 | n/a | 15.0 / 67.5 | n/a | 47.5 / 127.1 | n/a | 49.2 / 148.1 |
| 6 | `zone:unpaid` | zone | n/a | 15.7 / 46.5 | n/a | 17.8 / 46.6 | n/a | 15.2 / 64.9 | n/a | 15.3 / 64.2 | n/a | 27.2 / 111.7 | n/a | 30.0 / 94.7 |
| 7 | `zone:paid` | zone | n/a | 16.5 / 46.4 | n/a | 16.3 / 47.3 | n/a | 15.3 / 54.6 | n/a | 15.2 / 63.9 | n/a | 46.9 / 111.8 | n/a | 47.7 / 148.4 |
| 8 | `zone:none` | zone | n/a | 15.7 / 32.0 | n/a | 16.3 / 45.5 | n/a | 15.2 / 97.2 | n/a | 15.3 / 63.9 | n/a | 48.1 / 148.6 | n/a | 49.2 / 113.8 |
| 9 | `block` | structural | n/a | 18.2 / 48.2 | n/a | 20.8 / 46.2 | n/a | 15.5 / 66.4 | n/a | 15.2 / 64.0 | n/a | 46.2 / 114.8 | n/a | 46.9 / 118.0 |
| 10 | `block/auto-walls` | structural | n/a | 18.4 / 44.3 | n/a | 17.0 / 47.1 | n/a | 15.3 / 65.3 | n/a | 15.2 / 66.2 | n/a | 43.9 / 145.9 | n/a | 44.0 / 144.2 |
| 11 | `wall` | structural | n/a | 16.4 / 46.6 | n/a | 17.4 / 47.0 | n/a | 15.0 / 67.7 | n/a | 15.0 / 63.7 | n/a | 44.8 / 114.6 | n/a | 46.4 / 131.9 |
| 12 | `half-wall` | structural | n/a | 19.3 / 46.5 | n/a | 18.4 / 31.6 | n/a | 15.1 / 64.0 | n/a | 15.3 / 63.3 | n/a | 45.2 / 111.3 | n/a | 46.7 / 117.3 |
| 13 | `half-corner` | structural | n/a | 16.6 / 46.6 | n/a | 18.2 / 46.7 | n/a | 15.2 / 65.5 | n/a | 15.1 / 69.3 | n/a | 45.9 / 113.9 | n/a | 46.9 / 102.5 |
| 14 | `tri-upper` | structural | n/a | 17.2 / 46.1 | n/a | 18.6 / 46.6 | n/a | 14.9 / 61.6 | n/a | 14.8 / 63.6 | n/a | 45.7 / 115.2 | n/a | 47.5 / 115.9 |
| 15 | `tri-lower` | structural | n/a | 17.8 / 47.6 | n/a | 18.2 / 46.4 | n/a | 15.2 / 64.1 | n/a | 15.0 / 65.0 | n/a | 45.7 / 115.8 | n/a | 48.8 / 117.5 |
| 16 | `suspended-ceiling` | structural | n/a | 18.3 / 47.8 | n/a | 18.3 / 46.7 | n/a | 14.9 / 63.9 | n/a | 14.9 / 55.8 | n/a | 49.4 / 147.9 | n/a | 46.7 / 113.7 |
| 17 | `platform` | rail | 62.8 / 75.4 | 28.2 / 49.1 | 44.6 / 62.4 | 27.4 / 47.2 | 28.2 / 82.5 | 18.6 / 70.8 | 30.2 / 82.9 | 18.8 / 113.5 | n/a | 42.9 / 122.7 | n/a | 42.6 / 114.9 |
| 18 | `tunnel` | rail | 36.6 / 53.4 | 25.9 / 47.8 | 32.0 / 51.7 | 24.6 / 48.1 | 29.7 / 99.9 | 28.7 / 103.8 | 26.4 / 85.9 | 19.2 / 76.6 | n/a | 37.9 / 128.9 | n/a | 40.2 / 114.6 |
| 19 | `bridge` | rail | 33.3 / 63.8 | 23.5 / 45.8 | 33.6 / 47.3 | 24.1 / 50.9 | 23.9 / 84.6 | 18.5 / 71.8 | 25.1 / 84.5 | 18.7 / 81.2 | n/a | 28.8 / 133.8 | n/a | 30.2 / 85.7 |
| 20 | `pillar-slim` | structural | 38.4 / 46.0 | 19.8 / 33.4 | 54.5 / 56.1 | 20.9 / 46.3 | 28.4 / 67.2 | 17.4 / 119.3 | 31.1 / 79.3 | 18.8 / 112.7 | 63.5 / 132.1 | 29.5 / 130.4 | 67.5 / 141.2 | 30.0 / 86.6 |
| 21 | `pillar-thick` | structural | 39.5 / 46.8 | 20.1 / 48.8 | 45.7 / 50.2 | 20.4 / 46.2 | 28.6 / 65.9 | 17.4 / 103.0 | 30.4 / 73.7 | 17.7 / 110.9 | 56.4 / 114.6 | 28.5 / 113.6 | 59.1 / 114.7 | 29.8 / 131.1 |
| 22 | `roof` | structural | 30.9 / 46.4 | 22.8 / 45.1 | 32.9 / 46.8 | 21.6 / 46.4 | 22.8 / 66.9 | 17.2 / 100.9 | 23.8 / 63.3 | 16.7 / 99.9 | n/a | 36.5 / 100.0 | n/a | 41.1 / 105.8 |
| 23 | `roof-shell` | structural | 29.9 / 37.1 | 20.9 / 46.9 | 32.1 / 45.9 | 21.5 / 46.5 | 22.7 / 66.3 | 17.9 / 102.4 | 23.6 / 91.4 | 17.1 / 79.6 | n/a | 61.2 / 124.3 | n/a | 63.8 / 129.8 |
| 24 | `roof-truss` | structural | 34.1 / 46.7 | 21.0 / 47.3 | 34.2 / 49.7 | 25.2 / 33.1 | 23.9 / 66.3 | 17.7 / 85.3 | 24.6 / 64.2 | 17.6 / 103.0 | n/a | 58.8 / 118.6 | n/a | 61.4 / 123.7 |
| 25 | `roof-tapered` | structural | 34.8 / 47.1 | 24.6 / 46.6 | 31.6 / 46.3 | 22.4 / 46.9 | 23.7 / 69.9 | 18.2 / 86.4 | 23.5 / 63.5 | 16.6 / 91.2 | n/a | 57.0 / 133.2 | n/a | 58.4 / 137.0 |
| 26 | `roof-canopy` | structural | 32.7 / 46.1 | 21.4 / 46.9 | 48.5 / 55.0 | 21.5 / 47.2 | 23.4 / 65.6 | 17.0 / 101.5 | 24.0 / 79.3 | 17.6 / 94.0 | n/a | 37.8 / 94.1 | n/a | 41.8 / 97.5 |
| 27 | `gate` | equipment | 48.4 / 50.0 | 20.8 / 46.7 | 45.2 / 47.3 | 21.4 / 40.2 | 29.7 / 81.3 | 17.2 / 107.1 | 31.2 / 73.5 | 17.6 / 95.5 | 59.2 / 130.1 | 29.6 / 144.4 | 59.7 / 129.6 | 30.3 / 104.9 |
| 28 | `gate-new` | equipment | 58.3 / 62.7 | 20.8 / 47.5 | 52.6 / 57.3 | 21.1 / 45.8 | 29.5 / 66.4 | 17.4 / 105.1 | 32.4 / 82.7 | 18.3 / 99.4 | 58.3 / 125.2 | 29.8 / 136.3 | 57.0 / 120.5 | 30.6 / 101.1 |
| 29 | `fence` | equipment | 28.8 / 46.3 | 20.5 / 44.7 | 31.1 / 50.3 | 20.4 / 45.7 | 24.0 / 66.1 | 17.0 / 86.8 | 25.6 / 82.9 | 17.6 / 97.7 | 57.6 / 128.5 | 28.9 / 100.0 | 56.7 / 127.8 | 29.1 / 130.7 |
| 30 | `fence-gate` | equipment | 29.8 / 47.2 | 20.5 / 46.8 | 55.5 / 60.8 | 21.0 / 49.4 | 23.5 / 64.3 | 17.3 / 105.5 | 24.8 / 78.2 | 18.0 / 97.3 | 55.8 / 116.2 | 28.9 / 140.7 | 56.3 / 128.6 | 29.3 / 133.3 |
| 31 | `fence-steel-blue` | equipment | 29.1 / 46.6 | 23.4 / 48.2 | 31.0 / 50.4 | 21.2 / 46.4 | 23.5 / 72.3 | 17.3 / 105.3 | 24.0 / 78.4 | 17.4 / 100.8 | 59.1 / 126.8 | 28.2 / 139.2 | 57.6 / 114.4 | 29.5 / 87.9 |
| 32 | `fence-iron` | equipment | 28.7 / 47.5 | 19.5 / 47.1 | 35.2 / 46.0 | 20.4 / 34.8 | 24.5 / 73.4 | 17.9 / 103.3 | 23.8 / 77.0 | 17.3 / 101.7 | 54.3 / 107.6 | 30.9 / 98.5 | 61.9 / 138.3 | 30.2 / 103.6 |
| 33 | `escalator` | equipment | 39.7 / 45.9 | 22.9 / 39.0 | 41.4 / 47.6 | 22.2 / 46.3 | 29.0 / 79.3 | 17.7 / 122.9 | 29.8 / 79.4 | 17.9 / 103.5 | 73.1 / 141.1 | 40.7 / 106.2 | 73.9 / 145.2 | 39.8 / 105.1 |
| 34 | `walkway` | equipment | 39.9 / 50.8 | 21.3 / 45.5 | 43.1 / 46.9 | 22.7 / 47.3 | 29.3 / 77.8 | 16.9 / 105.3 | 29.6 / 78.8 | 17.4 / 96.6 | 114.4 / 189.3 | 36.7 / 120.7 | 122.0 / 193.0 | 36.6 / 119.2 |
| 35 | `lift` | equipment | 63.9 / 69.2 | 22.5 / 45.1 | 50.1 / 52.1 | 23.8 / 47.4 | 29.5 / 82.9 | 17.4 / 105.0 | 31.5 / 72.1 | 17.4 / 88.2 | n/a | 35.5 / 107.2 | n/a | 37.6 / 128.5 |
| 36 | `stair-straight` | equipment | 41.2 / 47.1 | 21.5 / 52.4 | 40.9 / 47.9 | 21.6 / 47.0 | 29.3 / 73.8 | 18.1 / 105.6 | 31.3 / 81.6 | 17.5 / 111.3 | 99.8 / 174.8 | 34.3 / 117.2 | 78.2 / 146.0 | 35.0 / 118.7 |
| 37 | `stair-block` | equipment | 39.0 / 49.0 | 19.9 / 47.2 | 41.3 / 47.0 | 21.3 / 46.7 | 28.5 / 80.8 | 17.7 / 103.2 | 30.6 / 81.0 | 17.8 / 97.5 | 58.6 / 127.6 | 28.4 / 136.4 | 65.1 / 135.7 | 29.5 / 132.0 |
| 38 | `stair-left90` | equipment | 41.3 / 47.7 | 22.6 / 45.8 | 40.6 / 49.7 | 27.7 / 47.0 | 29.7 / 85.4 | 17.3 / 107.8 | 31.8 / 80.8 | 17.5 / 120.2 | 84.7 / 162.3 | 35.4 / 99.5 | 82.5 / 152.0 | 36.5 / 104.5 |
| 39 | `exit` | equipment | 48.2 / 50.4 | 41.2 / 46.5 | 58.1 / 63.3 | 23.7 / 47.4 | 31.3 / 83.2 | 17.4 / 89.0 | 32.5 / 83.6 | 19.5 / 93.1 | 72.5 / 138.8 | 35.9 / 121.8 | 74.3 / 142.9 | 35.7 / 103.0 |
| 40 | `exit-doorway-1` | equipment | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 79.4 / 178.8 | 27.5 / 98.0 | 79.6 / 143.3 | 34.0 / 167.6 |
| 41 | `exit-virtual` | equipment | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 70.5 / 142.4 | 35.2 / 104.1 | 64.9 / 136.7 | 35.2 / 99.5 |
| 42 | `sign-ceiling` | decor-ceiling | n/a | 16.7 / 48.5 | n/a | 16.3 / 46.3 | n/a | 14.7 / 51.3 | 37.1 / 83.2 | 17.9 / 98.1 | 80.9 / 112.2 | 30.5 / 90.6 | 84.7 / 142.0 | 32.1 / 89.9 |
| 43 | `tv` | decor-ceiling | 37.6 / 45.4 | 20.2 / 45.6 | 42.8 / 48.9 | 20.3 / 46.9 | 30.6 / 82.8 | 17.4 / 104.4 | 32.1 / 72.7 | 18.1 / 109.7 | 90.2 / 160.8 | 30.4 / 86.0 | 91.3 / 147.5 | 29.1 / 98.9 |
| 44 | `tv-double` | decor-ceiling | 41.0 / 46.6 | 19.4 / 45.5 | 40.5 / 47.6 | 19.9 / 46.1 | 29.1 / 82.8 | 17.4 / 88.6 | 30.7 / 72.2 | 17.4 / 100.1 | 89.3 / 152.8 | 28.3 / 141.7 | 88.8 / 152.1 | 29.6 / 132.5 |
| 45 | `monitor-ceiling` | decor-ceiling | 38.4 / 49.1 | 20.0 / 46.8 | 42.1 / 47.4 | 21.7 / 45.9 | 29.1 / 72.5 | 17.5 / 105.0 | 30.1 / 72.8 | 17.7 / 100.4 | 72.8 / 138.4 | 29.3 / 134.4 | 76.0 / 154.1 | 30.8 / 95.1 |
| 46 | `clock` | decor-ceiling | 59.8 / 64.3 | 21.3 / 46.8 | 61.1 / 66.3 | 23.4 / 45.7 | 32.6 / 81.9 | 17.6 / 103.7 | 34.4 / 79.9 | 18.4 / 94.1 | 76.7 / 147.8 | 29.1 / 145.4 | 79.1 / 148.3 | 32.2 / 95.4 |
| 47 | `clock-digital` | decor-ceiling | 84.3 / 86.2 | 22.0 / 45.6 | 45.4 / 49.6 | 21.7 / 45.0 | 29.5 / 82.8 | 17.3 / 105.0 | 34.2 / 79.4 | 17.8 / 101.0 | 161.8 / 220.3 | 30.2 / 132.7 | 75.4 / 140.5 | 33.2 / 131.6 |
| 48 | `cctv` | decor-ceiling | 44.9 / 48.3 | 20.7 / 48.9 | 58.6 / 64.2 | 21.6 / 46.1 | 29.2 / 70.6 | 19.0 / 105.5 | 31.6 / 69.9 | 18.0 / 106.3 | 76.1 / 151.0 | 30.1 / 135.9 | 76.5 / 140.0 | 31.3 / 89.8 |
| 49 | `cctv-ptz` | decor-ceiling | 48.7 / 50.4 | 21.0 / 45.6 | 44.9 / 48.6 | 22.6 / 32.6 | 29.9 / 81.4 | 17.4 / 106.9 | 31.8 / 72.0 | 18.1 / 102.9 | 72.9 / 131.0 | 29.0 / 144.2 | 76.1 / 157.1 | 31.1 / 107.1 |
| 50 | `cctv-dome` | decor-ceiling | 44.3 / 51.0 | 21.5 / 48.8 | 49.9 / 56.7 | 23.6 / 51.8 | 30.9 / 80.6 | 17.4 / 106.3 | 31.6 / 78.3 | 17.7 / 104.2 | 73.5 / 131.7 | 29.7 / 144.5 | 78.1 / 142.0 | 31.0 / 111.0 |
| 51 | `light-circular` | decor-ceiling | 37.7 / 46.1 | 20.0 / 35.3 | 39.5 / 46.3 | 21.7 / 46.7 | 28.1 / 80.9 | 17.1 / 102.4 | 30.7 / 69.2 | 18.9 / 96.0 | 68.9 / 140.2 | 28.6 / 114.1 | 68.6 / 130.4 | 31.0 / 108.0 |
| 52 | `light-rectangular` | decor-ceiling | 42.0 / 46.2 | 20.9 / 47.5 | 41.0 / 47.1 | 19.9 / 47.1 | 27.9 / 81.1 | 17.4 / 105.0 | 31.6 / 73.1 | 17.9 / 102.6 | 67.8 / 140.6 | 29.3 / 132.1 | 69.0 / 133.9 | 32.3 / 94.8 |
| 53 | `vent` | decor-ceiling | 42.9 / 49.1 | 21.6 / 47.2 | 50.7 / 54.8 | 22.9 / 45.5 | 29.2 / 66.5 | 17.5 / 104.6 | 31.7 / 79.5 | 17.6 / 97.4 | 68.7 / 124.7 | 29.0 / 113.6 | 70.6 / 143.9 | 30.8 / 89.2 |
| 54 | `hanger-roof` | decor-ceiling | 58.1 / 62.6 | 21.6 / 45.9 | 48.4 / 50.2 | 25.2 / 52.6 | 33.8 / 82.1 | 17.2 / 165.8 | 36.1 / 80.0 | 18.3 / 102.4 | 73.9 / 133.3 | 30.2 / 132.1 | 75.4 / 147.6 | 33.4 / 97.8 |
| 55 | `sign-wall` | decor-wall | 53.3 / 54.9 | 21.2 / 48.1 | 48.6 / 53.6 | 21.1 / 49.3 | 29.3 / 79.5 | 17.4 / 122.6 | 31.0 / 71.6 | 18.1 / 129.2 | 60.1 / 125.1 | 28.2 / 135.2 | 65.0 / 122.4 | 30.9 / 133.1 |
| 56 | `billboard-wide` | decor-wall | 38.8 / 46.3 | 20.6 / 44.4 | 39.7 / 48.1 | 22.9 / 45.6 | 28.6 / 82.0 | 17.3 / 89.6 | 30.2 / 80.9 | 18.5 / 95.2 | 59.0 / 123.8 | 27.0 / 130.6 | 60.1 / 128.8 | 28.5 / 140.9 |
| 57 | `billboard-16x9-4m` | decor-wall | 40.8 / 47.2 | 21.6 / 45.5 | 42.4 / 45.8 | 21.7 / 49.4 | 28.0 / 65.8 | 17.7 / 88.0 | 30.5 / 72.5 | 17.7 / 91.6 | 149.5 / 211.9 | 27.4 / 130.4 | 157.9 / 215.1 | 30.4 / 89.9 |
| 58 | `glass-2x2` | decor-wall | 36.0 / 47.2 | 19.6 / 47.5 | 38.1 / 48.9 | 20.8 / 45.6 | 27.3 / 66.4 | 17.1 / 88.6 | 31.9 / 73.1 | 17.8 / 86.5 | 68.6 / 120.6 | 27.4 / 132.0 | 70.7 / 124.1 | 71.2 / 113.1 |
| 59 | `calligraphy-wei-h` | decor-wall | 37.0 / 46.7 | 19.9 / 46.1 | 38.4 / 45.7 | 20.7 / 46.4 | 27.9 / 67.6 | 17.1 / 67.9 | 30.6 / 82.0 | 18.9 / 68.5 | 84.1 / 162.2 | 27.6 / 131.6 | 83.3 / 146.7 | 29.0 / 140.8 |
| 60 | `linemap-wall` | decor-wall | 37.7 / 44.7 | 20.2 / 46.1 | 42.6 / 47.6 | 20.9 / 48.9 | 28.3 / 81.6 | 17.6 / 104.6 | 31.4 / 80.1 | 17.9 / 104.9 | 67.3 / 130.7 | 28.6 / 135.2 | 68.2 / 146.2 | 30.8 / 133.3 |
| 61 | `monitor-wall` | decor-wall | 40.2 / 44.8 | 20.3 / 46.1 | 48.7 / 53.4 | 22.2 / 45.7 | 31.4 / 73.0 | 17.6 / 104.8 | 33.4 / 186.4 | 18.4 / 106.4 | 78.6 / 146.6 | 27.9 / 137.1 | 80.4 / 142.9 | 30.6 / 138.2 |
| 62 | `urinal` | decor-wall | n/a | 16.8 / 46.6 | n/a | 16.0 / 47.4 | n/a | 15.0 / 66.3 | n/a | 15.6 / 65.8 | 79.4 / 161.1 | 27.3 / 130.2 | 84.4 / 144.0 | 31.0 / 93.6 |
| 63 | `tvm` | decor-floor | 55.7 / 60.0 | 20.8 / 45.3 | 42.6 / 46.2 | 24.0 / 49.6 | 29.0 / 72.0 | 17.1 / 122.3 | 32.9 / 82.7 | 17.6 / 137.5 | 54.0 / 110.6 | 29.0 / 115.3 | 55.6 / 118.0 | 30.8 / 90.0 |
| 64 | `vending` | decor-floor | 39.4 / 49.5 | 19.8 / 47.8 | 43.1 / 44.9 | 24.7 / 49.9 | 30.0 / 82.4 | 17.6 / 105.0 | 31.6 / 73.1 | 18.2 / 103.8 | 55.6 / 119.4 | 29.2 / 84.8 | 56.2 / 117.0 | 31.0 / 105.7 |
| 65 | `hanger-post` | decor-floor | 37.1 / 49.5 | 20.0 / 46.5 | 39.4 / 45.6 | 20.5 / 47.4 | 28.4 / 81.8 | 17.1 / 107.7 | 31.0 / 83.5 | 18.1 / 94.3 | 59.9 / 134.3 | 29.7 / 100.5 | 62.1 / 131.6 | 33.0 / 100.5 |
| 66 | `electrical-cabinet` | decor-floor | 40.9 / 49.2 | 20.3 / 49.5 | 43.9 / 48.6 | 24.3 / 53.7 | 29.7 / 78.3 | 17.6 / 90.1 | 31.9 / 79.1 | 17.9 / 82.0 | 71.8 / 142.3 | 30.0 / 100.1 | 62.5 / 150.6 | 33.3 / 103.4 |
| 67 | `tactile-guide` | decor-floor | 33.6 / 47.0 | 21.8 / 47.9 | 39.5 / 44.7 | 21.8 / 46.0 | 23.7 / 65.8 | 17.5 / 104.5 | 24.1 / 84.7 | 17.9 / 92.3 | 69.7 / 124.9 | 28.5 / 112.8 | 55.0 / 127.7 | 30.5 / 141.4 |
| 68 | `tactile-warning` | decor-floor | 30.9 / 44.1 | 20.5 / 47.5 | 30.4 / 37.8 | 22.7 / 49.1 | 23.4 / 78.6 | 17.3 / 104.4 | 24.8 / 73.4 | 17.8 / 104.6 | 61.4 / 123.8 | 29.8 / 131.0 | 61.5 / 135.5 | 31.3 / 112.4 |
| 69 | `tactile-warning-strip` | decor-floor | 28.5 / 46.5 | 20.9 / 48.5 | 33.1 / 50.1 | 34.3 / 47.2 | 23.7 / 80.5 | 17.6 / 104.5 | 26.3 / 91.9 | 17.6 / 91.1 | 62.9 / 119.1 | 30.0 / 115.3 | 62.9 / 141.3 | 31.8 / 91.9 |
| 70 | `floor-mark-boarding` | decor-floor | 32.4 / 51.5 | 20.6 / 46.8 | 144.0 / 153.7 | 21.6 / 50.2 | 23.3 / 77.2 | 17.4 / 88.3 | n/a | 15.4 / 50.4 | 56.9 / 114.5 | 30.2 / 101.6 | 58.4 / 116.4 | 31.3 / 141.9 |
| 71 | `floor-mark-waiting` | decor-floor | 33.3 / 50.7 | 20.5 / 47.8 | 29.5 / 46.8 | 21.1 / 46.4 | 24.5 / 71.2 | 17.7 / 104.2 | 25.4 / 69.4 | 18.1 / 89.5 | 57.4 / 113.7 | 29.7 / 86.5 | 57.7 / 118.2 | 30.8 / 107.1 |
| 72 | `floor-mark-direction` | decor-floor | 32.0 / 46.1 | 20.0 / 49.1 | 29.5 / 47.1 | 21.3 / 46.3 | 23.4 / 65.5 | 17.6 / 119.7 | 24.3 / 83.2 | 17.6 / 118.7 | 58.1 / 138.2 | 30.0 / 115.8 | 61.9 / 125.5 | 32.1 / 115.0 |
| 73 | `bench-steel-1` | decor-floor | n/a | 17.0 / 44.6 | n/a | 17.8 / 44.6 | n/a | 14.9 / 50.5 | 30.0 / 72.9 | 18.9 / 92.1 | 54.9 / 125.6 | 28.4 / 140.7 | 53.7 / 115.8 | 30.3 / 105.5 |
| 74 | `bench-wood-1` | decor-floor | 38.5 / 47.2 | 20.6 / 45.9 | 39.4 / 49.5 | 21.4 / 46.1 | 29.2 / 79.7 | 17.2 / 104.9 | 31.1 / 81.4 | 18.1 / 93.2 | 50.9 / 122.3 | 28.9 / 113.0 | 51.0 / 114.1 | 29.9 / 107.3 |
| 75 | `shelf-dark-tall` | decor-floor | 42.2 / 47.5 | 20.3 / 53.3 | 44.9 / 48.8 | 22.1 / 49.6 | 33.8 / 82.4 | 17.8 / 108.0 | 34.9 / 74.3 | 18.9 / 367.4 | 58.8 / 117.0 | 31.7 / 115.4 | 58.8 / 120.4 | 33.6 / 109.6 |
| 76 | `shelf-cooler` | decor-floor | 49.8 / 53.2 | 20.3 / 45.5 | 43.5 / 49.7 | 21.9 / 46.0 | 32.0 / 81.6 | 18.5 / 105.0 | 35.1 / 79.8 | 18.4 / 123.9 | 59.6 / 129.4 | 31.6 / 134.2 | 58.9 / 121.2 | 35.4 / 101.1 |
| 77 | `desk` | decor-floor | 62.1 / 66.3 | 21.3 / 47.7 | 46.9 / 49.1 | 22.6 / 51.9 | 30.3 / 82.3 | 17.7 / 90.7 | 31.7 / 73.3 | 17.8 / 89.9 | 60.5 / 130.3 | 30.2 / 145.0 | 57.4 / 117.3 | 30.0 / 91.0 |
| 78 | `checkout` | decor-floor | 38.5 / 48.8 | 19.9 / 53.1 | 42.9 / 46.9 | 23.8 / 50.9 | 30.1 / 80.2 | 17.3 / 105.9 | 31.3 / 73.5 | 17.6 / 93.5 | 58.9 / 121.7 | 32.1 / 109.5 | 66.7 / 136.1 | 49.6 / 177.2 |
| 79 | `checkout-cafe-pastry` | decor-floor | 40.1 / 48.6 | 20.7 / 46.9 | 53.1 / 58.0 | 22.8 / 46.8 | 30.6 / 81.0 | 18.0 / 90.1 | 33.1 / 79.9 | 18.4 / 105.9 | 61.5 / 125.4 | 32.1 / 136.1 | 63.6 / 129.6 | 30.8 / 107.7 |
| 80 | `cubicle` | decor-floor | 39.6 / 46.7 | 20.3 / 46.7 | 44.5 / 48.4 | 22.4 / 46.5 | 28.9 / 81.0 | 17.2 / 153.9 | 31.8 / 72.8 | 18.1 / 92.4 | 61.1 / 119.4 | 31.2 / 116.3 | 67.4 / 128.6 | 30.9 / 90.2 |
| 81 | `cubicle-toilet` | decor-floor | 41.1 / 46.6 | 22.1 / 52.4 | 41.3 / 46.2 | 21.0 / 49.3 | 29.2 / 83.0 | 17.8 / 105.7 | 30.2 / 79.8 | 18.1 / 91.3 | 57.6 / 130.4 | 29.7 / 115.3 | 55.7 / 116.9 | 30.8 / 107.4 |
| 82 | `sink` | decor-floor | 55.3 / 57.4 | 20.3 / 45.7 | 53.8 / 58.2 | 21.8 / 38.7 | 31.5 / 80.2 | 18.4 / 104.3 | 33.2 / 81.5 | 18.1 / 94.6 | 59.0 / 116.4 | 29.4 / 101.8 | 67.6 / 148.1 | 31.1 / 109.5 |
| 83 | `bin` | decor-floor | 39.0 / 46.5 | 20.5 / 49.7 | 42.0 / 47.5 | 21.7 / 46.7 | 29.7 / 82.6 | 17.4 / 104.5 | 30.3 / 82.8 | 17.3 / 95.2 | 55.3 / 117.8 | 29.1 / 92.6 | 58.5 / 135.1 | 29.9 / 106.7 |
| 84 | `extinguisher` | decor-floor | 45.1 / 49.6 | 20.3 / 53.5 | 43.7 / 47.4 | 21.3 / 50.5 | 30.1 / 82.3 | 17.9 / 105.8 | 31.2 / 74.2 | 18.8 / 88.4 | 51.4 / 107.3 | 29.1 / 132.2 | 55.7 / 134.0 | 30.5 / 89.0 |
| 85 | `curtain-wall` | decor-floor | 44.0 / 47.8 | 19.7 / 45.0 | 53.9 / 55.2 | 20.3 / 45.9 | 28.2 / 66.6 | 17.2 / 104.6 | 27.5 / 66.5 | 18.3 / 109.7 | 59.8 / 134.8 | 33.8 / 138.0 | 59.0 / 134.6 | 30.5 / 94.9 |
| 86 | `psd-end` | decor-floor | 39.4 / 48.5 | 19.9 / 45.7 | 48.8 / 50.5 | 20.9 / 47.3 | 28.5 / 131.5 | 18.0 / 103.5 | 29.7 / 74.1 | 17.4 / 106.4 | 63.5 / 120.8 | 29.3 / 132.5 | 64.6 / 142.3 | 31.5 / 91.6 |
| 87 | `psd-end-cover` | decor-floor | 40.0 / 46.2 | 21.8 / 45.8 | 45.0 / 48.7 | 22.7 / 46.6 | 29.2 / 82.2 | 18.0 / 104.7 | 31.6 / 81.6 | 18.2 / 103.3 | 54.4 / 110.0 | 28.3 / 123.2 | 55.7 / 130.5 | 30.0 / 107.4 |
| 88 | `rail-signal` | decor-floor | 37.4 / 50.3 | 21.6 / 45.2 | 50.1 / 54.6 | 20.1 / 45.6 | 28.9 / 82.3 | 17.9 / 104.5 | 30.3 / 82.1 | 17.5 / 93.5 | 58.7 / 129.3 | 29.1 / 144.1 | 59.7 / 124.1 | 30.8 / 110.3 |
| 89 | `linemap-stand` | decor-floor | 39.0 / 47.1 | 21.6 / 71.6 | 38.9 / 48.0 | 21.3 / 47.2 | 30.1 / 77.1 | 17.9 / 105.9 | 29.8 / 81.9 | 17.6 / 90.0 | 49.7 / 106.3 | 31.2 / 134.4 | 51.7 / 118.1 | 32.0 / 99.4 |
| 90 | `door-steel-1` | decor-floor | 45.5 / 49.2 | 21.2 / 47.5 | 61.4 / 63.4 | 22.3 / 46.8 | 29.5 / 82.2 | 17.7 / 105.9 | 32.1 / 83.5 | 17.3 / 104.9 | 53.5 / 114.2 | 29.9 / 130.9 | 54.8 / 134.1 | 31.3 / 114.5 |
| 91 | `noise-barrier` | decor-floor | 30.5 / 49.8 | 76.1 / 93.2 | 29.5 / 48.1 | 20.8 / 46.3 | 38.4 / 91.5 | 17.6 / 111.7 | 24.0 / 65.5 | 17.8 / 89.6 | 55.4 / 111.2 | 28.4 / 138.3 | 55.0 / 114.4 | 29.8 / 89.2 |
| 92 | `sidewalk` | decor-outdoor | 62.0 / 68.3 | 21.4 / 46.1 | 38.2 / 50.5 | 22.4 / 45.9 | 28.7 / 82.1 | 16.5 / 105.2 | 27.4 / 71.7 | 17.6 / 108.6 | n/a | 36.6 / 119.8 | n/a | 35.8 / 123.2 |
| 93 | `lawn` | decor-outdoor | 39.2 / 51.6 | 23.3 / 46.5 | 39.8 / 51.8 | 25.6 / 45.9 | 27.3 / 84.2 | 16.9 / 122.1 | 29.3 / 96.2 | 17.2 / 107.3 | n/a | 36.6 / 106.9 | n/a | 39.8 / 112.0 |
| 94 | `tree` | decor-outdoor | 58.6 / 62.9 | 23.3 / 48.7 | 52.8 / 56.7 | 24.0 / 45.7 | 29.4 / 81.9 | 18.7 / 103.6 | 31.6 / 72.2 | 17.9 / 106.0 | 67.9 / 137.1 | 36.9 / 104.2 | 75.0 / 142.1 | 37.6 / 107.8 |
| 95 | `road` | decor-outdoor | 48.0 / 54.3 | 21.6 / 47.6 | 60.2 / 65.5 | 24.3 / 46.5 | 31.9 / 81.8 | 17.3 / 90.2 | 32.2 / 82.0 | 17.2 / 88.8 | n/a | 36.9 / 105.1 | n/a | 39.3 / 111.7 |
| 96 | `traffic-light` | decor-outdoor | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | unsupported | 66.9 / 135.5 | 35.4 / 101.1 | 63.4 / 138.2 | 38.5 / 111.7 |
| 97 | `ac-unit` | decor-outdoor | 42.9 / 50.0 | 23.4 / 47.1 | 44.0 / 48.1 | 24.9 / 47.4 | 30.5 / 80.8 | 17.5 / 89.3 | 33.0 / 73.4 | 18.4 / 87.8 | 72.2 / 137.5 | 35.0 / 101.8 | 72.3 / 138.4 | 35.5 / 122.5 |
| 98 | `guidepost` | decor-outdoor | 59.5 / 63.2 | 21.7 / 49.0 | 54.9 / 59.4 | 22.8 / 47.1 | 28.8 / 83.5 | 17.0 / 106.2 | 29.4 / 65.9 | 18.1 / 105.8 | 64.3 / 137.8 | 43.2 / 110.3 | 71.1 / 142.7 | 36.9 / 124.6 |
| 99 | `busstop-short` | decor-outdoor | 39.9 / 46.4 | 23.2 / 45.7 | 47.8 / 49.2 | 22.7 / 47.3 | 28.7 / 81.6 | 17.4 / 105.0 | 31.5 / 73.7 | 21.0 / 109.1 | 66.0 / 136.2 | 34.8 / 119.9 | 72.8 / 146.1 | 36.9 / 113.8 |
| 100 | `cctv-post` | decor-outdoor | 48.2 / 52.9 | 22.7 / 47.9 | 56.3 / 60.1 | 23.8 / 54.4 | 29.2 / 70.7 | 17.0 / 107.6 | 30.3 / 72.4 | 18.1 / 90.5 | 69.0 / 137.9 | 37.4 / 123.0 | 73.5 / 145.7 | 37.6 / 116.8 |
| 101 | `court-pickleball` | decor-outdoor | 44.9 / 48.7 | 21.6 / 47.2 | 45.0 / 49.0 | 22.7 / 45.8 | 31.1 / 123.2 | 17.8 / 93.6 | 31.4 / 82.1 | 17.9 / 90.7 | 140.9 / 201.0 | 34.8 / 100.9 | 136.6 / 201.6 | 35.3 / 104.9 |
| 102 | `court-divider` | decor-outdoor | 134.7 / 143.1 | 21.0 / 45.0 | 35.9 / 47.5 | 21.9 / 46.1 | 23.5 / 64.6 | 17.0 / 103.6 | 24.7 / 69.4 | 17.8 / 104.3 | 67.9 / 152.8 | 35.7 / 103.0 | 61.3 / 135.9 | 36.1 / 105.2 |

