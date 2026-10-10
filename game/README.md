# Metro Station Designer — the game

The playable vertical slice (V0–V5) of draft 1 of [`../PLAN.md`](../PLAN.md) — a URL where you dig
a box into the ground and watch three thousand people break it. That plan is now superseded: the
current plan grows this slice into the **base game** (B1–B6, single line), and this README tracks
the milestones as they land.

It is its own application. Its own `package.json`, Vite config, tests and Cloudflare
Worker (`metro-game`). It imports nothing from `web/` or `art/`.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc --noEmit && vite build -> dist/
npm run test       # node --test: determinism, tick budgets, capacity ladder
```

## Where things live

```
src/
  sim/       PURE TypeScript. No DOM, no worker, no three. Runs in Node.
    constants.ts     every tuning number, including the time base
    clock.ts         the simulated clock: sim seconds -> a date, a weekday, the authored day
    demand.ts        the crowd's day: the double-peak curve, its knobs and the calendar factor
    stock.ts         A/B/C/L car classification
    finishes.ts      surface finishes: the family decides behaviour, §4.3
    zones.ts         fare zones: the boundary is a barrier, §4.5
    worker.ts        the only file that touches postMessage
  render/    three.js: chunk mesher, procedural materials, module models, outline, shadows, agents
  build/     station document, cell commands, paint, undo
             validation.ts  the ONE placement verdict + the preview gatherer
  persistence/ save schema (serialise / parse / migrate *.metro.json)
  app/       React shell: HUD, rails, inspector. Panels only, no sim logic
  data/      the demo station (the 动物园 save) and the art palette
test/        node --test suite (imports src/sim/*.ts directly)
bench/       crowd-tick benchmark
```

Dependency direction is one-way: `app/ → render/ → sim/`, and `sim/` imports nothing.

**One placement verdict, asked twice.** Every builder decision — may this block be
laid, may this piece stand here — is answered by one function, and both the preview
under the pointer and the commit on release ask it. The rules live in
`sim/placement.ts` (`blockReason`, `equipmentReason`); `build/validation.ts` gathers a
whole preview's worth of them into the accepted cells the ghost draws, the refused
cells it boxes in red and the pieces standing in the way. So the red preview, the
notice on release and the edit itself cannot disagree — see
[`test/validation.test.mjs`](test/validation.test.mjs) for the property pinned.

## The milestones

Draft 1's vertical slice is **done** (V0–V5). The base game plan picks it up at B1.

| | Contents | Acceptance | State |
|---|---|---|---|
| V0 | Shell: dark canvas, orbit camera, grid, FPS/tick readout | — | done |
| V1 | Rounded-corner mesher + material lab at `/lab` | reads as a designed building; chunk build < 4 ms | done |
| V2 | Build loop: 2×2 seed, extrude/dig, work plane, level slicing, undo | the spec's M0 test | done |
| V3 | Crowd: worker at 5 Hz, station graph, agents, LOS overlay | 3,000+ agents, p99 tick < 8 ms, determinism asserted in Node | done |
| V4 | Train, per-door queues, boarding, left-behind, the fix | an under-built station breaks and the fix works | done |
| V5 | Own Worker project, deployed | the deploy section below | done |
| **B1** | Cell faces, finish catalogue, per-face materials, paint tools, tactile strips, static save v1 | distinct materials, a floor finish that changes path cost, save round-trip | **done** |
| **B2** | Fare zones, the zone boundary as a movement barrier, zone paint + overlay | an ungated fare line strands the crowd; a gate restores flow | **core done** |
| B3–B6 | Capacity kit, draw kit, authored time + charts + snapshot, ship | see [`../PLAN.md`](../PLAN.md) §4 | planned |

**B1** shipped `sim/finishes.ts` (the finish table), faces in `sim/types.ts`, one chunk-mesh part per
finish, the walk-speed rule, the `N`/`M` paint tools, the tactile-strip decal layer along
platform edges, and `persistence/save.ts` (`formatVersion: 1`, static). The mesher's cell-key
packing was also fixed — the old bit-shift `key()` collided neighbouring cells, which would have
made finish lookups wrong. 搪瓷板 gained a custom colour: the 材质 brush packs it into the finish
id (`wall.enamel#rrggbb`), so a painted panel keeps its own colour through the save and the
mesher gives each tint its own part and material. The brush also keeps its `N` 单块 / `M` 整面
mode: the mode is a setting of the 材质 folder, not of a tile, so picking a texture (or a fresh
搪瓷板 colour) leaves it alone. A **stair** is the one module the brush finishes: its treads, their
risers and the half-landing platform are a single surface, so the pointer painting a staircase writes
`stair.cfg.finish` (`paintStairSurface`) rather than the floor under it — or, on an unpainted one, the
finish of the floor it climbs from, which is what the staircase is wearing. Right-click hands the
surface back to the floor. **The ground under a painted stair is painted with it**: the canvas the run's
cut leaves — a shaved block's cap or the derived filling above it — is part of the piece's surface, so it
is drawn in that same finish (`SlopeCut.finish`), while the block's own sides stay the ground's. The
finish is cosmetic there (a flight is walked at `STAIR_SPEED` whatever
it is made of) and the stringers, rails and landing frame stay steel, so a finished stair still reads
as a staircase. Eyedropping moved to the 工具 folder's **吸取** (`P`, see below): it lifts a bare
face's finish into this brush — a 半墙's inner face and a 三角's slope included — and a placed
设备 / 装饰 piece into the placement instead. What a pick changes is *not* an edit — the document is
untouched, so nothing reaches the undo stack — but it does re-arm the rail, so the state it stood on is
noted first (`beginPick`) and **Esc** puts the whole gesture back: the tool, the piece, its turn,
direction and 闸机 door, the boards a picked **指示牌** copied (`adoptSignBoards`: a sign is copied as
its own printed faces, not as its tile, so the next one hung is the one that was pointed at) and the
brush a picked face lifted (`cancelPick`, wired through the viewport's own Escape after 移动's).

**B2's core** shipped `sim/zones.ts`, `Cell.zone`, a graph rule that emits no walk edge across a
zone line except through a gate cell, a zone drag-paint tool (a rectangle of the chosen zone over
the floor it covers), the `分区` overlay (a tint on the walkable floor plus a text label naming each
area), and an inspector zone control. Still open in B2: zone inference (a room enclosed by gates
proposed `paid`), module zone-legality feedback for ticket machines, and the gate direction UI —
the 闸机's **piece** (a working lane, or the fence machine that closes a 围栏 run, toggled with Tab;
its hand is a rotation, `R`) has landed, but its in / out / both policy and queue anchor are still
fixed.

**The 分区 map follows the storey, and a zone is floor.** Two rules the map and the brush now share
one definition of (`isFloorCell`, `build/model/Zones.ts`):

* **One storey at a time.** The 分区图 used to tint every storey's paint at once, so a concourse
  patch and a platform patch were one picture with two sets of labels stacked in it. It draws the
  level being edited instead (`zoneMapFloorsAt(cells, activeZ, modules)`), and the map rolls with
  **Q/E** — the storey is part of the overlay's fingerprint, so a step rebuilds the picture rather
  than reusing the last one. A storey is `storeyBand`'s, the rule the level slice keys every mesh by:
  a cell belongs to the grid line at or below it, so the demo's −6 landings are drawn with its −8
  storey *and* tinted with it, where a plain `z === activeZ` filter would have left them paint no
  storey ever showed. The labels come off the same floors and no region ever spanned storeys
  (`zoneRegionLabels` walks the four in-plane neighbours), so they follow for free. 热力图 is still
  every storey at once: it is a read of the crowd, and the crowd is everywhere.
* **A zone belongs to a floor cell** (§4.5), which is not the same thing as "there is a block here".
  The rule is the one the map already drew with — solid, top face exposed, and a floor finish that
  walks (or a track bed at the foot of its column) — so the 分区 brush, its bucket, the 信息 card's
  chips and the overlay all accept exactly the same cells: never the floor cell a wall column stands
  in (its top is buried), never the earth roof over a tunnel, never a track coping. A refused press
  says `分区只能画在地板上`; a rectangle that crosses a wall row drops the tiles it cannot paint and
  tints the rest; the card's 分区 chips go dead with the reason beside them. The bottom of it is
  `paintZoneCells`/`paintZone` themselves, so a zone can no longer be *written* anywhere the map
  could not draw it — the 动物园 save's own paint is untouched, and the street is still floor a
  rectangle may materialise and zone. `test/zonetool.test.mjs` drives the click (a tapped floor tile
  paints, a tapped coping paints nothing and says so, a drag drops the non-floor tiles); `zones.test.mjs`
  pins the rule in the model, the per-storey map, and that the map tints exactly the floor the brush
  accepts.

**无分区: an unpainted cell says so.** A cell with no `zone` label is not a cell in some zone the game
picked for it: it reads **`none` — 无分区** (`zoneOf`, `sim/zones.ts`), and the 分区 map, the 信息 card and
the sim all read that one answer through `zoneIndexOf`. It is a **reading, not a record** — nothing is
written to the save, and the model refuses to *write* it (`paintZone` / `paintZoneCells` return the
state unchanged), because the way to 无分区 is to take a label *off* — so a station whose paint is
unfinished stays unfinished and now *says* so instead of masquerading as a zone. A tab of pavement that
was 非付费区 by accident (the 动物园 save has 126 unlabelled floor cells at grade out of 458) is 无分区
instead, which is the honest answer to "what is this?".

无分区 sits on the **unpaid side of the fare line** (`isUnpaidZone`), so it is not a barrier of its own:
an unlabelled station still grows no fare line, and `crossingDir('none', 'paid')` is still 1 — a painted
`paid` patch inside unpainted floor is a line that needs a gate, exactly as before. That is why the
change moves no crowd number: `demo`, `capacity` and `wayfinding` are unmoved, and the 动物园's measured
figures stand. The **street plane is still 站外**, and that is not a default either: `withGround` labels
its own cells `outside`, because the plane really *is* the world outside the station — which is why a
tile the zone brush materialised over virgin street goes back to reading 站外 when its label comes off
(see below). One thing came with it: `World.sampleTripFromStreet` took a machine's stop only when its
node was **labelled** `unpaid`, so a 售票机 on the pavement outside an entrance would have dropped out of
§7.4a's optional stop. It asks `isUnpaidZone` now — the side of the fare line, which is what that rule
always meant.

**无分区 is also the folder's sixth tile, and it is the eraser.** The tile takes a zone *off* the floor
instead of putting one on — the one zone edit the game had no way to make, short of painting a patch
over with another zone (`eraseZoneCells`, `build/model/Zones.ts`; the brush is the zone id itself,
`isEraseBrush` in `app/store/catalog.ts`, so the tile, the brush and the state are one name). It drags
the same rectangle the brush paints, previews in the 材质 brush's warning red, and the 信息 card's chip
row is the same six states — 无分区 first, and it is the chip that erases (dead while the cell carries
no label of its own). Nothing is validated: removing a label is legal wherever a label is, so this is
the one zone edit that does not ask whether the cell is floor. A surface tile the brush had
materialised — virgin street given a record so it could wear a label — goes *with* its label, because
with nothing else on it that record *is* the plane the document stores inverted; a cell with a finish
or a tag keeps its record and loses only the label, and reads 无分区 again.

**The module art pass** (part of PLAN §3 item 6, ahead of B3/B4) replaced the unit-cube modules with
`render/models.ts`: procedural ticket machines, turnstile cabinets, escalators, exits and platform
screen doors, plus rolling stock. PSDs are drawn from the `platform-edge` run (the screen the graph
already models as doors); trains are posed by `World.trainRenderState()`, sent through the worker
protocol, and drawn per consist by `SceneRenderer.setTrains`. Both ends of a consist wear the same
cab — the dark face with its windscreen, crew-door windows, 广州地铁 mark, twin lamp clusters, marker
bars, cream bumper band and coupler — and differ only in their lamps: white on the end that leads,
red on the end that trails. Each pose also carries a **door-side mask**, so the leaves slide only on
a side that really has screen doors to meet: a train never opens onto the tunnel wall (§1.13).
The door cadence is `doorCentres` in `sim/stock.ts`: one uniform pitch per car, held
`DOOR_END_INSET` (2.8 m) off both car ends for the cab or the gangway, so a three-door L car spreads
its outer doors out to the ends instead of bunching them in the middle. `doorRunOffsets` projects
that list onto a rail's run, and it is the single list the screen doors are cut from *and* the one
the graph seats its boarding doors on — one door server per car door, on the cell the door stands at
— so a screen door cannot drift from the car door it exists to meet.
The models are pure three.js geometry
over one shared material kit — no image or GLB assets. Modules are level-aware, so a tall escalator
or exit ghosts with the floor it belongs to instead of drawing through it.

**The 装饰 folder holds seating, room furniture and advertising.** 座椅 (the bench, moved
out of 设备), 货架 (a stocked supermarket gondola), 收银台 (white checkout counter with a stocked front display, cash drawer, POS and payment reader), 办公桌 (a control-room desk with two monitors and a mesh office chair),
厕所隔间 (the restroom cubicle), 洗手池 (the wash basin), 垃圾桶 (a stainless double bin), 灭火器
(the red fire-extinguisher cabinet on four legs), 导向柱 (the exit-linked street pillar) and 公交站
(the short/long shelter) are all free-standing pieces — everything but the round 灯具 turns with **R** —
and 广告牌, 电视, 指示牌, 时钟, 监控, 灯具 (圆形 / 直条 ceiling fittings) and 通风口 (the ceiling grille)
all live under 装饰 in the build rail. 收银台 shares a palette row with 货架, and 办公桌 with 挂架. Both computers show a blue desktop with shortcuts and a taskbar, separate from the ticket-machine UI. 垃圾桶 and 灭火器 are cosmetic like the
rest of the furniture — no server and no stop — and both count as room furniture, so they may stand
inside a walled 商店 / 厕所 / 办公室 / 售票亭 (`placementBlocked`'s furniture ↔ room exemption). 广告牌 is *wall-mounted*:
`sim/placement.ts`'s `wallMountMissing` refuses it unless the facing neighbour has a solid block at
its first course (`z + 1`), which is exactly where the 方块 auto-wall ring and the 墙 tool both start.
Because that requirement is a function of the rotation alone, the panel **turns itself** to face its
wall (`autofaceWallMount`): build a wall and drop the ad, and the orientation follows — no **R**
needed, and none can leave it facing the wrong way. `wallSide` turns that requirement with the module
rotation and the renderer mounts the model on the same local −y face, so
what the ghost shows is what the click builds. 广告牌 is a nested sub-menu of six formats —
横版 16:9 / 标准 2.25:1 / 大横版 16:9 / 长幅 3.75:1 / 竖版 0.7:1 / 方形 1:1 — whose run length (one,
two or three cells) and panel size come from the shared `sim/billboards.ts` table, so the palette thumbnail, the collision envelope and the drawn
housing cannot disagree. A multi-cell banner needs a wall behind every cell of its run. A hover on a
wall block itself mounts the panel in the face-adjacent cell (`wallMountStandCell`), so a banner can
hang on the station's outer wall across the track — behind and above the screen doors — where there
is no walkable floor in front of it.

**The wall pieces hang under 装饰, and the wall rule grew with them.** 玻璃板 is the 围栏's
wall-mounted cousin: a sheet of glass in an **outer frame only** — one sill, one head and two end
posts around the whole run, with a single pane between them, so a three-cell panel is one window where
a fence run of the same length stands three frames up — in six sizes (one, two or three cells wide, in
a 1 m and a 2 m height) from `sim/glassPanels.ts`. The separate **玻璃幕墙** tile stands
4 m tall with **Tab** cycling **窄 / 中 / 宽** (2 / 3 / 4 m wide). Beside it, **屏蔽端门**
reuses fixed platform-screen glass with **半高 / 全高** heights; a perpendicular panel
snaps into a screen run’s endpoint tile so the two cap rails meet at the corner.
The corner panel shortens to its tile boundary (0.84 m); subsequent panels are exactly
1 m long, with the cap/frame and placement reservation contained in each tile so
adjacent blocks and equipment remain placeable. **门** is a **free-standing doorway** the player stands
on a floor tile, in the four pieces `sim/doors.ts` names: **单开** (one leaf, one cell) or **双开** (a pair
meeting in the middle, two cells) × **不锈钢** or **木** — a threshold on the floor, a post at each end, a
head across their tops and the leaves hung between them, from the floor top up to 2.05 m. It carries its
own structure, so it stands like a 货架 and needs **no wall behind it**: it is placed on any tile with
floor under it, it is *not* wall-mounted (`isWallMounted` / `isWallMountedType` both say so), and it stands
on the **leading edge of the block it is placed on** — the doorway's own line is that block's edge and the
run reaches one cell (two for a 双开) into the cells the ghost highlights — rather than in the middle of the
tile. **Nothing on a leaf is glazed**: a panel lying a few
millimetres off the leaf's face is coplanar enough to z-fight it, and the two surfaces shimmer as the
camera moves — the vision panels the first cut carried were removed for exactly that, and every fitting
now stands proud of the leaf by a real `DOOR_FRAME` stand-off rather than lying on it. The 不锈钢 door is
the game's **钢板** itself: the frame and the leaf are the kit's `darkSteel` — the colour and gloss the 钢板
ceiling finish is tinted with and the 扶梯's truss (and the ground under it) is drawn in — with a
brushed-stainless pull and kick plate, so a stainless
door is one steel doorway rather than a white leaf in a steel surround. It is the
**one** door in the game: a 办公室 or 厕所
closes the opening it cut in its own wall with the very same `buildDoor` (`render/models/pieces/DoorModel.ts`),
at the opening's own width, so a door the player stands and a room's own door are one drawing rather than
two near-identical ones — the two callers differ only in where the doorway is set and in the
finish (a room takes the stainless piece). 站名 is the station's own name as a large ink
inscription: the piece carries **no text**, only the hand it is written in (楷书 / 行书 / 隶书 / 魏碑 /
黑体 / 宋体, `sim/calligraphy.ts`) and the way it runs (横排 along the wall, 竖排 down it), and
`render/calligraphyFace.ts` prints the live `StationData.name` onto a **transparent** plate — the name
and nothing else, no seal and no ground, because an inscription is brush strokes on the wall rather than
a poster of one. A rename therefore reprints every inscription in the station
without touching a module, and the panel is cut **when the piece is placed** — a wider name is a wider
piece of wall, so a later rename sets smaller type inside the same panel instead of quietly rebuilding
a different wall behind a placed piece. A 横排 panel is always an **odd** number of cells wide
(`calligraphyPanelCells`, one, three or five): the run is centred on the cell the pointer is on, and
only an odd count leaves the inscription's own centre on that cell — an even one centres it on the
boundary between two cells, half a metre to one side of the tile being aimed at, which is the whole
piece when the name is short. 线网图 is the network poster a real station hangs: the supplied
广州地铁 线网示意图 itself, saved as `src/assets/linemaps/network-map.jpg` (2048 × 2047) and paired with
the panel by `render/lineMapArt.ts` — **artwork, not a drawing**, exactly as `render/adArt.ts` pairs an
ad slug with its JPEG. Both mounts print the **same board**, cut to the poster's own aspect
(`LINE_MAP_ASPECT`), so a wall map and a concourse totem cannot crop one picture differently: **墙面线网图**,
a framed two-cell board bolted to a wall and read from one side, and **立式线网图**, a free-standing
two-cell totem on a plinth — the one piece here that is *not* wall-mounted, printed on **both** faces so
a passenger reads it from either direction down the concourse. Until the poster's pixels land (and if the
asset were ever missing) each map prints a **drawn placeholder board** from the station's own lines
(`render/lineMapFace.ts`: one coloured band per line, a shield, a tick per station, a ring per
interchange), which is what a unit test and a station-less build see.

**A wall-mounted piece is backed wherever its panel actually is.** `wallMountCourses`
(`sim/placement.ts`) reads each type's own table for the band of wall it covers — a 广告牌's first
course, a 1 m 玻璃板's, a 2 m panel's first two, a 门's first three (it is a full-height 2.05 m panel, so
its head crosses into the third metre), a 横排 inscription's 2nd and 3rd (it is written 1.2 m
up), a 竖排 column's 0th to 2nd — and `wallMountMissing` asks for solid backing on every one of them,
for **every cell of the run**. A panel that spans three cells needs three walls behind it, and a 半墙
(a one-course wall) carries the 1 m band and refuses the 2 m window and the door. The envelope is the same honesty
from the other side: `wallPanelBox` narrows the module's **own run cells** to a slab `PANEL_DEPTH`
either side of the wall's centre line, so the air in front of a panel is the room's — a 座椅 stands
under a 线网图 board, a 售票机 under an inscription that hangs above its head — and the run is read
from `glassCells` / `doorCells` / `calligraphyCells` / `lineMapCells` rather than from `x + w`, which would put the
housing across the room on the rotations that run the other way.

**A 电视 is a passenger-information screen.** Its blue layout follows the platform TV reference:
three white destination cards fill the left quarter, the landscape video fills the upper right,
and a station-name tile, service strip and date/clock sit along the bottom. Each card stacks its
Chinese label, English gloss, destination and arrival time on separate lines.

`World.trainServices()` publishes three arrivals per service track from the dispatch schedule
and current train phase (§6.5). Forecasts account for the occupied track and headway at each future
dispatch. `tvLineStatus` selects the nearest track in 3D, reads that track's direction and terminus,
and converts seconds to whole minutes rounded up. No service prints 暂无班次. Every worker frame
refreshes the information, but only a changed printed value causes a texture upload.

The full-screen station plate sits behind the video, leaving the bottom blue strip visible.
`TV_POSTER_RECT` is shared by the plate and model, so the overlay fits its reserved window. The
video is slightly closer to the viewing face to avoid z-fighting. Only this video window cycles
artwork, on a period rolled per screen; posters use a centred crop, never stretching.

**A 电视 reads from one side.** Its board and its window ride the same single face (the local −y), so
the panel is legible from one side and shows a plain dark back from the other — which is what the back
of a television looks like. This is a modelling constraint, not a taste: each lit pane is a plane lying
over a dark backing slab, and a pane on the slab's centre line is buried in it while a pane on the
slab's surface z-fights it. Either way the window renders as a flat black rectangle with nothing in the
console, which is why `LIT_STAND_OFF` puts every lit pane half a slab out *plus* a stand-off and why
`test/tv-screen.test.mjs` pins the depth and footer clearance rather than leaving either to a visual
check. 指示牌 is
*ceiling-hung* like the 电视: `ceilingMountMissing` refuses either unless a solid slab sits one storey
up (`LEVEL_STEPS`, the 4 m grid), and `render/models.ts` hangs each from that slab by two rods. The
指示牌 keeps its two double-sided faces — a wayfinding board genuinely reads both ways, where a
screen does not.

**A ceiling-hung piece wants the air, not the cell.** It hangs from the slab overhead, so the floor
under it is still the room's: `placementBlocked` lets it share a tile with anything that stands on the
floor or is bolted to the wall — a 座椅, a 闸机, a 广告牌 — and only refuses it against another *hung*
piece (the two really do want the same air, which is what the back-to-back 电视 pair is exempt from) or
against a **run**, whose treads, step band or shaft passes through the storey the piece hangs in.
Without the exemption the storey-tall envelope `moduleEnvelope` reports made a clock and a chair in one
corner impossible, though nothing about either is in the other's way.

**The same piece is exempt from the ground rule, and for the same reason.** It is anchored to the
floor cell of the storey it hangs over — `ceilingMountStandCell` resolves every hover to that cell, and
it is what the save carries — but it does not *stand* on it, so `equipmentReason` asks
`moduleFloorOk` of every piece except this one and the slab overhead (`ceilingMountMissing`) is its
whole structural requirement. A 指示牌 over a well, or over the rails under the station ceiling, is
refused by what really refuses it — `track` over a bed, `occupied` in a run's headroom, `ceiling` under
open sky — never by a floor three metres under its rods, which is the notice the ground rule used to
print there. A piece that really stands, in the same floorless cell, is refused exactly as before.

**A wall-mounted 广告牌 reserves the wall, not the cell.** Its envelope used to be the whole tile it
hangs over, three courses deep — so a 座椅 standing on that floor "collided" with a poster two metres
above it and the chair's ghost turned the placement red. `flatEnvelope` now gives the panel the drawn
geometry: a thin housing against its backing, spanning its run, over only the band of wall the poster
covers (`billboardSpec`'s `panelZ` / `panelH` — the lowest variant's skirt is 2.3 m up). So a chair, a
bench or a hung 时钟 shares the tile with a poster, while a 售票机 tall enough to reach the panel still
collides. No piece-hand-written exemption: the boxes decide, which is the same rule the 装饰 folder's
own tests read.

监控的子菜单提供 **枪机 / 球机 / 半球机**：枪机保留原来的支架与镜头，球机采用白色吊臂与锥形机身，半球机紧贴天花板安装。两种新机型都带烟色半球罩与内部镜头；旧存档的监控默认显示为枪机。吸取保留机型，拖动删除只收集同机型，切换机型立即刷新预览。`ceiling-decor` 与 `pick-tool` 测试覆盖存档、吊挂、旋转、预览和机型选择。

**时钟 and 监控 are the same ceiling-hung contract with different hardware.** 时钟 is a **round**
station clock: a white face with black hour marks, minute ticks and hands and *nothing* printed on
it — no numerals, no name — under a dark bezel ring, hung on a bracket from a rod off the ceiling
slab. **The face is geometry, not a printed canvas**: a slim white cylinder whose two ends are the
dials, a black **open-ended** wrap around the barrel between them, and on each end **sixty
divisions** — twelve hour marks and 48 minute ticks — with two hands and a centre boss, at
proportions measured off the reference face (hour mark 0.20 R long by 0.055 R across, minute tick
0.10 R by 0.02 R, both ending at the same inner rim; hands 0.5 R and 0.7 R). **Twelve bars alone
read as a plate with marks on it** — the minute ticks are what make the ring read as a clock. The
clock is **double-faced**: both ends carry the full dial, the far one turned half a turn about the
**vertical** axis so 12 o'clock is up on each.

**And the hands tell the simulation's own time** (§7.9). Each one hangs on a **pivot** the scene
turns, rather than being placed at an angle in the builder: `ClockRig` is the piece's two pivots per
face, `clockHandAngles` (`sim/clock.ts`, beside the clock's own strings) is the derivation from sim
seconds to the two angles — the hour hand carrying the minutes, the minute hand the seconds — and
`reposeClockHands` is what `ClockSystem` calls every frame. The builder's own pose is
`CLOCK_POSE_SECONDS`, 10:09, the pose the reference photographs show: it is what a **palette
thumbnail** or a unit test draws, because neither has a sim clock behind it. A **placed** dial is
seated on the real clock the frame after it is built, and so is the **hover ghost** — the preview is
the piece a click would place, and a translucent clock previewing at 10:09 over floor where every
clock on the wall reads the sim's time is exactly the surprise the hover exists to prevent, so
`GhostSystem` hands its ghost's rigs to the clock system too and drops them when the pointer moves
on. The time is swept between the
worker's snapshots over the same `stateIntervalMs` window the consists glide on, so the hands run at
whatever speed the sim is running at and **stop when it stops**; a snapshot more than a minute on
(and any step back) is a **seek** or a load rather than the clock running, so the hands are *set*
there instead of winding through every hour in between. Before this the two arms were nailed at
10:09 for the life of the station while the sim's clock ran on beside them — a dial that agreed with
the 电视 plate next to it exactly never. Giving them the time also exposed the face's own
orientation, which the frozen pose had hidden: see the mount below.

**A mark runs radially, and the turn that does it is `a − π/2`.** Every mark and both hands carry
their length along their box's local x, so one turn serves them all; aimed **across** the rim
instead, the 12 and 6 marks come out horizontal and the 3 and 9 marks vertical, which is the wrong
way round and very visible. The turn was read off the matrix rather than derived by hand, because
the hand derivation is one sign away from the wrong answer: at each clock angle `a − π/2` gives a
dot of 1.000 against the radius where `π/2 − a` gives 0.105 to 0.5. A double-faced clock is likewise
**one dial mounted twice** — the far one inside a group turned half a turn — rather than a builder
branched on a `facing` sign, which is three chances to get a sign wrong per element. **Which axis
that half turn is about is load-bearing, and it was wrong for the whole life of the piece.** Turned
about the dial's own normal (`y`) the far face hangs **upside down**, 12 at the bottom; turned about
the **vertical** axis (`z`) it is the mirror the viewer on that side needs — 12 still up, 3 across to
the other hand. Nothing showed the difference until the hands were given the time, because a ring of
sixty evenly spaced ticks is **2-fold symmetric**: it looks identical upside down and only the hands
say where 12 is. A hand is built at **12 o'clock** inside its pivot for the same reason the dial is
built once — the pivot's own y rotation *is* the clock angle, so nothing in the builder has to know
what time it will be — and one pair of angles, set in the dial's frame on both faces, then comes out
right on each, because the mount is what mirrors them.


Both of those are load-bearing. A canvas texture on the cap is one indirection between the source
and the pixels, and it measured wrong on the built page — the texture reaching the GPU carried the
marks' ink across the whole face while every unit test passed, because a test's canvas is a stub
that records calls rather than rasterising. And a *closed* bezel cylinder carries caps, so the cap
on the viewer's side is a dark disc lying exactly across the dial: the ring is `openEnded` so it
frames the face instead of covering it. **The dial is in the X-Z plane and needs no rotation at all**: a
`CylinderGeometry` is Y-up, so its caps already face ±y, and the printed face is the `−y` cap —
out at the camera. A quarter-turn about x (`±π/2`) moves that axis onto world z and lays the disc
flat, horizontal, one cap up and one down: that is the wrong plane, and **no choice of sign fixes
it**. The piece has been through both signs and read as a clock facing the floor, then the ceiling,
which is what this note exists to stop happening again. The dial hangs at 2.35 m, and everything
behind it — housing, bracket, rod — runs to **larger y**, away from the viewer (the camera looks
from `−y`). The dial was first built face-down, which is what a real hanging station clock does;
it is wrong here only because the game's camera never looks at it from underneath. Its suspension is deliberately **slim** — a 0.18 m regulator box on a 0.03 m rod under a
0.15 m ceiling plate, so the box covers a quarter of the dial's diameter. A 0.30 m box on a
0.045 m rod photographed from below as the clock's body rather than its mount, which is what the
piece looked like before; the face has to be the object and the mount a line. 监控 is the bracketed bullet camera of
the reference — a rounded white enclosure and curved sun hood, with a central dark lens panel and IR ring on a steel arm
from a ceiling plate. `rot` **aims** it: the head looks along the piece's local −y, the same face a
电视 and a 指示牌 print on, so a camera dropped at a corridor mouth can be swung to watch the
approach. Both are props — no server, no stop, and for the camera no line of sight either, so
neither changes what an agent sees or where one walks. Both reserve the whole storey column like
the hung 指示牌, so neither can be stacked under another hung piece.

**Two 电视 may share one tile, back to back, and then they are one object.** `sim/tvs.ts` owns the
rule: a second 电视 on the same cell turned to face **exactly the opposite way** (180°, so `rot` values
two apart) is legal, and the two are drawn as a **pair** — one housing, one bezel, one pair of
suspension rods and ceiling plates, with a lit face on each side. That is the concourse screen a
passage walked both ways hangs overhead, and it is the one exemption from
"two modules may not share space" that is not a pair of *different* kinds (`placementColliders`, beside
the room ← furniture and exit ← ramp ones). A quarter-turn apart is refused rather than drawn, because
two panels crossing inside one block have no single housing to be drawn on; two facing the same way are
refused because that is a duplicated panel.

*The housing is two panels thick, and that is all.* `TV_HALF_DEPTH` (0.05 m) either side of the cell's
centre, so the pair is 0.2 m through — two thin televisions stood against each other. It deliberately
does **not** fill the cell: a metre-deep box reads as a chunk of concrete hung from the ceiling rather
than as a pair of screens, which is what the first cut of this feature got wrong.

*Drawing them as two solo models is not merely twice the geometry — it is visibly wrong.* A 电视's
housing is symmetric about its centre, so two of them in one cell are left-half-coincident: each
panel's dark backing is coplanar with the other's and its far face lands **exactly on** the opposite
station board, which then z-fights it and loses its outer 0.006 m to the backing. `test/tv-pair.test.mjs`
pins the pair instead — one suspension for the object, one backing per pane (not two per cell, and each
stopping `TV_PAIR_MARGIN` short of the seam), each screen proud of the one surface the two share, and
each of the four lit panes reachable only from its own side. It also pins that a lone 电视 still draws
the 13-mesh model it always did, because this is a rule about two placed pieces, not a new field on the
piece: nothing about the module changes, so an old save loads and a lone screen is untouched.

*A screen has a back.* A lit pane is a plane mounted over a dark backing slab, and `render/adArt.ts`
mints its poster materials **`FrontSide`** so the artwork leaves only the front: a double-sided poster
prints out of the back of the piece as well, through the backing it is bolted to, so from behind a 电视
would show the campaign rather than its own black housing. That matters most while placing, because R
turns the piece and the one thing that has to read at a glance is which way it will face. The ghost
preview keeps it too: `SceneRenderer.tintModuleGhost` doubles the sides of everything *except* a
material the model already made single-sided, so a translucent screen still shows a black back. The
production material was `DoubleSide` and every test stubbed `ads`, so nothing caught it until it was
seen; `test/tv-pair.test.mjs` now pins both halves of the contract.

*Which way a member prints is `placeLocal`'s job, not the model's.* Every lit pane is built on local −y
in both cases; the two members end up on opposite sides of the cell purely because their `rot` values
differ by a half-turn and each group is turned by its own. Handing the model a "which side" as well
rotates the same turn twice — in the module's frame it cancels the group's own turn and drops **both**
screens on one side, facing the same way, which is the defect the pair exists to remove. So the pair
slot carries a depth and nothing else. The picker is the other half of the rule: a cell holding two of
them is one object seen from two sides, so `moduleAt` takes the camera's look direction and answers with
the face under the pointer (`scene.pickFacing`), rather than whichever piece happens to be first in the
document.

**A 指示牌 is a composed board, not a printed sticker.** §5.8's custom signage is what the overhead
board *is*: `sim/sign.ts` holds its layout — an ordered list of **components**, each an arrow, the
station's own line shield, typed text or a pictogram, placed in **metres along one row** — and
`render/signFace.ts` is the only code that draws it. The lit face on the drawn model, the hover ghost,
the build rail's palette icon and the board editor all call `drawSignPanel`, so what the player
composes is the board they build, pixel for pixel; the face is drawn at a constant `PX_PER_METRE`,
which is why a 0.42 m line badge measures the same on the model as it does in the editor.

**One board, two mounts.** The piece is offered as two tiles — **吊挂指示牌** and **墙面指示牌** —
and the mount travels in its own `cfg.mount` (`SignMount`, `sim/sign.ts`), so every rule can ask the
module rather than the palette id it was armed with: `isWallMounted` and `isCeilingHung` read that one
field, and `isCeilingHung` reads a bare `sign-ceiling` / `sign-wall` id as well, because the placement
tool is armed with an id before there is a module to ask. The **hung** board is what it always was: rods
from the storey slab (`ceilingMountMissing`), a storey-tall column (`FLAT_HEIGHT.sign`), and two lit
plates. The **wall** board is a panel bolted flat to the wall on the piece's local −y face — the same
face a 广告牌 hangs on, so `autofaceWallMount` turns it and the tool never asks the player to press `R`
first — read from one side only: the wall is behind it, so `cfg.back` is not mounted at all, the board
editor shows 正面 alone for it, and `createModule` drops the back a current pair may carry. It hangs at
`SIGN_WALL_PANEL_Z` (1.65 m), so its 0.7 m panel crosses exactly the wall's **second** course
(`signWallCourses` → `wallMountCourses`), and `flatEnvelope` gives it the 广告牌's shape: a thin slab on
that wall over that band, not a cell. A 座椅 under it therefore shares the tile while a 售票机 tall
enough to reach the panel collides, and a cell with open sky over it is exactly where it belongs. The
two mounts are two pieces to a sweep (`sign:wall` / `sign:ceiling`) and to the hover ghost
(`moduleGhostKey`), and one type everywhere else — a save, a pick, the inspector and the board editor
work on both.

**The board is one row, and it is as long as its content.** `signPanelSize` measures the row's own
span — from the first mark's left edge to the last one's right edge — and gives it a quiet margin
(`PANEL_END_PAD`) at **each** end, clamped to `PANEL_MAX_W`; the drawn panel, its mesh and its texture
all follow it. Both ends by construction is what makes the board a centred function of its content: the
first cut added the pad to the last mark's right edge alone, so the leading end was always one pad wide
while the trailing end took the slack, and a row long enough to reach the ceiling printed off to one
side. `PANEL_MAX_W` is 3.5 m, which is the smallest ceiling that lets six arrows — 3.24 m of row plus
two pads — be laid down with their ends matched. The height is fixed at `PANEL_MIN_H` (0.7 m): content
never flows up and down the face, because a 指示牌 is a list read left to right, and `signCentreRange`
pins every `y` to the row's centre line so that is structural rather than a habit. Positions are
metres rather than fractions of the board for exactly this reason — a board that grows must not slide
its content sideways.

**The printed ink is centred on the steel, not the padded boxes.** `drawSignPanel` shifts the row so
that what a viewer actually sees sits with equal black ends: the shift is derived from the ink's own
span and measured from the **printed area's** edge (`padX + (printedWidth − inkWidth) / 2 − inkLeft`).
Measuring it from the canvas origin instead — which is what the first cut did — spends the leading
margin twice and prints the whole board a margin's width to the right, which is the "shifted right and
not centring" report; it is invisible to a test that reads `signPieces`, because the padded boxes are
laid on the panel correctly and it is the mark inside each box that leans.
`test/sign-render.test.mjs` therefore paints the board through a matrix-tracking context and asks the
**pixels**, which is the only place this question has an answer.

**Nothing on the board ever overlaps, and packing is what guarantees it.** `packSignRow` lays the row
in three steps: the pieces the player is holding are placed first, exactly where they were put; then
everything else is taken in order of where it *wants* to be and dropped into the first room at or
after that point wide enough to hold it; then the requested order is restored, so the roster and the
board read the same way. Placing a piece only into room that is already free means one pass is exact —
which is why this replaced a separate-then-re-clamp loop that oscillated between two collisions
whenever a board's ends were both against the frame, the shape a one-row board has most of the time.
Each component also carries `SIGN_PIECE_PAD` on every side, so two marks never even touch.

**A label prints at its own size, and the box is exactly the stack of its rows.** `signInkSize`
reports a label as tall as its rows at `size × 1.15` each (`SIGN_SIZE.text.h × scale × 1.15 × lines`),
which is what the row packs around — so `drawText` divides that back down into one row's pitch and one
row's type (中文 at `SIGN_SIZE.text.h`, the gloss at `SIGN_TEXT_EN_SCALE` of it). A label holds
at most two lines — 中文 up to 8 characters, the English gloss up to 16 (spec §5.8 sizes the hanging
sign 2 × 8; the gloss runs longer because it sets smaller and Latin advances are narrower, so sixteen
English characters measure about like eight Chinese). Taking the stack's
height *as* the line size set every label `lines ×` too large — a two-line label printed at 2.3 × its
box and left the top of the panel — and a row pitch left in metres inside a pixel box stacked both rows
on the same baseline. Both are silent (the right words, in the wrong place), so
`test/sign-render.test.mjs` pins the two sizes, the row separation and that the stack stays on the
plate.

The palette's 指示牌 hangs the reference row — an exit arrow each side, the station's first line and
the green 出口 plate between them — composed from the station's **own** lines, so a recoloured or
renamed 5号线 reprints every shield that carries it without the sign being touched. A **line shield
prints the line's name as 线路 spells it** and nothing else: a 5号线 shield prints 5号线, because the
shield *is* the line's own name and a derived number would only be a second rendering of it. The
optional English gloss is the one addition. Each component may be bound to one **face**, so a sign can
be genuinely one-way (`side: 'left'` prints on the approach face only) or carry a different message
each way. A sign is a **document**: `cfg.components` survives a save, `toState` backfills one for a
save written before the board became a document (`ensureSignLayouts`), and `normalizeSignLayout`
repairs the numbers — a duplicate id, a scale past what the board carries, a stray position — rather
than trusting them.

**The board editor is a modal of three rows of tiles, and nothing else.** `app/SignEditor.tsx` is the
指示牌's one editor: the build rail's **自定义** tile opens it, beside the 旋转 tile a 指示牌 still has
(a board turns *and* is composed), and the inspector can open it on a placed sign as well. A sign
composed before placement is carried by the piece the next click hangs (`signDraft`). The three rows are

1. **the board** — its content as a row of **fixed places**: one square per item, plus the spare empty
   one. Bin order is list order, all the way down to the model (`signLayoutInOrder` / `packSignRow`), so
   a drop puts a mark in a *place* rather than at a millimetre;
2. **the four groups** — 箭头, 图标, 线路 and 文字, each a tile holding a picture of what it makes
   (`groupMark`: an arrow, the 出口 plate, the station's first shield, a label printing its own name over
   its gloss). One is open at a time and opening one folds the previous;
3. **the open group's palette** — every option that group offers, one square each.

A mark has **no size control**: every component carries `scale` (1 for everything the editor makes, and
`normalizeSignLayout` repairs a stray one on load), but nothing in the modal changes it — a board is
arranged by place alone.

There is no prose, no legend and **no separate preview of the whole board**, because a bin already is
the board: a row of places is the panel read left to right. Every tile — a place, a group, a palette
option, the mark in the air — is drawn by `drawSignPanel`, the same code the model prints with, at one
metre to the tile, so a tile carries the black plate and the mark that will stand there: a 卫生间 option
shows the 卫生间 pictogram, a 线路 option the station's own shield in its own colour, 出口 its green
plate — which is why a tile carries no lettering at all, and its name is its accessible label. The tiles wear the
build rail's own blueprint square (`bpBlock`'s flat navy, dashed technical inner frame and square
corners), so a group, a palette option, a place on the board and a block in the left rail are one object
in four places.

**One gesture, and every tile in the palette has it**: a mark is dragged from the palette **into a
bin**, or from one bin into another, and the row makes room under the pointer while it hovers, so the
drop is never a surprise. Letting go off the row changes nothing — with one exception, and it is the
gesture run backwards: a mark carried off a board and let go in the **library** the tiles came from is
thrown away (`pointerOverLibrary` → `endDrag`), exactly as one let go over the rail's bin is. A *palette*
tile let go over its own shelf has given nothing up: it simply stays there. **Nothing in the palette is
unique**: a tile arms a drag whatever the board already holds, and what it lays down is another of its
kind — a second arrow, a second 出口, a second label, the same pictogram twice — so `markFor` asks the
board nothing. The board's one refusal is its own ten places (`SIGN_COMPONENT_MAX`), asked before a tile
is even armed (`full`), which costs a tile the press rather than the drag. A press that never moves is a
click, and now that no mark is unrepeatable a click can only mean *select*: the one click that does real
work is the 文字 tile's, which picks the focused board's label so the boxes have something to edit
(`pickExisting`); a 线路 tile **adds** a shield after the selection instead, because a shield has no boxes
to point anywhere.

**A board repeats whatever it likes, until it is full.** Nothing counts marks by kind: the same
5号线 shield may stand on a sign as many times as it fits — a station with ten platforms is one board,
not ten — the arrow family carries no rule at all, which is how a row gets an arrow at each end, and the
pictograms and the text box are as repeatable as the rest. What stops it is the panel's own ceiling
(`PANEL_MAX_W`, 3.5 m), and **full is measured, not counted**: `signMarkFits` lays the row out with the
mark on it and asks whether `packSignRow` had to put it on top of something already there. So the count
depends on which marks they are — **six arrows** fill a board (3.24 m of ink and the pad between them),
nine pictograms or seven shields come close, and a board of arrows takes no seventh. The question is
about **the board and the mark and nothing else**, which is what the row's own order is for: a mark
carries an `x` from wherever it stands — `0` out of the palette, the place it holds on 背面 when it is
carried across from there — and a board read at those positions is a scattered row whose gaps are not
room, so the same arrow was taken from the palette and refused from the other row. Two boards also
number their own marks from `c1` (`packSignRow` places by **place in the list**, and a mark that changes
boards takes a free id there — `signLayoutCarried`), so nothing about a mark's name or its old place may
decide whether it fits. This is what the palette obeys (`noticeFull` in `SignEditor.tsx`), and it is why
the ceiling is a design knob rather than a bug: past it the pack folds the last marks onto one place,
which the print draws as two marks stacked where the row of bins showed two separate ones.

文字 is the one group whose *mark* is typed rather than picked: one text box at a time, carrying 中文 over
its English gloss. **Typing never puts a label up**: the group's drag handle is a tile of its own, to the
left of the two boxes, holding the label they add up to — so what the pointer picks up is what the board
would print — and that drag is the only way a label reaches the board. Labels repeat, so `setText`
patches **the selected one** — the same component the boxes are showing — because "the first text box on
the board" would mean typing into one label rewrote another. (Inserting on the first keystroke dropped a
mark into the row at a place nobody had
chosen.) The boxes never start a drag either, because a press inside a text field has to mean "put the
caret here". ✕ throws the edit away and ✓ writes it.

Nothing an edit does reaches the document until ✓: the board being arranged is drawn in place of the
module's own (`signModuleWithPreview`) and the undo stack is untouched (`previewSignLayout` →
`commitSignLayout`), so a drag per bin is not an edit. The hung sign still grows with its list, since
`signPanelSize` measures the row it is given.

**The ads are real posters.** The twelve supplied campaign JPEGs live in
`game/src/assets/posters/` and are the artwork a 广告牌 or a 电视's content window plays;
`sim/billboards.ts` carries the
slug table (`AD_POSTERS`, `postersFor`, `posterFor`) and `render/adArt.ts` pairs a slug with its file.
The folder is deliberately **not** called `ads/`: EasyList ships `/assets/ads/*$~image`, which blocks
Vite's dev-time module URL for anything under an `assets/ads/` path, and because the glob in `adArt.ts`
is `eager`, one blocked poster keeps the whole game from booting at all.
A 广告牌's poster is **rolled once, when the piece is committed** (`randomAdSlug` in `build/model.ts`,
deterministic in the module id, so an undo/redo pair hangs the same campaign) and written to
`cfg.poster` — from then on the lit face is frozen, so a row of billboards is a row of different
campaigns rather than a wall of flicker. A 电视's `cfg.poster` is only its opening frame: the scene
re-points that window at another catalogue poster on its own cadence (`AdArt.adWindow`, which ignores
the frozen slug entirely). A legacy save with no `cfg.poster` is backfilled once in
`toState`, never per frame. The roll is filtered by silhouette, so a landscape panel is never asked to
print a portrait poster, and `test/billboard.test.mjs` measures every catalogue poster against every
format it can be rolled onto.

**The pictograms are supplied artwork too, and they are bitmaps.** `sim/sign.ts`'s `SIGN_ICONS` is
the whole catalogue — 列车, 电梯, 无障碍, 卫生间, 扶梯, 楼梯, the 出口 plate and the 禁止 roundel — and every
one but the last two is a PNG in `game/src/assets/pictograms/` that `render/pictograms.ts` decodes and
hands to `render/signFace.ts` through the registry on that module (`setPictograms`).
`tools/prep-sign-icons.py`
is what makes them out of the supplied photographs of real station signage, and it is the only thing
that decides how a mark looks: it thresholds every pixel (so the ink is **pure white** and nothing
else survives), makes the photographed sign's dark ground **fully transparent** (the board's own plate
is already near-black, and a mark carrying its own dark square would only read as a second, dirtier
panel), cuts each mark square with one shared margin, and **drops the photographed sign's own rounded
frame** — found as the thin ring that spans the whole picture — because `drawSignPanel` strokes the
plate's frame around the whole board. 楼梯's frame is fused into its bottom tread, so that one source is
used whole; the rest are frameless. The two halves are split on purpose: `signFace.ts` keeps the
registry and draws, `pictograms.ts` is the only file that touches Vite or the DOM, so a test can paint a
board and read what it printed without a browser (`test/sign-render.test.mjs` decodes the real assets
and pins that each is square, pure white and clear behind the ink).

**Two marks are geometry instead of art**, and they are the board's only colour: the green **出/EXIT
plate**, which is a printed plate rather than a pictogram, and the red **禁止 roundel** — a ring with a
**level** strip across its diameter, drawn in `STOP_RED` because a prohibition sign is red or it is not
one. They are listed in `SIGN_DRAWN_ICONS` (`signIconIsDrawn`), which is what `pictograms.ts` asks
before reporting a missing asset and what `drawIcon` branches on, so a drawn mark is never waited on as
a bitmap nor reported as one that failed to load. The roundel is a path rather than a `fillRect`, which
is what lets `tools/render-sign-panel.mjs` record its corners: `test/sign-render.test.mjs` reads them
back off the matrix-tracking context and pins the strip as a box exactly `2r` wide and one ring-thick
tall, level and centred — a strip at an angle is a prohibit *sign* roundel, not the "stop" mark it is
named for.

**A board's marks are decoded before the board is printed**, for the same reason the posters are, and
then one step further: a plate is a texture the scene mints once, so a face drawn before the art landed
would keep the marks off it for the session. `SceneRenderer` starts the decode beside the ad artwork and
**rebuilds its modules** when it lands (and reprints the one fallback plate `models.ts` mints before
then), the rail's thumbnails await it, and the board editor's tiles redraw off the same promise
(`usePictogramsReady`) — so no route into a board can print a plate of empty squares.

**A poster is cropped, never stretched.** `render/panelUv.ts` computes the centred window of the image
that matches the panel's aspect, and `render/adArt.ts` writes it into the quad's own UVs — so a 16:9
campaign on a 2.25:1 lightbox loses its edges instead of smearing sideways, and one texture per poster
serves every format that prints it. The pixels are decoded **before** any material is made: a material
minted around a texture that has no image yet renders blank for good (the GPU upload happens once,
empty, and the image that arrives later never reaches it), so `AdArt.load()` awaits every JPEG and
`SceneRenderer` redraws the modules once they land — until then a screen prints a placeholder face.
座椅 is the same kind of nested sub-menu: two style tiles —
a plain stainless bench with no back and an upholstered seat with a back and arm rests that chains
into a row — from the shared `sim/benches.ts` table, with **Tab** cycling each tile between a 1 m
and a 2 m run. A 2 m bench is a real
two-cell run: its `w` fixes the collision envelope and its base cells (`benchCells`), the renderer
draws the whole run from the run's centre, and a legacy bench with neither `w` nor a variant is the
1 m stainless piece. 货架 now offers six variants: 深色高架 / 白色高架 (1.9 m), 白色矮架 (1.25 m), 移动网篮架 (1.6 m), and 白色冷柜 / 深色冷柜 (2.05 m). The shared `sim/shelves.ts` table sets their deck heights and placement clearance; legacy shelves remain tall dark gondolas. Stock is batched across decks, with paired product facings, bottle caps, package labels and price tickets. Room furniture (shelf / desk / cubicle / sink / bench, and the floor vinyl with them) may
stand inside a room footprint or booth (`placementBlocked` exempts the furniture ↔ room pair, and
`moduleAt` prefers the furniture over the room around it). A room brush marks a footprint only —

**A variant family is one row in one table, and the whole rail reads it.** A family in this rail is four
things that have to agree: the parent **tile** (its label, and the variant its icon shows), the **list**
it folds out, the rail's single **open slot**, and the **anchor** the contextual action row (旋转 / 自定义 /
… ) folds out under. Those used to be written out four times over — a menu component per family, a
hand-listed parent tile in each folder, a hand-listed open-slot mapping, and a hand-listed action anchor —
so a family could be *half* wired, and the failure was silent in the UI: a variant whose list folded away
the moment it was picked, or a placed piece whose 旋转 tile folded out under a tile no folder drew. They
are now one table, `MODULE_FAMILIES` in
[`app/store/catalog.ts`](src/app/store/catalog.ts) — the family's key and label, the folder it lives in,
the palette ids it owns, and (as data) the tile label its variants wear — and every half of
the UI reads it: `familyOptions(family)` is the sub-menu, `familyAnchor(key)` is the parent tile,
`familyFor` / `subMenuForModule` is the open slot, `actionsAnchorFor` is where the action row folds out,
`folderTiles(folder)` is a folder's tiles **in rail order** — the plain ones and each family's parent tile
in one list, so where a family sits among them is layout and not a property of the family, with `RAIL_ORDER`
the one place that order is written down (`folderOptions(folder)`, a folder's plain tiles, is derived from
it, so nothing is drawn
twice) and the folder header's count is that same arithmetic. `rail/shared/TileGrid.tsx` is the one grid
both the 设备 and 装饰 folders render (those tiles + the one variant menu,
`rail/menus/VariantMenu.tsx`, for every family — 楼梯 / 出入口 / 座椅 / 广告牌 / 玻璃板 / 门 / 站名 / 线网图 —
where there used to be seven near-identical components), and **the action row is one component too**:
`rail/actions/ActionRow.tsx` is the fold, the open rule and every action tile — 旋转 / 自定义 / 窄 中 宽 /
上行-下行 / 有门-围栏 — and the 工具 folder mounts the very same row under its cut pieces
(`ToolsFolder`), so the 旋转 a 半墙 folds out **is** the component a 座椅's 旋转 comes from. The 旋转 tile is
its own shared unit, `rail/shared/RotateTile.tsx`: the four places that turn something — the piece being
placed, a cut piece's half or corner, a 轨道 run, the 剖切 surface — are one control on **R**, so they are
one tile, and the mark they wear is drawn in that file and nowhere else. It is a turning arrow
(`react-icons`' `AiOutlineRotateRight`, handed to `Block` as its `art`) rather than one of the rail's
blueprint line icons, because "turn this" has to read off the glyph — and a hand-written tile per folder
is how the cut pieces' came to wear a different glyph for the same control. **A row is open
only under the family being
browsed** (`actionRowOpen`): two family tiles share a grid row (座椅 beside 站名, 指示牌 beside 广告牌) and a
full-width row can only be inserted after that pair, so a row left open across a family the player had
stopped picking from drew the *previous* piece's 旋转 tile straight above the new family's variants,
reading as theirs — while rotating a piece they were no longer looking at. It is parked instead, and comes
back the moment that family is picked from (R still rotates the live piece from the keyboard either way).
The anchor it folds out under and the tile it belongs to are one derivation for the whole rail
(`armedActionsAnchor` / `armedRailTile`, `rail/helpers.ts`), which answers for a piece, a cut piece, a rail,
a brush and a finish — so no folder asks "is this a cut mode?" for itself. **Adding a family is one row in
that table**, and adding a cut piece is one row in `CUT_MODES` beside it: the grid, the
list, the open slot, the count, the anchor, the row and the reveal all follow, and
`test/rail-families.test.mjs` proves in Node that they agree for every family and every palette id — and
for every cut piece.
no walls and no fit-out: the player walls the footprint with the 方块 / 墙 tools and
furnishes it piece by piece (`storeShelfSpots` / `officeDeskSpots` / `restroomSpots` name the
old layout spots a hand fit-out follows), so every unit is individually right-clickable. Only
a booth still stocks itself — one `bench` per back-row cell (`boothBenchSpots`), for 售票亭
and 问讯处 alike. Bulldozing a room takes its auto (`cfg.auto`) furniture but leaves
hand-placed pieces; extending one clears only the absorbed ring the union buries and keeps
the player's walls on the new edge. Rooms drawn before this carry only the `cfg.stocked`
mark (`ensureRoomFurniture`, via `toState`) — their old auto fit-out is never recreated.

**A room's walls are one panel thick, and its corners are square.** The wall columns
standing on a room's perimeter are hidden from the chunk mesher (`SceneRenderer.setStation`'s `hiddenCells`, leaving an
invisible pick box so the wall tools still address them) and `render/models.ts` draws each wall as a
0.5 m panel instead, which is what frees the inner half of every wall cell for furniture. Where the
west/east run meets the south/north run the two panels must not both want the same cell — two 0.5 m
walls in one square metre would be a lump of extra thickness at every corner — so the west/east run
takes the corner cell **whole**, its 1 m depth reaching the room's other outer face and closing that
run's end, and the south/north run stops one thickness short and butts against its inner face. The
room's own corner and the one its two inner faces make are then plain right angles, one panel thick on
every side. (A `mitreCap` triangular prism used to fill the corner cell on its diagonal, but its apex
was the cell's *inner* corner rather than the wall's — one thickness past the free half a room keeps
for furniture — so every corner also wore a 0.5 m diagonal wedge laid across that half. Nothing is
left for it to fill, so it is gone; `room-model.test.mjs` pins the corner as a right angle.) A
room wears **no name plate**: the 招牌 that used to hang over a doorway only ever repeated 商店 /
厕所 / 办公室 (or 售票 over a booth) above the shelves and cubicles that already say so. The 房间
folder's tiles wear a line icon of what the room is *for* — 商店, 售票亭, 办公室 and the 指示牌's own
厕所 mark — rather than a colour field, which is the only way a 1 cm tile can tell "tickets" from
"washroom" (`app/zoneThumbnails.ts` now renders the 分区 tiles alone — the five zones; the folder's
eraser is a line icon of its own, `Icon`'s `zoneErase`, since there is no zone to draw).

**The booth's counter is laid like a picture frame, not as two runs of whole cells.** `buildBooth`
draws a run that closes a corner across its own 1 m cell and stops the run meeting it one
counter-depth short, so the two butt against each other; the capping board is a separate, longer span
that crosses those joints, which is what makes the band seen from above one continuous frame rather
than arms with 45° notches. Running both arms through every corner is what used to make a 1 × 1 m pad
of desk there and push two glass screens through one another — a cross of extra desk and glass at all
four corners. The screen is closed by a mullion post standing on each seam.

**The level slice means one thing at every camera angle, and the crowd obeys it.**
`render/levelSlicing.ts` owns the rule and `test/level-slicing.test.mjs` guards it. **显示其他层**
(on by default) is the slice: off, the edited storey is the *only* thing drawn — blocks, equipment,
crowd and trains alike — in a plan, an elevation and a corner isometric; nothing from another storey
leaks in through a "plate
hanging in space" rule any more. With it on, the active storey stays crisp and every other storey is
drawn as a 35% ghost that keeps its real depth, so a storey the active one covers is simply behind it
and the depth test drops it: the ghost shows exactly where it does not block the depth being edited.
**隐藏天花板** (`H`, on by default) is the one piece of a storey *above* the active one that always
draws, and only when nothing stands under it, so a room never wears its own ceiling and a top view
looks into the room rather than onto its roof. The crowd follows the same `crowdVisible` rule — never
one floating on a hidden floor — and the 剖切 clip applies to it too, so people no longer show
through a slab. A consist is tagged with the storey its floor block is in (`storeyBand` of the rounded
track surface), so a train berthed at the platform disappears with the platform and never hangs in the
air above it. The nav cube only ever moves the camera: no face, corner, **Home** click, arrow or slider
drag rewrites the slice behind the player's back.

**隐藏UI shows the station whole: no lattice, no ghost sheet, every storey as itself.** The 视图
folder's **隐藏UI** tile (**U**) does two things, and they are the same idea — the picture is the
building, not the storey being edited:

* **The drawing furniture goes.** The 1 m editing grid and its cell cursor
  (`render/scene/systems/GridSystem.ts`).
* **The storey slice is put away.** Other storeys stop being drawn as 35% ghosts — the translucent
  sheet lying over the floor under the camera — and no ceiling is lifted, so every storey draws
  opaque, as itself, ceilings and all (`render/levelSlicing.ts` `sliceOptions`, applied by
  `LevelSystem.applyLevel`). 显示其他层 and 隐藏天花板 have nothing to act on while it is on, so they
  are greyed out in the folder.

No interface goes with either: the build rail, the inspector, the nav cube and every tool stay where
they are, and the pointer goes on building and picking. **隐藏墙壁** and **隐藏地面** stay live,
because they are not ways of drawing a storey: one is a look-through of the station's own walls and
the other takes the street plane away altogether (`sim/ground.ts` — the generated window, meshed as
its own pass by `ChunkSystem.meshStation`, so the tile is a `visible` flag on meshes that already
exist: no rebuild, no document write, and the walk graph goes on walking the same street). The
street is deliberately **not** 隐藏天花板's business — that rule is about the ceilings a storey
holds, and one plane the whole station stands under is nobody's ceiling — so 隐藏地面 hides it at
every storey, cut and mode.

The tile order is the folder's own reading order, and the three rows say what they are:
**显示其他层 · 剖切 · 隐藏UI** — the modes that decide how the station is drawn; then
**隐藏天花板 · 隐藏墙壁 · 隐藏地面** — the surfaces taken away (剖切 folding its own **旋转** tile out
at the foot of the row it sits in); then **分区图 · 热力图**, the overlays that paint the station
rather than hide it. **The folder itself lives in the 信息栏** — between 信息 and 出入口 — because
these are controls over how the station is drawn rather than pieces of it: it is the 信息栏's second row,
on **Alt+W** (`INSPECTOR_FOLDERS`), and it **opens with the app** rather than folded, because the
view toggles are the row a build starts from. **The panel is the wider column** (`.main` gives the build rail 232px
and the inspector 300px), so its tile grid fits **three** to a row where the rail's fits two — 显示其他层 /
剖切 / 隐藏UI, 隐藏天花板 / 隐藏墙壁 / 隐藏地面, 分区图 / 热力图 — and the 剖切 row that folds out under it is the same
three-wide grid (`styles.css` `.panel .blockGrid`). A folded-out row spans the grid
(`grid-column: 1 / -1`) and can only be inserted *between* rows, so 剖切's row is placed **after the whole
row that holds 剖切** (`ViewFolder.tsx`'s `<CutControls>`): back beside the tile it would break the first
row after two tiles and leave the third cell of the 3-wide grid empty. **Eight tiles, and that header says 8**: the count beside
a folder name
is the tiles that folder can show in the state the build is in, so it follows a mode that adds one (工具
grows by 生成墙壁 under the plain 方块 tool — and only there: a cut piece takes that tile
away — 视图 by 旋转 while 剖切 is on) rather than a number
written down once and left behind. A **folded-out action row is not a tile** in any folder, which is why
the 旋转 a 半墙 folds out adds nothing to that count (nor does a 座椅's 旋转 to the 装饰 folder's). The
工具 folder's cut pieces are **three tiles** — 半墙,
上三角块 and 下三角块 — one row each in `CUT_MODES` (`app/store/catalog.ts`), so the piece the player
wants is one click away rather than a step through a cycle; each arms the 方块 tool through the one
`setCutMode` call, and they are **click-only** — **Tab** is the 生成墙壁 ring's key, not a walk through
the pieces.

**The rail keeps the armed piece's own tile in view.** Whatever is armed names a tile
(`armedRailTile`: the placement's variant, a cut piece, the 轨道 folder's 站台 / 隧道, the room or
fare-zone brush, the paint brush's finish — one derivation for all of them, `armedTiles`), and the shell
brings it into sight when that changes — which is what makes a
**吸取** land somewhere the player can see, and what scrolls a cut piece's tile into view when its tile
is picked. A tile already on screen moves nothing
(`revealScrollDelta` answers 0, and the rail is the only thing that scrolls), and the pass runs twice —
at once, and again once the 280 ms fold has settled, because the first one measured a tile that was
still travelling.

**Each column's folders answer to its own modifier, one letter a folder.** The build rail is
**Shift+Q, Shift+W, Shift+E …**: 工具 is **Shift+Q** and W E R T Y U follow the folders below it (轨道,
设备, 装饰, 材质, 房间, 分区). The 信息栏 is **Alt+Q, Alt+W, Alt+E, Alt+R**, one letter a row down its own
stack — **信息, 视图, 出入口, 线路** — and every header in both columns badges its own key on hover the way
a tile does (`Shift+Q` / `Alt+W`; `.folderKey`, the tile's own `.bpKey` — hidden until the header is
hovered or focused, so a column of closed folders stays quiet). A **modifier each** is what keeps the two
stacks from competing for a letter: the rail's ladder deals in tools and the 信息栏's in read-outs, and
both columns use Q, W, E and R. Each column is therefore **one table read two ways**
(`app/rail/helpers.ts`): `RAIL_FOLDERS` with `folderForShiftKey`, `INSPECTOR_FOLDERS` with
`folderForAltKey` — the shell stacks its folders in its table's order and prints each key, and the app's
single keydown listener (`app/windows/AppShell.tsx`) turns a modified letter into the folder it names and
hands it over as `metro:folder`, because the columns own which folders are open and the app owns the
keyboard — the same split `metro:preset` / `metro:frame` use for the camera. Each column folds only the
rows of its own table, so one letter never folds two headers. Two keys are kept deliberately out of the
camera's way for the same reason: **Shift+W** was the fast forward pan (the fast pan keeps Shift+A/S/D
while a plain W is still forward), and the camera ignores **Alt** altogether, so Alt+W folds 视图 without
also starting a move.

**Ctrl+Q / Ctrl+E raise and lower the view — the camera and its aim together.** A plain Q/E steps the
storey, so the camera takes them *held*: Ctrl+E moves the view up world Z, Ctrl+Q moves it down, and the
key set holds the pan under the **intent**, not the key — `PAN_UP` / `PAN_DOWN`
(`render/scene/systems/SceneSystem.ts`) — so a storey step can never be read as a camera move. **Both** the
camera and the point it aims at step by the same amount (`CameraSystem.panCameraVertical`), which is what
holds the view angle, because the orbit offset is never touched: the station is seen from the same
elevation, distance and bearing and simply slides up
or down the screen — a vertical pan beside the WASD one. Moving the camera alone, with the aim left
behind, would instead tilt onto a steeper or a flatter angle: a different control, and the one line a
refactor is most likely to lose. The rate is the ground pan's own, so it scales with the orbit distance
and Shift triples it; it runs for as long as the token is held (the frame loop drives it beside
`panCamera`, `SceneRenderer.animate`), and because a locked step never changes the orbit distance,
`OrbitControls`' own 4 m / 400 m limits have nothing to clamp — the hold is bounded only by letting go.
**The nav cube's own two arrows hold the same token** (`app/ViewCube.tsx`, stacked at the widget's
bottom-right corner), which is what makes the buttons and the keys one control: one vocabulary, two
sources, so they cannot drift apart in direction or in rate, and a release from either clears the pan. Alt
is left out of the keyboard guard, because AltGr **is** Ctrl+Alt on a European layout and AltGr+Q/E types
a letter there; the press is taken from the browser before the browser acts on it, since Ctrl+E is
Chrome's address-bar search and Ctrl+Q quits Firefox. `test/camera-vertical-pan.test.mjs` pins the locked
step, the untouched angle, the shared token and every end of the wire.

**回到默认视角 owns three things, and `Ctrl+H` is the same button.** The nav cube's ⌂ gets back to the
isometric build view in perspective — `scene.setPreset('iso')`, the 透视/正交 flag, so the picture and the
rail agree, and **the lens**: 视场角 goes back to `DEFAULT_FOV` (45°), because it is the one camera
setting a player can leave the view in, and a home that kept a 120° wide-angle would be "wherever I was"
rather than home. It touches nothing else: 显示其他层, 隐藏天花板, 剖切, 隐藏UI and 隐藏墙壁 are the player's
own settings, and a "home" that quietly rewrote one of them is exactly what made the old button read as
broken. The action lives once, in `app/viewHome.ts`, because there are three ways
in and none of them may keep a copy: the ⌂ button, `Ctrl+H` in the shell (handed over as `metro:home`, the
split `metro:preset` / `metro:frame` already use, because the shell owns the keyboard and the viewport
owns the scene), and any later caller. A plain `H` is still 隐藏天花板 — the modifier is what separates the
two readings of the letter, as it is for Q/E. `test/view-home.test.mjs` pins the untouched settings, the
lens actually moving back through the real camera rig, and the one definition.

**The slider under the cube is 视场角: the camera's lens, in the camera's own degrees.** The number on
it is `PerspectiveCamera.fov` itself (`CameraSystem.fov` / `setFov`), so it can be compared with the lens
anyone else quotes — a shooter's 90, a wide-angle's 100 — with no conversion in between. Degrees rather
than a percentage of the default, which is what it was first: a lens *is* quoted in degrees, the
distortion at either end is a property of the angle itself, and the tangent is not linear, so "67% of the
default" is not 67% of the view. **Both ends of a lens are on the track** (`FOV_MIN_DEG` / `FOV_MAX_DEG`,
shared by the slider and the camera's own clamp so the two cannot disagree): **30°** is the long end — it
pulls the station in, a telephoto that fills the frame with one platform and leaves almost no context
around it — and **120°** is the short end, most of the station at once with the perspective leaning hard
into the fisheye. The values a shooter would call normal (60°–85°) and wide (90°–120°) are all reachable,
and the game's own 45° building view sits nearer the long end, which is what a station editor wants: a
tight lens with little distortion over the block being placed. It is the **vertical** field of view, which
is the one that means the same thing at every window shape — a screen-width angle would change meaning
when the stage is resized. **The camera is the truth**: the widget polls `CameraSystem.fov` every frame —
only a whole degree re-renders — so the thumb follows whatever changed the lens, `DEFAULT_FOV` included
when it is 回到默认视角 that moved it. Two details are not decoration. The flat presets are **unaffected**:
they draw through the orthographic camera, whose field of view is its own frustum (the wheel zooms there),
so this is a perspective lens control and 透视/正交 is still the preset keys' business. And a
`<input type="range">` **is** a typing target to `isTypingTarget`, so the slider blurs itself when the
drag ends — otherwise WASD and Ctrl+Q/E would quietly stop working until something else took the focus.
The row wears Material Design's camera aperture (`MdOutlineCamera`) as its mark, inlined the way every
other icon on this widget is — the repo draws its own SVG rather than carrying an icon package for one
glyph. `test/camera-fov.test.mjs` pins the degrees as their own inverse, the long end genuinely
magnifying and the wide end genuinely opening the frame (by the projection, not by the number), the
camera-side clamp, the NaN guard and the projection moving.

Each half is one line in the system that owns the drawing: the lattice is `GridSystem.setHideUI`, and
the slice is `sliceOptions({ghost, autoCeiling, hideUI})` (`LevelSystem.applyLevel` skips the ghost
material for every piece). Keeping them in their owners rather than in two calls from the viewport is
what stops the lattice and the slice from disagreeing about the mode, and the cell cursor is hidden
with the lattice because the pointer re-sets it every frame
(`test/grid-visibility.test.mjs`, `test/level-slicing.test.mjs`).

**The clock pauses and restarts.** **Space** toggles play/pause (the top bar's 暂停 / 播放 button does
the same), and 重启 empties the crowd, trains and queues while keeping the built station and the clock
(`World.restart`, sent as a `restart` worker message).

Two faults found while the view toggles were being built are worth keeping in mind.
**A focused button is not a text field.** `isTypingTarget` (`app/Viewport.tsx`, shared with `AppShell`'s
shortcuts) treats a key aimed at a `button` as the game's key; the earlier guard that only excluded
`INPUT` and `TEXTAREA` meant that after clicking a rail tile the arrow-key row was, in effect,
"typing", and WASD stopped panning. **A percentage height needs a definite containing block.** `.main`
carried only `min-height: 0`, and `min-height` is not a height: `.stage`'s and `.viewport`'s
`height: 100%` both computed to `auto` — which for a replaced element is its intrinsic **150 px** — so
the canvas sat at its 300 × 150 default in the corner with the whole station squeezed into it, at every
camera angle and in every view. `.main` now carries `height: 100%` with the reasoning written beside it.

**剖切 is a placed surface now, not a fixed half-station cut.** It used to be one plane through the
middle of the model's bounds facing +y, built inside the chunk rebuild. It is a surface the player
places, turns and drags (`render/section.ts` for the arithmetic, `render/scene/systems/SectionSystem.ts`
for the GPU half): an **anchor** — the middle of the station's plan on the storey being edited, set once
per station so an edit never throws the cut away — an **azimuth** that is always one of the four
**quarter turns** (0° looks north, 90° east, 180° south, 270° west) and an **offset** measured *the way
the surface faces*, so a north-looking cut walks north. The plane keeps the half **behind** it
(`planeConstant` is the distance from the world origin to the cut along the normal — the sign is the
whole of it, and built the other way round the plane keeps the half it faces and cuts the room away in
front of the player).

The rail says one thing about the cut and the mouse says the rest. Under the 剖切 tile, while the cut
is on, folds out **旋转 X°** (**R**): the next quarter turn, lit as the angle a press will turn the cut
*to* rather than the one it is at, wrapping at 270 back to 0 (`nextAzimuth`). There is nothing else —
no position box, no sliders, no readout, no 复位 / 翻转 — because the surface itself is the control.

**The drag is one promise: the cut moves the way (R) points it, and nowhere else.** A press that lands
on the highlighted sheet belongs to the cut whatever tool the rail is on (the sheet lights up and the
crosshair becomes a grab hand where that press would land). At the press the cut's own axis is projected
onto the screen — one line, fixed for the whole drag (`SceneRenderer.sectionDragAxis`) — and each move
measures the pointer's travel **along that line**, converted from pixels to metres, and snapped to 0.5 m
(5 cm with Shift). A step across the line counts for nothing, so an oblique camera cannot turn a
sideways drag into a slide; and because the measure is the pointer's own travel since the press rather
than a ray meeting some plane, a slide can never accelerate away from the hand or re-aim itself
mid-drag. A cut that slides straight at the camera has no line to drag along, and the grab is refused
rather than left to divide by nothing.

**While a cut is on, the cut is the only thing that hides anything.** That one sentence is the whole
rule, and it is why `levelSlicing.sliceOptions` takes 剖切 alongside 隐藏UI: the slice is put away, so
**Q/E stop choosing a storey to ghost and 显示其他层 / 隐藏天花板 stop lifting anything** — every storey
draws, opaque, ceilings and all. Cut through a ghosted storey and the cut reads as a cut through
coloured glass; leave the slice on and the half that should be gone comes back the moment the active
storey changes.

The other half of that rule is that the plane has to reach **every** material the picture is drawn with,
not only the ones the section system was handed. The slice *derives* materials and caches them — a 35%
ghost per base material (`dimMats`), a 隐藏墙壁 clone (`clearMats`) — and a clone carries whatever
`clippingPlanes` its original had **at the moment it was made**. A ghost made before the cut was
switched on therefore has none, and the cache hands it out again on every later walk: geometry in the
half that should be gone came back at full strength, which is a cut that looks like black paint rather
than a cut. So the walk restates the plane on whatever it just dressed (`LevelSystem.clipMesh`, fed from
`SectionSystem.applyClip`), and a clone takes its original's planes every time it is handed out
(`dimOf` / `clearOf`) — otherwise a ghost stays cut after the cut is switched off.
`test/cut-clipping.test.mjs` pins both halves.

The surface on screen is a translucent sheet with a border and a 2 m grid, grown with the station so it
always reaches past the building it cuts, floating a 2 cm toward the kept half so the clip cannot slice
its own marker — and a **green arrow** on it points into the half that is **kept**, so which way a turn
cuts is never a guess. The arrow is drawn without a depth test and last in the render queue, because a
mark half-buried in a slab says nothing. **隐藏剖切面** (**Y**) folds out beside 旋转 and takes the
sheet, its border, grid, grab handle and the arrow away, leaving the cut and nothing else; with the
surface gone there is nothing to grab, so the pointer goes back to the tools.

The plane is written **in place** (one `THREE.Plane` for the scene's lifetime, shared by every clipped
material), so a slide costs two numbers and no rebuild; the materials are only re-listed when the cut is
switched on or off. Equipment is clipped with the blockwork (a 闸机 or a screen door standing in the
cut-away half goes with the slab).

**Rails are equipment: a fixed piece centred on the cursor.** A rail is a `track` module — a car-width
bed (`d = 3` m) and a run the length of the bound line's consist (`w = ceil(stock length × cars)`) —
so the whole module is pre-rendered as the placement ghost, centred on the highlighted tile (it grows
evenly both ways, so a long consist lands under the pointer rather than off one end) and turned with
**R** like any other equipment. `R` is a true quarter-turn: `sim/track.ts` is the single source of orientation (run axis,
footprint, edge run, anchor), so a rail can run east–west or north–south, and the consist, its screen
doors and the platform-edge services all turn with it. Placing a rail removes the bed course, so the
mesher exposes the platform block's side face as a half-metre drop and the module supplies the recessed
slab and rails; `World.computeLineAnchors` reads the module (the bed cells are gone) and rides the
consist half a metre below the platform, now along the track's run axis with a matching yaw. The anchor
needs only a track — the platform edge is for boarding — so a freshly laid rail runs a train
immediately, before any platform or screen doors exist. `sim/placement.ts` asks "is this a track bed?"
by *either* the `floor.track` finish (the hand-built path) or a track module's footprint, so the demo
and the renderer agree. `build/rail.ts` is the pure placement + derivation: it lays the bed, then
generates one `platform-edge` per contiguous run of walkable exposed floor beside it (an island
platform yields two — the Spanish solution), each bound to the rail's line and direction and carrying
the rail's rotation. Every derived edge records which side the track lies on (`cfg.side`, read from the
screen's own frame), and the renderer, the auto-derive and `World.computeLineAnchors` share that one
meaning, so the printed header always faces the platform, never the rail. The same `cfg.side` decides
which of the consist's two door banks may open at that berth: a side with no screen run has none, so
its doors stay shut — the train opens onto the platform, never onto the tunnel wall (§1.13). Editing a line's 车型/编组 re-cuts its tracks to the new run length. Each track carries its line's 供电 in `cfg.power`: 第三轨 draws a guarded conductor rail beside the running rails, 接触网 draws an overhead contact wire hung from a ceiling — a canopy the model raises over a platform, or the bore's shell in a tunnel — kept under the 4 m storey line so it never buries in the floor above (and, unlike a mast, it cannot foul the screen doors of an island platform). Switching a line's 供电 (`setLinePower`) carries the new mode to every track bound to that line — platform and tunnel runs alike — and rebuilding the module meshes re-cuts them all together. The 轨道 folder has
two tools, both gated by one eligibility check (`trackBlockReason`): anything already sharing the run's
space — equipment, a room, a screen door, a ramp, another rail/tunnel — blocks placement rather than
being demolished, and the preview flags it red. **站台** is the fixed consist-length piece above; it must
rest on solid floor under its whole bed (three cells wide, `trackFloorMissing`) and refuses a wall in its
headroom (`trackClearanceBlocked`) — a platform is open air. **隧道** is a pure tunnel run: hover an
existing rail and it extends off the free end nearest the pointer (a slider sets the length), keeping
the source's axis, rotation and bed depth, flagged `cfg.tunnel` so it never spawns platform doors. A
tunnel may hang over void, and it bores: it deletes any wall (or ground) poking into its three clear
courses, then raises a solid side wall either side and a ceiling one storey up wherever they are missing
(`boreTunnel`, shell blocks tagged `tunnel-shell:<id>` so removing the tunnel takes them too). Both
refuse to overlap another track (`commitTrack` / `placeTunnel` return the same state when they would).
The ghost draws the run's 上行/下行 direction as arrows on the bed (Tab toggles it in platform mode)
and a tunnel inherits its source's direction; `computeLineAnchors` takes the train's travel sign from
the track's `cfg.dir`, so the button turns the real consist, not just the preview. The 轨道 folder shows
the platform-only controls — 方向 (上行/下行), 线路, 重置屏蔽门 — only while placing or editing a
**platform**; a tunnel tool or a selected tunnel shows just the two tools and the length slider. The 重置屏蔽门 button re-derives the selected
rail's doors, or every rail's when nothing is selected. Line management lives in the right inspector's
**线路** section (线路名/颜色, 上行终点/下行终点 direction signs, 车型/编组/供电/下车, plus **+ 新建线路**).
The whole section and each line card fold open/closed, so a long roster stays compact. Each card also
carries a trash icon beside the colour swatch that removes the line together with every track bound to
it (and those tracks' derived screen doors and tunnel shell) — a single undoable step. The 下车 slider
is per car; its readout is the whole train, so 载客量 (`编组 × 下车/节` 人/列) and the peak-hour figure
update with both the slider and the consist. The two
terminus inputs name where each direction runs, and every platform screen door on that line
prints the matching one on its direction sticker instead of a hardcoded place name. 屏蔽门 is a
per-line choice of **全高** (the default storey-tall screen, its line header printed on a top band)
or **半高** (a 1.5 m screen, the same header printed on the glass as stickers); switching it
re-derives every screen bound to the line and re-sizes their collision envelope. The Wusi Square
test rig (`test/support/scenario-station.ts`) builds its bed from the same dig, and the 动物园 demo
save carries the recessed bed too.

**A consist is a cabin the crowd actually rides in, not a counter that teleports people onto the
platform.** The alighting wave a service brings is **seated after stopping, before its doors open**:
`World.loadAlighting` puts the whole cohort into the doorway queues it will leave by — the front pair
at its own door, the rows behind it receding inboard — during the doors-shut berth phase (§5.9).
Passengers are absent during approach. `stock.ts` owns the cabin box the
sim's slots and the car model are both cut from (`cabinSlot`, `CABIN_FLOOR_Z`, `CABIN_HALF_W`,
`CABIN_ROW_PITCH`), so a rider is drawn standing on the floor the model draws and leaves through the
doorway it was walked to — the same contract `doorCentres` holds between a car door and the screen
that meets it. `World.stepTrainRider` pins a rider to its consist's own pose (`trainAt`, shared with
`trainRenderState`, so the two cannot drift), and a rider is out of the crowd's way while it is
aboard: not in the collision pass, not in the density derate, not priced onto the platform's nodes
and not counted in the LOS — a full train is not a crush on the floor nobody has stepped onto yet.
Doors first serve the wave: `World.openDoors` holds each doorway shut to boarders and
`stepAlighting` hands it over the moment its **own** queue has drained, a pair abreast every
`CABIN_ALIGHT_PAIR_S` (§5.9: alighting is the doorway's own business). Its turn is bounded by
`CABIN_ALIGHT_MAX_S`, because a dwell has to be shared — past it the rest of the wave rides on and is
counted among the stop's left-behind arrivals rather than a platform that silently never boards.
Boarders take the cabin behind that queue (`boardRider`). Cabin riders leave the world once the
doors close, during the stationary hold before departure. The car itself is hollow — floor, ceiling, lining to the waist rail, a glazed
window band, longitudinal seating in the bays between the doors and grab poles at each doorway
(`render/models/pieces/TrainModel.ts`) — which is what lets the player watch the queue inside and
step out of the doorway rather than appear beside the train. `test/train-cabin.test.mjs` pins it:
the whole wave is aboard before the doors open, a doorway passes a row at its own cadence, boarders
wait for their doorway, everybody still in the cabin despawns after closing and before motion, and a wave too big for
the dwell is counted rather than lost.

The passengers follow the web concept sheets' rounded body, circular head and curved hair cap,
retaining three instanced draws for the crowd. Train roofs use the body's own paint and meet
the cab at a cut seam without overlapping shells. Half-height screen-door top rails are split
at every opening, and each leaf carries its own white and black cap as it slides clear.
Train-door glazing occupies a real cut-out in its painted frame. Screen-door leaves use separate
slide lanes with clearance around the fixed glass, jambs and cap rails, preventing surface flicker
throughout opening and closing.
The half-height rails now use slim 8 cm white members and 10 cm black caps, stacked without
intersections, with an 11 cm glass slide lane. Screen panes draw one transparent surface without
writing depth. The cabin has formed stainless benches, white seat-end guards, red curved rails and
straps, overhead handrails, centre poles, ring lights and ceiling light strips over a grey-blue floor.
Train animation interpolates from the last drawn pose to each new worker snapshot; marking a
snapshot inactive no longer discards the previous position and makes the train jump at 1 Hz.

**Escalators are staircases, and they turn over.** `models.ts` builds each run as a band of
instanced steps whose treads stay world-horizontal (riser, then the yellow nosing along the
leading edge), so the incline reads as a staircase rather than a smooth ramp. `rollEscalator`
slides the band up the run every frame at `ESCALATOR_SPEED`, wrapping it at the comb plates and
driven by the sim clock (`stateIntervalMs`) so fast-forward turns the steps faster, not the crowd.

**Stairs are real steps, and the turn is walked.** The catalogue carries five staircase shapes —
straight, left- and right-hand 90°, and a 180° switchback in either hand (右 / 左双跑楼梯) — each
climbing exactly one storey
like an escalator, but walked both ways. `models.ts` builds each flight as level treads with a riser
under every leading edge (never a ramp with grooves), and wears the **floor finish of its lower
landing**, so a granite hall gets a granite staircase instead of a steel one. `sim/stairs.ts` exposes
a stair's ordered flights; the graph gives every flight its own two-way capacity edge, and the
half/quarter landing between them is a real walkable node and a stair-width platform in the same
surface and slab thickness as the treads, wrapped by a balustrade that carries the flight handrails
around the turn — the block mesher skips those cells, so a landing is never a floating 1 m cube. The
**楼梯** group has five buttons, one per shape (straight, left 90°, right 90°, left and right
switchback),
each placed as fixed-length equipment: its base sits on the hovered floor cell, the finished stair
previews as a translucent ghost, and **R** turns the run; **Tab** cycles its **size**, which the action
tile names **窄 / 中 / 宽** (`STAIR_WIDTH_LABELS`) — the player picks a size, never a metre. A straight
flight's size is one, two or three **lanes**, each exactly one escalator band, so a wide stair is
literally that many narrow flights side by side and every lane merges with the run next to it (see
the lane rule below); a 双跑楼梯's size is the **blocks** its flush pair takes across — 2 / 4 / 6, two per
run — so its runs are built a block wide each and laid on the block grid (`stairSwitchbackRunWidth`,
`stairFlightSlides`; see the switchback rule below).
Every side of a flight carries a stringer
and a handrail, and each handrail **levels off at its landing and turns down into a newel post on the
floor** — a quarter turn, so a stair rail wraps round and reaches the ground instead of stopping dead
above the last tread (the same idiom the escalator's balustrade return uses) — unless a **wall hugs
that side from bottom to top** (`stairWallSides`). Both the stringer and the soffit are **trimmed by
`thickness · tan θ`** (`buildStairFlight`), so their square-cut lower corners end on the treads' own edge
rather than swinging past it: a landing's column is deliberately never cut (it is the floor the crowd
stands on at the foot of the run), so an overhang there left the flight's foot 0.36 m deep inside the
floor block, cut off by the surface it stands on. The handrail keeps the full incline — it is in the air,
where its square ends pass over the landings harmlessly. The wall is the barrier there, so the flight keeps
only the stringer it meets the wall with and grows no handrail, rail posts or newel return of its own:
a staircase in a stairwell is railed on its open side alone. The wall has to run the flight's whole
length, at the flight's own heights — a wall that stops at the half-landing, a stump that only reaches
the bottom steps, a doorway punched through one course, or a wall standing only on the storey above
all leave the rail on. A turning stair also
lays its half-landing
as a walkable cell, so the two
flights connect — and that cell is the **stair's**, not the station's: the mesher skips it while the
model draws the platform there, so bulldozing the stair takes it back out again (`removeModule`). A
stair deleted on its own would otherwise leave a stray block in the middle of the station. That own
cell is also why **移动 tears a 楼梯 (or a 扶梯) down and builds it again** rather than translating it
(`moveRebuilds` → `moveEquipment`): the piece leaves through `removeModule`, which takes its landing
floor back out (or leaves it under a piece that still stands on it), and returns through
`addEquipment`, which lays the new landing and carves the opening it climbs through at the cell it was
dropped on. A straight stair lays no
such cell, and a block the player put there by hand is not the stair's to take away. The Wusi Square
test rig keeps a single pre-placed stair — the straight run
that replaces exit A's down escalator; `carveRampOpenings`
opens the slab each flight climbs through while keeping every landing, so each stairwell is a real
hole in the ground.

**A switchback's runs are block-wide and share their balustrades, so its size is the blocks it takes
across.** A 双跑楼梯's two runs cannot be laid like lanes — they stand **flush**, balustrades back to
back on the seam — so what has to land on the block grid is the *pair*, and each run is built to fill
its own blocks, **balustrades included** (`stairSwitchbackRunWidth`: 0.79 / 1.79 / 2.79 m at 窄 / 中 /
宽, where two lanes would be 1.36 m). Two runs of that width stand exactly `stairSwitchbackGap` apart —
the shared centre rail a real 双跑楼梯 has, with no floor left between them and no half block over either
side of the piece. The returning flight's path is laid `stairSwitchbackOffset` cells across (one block
per lane) and **both bands then move half a block** onto the grid (`stairFlightSlides`), so the piece
claims a whole number of **blocks**, two per run — **2 across at 窄, 4 at 中, 6 at 宽**, growing along
the run's right from the base cell (a 围栏 cannot stand in any of those columns; `test/stairs.test.mjs`
proves it block by block). Because the treads and rails end on the cell edges, a **wall built beside
the piece stands flush against a run's outer balustrade, and that balustrade goes** — exactly as on a
straight flight (`stairWallSides` reads the cells beside the run's own blocks, not the column its
walking line is in). A piece saved at an older, off-grid width keeps its band centred on its walking
line, and the return run closes what is left of the well (`stairReturnSlide`, capped at
`STAIR_WALK_CLEARANCE`): before the widths were block-wide, a 1.4 m switchback took five blocks and a
2 m one five again, with a 0.64 / 0.96 m corridor down the middle. The paths stay on the
grid — the half-landing is the row of blocks the pair covers, and both flights join the
graph on cells — so what moves is the band, never the walk. The two hands are two pieces, not one piece turned: the same first flight, with
the return run laid back on its right or on its left, and **R** cannot swap one for the other (a
rotation turns the whole stair about its base, so the turn keeps its hand). The half-landing is a
**walked** row of cells — its cells are the stair's interior nodes — and the crowd really crosses it:
each flight's balustrade wall (`sim/station.ts`) therefore **stops dead at the flight end that meets
an interior landing** and follows the slid band, because a wall over-running that end (as it does at an
outer landing, where it stops the crowd cutting the corner off the run) would cut the landing's own
cells apart and seal the two flights away from each other. A 180° turn lands on a row, so this is the
pair's only way through: a switchback built before this rule — or a saved one with its flights still
three cells apart — walks across it too, and tightens as far as its own layout allows. The platform the
landing is built on is **one block deep** — the row the two runs turn on (`stairLandingShape`), not as
deep as the runs are wide: that row is what the builder lays as walkable floor and what the crowd turns
on, and a slab as deep as the stair is wide hangs over the rows either side of it, across the last steps
of the run climbing into it. The
**half-landing's own balustrade** follows the same rule as a flight's: the model wraps the platform's
open edges, and drops the railing on an edge a wall hugs (`stairLandingWalls`, read at the landing's own
storey) — the two long sides of a 双跑楼梯 in a stairwell lean on the well's walls, and a rail left there
would be the barrier drawn twice, poking through the wall. See
`test/stairs.test.mjs` and `test/bay.test.mjs`.

**A wide stair is lanes — one staircase — and it snaps beside what is already there.** A straight
flight is laid as `stairLanes(stairWidth)` **one-lane pieces**, one per cell, each exactly
`ESCALATOR_BAND` wide: a 2-lane stair is two 0.7 m lanes in two blocks, a 3-lane stair three. Every
lane is an ordinary tile-sized run, so nothing about collision is special-cased. `stairLaneMates`
then joins the **steps** of any two lanes standing flush along the run: each one's treads and risers
run out to the cell edge, so neighbouring flights never leave a gap between them. Whether they are also
*one* staircase is a property of the pieces, not of being neighbours — every lane of a wide stair laid
in a single action carries the same `cfg.flight` token, and along a seam between lanes that share it
the model (`buildStairFlight`) drops the stringer, handrail and posts, so the flight is railed only at
its **outer** edges. So:

* a 1.4 m or 2 m stair placed from the catalogue is one wide flight — steps joined, no rail down the
  middle, and the crowd may step between its lanes at the landings (`sim/station.ts` leaves out the
  balustrade wall there too);
* two **separate** 0.7 m stairs dropped side by side stay two staircases — the steps still meet, but
  each keeps both of its own railings, and those rails are a barrier the crowd walks around.

Lane against *escalator* is a different matter again: both keep their own balustrade and the stair's
steps do not reach under it, as the tile rule below describes. The hover ghost is built against the
station *plus* its own pieces, so a wide stair previews as the one flight it will be. A wide piece
covers more than one cell, so the
pointer's cell is ambiguous: `planStairLanes` tries it as the first lane, then shifted back one lane
at a time, and takes the first arrangement whose every lane is placeable — so a 2-lane flight dropped
next to a stair **on its left** lands on the right of it, dropped next to one **on its right** lands
on the left of it, and one dropped into a gap fills the gap. No arrangement free → the first
candidate comes back flagged, and the ghost shows the same red refusal a single piece would.
A **turning** stair is one piece, not lanes (its flights turn, so its landings cannot be shared lane by
lane): a 90° turn keeps the tool's own width, and a 双跑楼梯's runs are built block-wide and laid on the
block grid (the switchback rule below), so either one is wider than a cell at 中 / 宽 and needs a bay of
its own, exactly as before. A station saved with an old single-piece 1.6 m stair keeps it as it is — one
wide flight with its own bay — so only newly placed straight stairs are mergeable.

**A run fits inside one tile, so runs stand flush and neighbours are buildable.** `ESCALATOR_BAND`
(0.68 m) is the escalator's clear step band, `ESCALATOR_BALUSTRADE` (0.82 m) is the spacing of its
balustrades, and the handrail's outer face lands at 0.49 m — inside the cell. A narrow **straight** stair
is built to exactly that band, so the two are the same width, and its handrail reaches 0.445 m; a narrow
**双跑楼梯**'s run is a block less its two balustrades (0.79 m of treads, rails out to 0.5 m), which fills
its block exactly. Either way the piece fits one 1 m tile per block with the whole assembly, rails
included, and never crosses its cell edge. Two runs in adjacent cells therefore simply sit side by side,
each keeping **both of its own
balustrades** — the pair reads as a bank of two rails on the boundary, and no rail has to be dropped,
shared or owned (`test/bay.test.mjs` measures the drawn models to prove it). (A boundary carries no
rail in two cases: two lanes of the *same* stair flight, which are one staircase, and a side a wall
hugs — see the lane rule above and the stair bullet.) It also means a wall, a
fence or a gate can be built right up against a run: `rampEnvelope` reserves exactly the tile the run
stands in, so the boxes of two adjacent runs *touch* and the ordinary strict-overlap rule already
allows the bank, with no exemption to maintain — and the block it is built against stays **whole**, a
full cube with nothing derived over it, because a run laid to fill its own blocks ends its rails
exactly on their edges and only a body that crosses into a block is reached (`rampThinCells`). A
single piece wider than a cell is the exception that
proves the rule — an old 1.6 m stair, or a 中 / 宽 turning stair, whose runs are two and three blocks
wide — because its body genuinely fills more than one cell, so it needs a bay of its own and still
collides. A run in the same column one
storey down still stacks and is still refused.

**扶梯 窄 / 宽** places one escalator spanning one or two blocks. The wide piece has a single
continuous moving step band and balustrades only at the outer edges. Its two-block footprint,
floor supports, carved openings and picker width follow the same piece in every rotation and
travel direction. Older saves without a width retain the narrow model.

The metal shoulders are 18 cm wide and the glass sits 8 cm further inward on each side.
Steps follow a smooth bend into flat landing tracks; their risers collapse and the chain
wraps beneath the comb plates. The upper landing block is recessed beneath that track,
with a metal apron replacing its exposed top while the floor cell remains a graph support.
The lower body is buried 2 cm into its supporting floor, with its lid and sides inset 5 mm
from adjoining surfaces; landing aprons clear the floor by 5 mm to prevent depth-buffer flicker.
Flush, parallel escalators also share a steel cap between their facing handrails, as does a
stair beside an escalator. Both handrails remain; one escalator owns each cap so rebuilding
or deleting a neighbour updates the seam without duplicate surfaces.
The infill wraps around both rounded rail returns to seal the ends down to the landings,
and a row of metal hemispheres follows its centreline, seated on the actual cap slope.

**Escalators are placed the same way.** The **扶梯** button drops a fixed one-storey escalator: its
base sits on the hovered floor cell, it rises `ESCALATOR_RUN` cells along the placement rotation, and
the finished run previews as a translucent ghost; **R** turns it and **Tab** flips its travel
direction between up and down. The placement ghost carries a bright arrow over the run pointing the
way it will carry people. Direction only orders `from`/`to` — the single one-way edge the sim reads —
so an up and a down piece share one footprint, and two runs may stand flush in adjacent tiles (the
tile rule above). Selecting a placed run exposes a vertical switch control beneath Move; it reverses
both endpoints and the direction setting in one undoable edit (`test/escalators.test.mjs`). The
one piece lives in `sim/escalators.ts`, and the Wusi Square test rig builds its pre-placed runs from
that exact constructor too, so the rig and the builder place the same equipment at the same
dimensions. Its handrail wraps the end of the glass at both landings — a half-turn round the end and
down onto the floor — and a flat newel plate closes the foot of each balustrade, so no rail stops
dead in mid-air.

**The ground under a run fills up to its underside.** A run's body hangs below its walking line, so the
block under it would otherwise swallow the truss. `rampSlopeCuts` (`sim/openings.ts`) derives the
volume each 楼梯 / 扶梯 takes out of the ground it climbs over: the tiles `rampBodyBoxes` already
reserves for collision, with the **body's own depth** taken off the local line — an escalator's
`RAMP_FOOT` under its truss, a stair's `STAIR_BODY_DROP` under the stringers and soffit the model hangs
to that same line, because a stair cut to a truss's depth stops 14 cm short of the steps and leaves a
slot of daylight under every flight. That depth is the *reservation's* too (`flightBodyBoxes`): a
stair's collision box hangs to its own soffit, so a 座椅 or a 围栏 stands in the band under a flight
that the drawn stair leaves clear, and the space equipment is kept out of is the space the piece
really fills. The **line** is the run's own too: an escalator's truss runs
landing centre to landing centre, but a stair's treads stop `stairTreadTrim` short of each landing centre
and still carry the whole rise, so the body under them is *steeper* than the walking line — a 3-cell turn
flight is 45° where that line is 33.7°. Cutting to the walking line crossed the stair (daylight under its
upper steps, the plane buried in its lower ones, worst on a 90° / 180° turn), so `flightTiles` cuts a
stair to the line its treads climb. The
mesher draws those blocks' tops on that plane instead (`chunkMesher`'s `slope` map), so a block under
a run is the filling under the slope — a wedge where the plane leaves through the block's floor,
clipped with Sutherland–Hodgman so nothing chords back up into the run — and the run's body lands on
it. `rampOpeningAt` leaves the space under a run buildable for exactly that reason: a run's opening
starts at its walking line, so the 方块 tool lays a block under it and the carve keeps it. Only the
column the run's own walking line passes through is cut and a run's landing columns are left whole.
Nothing is added to the document: the cut is derived from the modules, the way the half panel beside a
wide run is (`thinWallCells`).

The last course under a run is the one the brush may **not** lay: its top face would sit above the
walking line, where the crowd's own floor is measured. A **derived filling** (`rampFillKeys`) closes
that course where a run keeps it: every cut cell the station holds nothing in that stands on solid
ground, kept by `SceneRenderer` with the cuts (`SceneContext.slopeFills`) and drawn by `chunkMesher`'s
`fill` argument as if the block below carried on up to the run's underside — shaved by the same cut,
solid to every neighbour so the seam is never drawn. **Where the cut carries the drawn body's
half-width the filling *is* that body** — the mesher builds it from the rectangle itself
(`buildTrussProfile`: sharp, across the run, the full tile along it) in the run's own steel, the 钢板
finish (`RAMP_SOFFIT_FINISH`), so a narrow body's skirt meets its truss flush instead of stepping out
9 cm either side. 钢板 is a stock **ceiling** finish,
so it is in the 材质 palette too — a block's bottom face can wear the same steel anywhere. Still no
cell, no tag, nothing a tool has to keep in step: dig the ground away and the filling goes with it. The
hover ghost reads it with the pending cells in place, so the wedge a block is about to create is
previewed with it (`test/ramp-fill.test.mjs`, which fits the drawn filling against the escalator model's
own truss; `test/slope-cut.test.mjs`).

**The escalator carries its own body over the course the ground leaves.** The filling above is the
**ground's** surface, drawn by the mesher as a derived cell — and a derived cell has to be *told* it
is solid without being one, which is what drew it as four walls and no lid. The 扶梯 draws that body
itself instead, over exactly the course the 方块 brush may not lay (the reason a filling exists at
all): `EscalatorModel`'s `undercroftSolid` cuts a **closed prism**, `ESCALATOR_BALUSTRADE` across,
whose floor is the lower landing's walking line. Its lid is the plane the ground under a run is
**shaved to** (`RAMP_FOOT` below the walking line, `rampSlopeCuts`) rather than the truss box's own
underside, and that is what makes the two one surface: the body meets the shaved ground level, and the
trench the cut opens at its foot closes exactly where the body begins. The truss's underside hangs
lower still, so the body's top and flanks are buried inside the box — flanks flush with the box's own
at the same width, sharing the same steel, so there is no step for the eye and no seam for the depth
buffer. The lid follows that plane **to the body's very end** rather than flattening off at the course
line: a flat cap left the body's last stretch standing with the truss floating a hand's width above it
and a slit to see through, where now the end face meets the truss's own underside. The body reaches as
far as the ground's filling did and no further — on a one-storey run it spans the two cells the
filling covered, from where the lid meets the floor (0.75 m up the run) to the far edge of the last
cell it crosses (2.5 m) — and past that the run keeps the open underside it has always had. Because the
piece draws that body, the renderer **derives nothing** under an escalator: the cut it leaves carries
`ownBody` (`sim/openings.ts`), `rampFillKeys` skips it, and the tab stays empty — two bodies in one cell
would be two coplanar faces, one from the ground's kit and one from the model's, flickering against each
other. **Neither does a 楼梯**, which is the other end of the same question: the course a drawing filling
would stand in under one is the run's own **carved passage** — the cell its treads sweep, a block-sized
space nothing can be laid in and no 材质 brush can register on — so a stair's cut carries `noFill` and
leans on the ground it really has: the blocks its flight meets are shaved to its underside (the one below
the first step included), and where there is none the flight hangs over its own well, open. The filling
path itself is still the mesher's, kept honest by `test/ramp-fill.test.mjs` and `test/floor-surface.test.mjs`
over hand-made cuts, the way the truss-width band is. The space under a run also stays buildable (`rampOpeningAt`), so
a block laid there is drawn inside that body — the piece wins, the way it does anywhere a player builds
into equipment. `module-build.test.mjs` pins it: the prism's shell (every edge shared by two faces),
its floor, its extent, its width, every vertex at or below the plane the ground is shaved to with the
top exactly on it, its lid above the truss's underside the whole way so no slit can open under it,
rays straight up under the run meeting it over that course and missing it past it, and a down run
carrying the same body as its up twin.

**A wedge's top is the only drawn surface that is not a cell face**, and the pointer reads the drawn
mesh: `THREE.Intersection.face.normal` is the triangle's own geometric normal, so `cell + normal` asked
for a *fractional* block — laying 方块 beside the block under an escalator committed a block at
(4.44, −0.15, 1.89), which no tool can address again (the grid repair drops it on the next load). The
pick snaps the face to the axis it most points along (`render/pickCell.ts`, `pickCells` / `faceAxis`) and
takes the placement cell one whole step out, which also covers a rounded block corner — the other
off-axis face, and the reason the bug was never only about slopes. The 材质 brush reads the same snap
through `dominantFace`, so the face a stroke paints and the cell a block lands in cannot disagree.

**Ramps carve their way in.** `sim/openings.ts` (`carveRampOpenings`) removes the solid cells an
escalator, stair or lift climbs through, so a placed ramp surfaces from an opening rather than
through the slab; the landing cells are protected because the graph uses them as the ramp's nodes.
Only the run's **centreline cells** are carved (`RAMP_CORE_HALF`), so `rampOpeningAt` reserves just
the true opening and the floor beside a run is not deleted — it stays buildable. A block a ramp has
kept is marked by `rampThinCells`, and the **mesher** draws it half a block thick on the side away from
the run, leaving the near half clear for the body and handrail. It is the same drawing path a player's
own 半墙 takes (`thinWallCells` hands the mesher both), which is what makes a stair's own half wall a
real surface: its faces keep their own finishes, so the 材质 brush paints it, and the drawn panel is
what the pointer picks. Before that it was a single-material panel over a hidden voxel, and the brush
either could not see the cell at all or painted half a block away from the surface it was aiming at.
That is now only ever a piece wider than a cell, and *reaching* is strict: a swept body or
handrail has to cross the neighbouring block's near edge, because touching the face of a block is
not being inside it (`REACH_EPS`). A narrow stair or an escalator sweeps 0.445 / 0.49 m, so nothing
beside it is reached at all, and neither is anything beside a **双跑楼梯**: its run is built to the
width of the blocks it fills (0.79 / 1.79 / 2.79 m), so its rails end **exactly** on their edges and
the wall a player pushes the piece flush against stays whole, full block and full height — which is
the point of that width (the handrail drops on the walled side instead). While a
**floor** is still thinned when a wide stair's 1.6 m body reaches into the
column beside it — which closes the hole the carve used to leave at the top of the stair — and a wall
a wide stair's handrail reaches is thinned the same way (both kinds draw identically now, so the
derivation reports only the side), as is a 中 / 宽 90° turn's, which is one piece 0.18 / 0.52 m wider
than its own cell. The 动物园
demo save carries the same carved openings, so it no longer shows escalators punching through the
concourse floor. An escalator is single-direction and carries **one passenger per step**
at 0.5 m/s over a 0.4 m pitch — 75/min, and exactly one rider per step on the run.

**Elevators are a 2 × 2 m shaft with one car.** The default **玻璃** model has
transparent side/rear panels in a stainless beam frame, panel clamps, exposed guide
rails, glazed cabin walls, handrails and framed sliding doors. **Tab** (or the
style action tile) switches to **钢板**, the previous enclosed model. The choice
follows placement, hover previews, picking and saves; extending a shaft keeps its
style. Older lifts without a style field use the glass model.
The **电梯** button drops a base
module on the hovered floor: a 2 × 2 m assembly with a 1.5 × 1.5 m carriage
inside its walls (`sim/lifts.ts`, `LIFT_RISE = 4`) that serves the floor one
storey up and stands on all four of its floor cells. The *model* is taller than
the ride: it runs on up to the slab above its top landing, and its lid **meets
that slab's underside flush** — the lid's top face is the very grid line the
block above the landing starts on, so the shaft tops out on the block grid with
no strip of daylight around the cabin, and with no overrun either: a piece on the
platform (−8 m) serves −8 m and −4 m and its lid is exactly the concourse
ceiling's plane (0 m), never poking through the street. The player grows it a
storey at a time — hovering the shaft's upper half extends it up, the lower half
down (`LIFT_EXTEND = 4`).
Extending never checks for floor, so a shaft may run past a level with no slab
(it simply has no landing there); only a fresh piece must stand on floor. One
shaft is **one car**: `buildGraph` makes the walkable landing tile in front of
the door at every storey a stop and gives the single lift server an edge between
every ordered pair, so a passenger rides straight to their floor (a step-free
passenger is forced onto it because stairs and escalators cost ∞).
The whole 2 × 2 footprint is cabin interior and is never walkable; only the two
floor tiles in front of the door opening (`liftLandingCells`, turned by the
piece's rotation) can board, so the crowd enters and leaves through the door the
model draws and never through a side or back wall. The car is a real state
machine (`World.stepLift`): park, open the doors, let the crowd walk in and out,
shut, then travel — riders are `STATE_RIDING` and pinned inside the cabin by
`stepLiftRide`, so they visibly move with it instead of teleporting. `models.ts`
builds the shaft and a cabin whose two leaves are registered doors, with a
threshold sill and a green call panel at each real landing floor (never at a
floorless level or above the roof), and the worker sends one car pose per
snapshot (`World.liftRenderState`) so
`SceneRenderer.setLifts` glides the cabin and slides the doors. See
`test/lift.test.mjs`.

**Every Wusi Square exit is a head-house over an up + down pair.** Each of the three surface exits owns a
descending run and an up run landing on the exit's own row, **side by side** in the head-house's two
bays; `models.ts` draws the
exit as a **red steel portal frame** wrapping a **blue waved roof** that rises toward the street
doorway (the sign side stands tallest), with glazed sides *and* a glazed back wall whose heads follow
the roof, and red base members tying the frames together along the ground — the reference art, not a
white-walled box. The roof reaches over the run, so the runs surface from a hole in the plaza under
cover. The exit's drawn floor leaves each run's own block open (`exitRunHalf`), so the balustrade and
handrail pass through the wellway while the block beside it stays whole floor. Exit A's descending
run is a narrow **stair** paired with the up escalator (a mixed entrance), the other two drop a down
escalator beside their up run. An exit does **not** auto-face the nearest run: like the rest of the
equipment it is turned with **R**, and its floor, street-opening node and glass/back walls all turn
with it, so the mouth points where the player sets it. A surface exit is rooted at the street
(z = 0); dropping one on a concourse or platform slab is refused.

**Exits come in six variants: 有盖 / 无盖 × 单向 / 双向 / 三向, and their runs stand side by side.**
`ExitCfg.bays` (1, 2 or the default 2) is how many **adjacent** columns the head-house holds — a
单向 at 0, a 双向 at 0 and 1, a 三向 at 0, 1 and 2 — and `exitSpan` builds the house around that group
with **one full block of floor at each end**: 3 / 4 / 5 blocks across (`exitWidth`), so a 双向 is
exactly four blocks wide with a whole block of black pad either side of the two runs. `exitRunSnap`
clamps a dropped run to the group, so the runs can only ever be side by side. The head-house
floor is a thin plate over the whole plan — it opens
only along a column a run actually descends through (`exitRunOpenings`), not that run's top-landing
row, so the plaza floor never shows through the block and the pad is never cut a row short. The
interior dividers follow the runs the same way: the head-house rails a slot between two runs
with an empty block between them, and leaves runs
standing side by side to the two balustrades their own
models already draw on the boundary — a head-house rail there would cut through both of them.
`ExitCfg.covered: false` is the 无盖 exit: it drops the canopy, frames, glass and back wall and
draws a 围栏-style glass railing (steel top/bottom rails, a glass sheet and posts) where each wall
stood, so the barrier the crowd meets is the same and only the look changes. The 出入口 palette tile
is a sub-menu of all six (有盖 单向/双向/三向, 无盖 单向/双向/三向).
See `test/exits.test.mjs`.

**A ramp dropped inside an exit snaps into one of its run columns.** When an escalator or straight
stair is placed over a
head-house, the pointer controls the run's position on the *street* floor: `exitRunSnap` puts its upper
landing in the column under the pointer — clamped to the bay group (0 … bays − 1), so the runs stay
side by side — and drops its base one storey down toward the mouth, so the run lines up with the
wellway the
exit's floor opens for it rather than the floor it climbs from. That is what lets a stair be dropped
beside an escalator inside one head-house. Everywhere else the hovered cell stays the run's base.
Turning stairs are left un-snapped — their run does not end at the bay.

**The head-house is solid, and the opening is the way.** `sim/exits.ts` holds the geometry the sim
and the renderer share. The exit's graph node is the street opening (the doorway cell, not the cell
under the canopy), and the glass sides and back wall are barriers in the walk graph, so the crowd
walks in and out through the opening and never through a wall. A bare portal opts out with
`cfg.headHouse: false` (the small test stations do).

**An exit is named and selected in both views.** The RHS 出入口 section folds like 线路, and each card
edits the exit's name (commit on Enter / blur), its demand and its open toggle; the name reprints the
model's street header, which carries the station name and the exit's own name. The 3D view and the
card share one selection: clicking an exit highlights its card, and clicking or focusing a card draws
a highlight box around the exit in 3D (`SceneRenderer.setSelection`). A click tests the drawn meshes
(`SceneRenderer.pickModule`) as well as the collision envelope, so a large head-house is selected by any
part of its visible model, not only the cells its box reserves. The 删除 tool does the same: hovering a
placed module highlights the whole piece in red and a click removes it (rails and rooms through their
own teardown) instead of only clearing the block beneath it. **A held drag sweeps a same-type run.**
Press one 设备 / 装饰 piece and drag across its neighbours: every *matching* piece the pointer passes
over lights up as it is crossed and the release bulldozes the lot in one commit, so a single `Ctrl+Z`
puts the run back. The match is the palette piece, not the bare type — a 2 m 座椅 never takes the 1 m
ones and a 横版 广告牌 never takes the portrait panels — while rotation and a room's `自动` origin are
irrelevant, so a gate line facing both ways is one row. `app/sweep.ts` holds the rule; the viewport
feeds it `SceneRenderer.pickModule` and it samples the path between two pointer events, so a fast flick
that jumps a cell still collects what it crossed. A 围栏 keeps its own straight-run drag (below), and
rooms, rails, 出入口, 楼梯 and 站台门 are never swept — each is one structure with its own
teardown. A **扶梯** and an **电梯** are the deliberate exception, and a divergence from §9.5, which
lists both as unsweepable: a bank of either sweeps, each strictly within its own family, so an
escalator never takes a lift, and the teardown is the same `removeModule` a single delete uses, so one
`Ctrl+Z` restores the row. See `test/sweep.test.mjs`, which is where that decision is written down.

**移动 moves a piece — and rebuilds a run.** It is neither a tool nor a second panel: select the
设备 / 装饰 / 出入口 piece (`Z` 选择) and press the 移动 button in the right inspector's `信息` card, beside what
the piece is — and that same card becomes the move's whole control surface while the piece is in the air, with
the tick and the cross exactly where 移动 was, over the cell the drop would use and the rule a refused cell
broke. The card's acts are **icons, not words**: 移动 wears `IoMdMove`, its lift's 确认 / 取消 are
`IoMdCheckmark` / `IoMdClose` (so the card the button turns into is visibly the same card), and a
指示牌's board-editor entry is `FaEdit` (`react-icons`) — each named by an `aria-label`. **Nothing in the
app wears a tooltip**: a control shows its own label, art and key badge, and where a thing needs words they
are the label it already has or a line of text in the card (a disabled 移动 says why underneath, rather
than hiding it in hover text). The piece stops being *drawn* where it stood and rides the pointer as the translucent ghost a
fresh placement shows, with `R` turning it in the air and the validity tint — the same red — meaning
what it always means. Lifting is deliberately **not an edit**. The piece keeps its id and its whole
`cfg` (a 指示牌's printed boards, a 闸机's lane, a 广告牌's frozen poster) and never leaves the document,
so nothing lands on the undo stack and `取消` has nothing to restore; what lands is the piece as the
document holds it *now*, so a board edited while it was in the air survives the move. The drop is
**one** commit (one `Ctrl+Z`), and it answers the same rules a fresh placement does — floor under every
cell it stands on, no track bed, nothing already in the space, a wall behind a 广告牌, a ceiling over a
指示牌 / 电视 — asked through `moveCandidate` (`sim/placement.ts`) of a piece that already exists, so the
copy at its origin is never read as the obstacle and the ghost, the card's tick and the commit cannot
disagree. There are three ways out: `左键` on the ground (or the tick, or `Enter`) drops it, and the cross /
`Esc` / a right press puts it back where it came from. A refused cell keeps it in the air and names the
rule, exactly as a refused placement does. A ghost wears a private id (`MOVE_GHOST_ID`) because a
指示牌's printed plate and a 电视's station plate are cached per module id, and a preview may only
dispose what it minted itself. A **楼梯** and a **扶梯** move too, and a move of one is a **tear-down and a
rebuild** rather than a translation (`moveRebuilds` → `moveEquipment`): a run carries its own `from`/`to`
(and every flight a stair turns through) as world cells, a turning stair's half-landing floor is floor the
document holds for it, and both kinds carve the opening they climb through — so the piece leaves through
`removeModule` and returns through `addEquipment`, which is exactly the 删除 + 放 a player would drive by
hand, and it stays **one** commit. `movedModule` re-lays the run at the same time: the landings and flights
turn about the piece's own anchor in the piece's own quarter-turn convention (`stairFacing` for a 楼梯 /
扶梯, `rotateLocal` for a 楼梯块), so a piece that was never on the block grid keeps the run it has instead
of being rebuilt from the current sizes. What the run carved where it stood stays open, exactly as it does
when a run is deleted — the 方块 tool may fill it, since it is no longer a reserved opening. The remaining
structural pieces — a 电梯 (its shaft is grown a storey at a time, and `LIFT_EXTEND` never asks for floor,
so no single verdict can say where a moved one lands), rooms and 轨道 / 站台门 — are refused, by the same
rule that keeps 删除 from sweeping one: the card's button stays disabled, and the reason is a line of text
under it (`整件结构不能移动：用删除 (B) 拆掉再放`), because a control the
player cannot use is no place to hide why. Switching tools mid-lift puts the
piece back, because a lift is not a mode to be lost in. See `test/move.test.mjs`.

**No ramps stacked.** A ramp also has a collision envelope (`rampEnvelope` / `rampBlocked`): the tile
its run stands in, dropped the truss depth below the lower landing and raised the balustrade height
above the upper one — for a single piece wider than a cell (an old 1.6 m stair) widened to its tread
width. A run
in a column another run already occupies is refused, so a second escalator can never be dropped
immediately below a first, while a run in the next column over is free ground: the two envelopes
touch, which is not an overlap. That envelope is what two **runs** meet on. A run met by flat
equipment is measured by the **body** it draws instead (`rampBodyBoxes`): one box per tile, each
cut to the slope *at that tile* — the truss under the local walking line up to the handrail over it.
So a stair's treads stop half a landing cell short of each landing (`stairTreadTrim`, the same number
the model builds them with), which leaves both landing tiles as plain floor, and any slab the flight
climbs *underneath* keeps its headroom — the block over the low half of a run takes a 围栏, a gate or a
bench. An escalator is the exception that proves it: its truss, step band and balustrades are built
landing centre to landing centre, so every tile of its run, landings included, is its own.

**Floors grow their own walls, and the 墙 tool lays one by hand.** A deliberate 建造 drag is not
just a slab: `build/model.ts` tags its cells `auto-floor` and raises a 4 m `auto-wall` ring on the
patch's outer edge, so a drawn surface reads as a room-sized shell. The rule is the room union,
generalised to tagged cells: overlap or abut two patches and the shared edge inside the union loses
its wall while the new outer edge gains one, an L-shape keeps only its true perimeter, hand-built
floor is treated as continuous ground (no wall grows against it), and only `auto-floor` cells are
tracked so a wall the player placed by hand — or the new 墙 tool's run — is never deleted or
re-tagged. The 墙 tool's remove drag treats an auto wall as a wall, so a doorway can be opened
straight through the generated ring.

**The 墙 tool snaps to the edge that wants a wall, and orientation is never an input.** A wall is a
full one-metre course, so a snap cannot slide a block *within* a cell the way a fence panel does; it
picks the **cell** and the **face** instead (`wallSnap` in `build/model.ts`). An edge counts as open
when the neighbour carries no wall *and* no floor on that storey, so the tool's candidates are
exactly the edges the auto-wall ring would choose. A cell open on one side is walled where it stands
facing that side; a cell open on two or more (a corner, or a one-cell-wide strip) stays put and **R**
steps through the open faces best-first, which is how the course is made to continue the wall you
meant; and a cell buried inside a floor steps to whichever cell in its immediate ring does face open
space, faced back toward the pointer. The scan is deliberately one cell — a snap is a nudge to the
next edge, never a jump across the room — and the pointer aim only breaks a tie, never overrides a
rule. A hand-built wall always wins: the tool never offers a side that already carries one.

Crucially, **`wallSnap` takes no rotation argument at all** — `(cells, cell, pointer?, cycle?)` — so
a turn the player happens to be holding cannot steer the geometry. R reaches only the *output*, as
`dir`/`dirs`, and `walls.test.mjs` pins `wallSnap.length` so a `rot` parameter cannot creep back in.
Taking a placement rotation as the snap's starting point is the trap this avoids: it makes the player
turn the piece before the tool will agree with them, instead of the tool reading the wall and turning
the piece itself. **The same rule governs wall decor.** A 广告牌 bolted flat to a wall has exactly one
correct orientation, so `autofaceWallMount` (`sim/placement.ts`) derives it from the backing wall —
`wallMountMissing` already reduces "which way does it hang?" to `rot` alone, so the turn is an output
there too. A valid turn is kept (deliberately flipping a panel between two walls still works), the
pointer's aim breaks a corner tie, and a run must be backed along its whole length. The only failure
left is "there is no wall here at all".

**The 方块 tool lays a 半墙 — the same wall at half a block thick, one block at a time.** A facility
room's own walls and the panel a wide run keeps beside it have always been drawn half a block thick;
the 工具 folder's **半墙** tile (which arms the 方块 tool) turns a click into one of those, so the
player can put that wall anywhere. The piece is still an ordinary solid wall cell — tagged `WALL` plus
the half of the tile it keeps (`half-wall:w`, `sim/types.ts`), so the column lift, the storey slice,
`isWallBlock`, the ramp carve and the crowd all read it as a wall. `render/chunkMesher.ts` draws those
cells half a block thick, squashing the standard rounded profile into that half and turning it into
place, so the panel wears the wall's own profile and its **per-face finishes**: both of its sides are
ordinary surfaces, painted by the 材质 brush exactly where the pointer hits them.

**The same tile also lays a 三角 — the cell cut on a 45° plane *in elevation*, so the block is a wedge.** It
is the other half of the same idea: a 半墙 keeps half its cell *in thickness*, a 三角 keeps half its cell *in
height*, cut corner to corner up the cell rather than across it. The piece is again an ordinary tagged wall
cell (`tri-upper:w`, `tri-lower:w`), which is what makes everything else agree without a second code path —
the column lift, the storey slice, `isWallBlock`, the ramp carve (a run keeps a cut block rather than
carving it) and the crowd all read it as a wall, while the mesher draws the wedge the tag names. The shape
is a **triangular prism lying in the cell**: the flat 1 m square **in the X-Y plane** is its base, the
full-height square on the side it hugs is the face a run of them shares with the wall behind it, the two
triangular ends are where the cut leaves the cell, and the slope is the piece itself. Three of its faces
lean or cut, so nothing is chamfered — it is a sawn block, and a rounded rim would read as a lozenge rather
than as the cut the player asked for.

The two cuts are the same wedge and its mirror image, and the label on the tile says which way up it is:

* **三角上 (`upper`)** — the **base is the floor**, the tip line at `+z`: the flat square lies on the cell's
  own floor, the block is a full metre tall along the side it hugs, and the slope runs from the top of that
  face down to the opposite floor edge. It is the lower half of the cell, so the piece is a **ramp**.
* **三角下 (`lower`)** — the **base is the ceiling**, the tip line at `-z`: the flat square *is* the cell's
  ceiling, the full-height face is still on the side it hugs, and the slope runs from that face's floor edge
  up to the opposite ceiling edge. It is the upper half of the cell, so the piece is the **soffit** under a
  diagonal — the same cut seen from below.

Both are right isoceles with their right angle on the hugged face, so the eight pieces a cell admits are
**one shape in eight frames** rather than eight shapes: `TRI_FRAME` (`render/chunkMesher.ts`) is the cell
corner, the direction the cut runs into the cell and the direction along the ridge, and `pushWedge` writes
the five faces in that frame. The eight were a table of coordinates once, and the table was the bug — a
quarter-turn written out by hand collided one corner with another and lost the fourth — so the frame is
derived, and what the test pins instead is the *shape*: 0.5 m³ of volume, the base square in the X-Y plane,
the full-height face on the side the tag names, a √2 slope at exactly 45°, two triangular ends, and every
face wound the way its own normal points. **R** steps the side the piece hugs — the face the wall behind it
would have stood on, so a wedge dropped against an open edge arrives already the right way round, exactly as
a 半墙 hugs a patch edge.

The three cut pieces are the 工具 folder's **半墙 / 上三角块 / 下三角块** tiles — one row each in
`CUT_MODES` (`app/store/catalog.ts`), because they are one question: what shape does a click lay.
Each is armed on its own tile — one click for the piece the player wants, rather than a step through a
cycle — and **R** turns whichever is
armed, which is why the same `wallSnapCycle` serves them. **An armed cut folds out a 旋转 row**, and it is
not a tile of its own in that folder: it is the **same `ActionRow`** a 座椅's 旋转 folds out through, under
the cut tile itself (`cutAnchor` — a cut piece is its own tile *and* its own anchor, which is what
`armedActionsAnchor` answers for it). That tile steps the counter **R** turns
(`rotateWallSnap`) — which half a 半墙 keeps and which corner a 三角 takes is the hovered column's
business, so it is one click away instead of keyboard-only. The tiles live on the 方块 tool because a cut piece *is*
the wall that tool grows — so the cut modes are exclusive with the ring: any of them holds **生成墙壁**
off, and with one armed that tile is **not in the folder at all** (`showsAutoWalls`; **Tab**, the tile's
key, is refused while a cut mode owns the tool as well). It used to be drawn greyed out with a tooltip explaining
itself, which is a control the player cannot use taking a place among the ones they can. A cut click also
never becomes a patch or a run: one block, exactly where the click landed, whatever the pointer does
afterwards. A *run* of walls is still the 墙 tool's job.

**生成墙壁 is off when the game opens.** The ring is the one thing the 方块 tool does that the player did
not draw — it stands a 4 m wall around a surface they only laid the floor of — so it is no longer assumed:
a dragged patch grows bare floor, and the ring is asked for on its own tile or with **Tab**, the key that
tile wears. A cut mode refuses both: while a 半墙 or a 三角 owns the tool the tile is not drawn and **Tab**
does nothing (`setAutoWalls` holds that guard), rather than switching a cut off behind the player's back.
A new station therefore builds the way it was drawn, and 生成墙壁 is a deliberate
choice made on the tile that says so — one keypress away.

**A block the release will refuse is shown refused.** The ghost used to drop such a cell silently — a
drag that met a 闸机 simply laid one block fewer than the rectangle it drew, with nothing on screen to
say which cell or why. Now the ghost draws the accepted cells as the cyan shape it always did **and**
boxes each refused candidate in red, with the offending pieces (the 闸机, the 座椅, the hung 指示牌)
highlighted in red beside them, and the release repeats the reason in the notice bar. It is the same
verdict on both sides — `sim/placement.ts`'s `blockReason`, gathered by `build/validation.ts`'s
`checkBlockCells` — which is what makes the count in the notice and the number of red boxes one number.
`test/refused-ghost.test.mjs` pins the display half of that contract: the refused cells reach the
instanced boxes centred on their cells, a changed refused set rebuilds them, an empty set clears
them, and the wall pieces (玻璃板 / 站名 / 线网图) draw no floor contact blob.
The 墙 tool reads it the same way: a full-height column is four candidates, so a wall that meets a
machine shows the two courses inside it red and stands the two above it, and the running 围栏 drag marks
the panels it cannot place.

Which half, or which side, a piece hugs is **R**'s business, and it is the one thing a wall's own
geometry cannot always answer. The candidates are the faces the cell opens onto first, then the rest
(`halfWallSideDirs` / `triangleSideDirs`), so a 半墙 dropped along a patch edge hugs that edge with no key
pressed — the face a full wall would have stood on — and a 三角 stands its full-height face there, while a
partition placed in open floor, which has no edge to read, still offers all four. (A run offers only the
two sides perpendicular to it, because a side *along* the run would leave a slot between column and column:
a run's panels are one wall. Switching the mode resets the face cycle, since the cycle means something
different in each.)

The paint brush knows the difference too. A 半墙's inner face — the one looking across the cell's own
clear half — is a surface *inside* its cell, so a solid neighbour behind it does not cover it:
`facePresent` (`build/model.ts`) is the one rule the viewport's paint rectangle and `M` 整面's flood
both ask, and `render/scene.ts` insets the paint ghost onto the panel itself rather than onto the
cell's boundary. The same applies to the half walls **a ramp derives**: `thinWallCells`
(`sim/openings.ts`) is the single list of every half-block cell — the tagged ones the player laid plus
the ones a ramp kept — and `thinWallSideMap` turns it into what the brush reads, so a stair's own half
wall is painted like any other. A ramp never thins a player's 半墙 a second time either
(`rampThinCells` skips it): the side is theirs, and re-deriving it would move a wall they built.

It is a wall to everything else that asks about walls, including the decor: `wallMountMissing`
requires the backing block to keep the half that faces the panel, so a 广告牌 bolts to a 半墙's near
side and `autofaceWallMount` turns the piece to a side that really backs it — a full wall, which fills
its cell, still backs either. See `test/halfwall.test.mjs`.

**A 三角's slope is a face of the piece too, and the brush paints it there.** It is the one 45°
surface no cell boundary describes: `pushWedge` emits it whether or not the cell it leans to is
solid, so a ramp under a slab — 三角上 with a block in the cell above it, 三角下 with one below —
shows a diagonal the boundary rule calls covered. It wears the cell's own horizontal slot,
`triangleSlopeFace` (`sim/types.ts`): `top`, the slot a floor wears, for 上, and `bottom`, the
ceiling's, for 下. That is the same face the pointer reads off the 45° normal — `faceAxis` ties on
two axes and goes vertical — so the mesher that draws it, the brush that aims at it and the palette
that names it all mean one surface. `facePresent` (`build/model/Paint.ts`) offers it as paintable
for exactly that reason, the one rule the viewport's paint rectangle and `M` 整面's flood both ask,
and the paint ghost (`GhostSystem`) rides the sawn plane (`wedgeSlope`, `chunkMesher`) rather than
the cell's ceiling a metre above the crest. Before that the diagonal was drawn but untexturable:
the stroke fell through to whatever ceiling stood beside it. See `test/triangle.test.mjs`.

A hole dug through the middle stays open rather than getting
boarded up. The platform/tunnel footprint is covered ground too: a placed rail digs its bed, so the
merge folds that footprint into the surface — the ring wraps the whole patch-plus-track area, the
drag never pours a block into the trench, and no auto wall rises through a platform screen door a
full track sliced through the patch. Single clicks
and stacked blocks stay plain, and the drag's live ghost shows the wall ring before release. The
方块 tool carries a **生成墙壁** toggle in the 工具 folder, and it is **off by default**: the same
drag lays the patch as untagged bare blocks unless the ring is asked for. **Tab** is that tile's key —
the one control that raises the ring, and a no-op while a cut piece owns the tool — and with one of them
armed that tile is not drawn
(`showsAutoWalls`), since the two are exclusive. See `test/walls.test.mjs`.

**Fences divide areas with gates.** The 设备 folder's 围栏 (§5.2) is a 1 m high, very thin
stainless railing standing through the middle of its block. Its three variants are 玻璃围栏
(round handrail, slim posts and clamped glass), 门 (a raised glass leaf with hinges and latch,
no centre upright or floor sill), and 铁围栏 (closely spaced vertical bars and transverse feet).
门 allows 盲道 and 地面指示 underneath, in either placement order; deleting the gate preserves
the ground decoration. It remains a closed barrier for the crowd. Older fences use 玻璃围栏.
A single click drops
one panel turned with **R**; press-and-drag lays a straight run like the 墙 tool with the panels
following the drag direction, and right-drag lifts the run back out. The 删除 tool drags the same
straight line: press a panel, drag along the run, and release to lift every panel on it at once (a
tap still removes just the one under the pointer). The run previews as real
translucent fence models while you drag. Every panel is built from its neighbours
(`sim/fences.ts`), so a straight run is continuous, a dead end caps itself with an end post, and
an L, T or + junction turns through the shared centre post with no overhang — dragging a new
segment up to an existing end regenerates that end on the spot, dropping its old cap and post.
A run plugs straight into a 闸机 row, and it also joins a stair or escalator: `railLandingAt` makes a
fence next to a run's landing drop its end cap and butt up to the handrail instead of stopping short
(a wide escalator's second landing column counts too, via `escalatorLandings`).
That connection needs no collision exemption: a run reserves just its own tile, so the cell beside it
is free ground and the fence's own thin box never meets the run's. The **landing tile itself** is free
ground on a stair too — its treads stop half a landing cell short of each landing (`stairTreadTrim`) —
and so is any slab the flight passes under: the run's body is cut to the slope tile by tile
(`rampBodyBoxes`), so a fence also stands on the block at the head of a well, or over the low half of
the flight, and guards both. The sim treats a fence cell as not
walkable, so the run
plus its gates is a barrier the crowd only crosses at a gate — and a fence *on* a landing is read the
same way: that flight is dropped from the walk graph, so fencing the head of a stair really closes it
off. Paint different zones each side and the
fare line holds. See `test/fence.test.mjs`.

**The 选择 tool can pick a passenger, and the station draws where they are going.** A click that
lands on a body selects **the person**, not the floor under them (`SelectTool`), because the crowd is
drawn over the station and the body the player aimed at is what they mean. The 信息 card names them
(`行人 #id`) and the 3D view paints their remaining walk as a **light-blue line on the floor**, with a
ring on the passenger it belongs to and a ring where the walk ends.

The pick is **screen-space, not a ray**. An agent is three small instanced meshes thousands strong; a
ray would either miss a 0.3 m person or need a fattened proxy for every one of them. So every body on
a storey the slice draws is projected and the one nearest the pointer within 14 px wins
(`CrowdSystem.pickAgent`) — the nearer body breaking a tie, so a passenger standing in front of another
is the one picked. The distance to the solid face the same pointer ray found is handed in as a
`blocker`, so a passenger a wall stands in front of is not selectable: they are not on screen.

**The route is asked for, never assumed.** The selection names an agent and the worker answers with
that agent's remaining walk (`World.routeOf`), sent with the ordinary state frame — waypoints as xyz
triples, plus the id they belong to and a token. The token is what makes "the worker has not seen my
selection yet" distinguishable from "that passenger has already left": a frame it had already built
when the click happened names nobody, and only an answer to the newest request can clear the
selection. The route is an **observation**: `routeOf` writes no agent field, joins no queue and draws
no randomness, so a watched passenger walks exactly as an unwatched one does (pinned in Node against a
control world).

**The line is a ribbon lying on the walk surface, not a `THREE.Line`.** A one-pixel line has no width
at station scale, and a preview that reads as paint on the floor has to have the floor's own plane
(`render/routeLine.ts`). Each segment is a quad whose width runs along `side = normalize(d × up)` and
which is lifted a hair along `side × d` — flat on the floor for a horizontal segment, and in the run's
own plane for a 楼梯 or 扶梯, where a quad at the segment's average height would sink into the treads at
both ends. Every bend is filled by a square of the ribbon's width laid in the frame of the average
direction, which covers both corners the neighbouring quads leave (the square's inscribed disc is the
one they sit inside). Positions are written into the scene's own buffer and the used part is chosen
with the draw range, so a preview following a walking passenger every frame allocates nothing.

**The walk ends where the train begins.** A route chains the legs the passenger will still **walk** —
the rest of the one they are on, then each later leg from the node the previous one ends at — and
stops at the first train leg. Everything past a ride is another station's floor, and a line drawn
straight across the map would be a lie about a journey the floor cannot carry. For the same reason the
line goes with the passenger: a storey the slice does not draw does not draw their route, and a
passenger who reaches the door, boards and leaves the station takes the line with them. Leaving the
选择 tool puts it away and coming back re-arms the same passenger, because the selection is still
theirs.

**Wayfinding: a lift is not for commuters, and the crowd is part of the cost.** Two things made a whole
crowd choose the same way through a station, and both were on the *graph* rather than in the people.

A lift edge is one 40 s hop between any two floors, so the moment the escalator queue passed a couple of
minutes A* handed the lift the entire wave: on the shipped 动物园 demo, **2,238 of the passengers who
travelled between floors ever boarded a lift** — walkers, in queues 33 and 72 deep — while the
escalators built for them stood beside it. `waitQ` is the other half of it: it prices a queue that has
*formed*, so the bodies still walking towards a gate were invisible to A*. A wave committed to one
turnstile and then stood in front of it, and a passenger already in that queue had no idea the next lane
along was empty.

**A lift costs what the passenger cannot avoid.** `liftPenalty` ([`src/sim/station.ts`](src/sim/station.ts))
is §7.2's `levelPenalty`: seconds added to every lift edge for a passenger who could have walked. A
step-free passenger is charged **nothing** — the lift is the only way down they have (§7.4a) — a
passenger with luggage `LIFT_AVOID_LUGGAGE_S`, and everyone else `LIFT_AVOID_S` (five minutes). It is a
preference and not a ban, and that is the point: past that margin the lift still wins, so a station whose
ramps really are jammed keeps its relief valve, and a shaft with nothing else beside it keeps its queue —
the demo's deeper shaft still carries 798 walkers at the default.

**The crowd is priced onto the graph.** `World.priceCongestion` scatters every standing passenger into
its own collision cell **and the ring around it**, so a node knows who is standing *beside* it — the
crowd pressed at a gate bank is on the tiles in front of the gate, not inside it, which the speed
derate's own density field cannot see because it is filled only where bodies stand. Each node is then
charged `min(bodies, CONGESTION_CAP) × CONGESTION_S` seconds on the path finder, and *every* search that
tick reads the same field: a budgeted re-path, the fare-line choice and the 选择 tool's preview all price
the same crowd, so the line a player watches is the line the passenger walks. The cap is what keeps a
crush from becoming a wall — past it, one more body is not another second of detour.

**The fare line is decided while it is still ahead.** `chooseGate` used to fire when a gate was the
agent's *next* node, and by then the passenger is standing in the crush it should have walked around. It
now re-plans the rest of the leg the moment a gate comes within `GATE_LOOKAHEAD` (8 m), skipping the path
cache so it sees the queues as they are; `GATE_REPLAN_PER_TICK` rations those synchronous searches,
because this one is not amortised like a leg's, and an agent the ration skips still chooses at the
gate's own cell. A queue that is past patience gets §7.2's other trigger: `reRouteAroundQueue` re-plans
against the live crowd and **moves only when the new route queues somewhere else**, so a passenger that
finds nothing better keeps its place instead of walking to the back of the lane it is already in (and a
step-free passenger waiting for a lift is never sent round in a circle).

**What the two together do to the demo** (2400 s of the shipped 动物园 save at its peak, seed 99): the
elevator queues fall from 33 / 72 deep to 27 / 48, the passengers who ever board a lift fall from 2,238
to 1,885 (walkers 2,073 → 1,412), and the station **clears more people for it** — 3,425 leave against
3,383, with 674 still inside against 734. The congestion term is deliberately not a free win on its own:
with `LIFT_AVOID_S` set to 0 it *worsens* the elevator queue (113 / 57), because an uncrowded lift is
exactly what a congestion-aware walker diverts to. The two numbers are one feature, and both are meant
to be tuned: `CONGESTION_S = 1.2` is the setting at which the demo clears the most people, while 2.4
jams the gates and the lifts together (113 deep).

The bottom bar follows: **电梯排队** is its own counter, and 扶梯排队 no longer counts elevators with
the ramps (`sim/world/types.ts`).

**A barrier belongs to a storey, and that was the bigger bug.** An exit head-house's glass and a ramp's
balustrade were thin planes in **plan**: `crossesExitWall` and `crossesRampWall` tested `(x, y)` and
nothing else, so a 3.2 m head-house on the street walled off every floor beneath it and an escalator's
side glass walled off the floors its run never reaches. On the shipped 动物园 save that fragmented the
floor into **73 walk-only islands** and left exactly **one** platform→exit route in the station: all 36
platform doors and both exits shared the same three rides, and 12 of 30 ramps carried nobody. That is
the whole of "everything takes the blue route and nothing takes the red one".

Both planes now carry the block levels their own body occupies (`EXIT_H` for a head-house, each
flight's own `from.z`/`to.z` for a balustrade), and a walk edge outside them is free. The demo's floor
comes back as 59 islands, **8 ramps** are on some platform→exit route instead of 3 — the escalator pair
at (64,15)/(70,16) among them, splitting the crowd 36/36 with the western stair chain — 5 ramps carry
nobody in 2400 s instead of 12, and the station clears 3,476 people against 3,383. `wayfinding.test.mjs`
pins the rule both ways up: the storey a run climbs is walled by its glass, the one under it is not.

*The station's own paint, and why the fare line is off for now.* 7,199 of the 动物园 save's 12,035 floor
cells carry **no zone label**, and an unlabelled cell reads **无分区**, which the fare line counts with
the unpaid side. That is fine
where the gate row is the line — and an invisible fare line everywhere a *painted* patch sits inside
unpainted floor. Enforced, those lines are barriers (§4.5) and they sealed the −16 level's escalator
landings into 6-cell pockets: that platform's only way out was one narrow stair at (28,3), 270,450 queued
agent-seconds in 2400 s, and 5 of the station's 30 ramps carried nobody.

So **`ZONE_LINES_BLOCK` is `false` for now** (`sim/constants.ts`): a zone line no longer blocks, a gate is
still a queue the crowd walks through — and walks around when it is long — and the fare line stops being
invisible enforcement. It is one line to put back, or per station: `buildGraph(data, true)` /
`new World(data, seed, { zoneBarriers: true })`, which is how `zones.test.mjs` and `gates.test.mjs` keep
the rule covered (they assert both modes: an ungated line strands the crowd when enforced, and is walkable
floor when not). Measured on the same save with the labels left exactly as they are:

| demo, 2400 s, seed 99 | line enforced | line off (shipped now) |
|---|---|---|
| ramps carrying nobody | 5 of 30 | **0 of 30** |
| the −16 escalators at (52,17)/(53,17) | 0 | **925 / 7,302** queued agent-seconds |
| stair@(28,3), the choke | 270,450 | **25,508** |
| peak elevator queue | 63 | **11** |
| people cleared | 3,540 | **3,777** |
| gate throughput | 3,814 | **4,079** |

The gates still carry a crowd — they are simply no longer a checkpoint, so a passenger may go round them.
What is *not* fixed by any of this is the paint itself: a repair cannot be mechanical (filling unpainted
floor from its painted neighbours leaks around the ends of the gate row and erases the fare line at all 15
gates — measured, and why no such repair is in this diff), so the paint has to be finished by hand with
the 分区 brush, after which the flag can go back on. Nor does the game yet say *why* a new escalator carries
nobody, which is the one diagnostic this work did not add.

*What this does not fix.* §7.1's two-way lane is committed to one direction until that side drains, and
in a busy station the committed side never drains: a single two-way gate with a 540-passenger train
alighting onto it boards **nobody** in ten simulated minutes, however long it runs, while the exiting
queue grows past a thousand. That is the authored rule and it needs its own decision (a bounded hold, or
a lane that alternates) — `wayfinding.test.mjs` and `zones.test.mjs` now assert the gate's *throughput*
rather than one direction's, and the fixture says why.

`test/` holds the acceptance tests. Run them with `npm test`:

Two of the drawn faces can be rendered to a PNG outside the browser, for looking at rather than
asserting: `node ../tools/render-tv-plate.mjs out.png` prints a 电视 station plate, and
`node ../tools/render-sign-panel.mjs out.png` prints 指示牌 panels — a fresh board at the floor, one
grown taller, one grown wider, and the whole catalogue on one board. Both drive the shipping draw
functions through a recording 2D context, so the picture is the real output (only text width is
approximated); neither needs WebGL.

* `determinism.test.mjs` — same seed + tick ⇒ byte-identical positions, and no unseeded
  randomness anywhere in `sim/`.
* `rng.test.mjs` — the generator that determinism rests on (`sim/rng.ts`, §7.6): the exact
  sequence a seed produces (golden values — mulberry32 is a published algorithm, so a change
  to these is a change to every recorded crowd and every replay), the range each helper
  promises (`int` / `range` / `chance` / `pick`), the Poisson draw the crowd's arrivals are
  made of (zero at a zero rate, and capped so an absurd λ cannot spin), and the state a
  stream can be saved and resumed from. `pick`, `state` and `hashString` have no caller left
  in `src/`, so they are pinned here as the module's API surface rather than as live code.
* `clock.test.mjs` — the simulated clock (`sim/clock.ts`, §7.9 / §9.6C): a sim second
  becomes a civil date, a weekday, a day type, a period and one readout string, and the
  信息栏's clock card, the status bar's 时间, the in-world 电视 plates **and every placed 时钟's
  hands** all read that one clock. The arithmetic is pinned against real calendar facts rather than against
  itself — 1970-01-01 was a Thursday, 2024-02-29 exists, 1900-02-29 does not, and the two
  converters round-trip a leap day either side of the epoch — because a date one day out, a
  weekday one off and a midnight that never comes all *look* like a working clock. The
  高峰 / 平峰 / 夜间 chip is checked to be `periodOf` — the function the dispatcher picks its
  headway with — at every window boundary, so the readout can never name a period the sim is
  not running. It also pins the **authored day** (§9.6C): the operating window is half-open
  `[from, to)`, a shut station is 夜间 *before* the peaks are consulted (a station that opens at
  09:00 has no 08:00 peak to serve), a peak window moved into the morning moves the 高峰 with it
  while one drawn outside the hours serves nobody, the 06:30 / 22:30 shoulders are the day's
  rule rather than the window's — opening all day does not make 23:00 busy — and a window or a
  peak pair the day cannot hold is bent into range instead of refused, in whole minutes so it
  always matches what the grips print. The **peak pair is also held in order** — 早高峰 ends no
  later than 晚高峰 begins, an overlap is pushed out rather than sorted, and the pair still fits in
  one day when the morning runs to midnight. And the **calendar**: the shipped 2026 arrangement, date
  by date (元旦 runs into the Saturday, the Sunday after it is worked, 春节 is nine days, the
  Saturday after 国庆 is worked, a plain weekend in March is a plain weekend), every key a real
  date and no date on both lists, `weekdayOf` / `daysInMonth` against the century rule
  (2000-02-29 exists, 1900-02-29 does not), a **month grid** pinned as whole Monday-first weeks
  with its leading `null`s and each cell's own day type (a 调休 Sunday reads 工作日), and a
  calendar the day cannot hold repaired rather than refused — 02-30 is 02-28, a key that is not
  `YYYY-MM-DD` is dropped, a date on both lists is a holiday, and a list the document does not
  carry at all is the shipped one. `clockHandAngles` — the two hands of an analogue dial, in
  degrees clockwise from 12 — is pinned beside the strings it agrees with: 3:00 puts the hour hand
  on 3 and the minute hand on 12, 6:30 puts the hour hand **half way between 6 and 7** (the hour
  hand carries the minutes) and the minute hand on 6, the seconds are kept **fractional** rather
  than floored (the scene sweeps the hands between snapshots, so a floor would make them step), a
  time before the epoch reads as the hour it really is, and the last second of the day is a hair
  short of 12 on both hands.
* `demand.test.mjs` — the crowd's day (`src/sim/demand.ts`, §7.4 / §9.6C 客流曲线): the
  **golden** case is that `demandShape` at `DEFAULT_DEMAND` equals the formula it replaced, at
  every five simulated minutes and to the last bit — the knobs were added under a running
  simulation, so a tolerance would hide exactly the drift this exists to catch. On top of that:
  a knob moves the curve it names and only that one; 波形陡峭度 narrows the day (so the apex
  barely moves and the *fall-off* is what changes); the period and day-type factors are the two
  scales on the shape (peak 1.0 / off-peak 0.6 / late 0.25, and 工作日 1.0 / 周六 0.45 / 周日 0.35 /
  **节假日 1.15** — a holiday is the crush, not the lull); a series is 97 points that close back
  onto their first; a peak window inside the operating hours is worth exactly
  peak-over-off-peak, and one drawn outside them is worth nothing because shut is answered first;
  and every knob a document holds is clamped, rounded to two decimals and defaulted field by
  field, so no `NaN` ever reaches the spawn. Its second half runs the **real world** on the
  shipped station: the authored day reaches the crowd (a silenced 早高峰 is a thinner crowd, a
  doubled one is busier, a station shut at 06:30 runs a thin service), and the *calendar* does
  too — 周六 at 0.45 of a weekday, 周日 at 0.35, the 元旦 holiday above a plain Monday, the 调休
  上班 Sunday running a Monday's crowd, and the same weekday a week later running the same crowd
  to the person (§7.6).
* `demo.test.mjs` — the shipped demo (动物园, Line 5) is one connected circulation: every exit
  reaches every platform and screen door and back, and a run actually boards and clears a crowd.
  Its controlled rig lives in `test/support/scenario-station.ts` for the other sim tests.
  It also guards the two contracts around the file itself: `referenceStation()` hands out a
  **fresh** `structuredClone` on the document's own seed (a station the app mutates must never
  leak an edit back into the next 打开), the shipped save carries no cell off the 1 m grid, and
  `emptyStation()` is the 2 × 2 at-grade seed with nothing built on it.
* `capacity.test.mjs` — the §7.8 capacity ladder as a comparison: one platform escalator
  jams, three fix it; a saturated platform leaves people behind.
* `layering.test.mjs` — `sim/` imports nothing and touches no DOM; `render/` never reaches
  up into `app/`; `build/` imports neither.
* `scene-wiring.test.mjs` — the scene systems' sibling wiring (`render/scene/SceneRenderer.ts`).
  Every system declares the siblings it walks with a definite-assignment claim (`chunks!: ChunkSystem`),
  which TypeScript believes and the orchestrator has to make true; a wiring line dropped in a refactor
  compiles cleanly and throws on the first frame instead — `Cannot read properties of undefined
  (reading 'outlineSet')` at `LevelSystem.applyLevel`, which is what happened when a new system was
  added and `this.level.chunks = this.chunks` went with it. The test reads the claims out of every
  `systems/*System.ts` and asserts the orchestrator assigns each one, and a second case asserts the
  reader actually sees the claims it guards (a check that parsed nothing would pass forever).
* `surfaces.test.mjs` — a slow floor finish is a real detour, a track bed is not a walkable
  node, paint/fill/erase are immutable, and the mesher groups by finish (B1); 搪瓷板 takes a
  custom tint encoded in its finish id without changing the wall family, and the mesher keeps
  two tints in separate parts; a stair wears the floor it climbs from until it is painted, then
  its own `cfg.finish` (with the pieces around it untouched, and `null` handing the surface back).
* `save.test.mjs` — the `metro-save` v1 envelope round-trips the static station and names
  every failure mode (B1); a legacy line with no direction termini loads with empty ones; a
  block off the 1 m grid — or a `NaN`, which JSON writes as `null` — is **dropped** at both
  boundaries rather than refused, while a broken envelope is still refused whole. The
  **authored day** — operating hours, peak windows, demand knobs and the calendar — rides beside
  the name and the seed: a v1 file written before any of it loads on the defaults (absent and
  defaulted are one code path, and the cell schema `formatVersion` freezes has not moved), and a
  hand-edited file with an inverted window, a one-ended peak pair, a knob past its slider or a
  calendar whose epoch is 02-31 still opens, repaired field by field.
* `ground.test.mjs` — the city's own floor (§4.1), which the document stores **inverted**: at
  `z = 0` a `{ fill: 'void' }` record is a hole the player dug and *absence is ground*, so an empty
  document already stands on built ground and no save ever carries the horizon. It pins both halves.
  The module's own rules: `groundWindow` is the content's plan rectangle plus `GROUND_MARGIN` (16 m,
  a run's `from`/`to` included, and ± margin at the origin for a station with nothing in it yet);
  `withGround` materialises one bounded window for the two consumers that walk every cell (the walk
  graph and the chunk mesher), never shadows an existing record — a `void` is skipped, so a hole is
  not paved back over — and stamps the generated cells `zone: 'outside'` (站外) with no finish, which
  is load-bearing: `outside`↔`unpaid` is not a fare crossing, so the plane never invents an ungated
  fare line (a `paid` island in the street has no walk edge out of it; an `unpaid` one is the street
  again); `groundHoleAt` / `virtualSolidAt` / `solidAt` are the three answers a coordinate can have,
  and an opening the *game* cut — a ramp's carved corridor, an exit's floor — is a hole with no
  record of its own, so the demo's surface openings stay out of its JSON. And the edits: `removeCells`
  records the hole at grade and nowhere else, `addCells` / `addFloor` **fill it back** by replacing
  that record instead of shadowing it (they count *blocks*, not records — counting records skipped
  the very cell `checkBlockCells` had offered the drag, so the ghost promised a block the release
  dropped), the 材质 brush materialises the pavement it paints and refuses a hole (a hole is not a
  surface) and a cell the one placement rule set refuses, a zone rectangle materialises the ground it
  covers while the bucket leaves the plane alone, and `moduleFloorOk` / `ceilingMountMissing` read it
  — a machine stands on the street, and a fitting in a basement hangs from the slab above it.
  `blocktool.test.mjs` drives the other end: a right-press on the pavement digs it and leaves the one
  `void` record the plane keeps, and the document's own blocks are still the only ones the seed guard
  counts.
* `grid.test.mjs` — nothing in the game can put a cell off the 1 m grid. Every palette piece is
  placed at every rotation, width, direction and 闸机 door mode, every staircase shape at
  fractional legacy widths (1.2, 1.6 m), and 方块 / 墙 / 房间 / 电梯 / 站台 / 隧道 / 材质 / 分区 /
  移动 are driven through their real builders, each asserting that every cell and every module
  anchor — `from`, `to` and a switchback's flights included — stays whole. This is the guard on
  the code that *makes* stations: a save cannot be written with an off-grid block either
  (`save.test.mjs`), so a tool that learned to mint a fraction is the only way one could ever
  reach a player.
* `pick-cell.test.mjs` — the pick above every command in `grid.test.mjs` names whole cells,
  whatever angle the surface it hit is drawn at. `CameraSystem.pick` reads the drawn mesh and
  `THREE.Intersection.face.normal` is the *triangle's* geometric normal, so the two faces this game
  deliberately draws off-axis — the wedge a 楼梯 / 扶梯 leaves the block under it (its top is the
  run's sloping underside) and every rounded block edge — used to hand a tool a fraction: a 方块
  block laid beside the block under an escalator landed at (4.44, −0.15, 1.89). The test rays the
  **real chunk geometry** rather than typed-in normals — a case that only passes on made-up numbers is
  what let this through — and pins that the axis snap is the one the 材质 brush paints by
  (`faceAxis` ← `dominantFace`), so the face a stroke lands on and the cell a block lands in agree.
* `load.test.mjs` — loading a station is a full sim reset: `World.load` clears the crowd,
  trains, server queues, clock and throughput counters and reseeds the RNG, while the edit path
  `rebuild` keeps the crowd in place; `World.restart` empties the crowd and trains but keeps the
  station document and the clock.
* `zones.test.mjs` — an ungated fare line strands the crowd (zero boardings); a gate restores
  flow; the graph has no edge across the line; the zone bucket respects a drawn boundary (B2). Then
  §4.5's later rules: the map draws **one storey** (`zoneMapFloorsAt`, with the labels on their
  own level); a zone is painted on **floor** — a rectangle, a bucket flood and the 信息 card's own
  point query all drop the cell under a wall column, the earth roof over a tunnel and a track coping,
  and accept a walkable wall top and a track bed at the foot of its column — with the agreement itself
  pinned: the map tints exactly the floor the brush accepts; and an unlabelled cell reads **无分区**
  (`none`, on every storey — in `zoneAt`, the map's labels, the graph's `nodeZone` and `zoneIndexOf`),
  with the model refusing to *write* that reading while 非付费区 is a real label, `none`↔`unpaid` and
  `none`↔`outside` still one fare side so an unpainted station invents no fare line, and a coordinate
  with no record at all reading 站外 at the ground plane (the street) and 无分区 anywhere else; and
  `eraseZoneCells` — the 无分区 brush — takes a label off and leaves the cell reading 无分区, the
  materialised street going with its label and a cell with a finish of its own keeping its record, and
  does nothing where there is no label.
* `zonetool.test.mjs` — the same floor rule through the **click** (`app/tools/ZoneTool.ts`,
  `ToolContext.floors`): a tapped floor tile paints; a tapped coping paints nothing, opens no drag and
  says `分区只能画在地板上`; a hover on one draws no tint at all; and a drag across a patch tints the
  floor it crosses while the tile under the wall course and the course itself stay untouched. Then the
  无分区 brush, which is the same zone id armed instead of a colour: it drags like the brush it erases,
  takes a label off a zoned tile (which reads 无分区 again, with no record left behind), and says
  `这些格子上没有分区` — committing nothing — when the patch carries no label at all.
* `wayfinding.test.mjs` — how a crowd chooses (§7.2's path cost, §7.3's crowd, §7.4a's needs): the cost
  of a lift edge is a fact about the *passenger* (`liftPenalty` — nothing for a step-free passenger, the
  luggage figure for a suitcase, the full figure for a free walker) and the crowd charge is capped so a
  crush is not a wall; on one fixture, a walker takes the ramp where a step-free passenger must take the
  lift and a passenger with luggage does what neither does — and a jammed ramp still hands the walker the
  lift, because the penalty is a preference and not a ban. Then the crowd itself: a priced node steers
  the search to the other turnstile (in both directions, so it is the price and not a tie-break), the
  world writes that price from the bodies standing next to a node before anything plans, a passenger
  whose gate queue is past patience takes the next lane, and a busy gate line is re-chosen while the gate
  is still metres away rather than on its doorstep. It also pins the two barrier rules the same complaints
  ran into: a ramp's balustrade walls the storeys its run climbs and not the one below it, and a
  head-house walls its own storey and not the concourse underneath it — a plane with no height on it left
  the demo with one usable route and 12 of its 30 ramps idle.
* `gates.test.mjs` — the gate **policy** predicates (`sim/gates.ts`): which direction a lane lets
  through, the two-way single-lane rule (`nextGateIndex`), and the spellings an older save may carry
  for the 闸机 piece (`right` / `left` → lane, `none` → fence). `gate-door.test.mjs` pins the piece
  and its Tab cycle; this one pins the rules underneath.
* `psd-end.test.mjs` — 屏蔽端门: one-unit fixed screen glass, 半高/全高 Tab switching, snapping to shared screen-door corners in every rotation, shortened corner glass followed by continuous one-metre extensions, tile-contained cap/frame and reservations with neighbouring block/equipment placement, accepted hover/click placement, undo, walk barrier and save/load; a snapped return re-snaps through the move path; the 玻璃幕墙 tile cycles its three widths and preserves them through picking.
* `gate-door.test.mjs` — the 闸机's two states (§5.2): `Tab` toggles a working **lane** and the
  **fence** machine, and a save written while the door *side* was a setting (`right` / `left`) reads
  as a lane while the old `none` reads as fence. The machine's solid side is the half its body stands
  on and turns with `R` — a half turn *is* the mirror, which is why there is no 左 / 右 setting — so a
  fence run butts it while a fence on the lane side ends at the doorway with its own end post; a fence
  machine is a barrier — not a node, no gate server, no fare-line crossing — keeping the same
  half-block body with fence on the other half of the cell (capped where nothing carries the run on).
  The model itself is pinned too: the head is a trapezoid whose top is shorter than its base (the
  reference's 115° shoulder) and the whole machine is the reference's 1250 mm, not a 1 m cube. The
  **live ghost** is pinned as well, because a Tab cycle only redraws a preview already under the
  pointer if it reaches both halves of that path: the store key the viewport subscribes to
  (`placementPreviewKey`) and the renderer's ghost identity (`render/moduleGhostKey.ts`, which skips a
  rebuild it thinks is unchanged).
* `trains.test.mjs` — a dispatched train gets a pose on the track beside its platform edge,
  a stop is a fixed berth/open/dwell/close/hold/depart sequence, the pose is deterministic,
  the door-side mask follows the berth's screen doors (the platform side only, both banks on an
  island, neither on a rail with no platform beside it), and every screen door stands on a car door
  with no car door left without one (the rolling-stock render path).
* `stock.test.mjs` — the rolling-stock classes (§6.1): every classified car has a table row,
  the L linear-motor car is the short 2.8 m three-door third-rail stock, its door cadence is
  symmetric, spread to the car ends on one uniform pitch rather than bunched mid-car, and the
  worker's pose index decodes back to the same class.
* `placement.test.mjs` — `sim/placement.ts` gives every module a world footprint: two may not
  share space (a gate line in adjacent cells is fine, a module on the storey above is not a
  conflict), a ramp corridor blocks flat equipment inside it, `moduleAt` finds a module from any
  cell it covers, `removeModule` bulldozes exactly one module and leaves its block, and the block
  brush refuses a cell reserved by a ramp opening or an exit's floor (`reservedOpening`) **or held by
  a piece of equipment** (`moduleBlockedCells`: a 闸机, a 售票机, a 座椅, a 房间's whole plan or a
  hung 指示牌's column — while a run's landings and the ground under its slope stay floor, since the
  carve is what owns the corridor between them). A ceiling-hung piece shares its cell with whatever
  stands on the floor or hangs on the wall, since it wants the air and not the cell, and is refused
  only against another hung piece or a run. The
  装饰 广告牌 is wall-mounted: `wallMountMissing` refuses it without a solid wall block
  at the facing neighbour's first course, and `wallSide` turns that requirement with the module's
  rotation. `autofaceWallMount` turns the panel to face that wall, so the rotation is derived rather
  than pressed. A fresh exit is named for the first free letter A ~ Z (`nextExitName`, so A口 / B口 / …),
  reusing a letter freed by a delete or rename, and falling back to 未命名口 once all 26 are taken.
  A wall-mounted ad may also stand in the face-adjacent cell when the pointer is on a wall itself
  (`wallMountStandCell`), so it can bolt to the station wall across the track.
  Escalator equipment collisions follow the sloped, per-tile body even against another run: the
  floor above the lower section stays free, and vertically adjacent runs may meet at the landing
  plane without reserving the whole shaft. Placement and bay tests pin that clearance and real
  body overlap.
* `validation.test.mjs` — **the preview and the release are one verdict** (`build/validation.ts`
  over `sim/placement.ts`'s `blockReason` / `equipmentReason`), which is the property the player
  sees: a cell the ghost promises is a cell the edit commits, and a cell it refuses is one the
  release drops *and reports*. `blockReason` names the rule that fired (`opening` / `equipment` /
  `track`) and, for equipment, the piece itself, so the preview can box the 闸机 it collided with.
  `checkBlockCells` splits a whole gesture into the accepted cells the cyan ghost draws and the
  refused cells + offending pieces the red boxes mark, over a rectangle that meets a 闸机, a hung
  时钟 and a rail bed; `addCells` lays exactly the accepted set and counts exactly the refused one,
  `addFloor` carries on around a piece, and a wall column is refused at the courses the piece really
  occupies while standing clear above it (a 闸机 is 1.3 m). `equipmentReason` is one rule set with one
  sentence per rule — the ground (asked of every piece that stands on it, never of a ceiling-hung one),
  the storey an 出入口 belongs to (while placing, not while moving),
  the rails, the space another piece holds, a 广告牌's wall, a hung piece's slab, a 扶梯's two landings
  and a 电梯's bay — and `moveDropReason` reads the same one, so the 移动 card and the hover cannot
  drift. `checkModulePlacements` gathers a placement's candidates (a wide 楼梯 is several lanes) with
  the colliders each refusal names, and `firstRefusal` / `dominantRefusal` /
  `blockRefusalNotice` turn the whole preview into the notice line — the majority
  refusal, not the first cell walked into. A run's footprint is its two landings
  (the void middle is carved, not refused), and a lift short of floor names its bay
  (`lift-footprint`, never the generic floor — the dedicated branch used to sit
  behind the generic check where no lift could reach it). The course arithmetic
  underneath (`sim/courses.ts` `wallCourses`) claims a course the panel crosses and
  never one its edge merely touches.
* `openings.test.mjs` — a placed ramp carves the slab it climbs through but keeps its landings as
  graph nodes, only the run's centreline cells are carved (a block the handrail merely grazes is
  kept), a wall beside a run survives untouched (the run sweeps less than half a cell, so nothing
  beside it is reached), **a 双跑楼梯 pushed flush against a wall leaves it whole** — every size and
  both hands, with the wall columns standing just outside the blocks the pair fills, kept through the
  carve and never thinned, because a block-grid run's rails end exactly on the cell edges its runs
  fill — a single piece wider than a cell keeps its side floor cells and has them
  marked as half blocks while a wall it reaches is thinned the same way (an old 1.6 m stair, or a 中 /
  宽 90° turn, which is one piece 0.18 / 0.52 m wider than its own cell; the narrow turn and a
  straight wide stair, which is lanes now, reach nothing), and every cell the carve
  opens reads as reserved so a hand-built block cannot cover it back up.
* `slope-cut.test.mjs` — the ground under a run (§5.1 / §4.2): the 方块 tool lays a block under a
  楼梯 / 扶梯 and the carve leaves it (a block already there when the run arrives survives it), the cut
  is the run's own underside — an escalator's `RAMP_FOOT` or a stair's own `STAIR_BODY_DROP` below the
  line its treads climb at every point across the block,
  never above it — one block per tile of the run's own column and nothing beside or past it, a stair
  cuts only the tiles its treads sweep (its landings stop the treads short), stairs' landing columns
  and escalators' lower landings stay level while their upper terminal blocks are recessed below the
  landing deck, a **slid band** (`stairFlightSlides`) is cut across **both** blocks its line divides rather than
  the one tile it is named for (the second block was left standing in the flight's soffit), a run's
  **collision** body hangs to the same depth its drawn body does (a stair reserved at a truss's depth kept
  a 座椅 out of a band the model leaves clear), a cut block is drawn as a slope with no flat cap, **a turn
  flight is cut on its own steeper
  slope** (a 3-cell flight is 45° where the landing-to-landing line is 33.7°, which is what left a wedge
  of daylight under its upper steps), nothing a run cuts reaches back into its
  body on either an escalator or a straight stair — each against its own body line, so a stair's
  ground really does meet the steps — the **cap** is drawn in the piece's own finish when the 材质 brush
  has painted it and the block carries no top face of its own (a face the player painted wins), **a stair
  derives no filling** — its flight hangs over its own well rather than on a mass the renderer made up,
  and the ground it has is shaved to the line its treads climb — and a block out of the run's reach
  meshes exactly
  as it always did. It also pins the derived filling (`rampFillKeys`): a packed key really does step one
  block down by subtracting one, and a filling sits only where the plane cuts over ground and never in the
  document.
* `ramp-fill.test.mjs` — the filling's **derivation** through the **real renderer** (`ChunkSystem`): no
  run in the game derives one — a **楼梯** leans on the ground it really has, hanging over its own well
  (`SlopeCut.noFill`), and a 扶梯's piece draws its own body — so the tab stays empty under both, while
  the ground the stair does have is shaved to its own body line in both slice passes; a run hanging over
  void fills nothing (no floating wedge); a block the station still holds there needs no filling; a cut
  with no ground under it fills nothing; and the packing step the derivation reads (`packKey` minus one
  is the cell below) still holds.
* `floor-surface.test.mjs` — the drawn floor surface, and the filling: a wedge a cut leaves where the
  ground below carries on up to the run's underside is a **closed** body, walls *and* a lid (a derived
  cell once counted as solid for its neighbours' exposure, so it drew no top face and the run's body came
  out as four walls with no lid).
* `stairs.test.mjs` — the five stair shapes, each one storey; every flight is a two-way graph edge
  between walkable landings, a switchback is walked bottom to top **across its half-landing** (in a
  stairwell with nothing else at the half height, so a sealed landing fails the test rather than
  routing round the station), the turn
  landings are the cells between flights, a switchback's runs are **built a block wide and laid on the
  block grid** — both bands move half a block (a whole block at three lanes) onto it, so the piece claims
  exactly **2 / 4 / 6 blocks** across at 窄 / 中 / 宽, growing along the run's right from the base cell and
  probed with a 围栏 in every column — while a piece saved at an older, off-grid width keeps its own band
  centred on its walking line and closes the rest of its well, and its two
  hands are mirror images that
  no rotation can swap, the size cycle runs 窄 → 中 → 宽 (one, two or three lanes; the *run* a 180 is built
  at is the blocks it fills less its two balustrades, and a width that is not a whole number of lanes
  reads as the nearest lane with the tile's label), a 双跑楼梯 in a stairwell leans on the walls — each
  run's outer rail, and the half-landing's two long sides, go where a wall hugs them, and its open end
  keeps its railing — the lanes of a
  wide flight step along `stairRight` — the same "right of forward" a switchback's second flight uses —
  `planStairLanes` puts the hovered cell first and shifts the flight back so it butts against a stair
  on its left or its right (and flags the first candidate when nowhere fits), `stairLaneMates` pairs
  two lanes of one run — neighbours always (`sameFlight` false: their steps meet and they keep their
  rails), one staircase when they share a `cfg.flight` token — and refuses a lane set along the run,
  one on another level, one running the other
  way, a turning stair or a saved wide piece, the five stair
  buttons each build their fixed one-storey shape, a placed turning stair lays its half-landing as a
  walkable cell **and bulldozing it takes that floor back out** (a stray block at mid-run otherwise, the
  shape a stair is torn down and rebuilt in) while a straight stair and a hand-laid block are left
  alone — and a landing cell **another piece stands on** is kept, every cell of that piece's own footprint
  (`moduleFootprint`) counting, so a 2 m 座椅 across the turn is not left over void — and a carve keeps the
  landings while opening the slab a turning
  stair climbs through. `stairWallSides` names the sides of a flight a wall hugs from bottom to top —
  every cell of the run, each read at the height the flight is at when it passes it, and read beside the
  run's **own blocks** (so a block-wide run's rail is dropped by the wall that stands on the cell edge it
  ends on) — so a wall that
  stops at the half-landing, a stump beside the bottom steps, a doorway through one course or a wall
  standing only on the storey above leaves the rail on, while the top course a stairwell's wall shares
  with the floor slab above still counts (the check reads solids, not wall tags). `stairLandingWalls`
  reads the same rule for the half-landing's own edges, at the landing's storey.
* `bay.test.mjs` — the one-tile rule (§5.1): a narrow stair is exactly the escalator band and the
  default stair, and a wide stair is laid as lanes, so every lane of a 2- or 3-lane flight merges with
  an escalator and with the lane beside it (while an old single-piece 1.6 m stair keeps its own bay);
  the models are measured to prove two neighbouring stairs **join their steps** while two placed
  separately keep the rails between them and the lanes of one wide stair (one flight token) do not, and
  the graph to prove the crowd may cross between the lanes of one wide flight but not between two
  stairs — while a stair beside an escalator keeps both balustrades either way; a
  run's body and handrails sweep less than half a cell, so an escalator and a stair,
  two escalators (either travel direction) or a bank of three may stand in adjacent cells, along the
  run or a storey up, while a wide single piece, the same column and a turning stair still collide; a wall,
  fence or gate may be built right up against a run but not inside its tile; the rig's exit A is such
  a flush pair, both runs join the graph and no walk edge crosses their balustrades; and the drawn
  models are measured to prove each run keeps both of its own railings inside its own cell — and that
  a 双跑楼梯 is **drawn** across exactly the blocks its size claims, 2 / 4 / 6, the columns a 围栏 is
  refused in, and is railed only where it is open — a wall against either run's outer edge, or against a
  long side of its half-landing, takes that side's railing with it and leaves the seam rails, the
  stringers and the landing's open end — and that
  a stair's handrails wrap round at both outer landings and land on the floor, while a switchback's
  half-landing gets no newel post in the middle of it, and that a wall standing beside one side of a
  flight takes that side's handrail, rail posts and newel return with it (its stringer stays, and the
  other side is untouched) while a wall that stops part way — or one on each side — leaves or takes
  both. The flight's beams are measured too: **no rotated part of it reaches into a landing's block**
  (the stringer and the soffit are trimmed by `thickness · tan θ` so their square-cut lower corners end
  on the treads' edge, in the cell the cut shaves — an overhang buried the foot of the flight 0.36 m
  deep in a block `rampSlopeCuts` never touches, and the floor's own surface cut it off there).
* `exits.test.mjs` — the 出入口 (§5.6): the plan is the runs' group with one full block of floor at
  each end, so a 单向 / 双向 / 三向 is 3 / 4 / 5 blocks across and the runs stand side by side in
  columns 0 … bays − 1; the floor, street-opening node and glass/back walls all follow the placement
  rotation; the house's plan is `cfg.bays` alone — one full block of pad each end and no other
  width, so `exitRunOpenings` keeps the wellways of the runs that fixed span covers and the house
  never widens for a run outside it; the pad opens one wellway per run, exactly its own block (and
  wider only for a run wider than a block); the snap clamps the pointer into the bay group so runs can
  only be dropped side by side; and 无盖 keeps the same barrier planes as 有盖.
* `ramp-join.test.mjs` — shared metal caps between flush escalators and stair-escalator pairs:
  rotations, travel directions, wide pieces, unique seam ownership and neighbour removal;
  closed rounded end shells and true hemispheres seated along the sloping centreline.
* `escalator-length.test.mjs` — 长 rises 8 m over a 12 m run, versus 短's 4 m / 6 m.
  Both widths and travel directions retain their footprint, carve intermediate floors,
  connect the crowd graph, snap into exit bays, move and survive saving. The rail controls
  are 旋转 / 上行-下行, then 窄-宽 / 短-长; previews and picking carry the length.
* `escalators.test.mjs` — the short escalator is a fixed one-storey piece: an up run travels from
  the dropped cell to the storey above, a down run keeps the same footprint entered from the top,
  the direction cycle flips up ↔ down, two runs may not share a footprint but the next bay over is
  free, placing one carves its slab, and the scenario rig's pre-placed runs are that same piece at the
  same dimensions. Wide places one two-block module with both landing columns supported and
  carved in all rotations and directions; its hover key includes the width.
* `lift.test.mjs` — the 电梯 (§5.1): a fresh piece is a 2 × 2 m assembly that
  serves the floor one storey up; extending grows it a storey up or down in the
  same column and keeps its id; the graph joins every floor in the shaft with one car,
  both ways, skips a floorless level, and boards only at the door landing (the whole
  shaft interior is not walkable, and a rotated lift's landing follows the door it faces);
  two lifts may not share space but a 2 m gap is free; and a passenger rides —
  walks in, is pinned to the 1.5 m cabin while it moves, and steps out on the
  floor above. The car pose is deterministic and its door fraction stays in 0..1.
* `lift-style.test.mjs` — the 电梯's two housings (§5.1): glass is the default, steel keeps
  the old enclosed shaft; Tab cycles the style with a live ghost refresh, picking adopts it
  and Esc restores the armed one, the ghost key names it, and both styles survive extending
  and the save round trip.
* `psd-decals.test.mjs` — the printed safety vinyl on the platform face (§5.9): the fixed-pane
  band prints mind-the-gap bilingual in red over yellow, the door band the same warning on
  yellow, the warning placard the door-safety lines over yellow with white caution eyes, and
  the opening arrow a white ring with a filled head.
* `rail.test.mjs` — placing a rail digs the bed, lays the track module and derives one platform-edge
  per contiguous platform run (two on an island); the derived screen's `side` names the side the track
  lies on, so the header faces the platform and never the rail (checked on both sides of an island and
  on a quarter-turned run); a wall above a platform cell splits the edge;
  regeneration is idempotent and follows the current floor; the dug bed blocks equipment and reads
  as track by either rule; a piece is sized from the line (a car-width bed, the train length), centred
  on the highlighted cell, and a quarter-turned track digs a north–south bed, derives north–south
  screen doors and runs its train in y with a matching yaw; a 供电 switch (`setLinePower`) re-cuts every
  track bound to the line — platform and tunnel — and leaves other lines untouched; a tunnel auto-extends a rail off its free
  end, clears the wall it pokes through and raises its own side walls and ceiling without spawning
  doors; a platform needs its whole bed on solid floor and refuses a wall in its headroom; either one
  is blocked by any existing equipment, room, screen door or track; re-cutting a line's consist resizes
  its platform tracks; deleting a line (`removeLineAndTracks`) takes its platform rails, tunnels, derived
  screen doors and tunnel shell with it while leaving other lines' tracks and doors untouched;
  a fresh line carries empty 上行/下行 termini for its screen header and a full-height
  (全高) 屏蔽门; switching a line to 半高 re-derives its edges and shrinks the reserved screen height from
  3.1 m to 1.5 m; the reference
  station builds its bed from the same dig and its hand-authored edge
  matches what the derive would place.
* `facility.test.mjs` — the rectangle-drag facilities: 商店 / 厕所 / 办公室 place a footprint
  module only (one `shop` module type, the fit-out in `cfg.kind`, `door` and `stocked`) — no
  walls are built (the player walls the footprint with the block tool) — while 售票亭 and 问讯处
  are open-desk booths (`cfg.kind` ticket / info) that keep their staff benches; same-fit-out drags
  extend a room, different ones clash (including ticket vs info); right-click carves the
  player-built wall openings (the renderer then hangs a
  3D door on a 厕所 / 办公室 opening and leaves the 商店 front open) and a room with no wall left is
  removed; picking an info booth arms the info zone brush; the demo's shop and booth stay connected with live sim stops.
* `walls.test.mjs` — the 建造 tool's deliberate drag draws a walled floor patch: a 4 m auto wall
  ring rises on the patch's outer edge, overlapping or abutting two patches unions them (the buried
  wall goes, the new edge is walled) while a hand-placed wall survives, digging an edge moves the
  ring and a hole through the middle stays open, and 墙 lays tagged four-course columns that a
  right-click or right-drag lifts whole — an auto-generated wall answers the same column lookup, so
  the tool can open a doorway in the generated ring. The platform/tunnel footprint is covered
  ground: the ring wraps a dug rail bed instead of walling the platform edge, the drag never pours
  a block into the trench, and no auto wall rises through a platform screen door a full track
  sliced through the patch.
* `fence.test.mjs` — 玻璃围栏 / 门 / 铁围栏 (§5.2): variant save/preview/pick identity, drag placement,
  raised gate geometry and decals underneath in either placement order, iron bars, deletion preserving
  ground decals; a 1 m high thin panel through the block middle (R turns a
  single, a drag lays a run along the drag direction); a dragged run plugs into a gate row, the
  fence cell is not a walkable node so the run plus its gates is a barrier the crowd only crosses
  at a gate, and `fenceArms` builds every joint from the neighbours — a lone panel caps both ends,
  a run end caps its free side, and an L / T / + turns through the centre with no overhang or cap;
  `railLandingAt` lets a fence connect to a stair or escalator landing, both landing columns of
  a wide escalator included.
* `storey.test.mjs` — the renderer's storey bands key every cell to the fixed 4 m grid line at or
  below it (`storeyBand`), so a floor and its 4 m auto walls share a storey while a second floor one
  storey down stays its own; a lower floor's wall reaching the floor above must not merge the two
  floors into one band. The 高度 rail's 0–3 m base shifts every stop and band together; `save.test.mjs`
  checks that the base survives a save and an older save defaults to 0 m.
* `shelf.test.mjs` — the 货架 (§5.7): six variants keep their configuration through factory/save/ghost/sweep; every rotated model stays inside its tile and matches its clearance height, and a low ceiling blocks the cooler. Cooler panels butt between the lid and base, with proud trim to prevent flickering at coplanar surfaces. Tall and short gondolas recess the plinth 12 mm behind the toe strip, and their back panels/posts start above it. the factory builds it with the hover rotation, it may stand
  inside a room footprint or booth (either side of the shelf ↔ room pair, while shelves still collide
  with each other and other equipment does not enter rooms), `moduleAt` prefers the furniture over
  the room around it, placing a store builds no walls and stocks no shelves, each shelf deletes on
  its own while bulldozing the room keeps hand-placed ones and drops auto-flagged ones, extending
  stocks and builds nothing, legacy rooms only gain `stocked` on load (the dead `cfg.bare` flag buys
  nothing), and everything
  round-trips the save.
* `checkout.test.mjs` — 收银台 shop placement, move/sweep and save round-trip; checkout and control-room workstation bounds in every rotation, low-ceiling clearance, exposed merchandise and monitor faces, and the mesh chair.
* `desk.test.mjs` — the 办公桌 (§5.7): the factory builds it with the hover
  rotation, it may stand inside a room footprint, `moduleAt` prefers it over the room, placing an
  office builds no walls and stocks no desks, each desk deletes on its own while bulldozing keeps
  hand-placed ones and drops auto-flagged ones, legacy offices only gain `stocked`, and everything round-trips the save.
* `restroom-model.test.mjs` — three-panel cubicles with privacy doors, flush rear joins,
  one shared partition across rotations, separate floors, previews and neighbour removal.
* `restroom.test.mjs` — 厕所 fixtures and the booth staff seats (§5.7): cubicles and sinks build
  with the hover rotation and stand inside a room footprint, placing a restroom builds no walls and
  stocks nothing (a recorded door is kept, still with no fixtures) while a ticket or info booth
  stocks one bench per back-row cell,
  each unit deletes on its own while bulldozing keeps hand-placed ones and drops auto-flagged ones,
  legacy rooms only gain `stocked`, and everything round-trips the save.
* `booth-model.test.mjs` — the reference-based 问讯处 / 售票亭 models (§5.7): both stay
  within their footprint and 2.4 m height, the white information counter has a lowered
  accessible centre, the stainless ticket kiosk has clear transfer apertures beneath its
  service glazing, and both open overhead frames carry visible, owned sign materials.
  Translation is checked on every mesh.
* `room-model.test.mjs` — the walled room's own model (`render/models.ts` `buildRoom`), the perimeter
  ring of 0.5 m panels that stands in for a room's wall voxels. What it pins is the square corner:
  three quarters of every corner cell are wall and the quarter the room keeps for furniture is empty
  (the ring is an L, not the diagonal wedge a `mitreCap` used to lay across that quarter, its apex one
  wall thickness past the room's own inner corner), the panel's centre line is covered at every 5 cm
  sample the whole way round with no gap at a corner, no panel leaves the room or the height
  `moduleEnvelope` reserves, and nothing in the ring is anything but a box. It also builds the room's
  **doorway** on all four walls (`buildDoor` into the doorway's own group): every member runs along
  its wall and never through it — a doorway whose members were only *moved* into the turn (the old
  `turnedDoorFrame`) had its run and depth swapped on the two x-sides and stood its head and leaves
  0.43 m outside the building, which no south-wall test could see.
* `vending.test.mjs` — the 自动贩卖机 (§7.4a): the factory builds it with the hover rotation, its
  1 × 1 m envelope is identical to a TVM's (so the two block each other), and `buildGraph` gives it
  the same unpaid-zone `stop` server and rate as a ticket machine under the 自动贩卖机 label.
* `bench.test.mjs` — the 座椅 variants (§5.7): the table offers two families (stainless with no back,
  backed seat) at two widths; the factory builds each with the hover rotation and a legacy bench is
  the 1 m stainless piece; a 2 m bench covers two cells in its own direction (and quarter-turned),
  blocks a piece on its second cell but not the next one over, is found by `moduleAt` from either
  cell, is refused over a track bed on either cell, and round-trips the save.
* `decor.test.mjs` — the 垃圾桶 and 灭火器 decorations (§5.7): the palette files both under 装饰 with
  their Chinese labels, the factory builds them with the hover rotation, each reserves exactly its own
  cell up to the height it is drawn to (so the body can never stand taller than the space it reserves),
  two may not share a cell while a neighbour or the storey above is free, both are room furniture that
  may stand inside a 商店 / 售票亭, both are refused over a track bed, both round-trip the save, and a
  drag sweep collects a run of either one without taking the other. The models are measured too: the bin
  is an enclosed stainless cabinet (`binSteel`) with two hopper mouths over dark wells and one
  0.76 × 0.57 m sorting-sticker plate floating just off its front panel, symmetric about x,
  and the cabinet is a red steel box standing on exactly four corner legs with one
  white lettered plate spanning both doors in front of them.
* `ceiling-decor.test.mjs` — the ceiling-hung 时钟 and 监控 (§5.7): the palette
  files both under 装饰 with their Chinese labels, the factory builds them with the hover rotation,
  each reserves exactly its own cell from the floor top to the storey ceiling, neither may be hung
  where there is no slab overhead while floor-standing pieces are never asked for one, a hung piece is
  judged by that slab and never by the ground under it — a floorless cell takes the clock and still
  refuses the 售票机 that would stand there — neither may
  share a cell with **another hung piece** — while a 闸机, a 座椅 or a 广告牌 on the same tile is
  allowed, and a run is not — neither may stand on a track bed, both are movable and round-trip the
  save, and a drag sweep collects a run of either without taking the other. The models are measured
  too, off the **geometry** rather than a texture: the clock is a true cylinder whose face disc
  hangs at 2.4 m with a **white** material, twelve hour markers and 48 minute ticks in **black**
  resting on its plane, two hands and a boss, and an **open-ended** bezel ring proud of it, so the
  face cannot be covered by a cap and no text is printed anywhere on the piece; every hand is a
  **pivot** the scene turns and is seated on the sim's own pose at `CLOCK_POSE_SECONDS` (10:09) when
  nothing is behind the build, the rig is handed to the clock system by the module pass — and by the
  **hover ghost**, which is turned with the placed pieces and gives its hands back when the pointer
  moves on — and the hands follow the sim clock: **swept** between snapshots, **set** on a
  seek (and on a step back), and stopped when the sim is paused. Its second half is the piece's
  **readability**, which the hands are what make checkable: each face tells the time to the viewer
  standing in front of it — measured on that viewer's own screen, for a rot 0 and a rot 2 piece, so
  whichever dial the camera is looking at reads the clock — and the mark that viewer sees at the top
  of the circle is the dial's own 12; the camera is a
  slim fitting — under 8% of the cell it reserves — with its lens, two illuminator LEDs and hood all
  on the local −y front, and half a turn round puts the lens on the other side of its own cell.
* `lights.test.mjs` — the ceiling 灯具 (§5.7): the palette files 圆形 and 直条 fittings under 装饰,
  the factory stamps the variant, and each hangs flush from the slab overhead with its diffuser
  10 mm under the steel; the rectangular batten walks the shared nine-spot in-cell cycle (Tab) and
  turns 0°/90° (R) while the round one stays centred and fixed; ghost and collision match the drawn
  housing; ceiling support, furniture clearance and structural clashes are judged like the other hung
  pieces; and a batten is movable, sweeps by shape, and round-trips the save.
* `vent.test.mjs` — the ceiling 通风口 (§5.7): its own decor tile, a square grille flush against the
  slab with a recessed dark backing and nine blades turned by R; model and collision agree at every
  rotation; ceiling support, furniture clearance and structural clashes as hung; movable, sweepable,
  and round-trips the save.
* `floor-decor.test.mjs` — industrial floor equipment, two tactile tiles and three floor markings:
  rotated model/placement bounds, floor support and wall collisions, machinery blocking the walk
  graph while floor vinyl stays walkable, screen-door clearance, straight tactile drag placement
  and deletion in one undo step, variant-safe removal, printed markings and save round trips.
* `street-decor.test.mjs` — the outdoor 导向柱 and 公交站 (§5.7): above ground only, refused below
  grade and on anything but whole solid floor, movable; the 4 m pillar binds the armed exit — or the
  first one standing — and reprints the station and exit names live, dropping to 入口 when its exit is
  gone; short and long shelters with frozen ad posters; rotated model bounds; exit binding, shelter
  variants and posters survive the save round trip.
* `exit-banner.test.mjs` — the exit header (§5.6): the red brand board prints the saved English station
  name under the Chinese with the exit identifier beside it, white on red, with no 口 suffix and none
  duplicated.
* `wall-ceiling-snap.test.mjs` — the wall/ceiling snap contract (§5.7): a wall hover on an
  upper course anchors the panel to the storey floor below (`wallMountStandCell` + `storeyBand`,
  never a floating course height); a hung fitting hovered on the floor, the slab overhead or
  a wall course resolves to the floor it hangs over (`ceilingMountStandCell`); and a piece so
  aimed passes the shared `equipmentReason` verdict — with a ceiling where it needs one.
* `sign.test.mjs` — the 装饰 pieces 指示牌 and 电视 (§5.7): the factory builds the sign
  with the hover rotation; a piece needs a solid ceiling at the next storey grid line (so a B1 piece
  hangs from the concourse slab) and is refused without one, while floor-standing modules are never
  refused; a **hanging** sign is not wall-mounted and its envelope is the full storey column, so it is
  found and blocks its cell; and both round-trip the save. The same file owns the 指示牌's **two mounts**
  (§5.8): the piece is created with the mount its palette tile names, a **wall** board is wall-mounted and
  never the ceiling one, it is backed on the **one** wall course its 0.7 m panel crosses
  (`signWallCourses`), it reserves a thin slab on that wall rather than the whole storey column (so a
  座椅 shares the tile while a tall 售票机 collides), and the shared `equipmentReason` verdict answers each
  mount by its own rules — ceiling for the hung board, backing for the wall one — with the two mounts two
  pieces to a sweep and one module type to a save. The same file owns the 指示牌's **board document** (§5.8):
  the board is **one row** that grows longer with its content and never taller, and its texture follows
  it at a constant pixels per metre; text is measured and estimated alike; a label is two lines of
  eight; every component is its ink plus a pad, so two marks can never touch; **no two components ever
  overlap** — not when two are dropped in the same place, and not when every palette block is stamped
  at one point — while the block being held keeps its exact place and the row packs around it; a
  component is clamped onto the board rather than off it; a face-bound component prints on that face
  only, and the hit test picks what the player can see; a fresh board carries the station's own line and
  a legacy board is backfilled once; an unreadable layout (duplicate ids, forty components, a 99×
  scale) is repaired rather than trusted; and a palette block is a content group that stamps as a run.
* `billboard.test.mjs` — the 广告牌 formats and their posters (§5.7): the catalogue and the JPEGs in
  `src/assets/posters/` name the same twelve slugs; a panel is only ever offered artwork cut for its own
  silhouette; every poster a format can roll is cropped by less than 1.45× and the window that does the
  cropping keeps the image's own aspect (`panelUvWindow`), so nothing is ever stretched; the window is
  the centred crop and the cropped quad's UV corners walk it in three's own order; an unknown slug falls
  back to the catalogue head rather than to a blank face; and all six panels fit their run, the wall
  band their collision envelope reserves (`panelZ` ± `panelH` / 2, so a poster never claims the floor
  under it) and the 4 m storey.
* `glass-panel.test.mjs` — the 玻璃板 sizes (§5.7): the table offers nine (six wall sizes and three
  4 m floor-edge sizes), six wall-size palette options plus a separate 玻璃幕墙 Tab cycle, and a legacy or unknown value reads as the 1 × 1
  band; the factory centres the run on the hovered cell; short-panel envelopes are a **slab on a wall**
  rather than a cell (`x + w` is not the run — at rot 2 it lies along −x, and `wallPanelBox` reads the
  module's own cells so the housing stays on the wall on every rotation); every cell of the run needs
  backing, and so does **every course the panel crosses** (a 1 m wall carries the 1 m band and refuses
  the 2 m window); a panel turns itself to a wall that backs it; two may not share a cell; the pieces
  round-trip the save and sweep by size. The model is where "outer frame only" becomes a number: five
  meshes at **every** size — a sill, a head, two end posts and one pane — against a 围栏 run of the same
  length, which stands one frame up per cell.
* `door-panel.test.mjs` — the 门 (§5.7), the **free-standing doorway**: two material variants (不锈钢 / 木) in the 门 family menu, plus a 窄 / 宽 action tile
  that also cycles with Tab, and a legacy value reading as the narrow stainless door; the factory centres a 双开 run on the hovered cell; the piece **stands on the
  floor** — it reserves its whole cells from the floor top to its head, wants no wall behind it
  (`isWallMounted` and `isWallMountedType` are both false, `wallMountCourses` is empty) and is refused for
  missing floor like any furniture; it round-trips the save and sweeps by variant (rotation is not part of a
  sweep family). Two tests pin where it stands: it is set on the block's **leading edge** with the run
  filling exactly the cells the ghost highlights — one cell for a 单开, two for a 双开, at either rotation —
  and a 双开 pair's two pulls are mirrored at the meeting line, where a pair of doors is opened from. The
  stainless model uses satin brushed stainless on every surface: frame, uninterrupted leaves,
  three exposed hinges per leaf, upright pulls and the active leaf's lock escutcheon. The tests
  check the finish throughout, hinge count, pull clearance and mirrored pulls at the meeting line.
  The wooden variant keeps its timber frame, leaf and pull, with a steel kick plate. Both sizes
  retain their placement bounds, and rooms reuse the same door builder.
* `calligraphy.test.mjs` — the 站名 (§5.7): six hands (楷书 / 行书 / 隶书 / 魏碑 / 黑体 / 宋体, each
  with its own font stack, ink, tracking and second strike) on two axes, twelve palette tiles whose
  labels name both; the characters are the station's own name, capped at eight and never blank; the
  panel is cut for it — whole cells across at eye height, one column down in 竖排, with the type
  shrinking when the name outgrows the panel rather than the panel growing past its ceiling; **every
  横排 panel is an odd number of cells**, so the run straddles the hovered cell evenly and the name is
  never drawn half a cell off the pointer (a short name on an even panel was); the wall
  courses are the band the inscription crosses (a 横排 band written 1.2 m up wants the 2nd and 3rd), so
  a low inscription shares its cell with a bench under it while a 售票机 reaches into it; the factory
  records the hand and the axis and cuts the panel from the live name. The pixels are pinned through
  the recording canvas: **the name is the whole plate** — nothing fills at all, so the wall is the
  paper and no seal is stamped beside the characters — one strike per character plus a drier second
  pass, the run laid out across in 横排 and down the column in 竖排, and the wash from a hash of the
  character, so a rebuild reprints the same wall instead of twitching. The scene's own plate cache is
  driven too: a rename repaints every inscription **in place** (retained by module id), a different
  hand is a different texture, and a module the document no longer holds gives its plate back.
* `line-map.test.mjs` — the 线网图 (§5.7): the two mounts are one table — a wall board (two cells,
  single-sided, on a wall on every course it crosses, with its frame's bottom 1.06 m up so a 座椅
  stands under it) and a free-standing totem (the **same two-cell board** on a plinth and a post,
  printed on **both** faces, floor-standing and never asked for a wall). **The board is the supplied
  poster**: the file's own JPEG header is read, its 2048 × 2047 size pinned, and the panel's aspect
  checked against it, so the crop window is the whole image (`panelUvWindow` is the identity) — and
  replacing the asset with a differently shaped picture fails the test rather than silently cropping
  the map to a slice. The **placeholder board**'s arithmetic is checked on the real table too: one band
  per line in document order, never overlapping, the shield heading its run, every station ticked, the
  station two lines share ringed as an interchange, labels thinning to every nth when a 1.8 m board
  cannot hold them — with a label's own width clear between the ones it keeps — and lines the panel is
  too short for counted in the footer rather than folded onto each other. The pixels are read back: the
  title and the station's own plate, each line's colour as a band and a shield, every station named, the
  footer counting the network, and a recoloured line reaching the board. The model pins the mount: one
  lit face on the wall board facing into the room, and **two planes facing opposite ways** off one face
  on the totem, never one double-sided plane that would print the map mirrored on the back.
  The scene's own plate cache (`PlateSystem.makeLineMapPlate`) is driven the way the modules
  drive it: the placeholder is owned pixels cached by piece and panel, the poster's face is
  shared art the cache neither mints nor frees, a placeholder left past the poster's arrival
  is evicted on retain, and a line edit repaints the placeholder in place.
* `tv-screen.test.mjs` — the 电视's two lit panes (`render/models.ts` `buildTv`), pinned in geometry
  because the failure is silent: the content window's pane must stand clear of the dark backing slab
  that carries it, since a coplanar pane z-fights that slab and the window renders as a flat black
  rectangle with nothing in the console. Both panes are also asserted to be front-side-only on the same
  local −y face, so the back of the case reads as a blank panel, and the video overlays the
  full-screen plate proud of it — reaching the top, standing clear in front, the bottom footer
  still visible below, the station texture unscaled at repeat 1,1.
  `render/adArt.ts` is stubbed here rather than imported: it resolves its JPEGs through Vite's
  `import.meta.glob`, which plain Node has no implementation of, and nothing under test lives there.
* `module-build.test.mjs` — enclosed stainless double bins, inward-facing hopper walls and recessed wells in all four rotations;
  full-height platform doors at 150% of car door width, closure across all stock classes and both
  platform sides, including vinyl that travels with each leaf; every piece the station can draw,
  built through the real dispatcher and
  the real material kit (`render/models.ts` `buildModule`), one row per palette piece: the meshes it
  draws (its instanced batches included) and the size its bounding box spans in metres, so a dropped
  part or a whole piece that stops being drawn is a failure and not a silent hole in the station; the
  `userData` handles the scene animates a piece by (`wing`, `doors`, `liftCabin`, `escalator`,
  `adScreen`, `wall`); the dimensions that are contracts with the sim (the 闸机's 1250 mm, a screen
  door drawn to the height the graph reserves — `PSD_FULL_HEIGHT` / `PSD_HALF_HEIGHT` — an exit one
  block wider per bay, a stair climbing `STAIR_RISE` over `STAIR_RUN`, a 2 m run spanning two cells,
  the 零售 shell *being* the store room); the consist (`cars × carLength` of body, both ends cabs, one
  leaf per modelled door, white lamps leading); the four per-frame setters (`setGateWing` — whose
  hinge end never moves — `setDoors`, `setDoorsSides`, `rollEscalator`); the 扶梯's own **body under
  its truss**, which is walked as a closed shell and measured against the lower landing, the course
  the ground leaves, the cell edges it spans and the truss's width, and rayed straight up over that
  course and past it; a 指示牌's **two mounts** measured the same way (the wall board flush with the wall
  plane, its body only its own depth proud of it, its panel spanning 1.3–2.0 m — the one wall course it
  asks for — where the 吊挂 board reaches the ceiling its rods bolt to); and a teardown, which frees
  every geometry a group owns — an `InstancedMesh`'s instance buffers included — while keeping the
  shared kit and the shared ad quads.
* `station-display.test.mjs` — the TV's blue reference layout: three stacked destination
  cards, a wide video window, station footer and date/clock below the video. Arrival forecasts
  come from the worker's per-track dispatch schedule and train phases; the test compares all
  three forecasts with actual berth times, converts seconds to displayed minutes, and checks
  nearest-track selection across rotated rails, opposite directions and storeys. Missing
  services print 暂无班次 rather than an invented countdown, and a lineless plate still prints
  the station under three empty cards. The six-second approach window ends inclusively. The model uses one full-screen
  station texture beneath the video, with its own depth offset to avoid z-fighting.
* `sweep.test.mjs` — the 删除 tool's same-type drag sweep (§9.5, `app/sweep.ts`): two 闸机 of either
  rotation are one family while a 售票机 at the end of the row never joins; the palette variant is the
  match, so a 2 m 座椅 leaves the 1 m ones standing, a 横版 广告牌 leaves the portrait panels and a
  双开 不锈钢 门 leaves the single wooden ones, and a **墙面指示牌** leaves the hanging boards (the mount is
  the same kind of variant, an absent one reading as the hung board), while
  a legacy piece with no variant reads as the default it is drawn as; a room, a rail, an 出入口, a
  楼梯 and a 站台门 are never sweepable; every sweepable 设备 / 装饰 type is listed (so a new palette
  piece is un-sweepable until the decision is written down); the drag path between two move events is
  sampled end to end
  (a fast flick that jumps a cell still collects what it crossed, a teleport is capped but never
  skipped), so a drag along a gate row collects exactly the gates and never twice; and the whole run
  folds into one state, leaving other modules and the floor under them untouched.
* `move.test.mjs` — 移动 (§9.5, `sim/placement.ts` + `build/model/Equipment.ts` + `app/store.ts`), the
  `信息` card's action on the
  selected piece rather than a tool: it lifts whatever tool is active and leaves that tool alone; the
  flat 设备 / 装饰 pieces, an 出入口 and the two runs (a 楼梯 and a 扶梯) are movable while a 电梯 / 房间 /
  轨道 / 站台门 is refused; a
  moved piece is the same piece (id, `cfg`, poster and boards all travel) and never collides with the
  copy still standing at its origin; a drop needs floor under every cell it stands on (a 2 m 座椅 needs
  both, and a 扶梯 needs the slab its upper landing arrives on), refuses a track bed and an occupied cell,
  turns a 广告牌 to the wall that backs it (and lets it
  hang over the track where there is no floor in front of that wall), and requires a ceiling over a
  指示牌 — which is the only thing it is asked for, since a hung piece is exempt from the ground; `replaceEquipment` swaps the piece in place keeping the list order; a **run** is re-laid instead: a moved 扶梯's `from`/`to` travel with it (and a turn swings the upper landing about the base, never the travel direction), a moved 楼梯 is the stair the factory would build at that cell and rotation for every shape and size (its flights, its width), a piece that was never on the block grid keeps the run it has, a turning stair's half-landing floor goes with it and the new one is laid, a moved 扶梯 carves its new opening while the one it left stays open as it does on a delete, and the whole move stays one commit that `Ctrl+Z` undoes (landing floor and all); and in the store a lift is
  not an edit (the piece stays in the document, nothing on the undo stack), `取消` puts it back with no
  commit, `确认` is one commit that `Ctrl+Z` undoes, a refused drop keeps the piece in the air and says
  why, a drop that changes nothing is not an edit while `R` + `确认` on the same cell is, and what lands
  is the live piece — its boards as they are *now*, not a lift-time snapshot.
* `paint-mode.test.mjs` — the 材质 folder's own setting (`app/store.ts`, §4.3): `N` 单块 / `M` 整面
  are what the brush keeps, so choosing a texture — a plain finish tile, or a fresh 搪瓷板 colour,
  which reaches the brush in the same click rather than the previous render's value — never resets
  it, and the setting survives a detour through another folder on the left rail.
* `tool-shortcuts.test.mjs` — B 删除, P 吸取 and M 移动 toggle back to the tool that was active
  before the mode; changing tools records the previous one, and each shortcut cancels its own mode.
* `pick-tool.test.mjs` — the 工具 folder's **吸取** (`app/tools/PickTool.ts`, `P`): clicking a placed
  piece arms the placement with its exact palette variant — a 2 m backed 座椅, a 六 format 广告牌, a
  right-双跑 楼梯, a 木 双开 门, or either 桁架屋顶 style at its placed width — and copies its turn, 扶梯 direction and 闸机 door, selects the instance
  and opens
  the owning folder; a legacy piece with no variant reads as the palette default it is drawn as; a
  rail run hands to 轨道, a walled room to 分区's own brush, a derived 站台门 only selects; and a bare
  face lifts its finish into the 材质 brush — a **半墙**'s inner face and a **三角**'s slope included,
  resolved by `facePresent` exactly as the brush resolves them — while a right press picks nothing.
  Two halves of the gesture are pinned beside it: a **指示牌** is copied as its own **boards**, not as
  its tile (the picked sign's printed faces become the current pair, the piece itself untouched, and
  the next sign hung carries them) — and it arms the **tile of the mount it stands by**
  (`sign-ceiling` / `sign-wall`), so the palette and the piece agree — and **Esc** puts a whole pick back
  — tool, piece, turn, direction,
  door, the 方块 tool's wall-face cycle and the boards — through the `pickDraft` the picker notes before
  it writes, with a pick that changed nothing noting nothing.
* `line-edit.test.mjs` — the 线路 card's own actions (`app/store/slices/LineSlice.ts` +
  `StationSlice.ts`, `build/rail.ts`): `addLine` mints the next free id in the document's own numbering
  and wears its real 广州地铁 colour; `updateLine` lands 名字 / 颜色 / 上行终点 / 下行终点 / 车型 / 编组 /
  下车, clamps a consist to 1–8 cars and carries the per-car 下车 over, and its **供电** and **屏蔽门**
  switches reach every track and screen door bound to that line and no other (re-cutting a platform
  rail while a hand-sized tunnel keeps its own length); refreshing a selected platform or one of
  its screen doors resolves to that platform and re-derives only its doors; `removeLine` takes the
  line, its tracks, their
  doors and any tunnel shell as **one** `Ctrl+Z`; the undo stack pushes the document as it was, walks
  both ways, and its memory cap trades depth on a large station without ever dropping the newest frame;
  and the station paths — 新建车站, 示例车站 (with the 打开 notice when a load had to be repaired), a
  rename that trims and never commits twice, and a save written and opened back — land on the document
  and the notice they say they do, while a save that cannot be trusted is refused whole.
* `rail-folders.test.mjs` — the two folder ladders (`app/rail/helpers.ts` `RAIL_FOLDERS` +
  `INSPECTOR_FOLDERS`): the build rail is Shift+Q W E R T Y U in the order its folders are stacked, 工具
  first (so Shift+Q folds the folder the rail already opens on), with **材质 pinned directly above 房间**;
  the 信息栏 is Alt+Q W E R over 信息 / 视图 / 出入口 / 线路, 视图 standing in **one** of the two tables
  (Shift+I names nothing now); a folder stands on one key and a key on one folder **within its column**,
  the two columns deliberately sharing Q, W, E and R under different modifiers; both lookups are
  case-blind because the listener hands over `KeyboardEvent.key.toLowerCase()`; and a letter no folder
  stands on falls through to the app's own switch instead of folding something.
* `rail-families.test.mjs` — the rail's **variant families** (`app/store/catalog.ts` `MODULE_FAMILIES`),
  the one table the parent tiles, the sub-menus, the rail's single open slot, the folder counts and the
  contextual action row all read. It pins the four halves against each other for every family and every
  palette id: the keys and anchors are unique; each family owns at least one variant and **no variant is
  claimed twice**; every family is filed in the folder its own pieces are filed in (装饰 by `isDecorType`,
  设备 by the rest) — and **every palette id answers a predicate as its own type does**, which is the rule the
  rail's folder fold and the 装饰 right-click guard ride: a family whose ids are prefixed (`sign-ceiling`)
  has to be named by its family predicate, or arming it opens the wrong folder and a right press skips the
  guard that protects a room — and `familiesIn` names them in rail order, 装饰's own list being
  bench / billboard / glass / door / calligraphy / linemap / **sign**, the 指示牌's two mounts the seventh —
  and **one order list (`RAIL_ORDER`) lays the
  grid out** and every tile a folder owns is drawn exactly once, in it — a family's variants are excluded
  from its folder's plain tiles (`folderOptions`), so nothing is drawn twice and everything the folder can
  place is reachable; the
  open slot answers with the piece's own family (`subMenuForModule`), which is what stops a variant
  folding its list away the moment it is picked; and every piece with an action row anchors to a tile its
  folder really draws — `actionsAnchorFor` names the family tile for a variant and the piece's own tile
  otherwise, so the 旋转 row can never fold out under nothing; and `actionRowOpen` is open only under the
  family being browsed — the reported 座椅 → 站名 case is pinned by name, for every family pair, so no
  family can ever show a stray 旋转 row inside another family's list.
  The 方块 tool's **cut pieces** (`CUT_MODES`) are held to the same contract in the same file, because
  they travel the same path: a cut piece is its own tile and its own anchor (`cutAnchor`), the armed cut is
  what `armedTiles` / `armedRailTile` / `armedActionsAnchor` report for the 方块 tool, its row opens by the
  very same `actionRowOpen` call a 座椅's does, and a cut left armed in the store folds **no** row out of
  any other tool's grid — so the 旋转 a 半墙 shows is the equipment mechanism, not a second one beside it.
  `生成墙壁` is the one tile that comes and goes with the cut modes, and the folder count follows it.
  The 分区 folder's own count is the same kind of arithmetic (`zoneFolderTiles`): the length of
  `ZONE_LIST` **plus the three walled-room brushes** (商店 / 厕所 / 办公室 — 售票亭 / 问讯处 stay in
  房间), **无分区 included** — that tile is the folder's eraser, armed as the zone id `none`
  (`isEraseBrush`) and reported by `armedRailTile` like any other tile, which is what keeps the grid the
  folder draws, the header's count and the brush the drag runs one list.
* `halfwall.test.mjs` — the **半墙** (§4.1/§4.3), the 方块 tool's half-block mode
  (`build/model.ts` `addWalls`'s `side`): the column is an ordinary tagged wall — a `half-wall:w` course
  that lifts, slices and carves like any other while the mesher draws it `HALF_WALL_T` thick in the half
  the side names; **R** offers the geometry's own faces first for a single column and only the two
  perpendicular sides for a run, wrapping; arming the 半墙 cut tile switches 生成墙壁 off, refuses it
  while on and hands the ring back on the way out — and **Tab**, the ring's own key, is refused with it —
  and both settings join the ghost key; a painted face of
  a panel colours that surface and not the whole block; the brush may paint a 半墙's inner face even with a
  solid cell behind it (`facePresent`, and `M` 整面 flooding a whole run from one column); `thinWallCells`
  is the one list of cut cells the mesher, the ghost and the brush all read; a half wall **a ramp
  derived** is in it and is painted the same way (the stair panel that used to be untexturable); and a
  ramp keeps a player's 半墙 without thinning it a second time.
* `triangle.test.mjs` — the **三角** (§4.1/§4.3), the same tile's other two steps: a cut block is an
  ordinary tagged wall (`tri-upper:w`), so `isWallBlock`, the column lift and the ramp carve treat it
  as one and a run beside it keeps it rather than re-cutting it; the mesher draws the wedge the tag
  names and **only** that wedge — all eight `(kind, side)` pairs read back as five faces, and the
  assertions are about the shape rather than about a table of coordinates: 0.5 m³ of volume (which only
  closes if every face is wound outward), the 1 m² base square flat in the X-Y plane at the floor for 上
  and at the ceiling for 下, the 1 m² full-height face on the side the tag names, a √2 slope at exactly
  45° falling away from that side, and two 0.5 m² triangular ends across the ridge — and the eight are
  distinct, so no two tags are the same block; its **slope is a surface the brush offers and paints** —
  with a block against the face it leans to as much as without one, the block landed there or not
  (`facePresent`), the stroke landing in the very finish the mesher draws the diagonal in
  (`triangleSlopeFace`), the paint ghost riding the sawn plane (`wedgeSlope`) instead of the cell's
  ceiling, and that plane's frame right-handed — `along × ridge` is the normal — for all eight pieces,
  which is what keeps the quad on the diagonal rather than folded through it; the tile
  cycles 半墙 → 三角上 → 三角下 → 关, the three cut modes are exclusive with each other and with the ring, and
  the kind and the side both join the ghost key (R rebuilds the preview without the cell moving).
* `blocktool.test.mjs` — the 方块 tool's own press/release path: a cut click lays exactly the piece its
  ghost previewed (the defect this file exists for was the ghost drawing a panel while the release laid
  an untagged full block), the floor it stands on is left byte-identical, R walks the side and the
  label with it, and a 半墙 aimed at a cell the auto-wall ring already fills is a no-op rather than a
  course that replaces the ring's block.
* `level-slicing.test.mjs` — the level slice as a pure rule (`render/levelSlicing.ts`): which
  side of the edited storey a piece sits on (a lift spanning into the storey counts as active),
  显示其他层 off drawing the edited storey alone at every camera angle, ghost mode keeping the
  neighbours at 35% while a storey above keeps only its unsupported plates (a room never wears
  its own ceiling), and the crowd and the trains following the same slice. It also pins that
  **隐藏UI is not a slice flag**: its slice is a different one (`sliceOptions`), because a flag
  could turn a piece on but could not undo the ghost material that put a storey through the floor
  under the camera, so the mode skips the walk (`LevelSystem.applyLevel`) and the only per-agent
  flag that remains is `crowdVisible`'s.
* `grid-visibility.test.mjs` — 隐藏UI's drawing furniture
  (`render/scene/systems/GridSystem.ts`): the tile hides the 1 m lattice and its cell cursor, and a
  pick under the pointer cannot put the cursor ring back on a hidden grid; the lattice is still
  rebuilt at the active storey while hidden, so showing it again never flashes an empty grid.
* `section.test.mjs` — the 剖切 surface's arithmetic (`render/section.ts`): a fresh cut looks exactly
  +y, which is the plane the old fixed toggle drew; the look is one of four quarter turns and never
  tilts out of the vertical, each with an orthonormal surface frame; `nextAzimuth` steps one quarter and
  wraps at 270, snapping an off-grid angle back on; the offset slides the cut the way the surface faces
  and nowhere else; `planeConstant` is the distance from the world origin to the cut, so the plane keeps
  the half **behind** it and the surface itself is never clipped off; the snap lands on a half metre
  (5 cm fine); a drag projects onto the look at every quarter turn; and the highlight grows with the
  station it cuts.
* `section-drag.test.mjs` — the 剖切 drag end to end, with the rig the game uses
  (`SceneRenderer.sectionDragAxis` and `render/section.ts` `dragOffset` / `walkAlong`): the cut's axis
  projects to a real screen line at all four turns, a push **along** that line slides the cut the metres
  it walked while a push of the same length **across** it moves nothing (the case an oblique camera used
  to get wrong), and a cut sliding straight at the camera has no line at all — the grab is refused
  instead of dividing by nothing.
* `cut-clipping.test.mjs` — the seam between the cut and the slice (`LevelSystem`): the slice's cached
  ghost for 显示其他层 takes the plane when the cut comes on (and gives it back when the cut goes off —
  a clone follows its original), **while the cut is on every storey draws opaque** however 显示其他层 and
  Q/E are left, and the plane reaches every storey. It is the guard on the two ways a cut can look like
  black paint instead of a cut: a ghost that never learned about the plane, and a slice still ghosting
  the storey the cut is going through.
* `floor-surface.test.mjs` — the drawn **floor surface** (`render/chunkMesher.ts` `buildProfile`): a run of
  blocks is one flat plane, out to a **square rim**. It reads the height of the drawn surface rather than
  counting triangles, because a count cannot tell a groove from a smooth floor — a shared cell edge emits no
  wall, so two top faces meet flush and a 2 × 2 patch of them has no pit in the middle, and an exposed edge
  runs level all the way to the cell boundary. It also reads every drawn triangle's normal, because a cube
  has only axis-aligned faces and a chamfer does not: that is the pin on §4.2's 12.5 cm top-rim bevel having
  been **removed**. The shape before both of those — every cell edge rounded and bevelled whatever stood
  beside it — left a V-groove along every seam and a 12.5 cm pit at every four-block corner, plainly
  visible from above.
* `camera-vertical-pan.test.mjs` — Ctrl+Q / Ctrl+E, the camera's own pair of letters
  (`CameraSystem.panCameraVertical`): the camera **and the point it aims at** travel together along world
  Z, so the orbit offset — the view angle — is untouched and the station slides up or down the screen
  instead of being tilted away or panned off it; the rate scales with the orbit distance and Shift
  triples it; a locked step never changes the orbit distance, so the wheel's own 4 m / 400 m limits have
  nothing to clamp and a long hold keeps the angle; and a *plain* Q/E — the storey step — leaves the
  view exactly where it is, which is why the key set carries the modifier in its token.
* `camera-fov.test.mjs` — 视场角, the lens slider under the nav cube (`CameraSystem.fov` / `setFov`): a
  degree count reads back as itself, which is what stops the thumb creeping, since the slider follows the
  camera rather than leading it; the **30° end genuinely magnifies and the 120° end genuinely opens the
  frame**, both measured by the projection's y scale rather than by the number, since "seeing more" is a
  property of the frustum and not of the slider; a third of the angle is more than a third more
  magnification, the non-linearity that made a percentage of the default the wrong scale; the camera
  clamps to the slider's own ends, refuses a NaN (`clamp` would pass one through and blank the station),
  and moves the projection matrix, so the change is drawn rather than merely stored.
* `camera-orbit.test.mjs` — dragging the nav cube (`CameraSystem.orbitBy`), the one camera control with no
  key and no button: a sideways drag turns the bearing and leaves the camera's height alone, an up-down
  drag (after a turn, so the pitch axis has to be the screen-right one and not world X) changes the height
  and leaves the bearing alone, and a drag pitched far past the pole stops short of it at `POLAR_EPS`
  rather than flipping the view.
* `view-home.test.mjs` — 回到默认视角 (`app/viewHome.ts`): the iso preset, the perspective flag and the
  **lens** — and **nothing else**: every display setting (显示其他层, 隐藏天花板, 剖切, 隐藏UI, 隐藏墙壁) is
  checked to come back untouched, because a home that quietly flipped one is what made the old button read
  as broken; a widened lens is driven back to 100% **through the real camera rig**, so the reset is the
  lens moving and not a call that happened to be made; a missing scene is a no-op; and `Ctrl+H`, the ⌂
  button and the `metro:home` hand-over are one definition rather than three copies.
* `chunk-cache.test.mjs` — the chunk cache's **GPU** half (`render/scene/systems/ChunkSystem.ts`): a
  chunk whose content did not change comes back with the very geometry objects it had, its per-chunk
  outline material included (so no program recompile), a chunk whose content *did* change releases the
  buffers it is done with, and a rebuild still prunes the chunks the station no longer has. `meshStation`
  releases the last rebuild exactly **once**, after the reuse set is known: releasing before it as well
  disposed every cached geometry and outline before the keep-aware call had anything left to skip, so
  every edit re-uploaded the whole station's buffers at a cost that grew with it — invisible in the
  triangle count, which is why it read as "it gets slower the longer I build".
* `sign-editor.test.mjs` — the 指示牌 board editor session (`app/SignEditor.tsx`): a sign is a
  pair of boards with a one-sided default, the preview never commits, confirming makes the pair
  current and the next sign hung carries a copy, covering the full compose→place→print flow — and a
  **wall** 指示牌 keeps its mount through an edit and is never given a back (the wall is its second
  face), while a wall board hung as the current one drops the back that pair carries.
* `sign-model.test.mjs` — the 指示牌 board document path (`sim/sign.ts` `buildSign`): one lit
  face per composed board with a default-front/empty-back fallback, one vs two mounted faces,
  and the shared panel sized to the longer board. The two mounts are measured off the geometry: a
  **wall** board mounts **正面 alone** as one lit face into the room (the back's own label never reaches
  the wall), carries **no rods** (five meshes fewer than the hung board) and stands its panel across the
  one wall course its backing rule asks from (`SIGN_WALL_PANEL_Z ± PANEL_MIN_H / 2`), with its body's back
  face on the wall plane and the same board width as the hung one. It is **cut to the face it mounts**, too:
  a back the document still carries cannot widen its steel or shift its plate (`mountedSignBoards`), where the
  hung board — the one that really mounts both — is cut to the longer of its two faces.
* `sign-render.test.mjs` — the 指示牌 board pixels (`render/signFace.ts` `drawSignPanel`): a
  fresh sign prints ink rather than black, per-face boards, the empty-face stand-in, panel-vs-
  plate size agreement, label row pitch and separation, every palette mark printing, the PNG
  pictograms square/white/clear, and the save round-trip. Two marks are **geometry, not art**, and both
  are pinned: the 出口/EXIT plate, and the red **禁止 roundel** — one ring drawn right round, whose strip
  the test reads back off the matrix-tracking context as a filled red path exactly one ring-thickness tall,
  level and centred on the ring (a strip at an angle is a prohibit-sign roundel, not the stop mark), with no
  bitmap and no wording of its own.
* `agent-route.test.mjs` — the 选择 tool's passenger preview (§9.5): `World.routeOf` names the walk still
  ahead (the line starts under the passenger and goes on to the node they are walking to, never back over
  ground already covered, every waypoint a graph node), it **stops at the train** — a line leg ends at the
  platform door the passenger is queuing for — a passenger who is not in the world has no route at all, and
  reading one changes nothing (a watched world and a control world stay identical, RNG included). The
  ribbon half is pinned as arithmetic: a flat route is one width across and a `ROUTE_LIFT` above the floor,
  a 45° run's ribbon lies **in the slope** rather than on a plane at its average height, a bend's joint quad
  covers both segment ends it joins, and the index buffer walks the quads in order so the draw range can
  pick the used part. And the scene half runs with no GPU (`CrowdSystem`): the ribbon and its destination
  ring are drawn for a real route and put away for a spent one, the ring and the line follow the passenger
  and go with the storey that hides them (隐藏UI being the exception), hiding the crowd takes the preview
  with it, and the pick answers with the passenger under the pointer — inside the radius, behind a nearer
  solid face (no), on a hidden storey (no), and the nearer of two bodies that overlap.

## The simulation's time base

GAME-SPEC §10.3 asks for 24 simulated hours in ~12 real minutes *and* a 5 Hz continuous
crowd. Those two cannot both hold: 12 min/day is 24 simulated seconds per 200 ms tick,
and 24 s of walking is 32 m — a crowd that teleports 32 m per tick cannot be separated,
queued or watched. PLAN §2.1's own benchmark steps agents at the 0.2 s tick.

This build keeps the crowd honest and runs the clock fast instead:

* **one simulated second per tick**,
* **1× is real time**: one tick per real second, so the crowd walks at true speed, the
  AM peak is ~90 real minutes, and a train every 150 s of sim time is every 150 real
  seconds,
* **fast-forward multiplies ticks per second, never the step size**, so §7.6 determinism
  is untouched.

`SIM_SECONDS_PER_TICK` in `src/sim/constants.ts` is the one number to change, and the
comment there explains the trade.

**The clock those seconds are read through is one derivation** (`src/sim/clock.ts`). The sim
counts seconds; a station lives on a calendar, so `stampAt(simTime)` lays day 0 on the
calendar's epoch — **2026-01-01** until the player picks another date — and derives the date,
the weekday and the day type (工作日 / 周六 / 周日 / 节假日) from it. A long run therefore crosses
midnight on its own: the date and the weekday walk forward while the crowd keeps its seconds,
and the day type walks with them, which is what makes a weekend visible in a long run. Every
readout prints that one stamp — the 信息栏's clock card (with the 高峰 / 平峰 / 夜间 chip and the
day bar), the status bar's 时间, and the 电视 plates' own departure clock — so three drawings of
the clock cannot disagree with each other or with the dispatcher, which asks the same `periodOf`
for its headway.

**The authored day is four fields of the station document**, all of them set in the floating
**客流** window (§9.6C, opened by pressing the clock card) and all of them carried in the
save beside the name and the seed:

| field | what it is | default |
|---|---|---|
| `service` | 营业时间, the span the station runs at all | 06:30–23:30 |
| `peaks` | 高峰时段, the two peak windows (早高峰 ends no later than 晚高峰 begins) | 07:30–09:00, 17:30–19:00 |
| `demand` | 客流曲线: 早高峰量, 晚高峰量, 波形陡峭度 | 1.0, 0.78, 1.0 |
| `calendar` | 日期类型: which date day 0 is, plus the 节假日 and 调休上班日 lists | 2026-01-01, the 2026 arrangement |

Each is repaired into range on load rather than refused — whole minutes, one day, `to` after
`from`, a knob inside its slider, a date that exists — so a hand-edited file still opens.
`periodOf` gates the service periods on the first two: outside the window the station is 夜间
whatever the timetable would otherwise be doing, **shut is checked before the peaks** (a station
that opens at 09:00 has no 08:00 peak to serve), and a peak window drawn outside the hours cannot
sneak service into them. Both shipped timing defaults are deliberately **behaviour-preserving** —
the hours they exclude were already 夜间 under the day's shoulders at 06:30 and 22:30, and the
default peaks are the windows that used to be hard-coded — so shipping them changed no crowd and
an old run replays.

**The calendar is the 2026 arrangement, and the day type is derived from it.**
`DEFAULT_CALENDAR` carries 国务院办公厅 国办发明电〔2025〕7号 — every 放假 date of 2026 as a holiday
and every 调休 上班 date as a work day (元旦 01-01…01-03 with 01-04 worked, 春节 02-15…02-23 with
02-14 and 02-28 worked, 清明节 04-04…04-06, 劳动节 05-01…05-05 with 05-09 worked, 端午节
06-19…06-21, 中秋节 09-25…09-27, 国庆节 10-01…10-07 with 09-20 and 10-10 worked). The 时刻 window
draws it a month at a time — **Monday first**, each cell already carrying its day type — and
pressing a date makes it **第 1 天** of the run, which is how the player chooses the day type
without a dropdown that could disagree with the date the clock prints. `monthGrid` is pure
arithmetic (whole weeks, leading `null`s, the head each date sits under) so a test can pin the
grid rather than a person having to look at it.

**The curve is one function with two readers** (`src/sim/demand.ts`). `World.spawnStreet` draws
its Poisson arrivals from `demandAt(hour, period, dayType, knobs)` and the 时刻 window plots
`demandSeries(…)` — the same function sampled — so a boundary dragged in the panel redraws the
picture *and* moves the crowd, and the two cannot describe different days. The curve is §7.4's
`λ = base × curve(timeOfDay) × calendar(dayOfYear)` split three ways:

```
shape(hour)     the double peak: the two heights and 波形陡峭度 (0.85 h wide at 100%),
× period       高峰 1.0 / 平峰 0.6 / 夜间 0.25, the timetable's own multiplier (§6.5),
× day type     工作日 1.0 / 周六 0.45 / 周日 0.35 / 节假日 1.15 — §7.4's calendar factor.
```

The **defaults are the pre-knob formula to the last bit** — `demand.test.mjs` compares
`demandShape` against the `0.06 + gauss(8, 0.85) + 0.78 × gauss(18, 1.05) + 0.18 ×
gauss(12.5, 2.2)` it replaced at every five simulated minutes, because that is the only proof
that shipping the knobs under a running simulation changed no crowd. A 节假日 is **above** a
weekday and a 调休上班日 is a weekday, both because the arrangement says so; the *shape* difference
§7.4 also asks for (a later, longer holiday peak) is still to come, and 活动日 rows are not
modelled at all.

**The six boundaries are draggable on the chart itself.** 营业时间's two ends and both peaks' are
grips in the drawing — a wide transparent hit box, the line it moves, a knob, and an
`aria-valuetext` of the time — moved by pointer or by the arrow keys. **早高峰 ends no later than
晚高峰 begins**: that is an invariant of the pair, held by `normalizePeaks` on the way in and by
the grips' own walls while they are dragged, so a morning peak cannot be dragged over the evening
one and a hand-edited save cannot load crossed. A drag writes a **draft** (the curve redraws under
the hand, and the two peaks' times print under the chart in the draft's own numbers) and commits on
release: one undo frame and one worker rebuild per gesture, not one per pixel. That is also why a
nudge is handed over as a nudge rather than as a drag plus a release — a key press is both in one
event, and state written in it is not in the commit's closure yet.

The speed group is **暂停 / 1× / 4× / 16× / 64×**. One tick is one simulated second at every
multiplier — only the real interval between ticks changes (`intervalMs`) — so 64× asks for a
tick every 15.6 ms and takes whatever rate the crowd's own tick cost allows; nothing is
skipped, and §7.6 determinism is untouched because the step size never moves.

The speed group is **暂停 / 1× / 4× / 16× / 64×**. One tick is one simulated second at every
multiplier — only the real interval between ticks changes (`intervalMs`) — so 64× asks for a
tick every 15.6 ms and takes whatever rate the crowd's own tick cost allows; nothing is
skipped, and §7.6 determinism is untouched because the step size never moves.

## Deliberate divergences from PLAN / GAME-SPEC

* **No react-three-fiber.** The scene is a plain three.js `SceneRenderer` driven by a
  React `Viewport` component. The renderer we judge at `/lab` is the renderer the game
  keeps either way; R3F would have added a reconciler between us and the chunk mesher.
* **Inner fillets are dropped.** PLAN R2's named fallback: the mesher never fillets a concave
  inner corner, and since the top-rim bevel went (below) it cuts nothing off a block at all.
* **A block is a cube: no top-rim chamfer, no rounded corner.** §4.2 asked for a **12.5 cm bevel
  on every top edge exposed to the air**, and in the same breath for rounded outer corners — which
  cannot coexist with it, since at a 12.5 cm radius the corner's inset collapses exactly where the
  bevel ends. Both are now **gone**: a block's rim is a square edge, its top face is the cell's own
  cross-section, and its walls run the whole way up to it. The bevel was the renderer's one hard
  case — its four 45° strips met at every convex corner in a facet that crossed its neighbours and
  stood proud of the lid, and a mitre ring plus a corner triangle per corner existed only to hide
  that — while a hard, axis-aligned edge is what a 1 m grid actually is. The station's softness
  comes from its finishes, its modules and its light. `test/floor-surface.test.mjs` reads the
  height of the drawn surface (flush seam, level floor, rim on the cell boundary) **and the
  direction of every drawn normal** (a cube has no leaning face, a chamfer has nothing else), which
  is the pin on the cut having gone.
* **A shared cell edge draws nothing.** A side a solid neighbour shares emits no wall, so two top
  faces meet flush and a run of blocks is one flat plane. Rounding and bevelling every cell edge
  whatever stood beside it — which is what the mesher did first — left a V-groove along every seam
  and a pit at every four-block corner, 12.5 cm deep and plainly visible from above.
* **The filling under a run is a closed body.** `rampFillKeys` derives the wedge between the
  ground and a truss's underside, and the mesher draws it as the run's own body. Two things
  had to be true for it to read as solid. A fill cell must **not** count as solid when its
  neighbours ask what is exposed — it is drawn, but it is not a cell the station holds — or
  the cell below believes a block stands on it, reports `up = false` and never draws a top
  face: the run came out as four walls with no lid, and the inside of the escalator showed
  through the gaps between them. And the top face's height is the **cell ceiling**, not the
  wall's own top: while the block wore a bevel the two differed by 12.5 cm, and reading the
  wall's height for the cap dropped the whole floor and opened a rim of
  missing surface right round every block. `test/floor-surface.test.mjs` reads the filling's
  height rather than counting its triangles, because only the height can tell a lid from none.
* **The day clock is real time at 1×, not 120×** (above).
* **The speed group runs to 64×.** §9's interface tables stop at `暂停 / 1× / 4× / 16×` in
  three places, and §7.9's fast-forward — "headless worker ticks with no rendering, a full
  day in a few seconds" — is not what this is: the crowd still draws at 64×, and the sim
  takes whatever rate its own tick cost allows (a tick every 15.6 ms is what 64× asks for).
* **The day is authored from a floating 客流 window, and its default window is 06:30–23:30.**
  §9.6C puts 营业时间, 高峰时段, 客流曲线 and 日期类型 in the bottom rail's 时刻 panel as a 05:30–24:00
  dual slider, a 24-point spline editor and a dropdown; the bottom rail has no 时刻 tab yet, so
  pressing the 信息栏's clock card opens a floating window with the same four inputs in its place
  — the six span boundaries **dragged on the curve itself** instead of sliders, three 客流曲线
  knobs, and the calendar, and the day lives in the station document (`StationData.service /
  peaks / demand / calendar`). The operating default differs from the spec's and is chosen to
  change nothing: every hour it excludes was already 夜间 service, and the shipped peaks are the
  windows that used to be hard-coded. A window that crosses midnight is not expressible —
  营业时间 is one span of one day here, as it is in the spec's own slider.
* **The day type is chosen by date, not by §9.6C's 日期类型 dropdown.** The demand carries the
  calendar coefficient the four day types name, but *which* day it is comes from the calendar —
  a real 2026 date list with the 国办发明电〔2025〕7号 holidays and 调休 work days — and the player
  picks it by pressing a date in the 时刻 window's calendar (that date becomes 第 1 天). A dropdown
  that overrode the date would leave the clock's own date and weekday disagreeing with the crowd
  they describe. The 节假日 and 调休上班日 lists are shipped data rather than editable rows, and
  §9.6C's 活动日 (an event day with its own multiplier) is not modelled at all.
* **Zones, surfaces, save/load, settings, charts and the module catalogue beyond
  escalator / gate / TVM / bench / exit are out of scope**, exactly as PLAN §7 lists.
* **One line.** Transfers therefore resolve to an exit; §7.5 is not exercised.
* **No named levels.** GAME-SPEC §4.3 defines a `levels` list of
  `{ id, z, kind, height }` bands. The game dropped it: the street is simply `z = 0`
  (`GROUND_Z`), and the renderer derives each storey from the fixed 4 m editing grid
  (`LEVEL_STEPS` in `sim/constants.ts`) — every solid cell belongs to the grid line at or
  below it (`storeyBand`). A floor slab and the 4 m walls on it share a storey; a second
  floor one storey down keeps its own, even when the lower floor's wall column reaches the
  floor above, so two stacked floors never merge into a single band. A plate with nothing
  below it stays on screen when the active level drops beneath it. A new station can
  therefore be dug below 0 immediately, with no B1/B2 declaration, and the save no longer
  carries a `levels` field (old saves load with it ignored).

## Measured

On this machine (Node 24, desktop):

| Measure | Value | Budget |
|---|---|---|
| Crowd, p99 worker tick | 2.2 ms at 3,257 agents | < 8 ms comfort, 200 ms hard |
| Crowd, mean worker tick | 0.9 ms | — |
| Wayfinding pass (`priceCongestion`), added per tick | 0.12 ms at ~1,000 agents on the 动物园 demo (that run's p99 worker tick: 4.1 ms) | inside the crowd budget |
| Chunk mesh build, before B1 | ~3.7 ms warm, ~5 ms on the very first chunk (JIT) | < 4 ms |
| Chunk mesh build, per-face finishes (B1) | **1.9 ms** for a one-layer station floor chunk, 2.7 ms for two, 4.4 ms for a fully solid 8-layer block | < 4 ms |
| Frame | 60 fps in a windowed GPU; the headless software rasteriser used for
  CI screenshots is the limit there, not the scene | 16.6 ms |

B1's per-face materials make the mesher sort faces into one part per finish. A real station
chunk is a thin floor slab and stays well inside the budget (1.9 ms); the figure that misses
is a *fully solid* 16×16×8 block, which is geometry-bound rather than finish-bound and was
near the line before B1 too. PLAN R2's fallback if that ever got worse was to drop the rounded
vertical corners and keep the top bevels only — and both have since gone for reasons of their
own: a block is a cube now (GAME-SPEC §4.2, and the divergence note above). That takes the
chamfer ring and the per-corner triangle out of every mesh, so this budget is easier to hit
than the figures above were measured against, not harder.

## Deploy

```bash
npm run build
npx wrangler deploy -c wrangler.jsonc
```

From the repository root, `npm run deploy:game` does both steps and also attaches the routes.

`wrangler.jsonc` serves the game from the path prefix `https://ericpzh.rest/metro-game/` via
[`worker/index.js`](worker/index.js), so the website's 游戏 tab can embed it same-origin. The two
routes `ericpzh.rest/metro-game` and `ericpzh.rest/metro-game/*` are declared under `routes` in the
same file, so `wrangler deploy` creates them — there is no dashboard step. Two routes, not one: the
bare path needs its own. The Worker's own `workers.dev` root keeps working at the same time.

Two notes:

* `wrangler` warns that the routes "will attempt to serve Assets on a configured path" (it looks for
  `dist/metro-game/*`). Nothing lives there, so those requests fall through to the Worker, which
  strips the prefix and reads from the asset root. The warning is cosmetic.
* This Worker has its **own** Workers Builds project (`metro-game`), connected to `ericpzh/metro`.
  A push to `main` runs `npm run build:game` and then `npx wrangler deploy -c game/wrangler.jsonc`,
  so the game ships on every push the same way the site does. You can still deploy it by hand with
  `npm run deploy:game`.

To host it at the `workers.dev` root only, delete `main`, the `assets.binding`, the `routes` and the
`ASSET_PREFIX` var, and set `assets.not_found_handling` back to `"single-page-application"`. The
build needs no change either way.

If the site's tab should point somewhere else — a preview URL, a different domain — set
`VITE_GAME_URL` when building `web/`.


Above-ground equipment: `overground.test.mjs` pins slim/thick support dimensions and 4 m extensions, slim-pillar R cycling through nine offsets shared by the model and collision envelope, the 1×1 m thin roof and two raised truss styles in 4/8/12 m widths, full-height collision bounds, and material painting of roof cladding while the supporting truss stays steel in 单块 / 整面 mode, doorway exits aligned to the near block edge in all rotations, in three widths at any supported height ≥ 0 m (with preview/release agreement and graph registration), bridge connections in both directions and all rotations, support attachment, and save/load preservation. Roof and pillar variants sit below the triangular blocks in 工具; doorway exits live under 设备; 轨道桥 lives under 轨道 and extends an existing rail without platform doors or a tunnel shell. Thin roof tiles place by click or rectangular drag, truss bays by click or a straight-line drag along their own crest axis, and both are painted through 材质.

细支柱 and 粗支柱 each have one palette tile. Tab switches the section added by a click between 2 m（短） and 4 m（长）; clicking a pillar adds that selected length while retaining its width, position and finish, so 2 m → 4 m → 2 m becomes one continuous 8 m pillar. Existing pillar saves keep their heights.

`roof-tool.test.mjs` verifies rectangular thin-roof previews, truss-bay placement and removal as a straight run along the crest axis (a sideways wander never staggers it, backwards and right-drag removal included) including rotated 8 m bays, collision refusal, and one undo step per drag. Each truss style has one tile; Tab or its action tile cycles 窄 4 m / 中 8 m / 宽 12 m and redraws the hover.

Roof placement centres the roof footprint on the mouse, snapping to the block grid for plain roofs and both truss styles. The pointer ray targets the roof's top height rather than the floor below, so elevated previews stay under the cursor in perspective and orthographic views. Click and drag release use the same centred anchor; rotation and width changes keep the centre in place. `roof-tool.test.mjs` checks centring, preview/release agreement and roof-height ray projection. Removal continues to target the existing roof footprint.

Small stair blocks: 楼梯块 under 楼梯 has a 1×1 m footprint and no railings. Tab switches 高 (1 m, four treads) / 矮 (0.5 m, two treads), with a live placement preview; the palette preview is turned 90° counter-clockwise. Click or rectangular drag places independent tiles on floor, R rotates them, and 材质 paints the whole stepped surface. The high block connects adjacent lower/upper floors without carving blocks; the short building piece does not create a full-metre walking connection on the whole-metre floor grid. `overground.test.mjs` pins dimensions, painting, collisions, floor preservation, save/load and both walking directions; `roof-tool.test.mjs` pins drag, rotation, undo and removal.

Bridges use a solid one-metre concrete deck beneath the track bed, with no coplanar edge girders. They generate one thick centre pier per complete eight-metre bay (four-metre bridges have no generated pier), standing on the highest available floor below the deck; existing supporting pillars are reused and bridge-owned piers are removed with their bridge. Older saves gain missing supports on load. B can remove each generated pier independently; the bridge records that deletion so edits and reloads do not regenerate it, while undo restores it. New bridges must keep their entire deck at or above the street surface. 材质 paints the concrete deck independently of the rails, sleepers, power equipment and edge barriers. The 轨道桥 panel uses one tile to cycle 栏杆 → 半高声屏障 → 全高声屏障 for new and selected bridges; sound barriers rise 1.5 / 3 m above the bed, with opaque lower panels and a clear upper band. `overground.test.mjs` checks deck geometry, support spacing and ownership, collision refusal, independent deck paint, barrier bounds and save/load; `pick-tool.test.mjs` checks copying and cancelling the bridge settings.

Truss roof finishes: both roof styles use neutral white vertex colours and metre-scaled UVs on cladding and beams, so 材质 painting renders the selected finish on the roof sheets instead of black. Beams and braces keep the shared steel material. Both assemblies are exactly 4 m tall including the roof skin, above the 4 m support posts. Their 40 cm bottom chords and upper purlins span the full bay so dragged neighbours join at the shared edge. 收束 uses mirrored alternate internal ribs and longitudinal diagonals at half the original density, retaining both outer edges, centre supports and end ties around its single heavy central chord. `overground.test.mjs` checks mesh finishes, exact height, support contact and connections across all three widths and four rotations.

`structures-gaps.test.mjs` pins the repair-shaped edges the feature suites use but never assert: `normalizeLevelBase` clamping/rounding, the roof width cycle/clamp/labels and ridge formula, the three ways a pillar refuses a bridge, and the roof-paint no-ops.

Roof visibility: 隐藏天花板 leaves actual roof modules visible. 隐藏屋顶 is a separate view toggle, off by default, hiding all roof styles even in 隐藏UI / 剖切. It sits below 隐藏天花板 with 分区图 to its right. `ground-visibility.test.mjs` pins independent ceiling/roof visibility; `rail-folders.test.mjs` pins the nine-tile order and header count.

Ceiling lights: 装饰 → 灯具 offers 圆形 and 直条 fittings attached flush to the ceiling slab. Tab cycles rectangular light positions; R toggles their 0°/90° orientation. Thin pillars cycle positions with R. Both position cycles run through centre, top-left, top-middle, top-right, middle-left, middle-right, bottom-left, bottom-middle and bottom-right. Each fitting remains inside its tile. `lights.test.mjs` checks ceiling contact, drawn/collision bounds, position order, ceiling support, structural clashes, ghost refresh and save/load.

Ceiling vent: 装饰 → 通风口 is a separate square metal grille with recessed dark backing. It sits flush against the ceiling and R turns the blade direction. `vent.test.mjs` checks its tile, ceiling support, model/collision agreement, separated backing and blades, furniture clearance, structural collisions, movement, sweep and save/load.

Floor equipment and vinyl: the final two 装饰 tiles are stainless-steel 空调风机, a 3×2 m industrial central AC unit with twin top fans,
coil grilles and service panels; 设备柜 is a 3×1 m electrical switchboard with meters, breakers,
status lamps and red fascia. Both stand on floors, rotate with R, move and block pedestrian access
through their footprint. 装饰 → 盲道 offers 条形导向 and 圆点提示: thin yellow strips laid by click or
straight line drag, with the guide ribs following the drag axis. Right drag or 删除 removes a run of
the pressed variant; each release is one undo step and preserves the floor. 圆点提示 automatically
connects to adjoining strips, forming L, T and cross junctions. 盲道 and 地面指示 sit immediately
below the 座椅 / 站名 row. The station-name previews have light backings for legibility. 地面指示 offers
屏蔽门箭头, 排队等候线 and 方向指引, printed flush on the floor and rotatable with R. Boarding strips
are 0.25 m deep and snap their green central arrow to train-aligned screen-door openings on the
same floor within 1.5 m, facing the track. Direction decals carry a saved line binding; the line
tiles below the tool choose it, and its current name and colour print live. They can share a
screen-door strip, remain walkable and retain their variant, binding and alignment in saves.
Waiting lines first snap behind nearby boarding ink (within 2.5 m), otherwise to a screen-door
opening using the same alignment; their front edge leaves a 2.5 cm gap behind the boarding strip.
Direction arrow ink fills its whole 1×2 m decal. Tactile right-drag erasure starts on movement,
survives the browser context-menu event, and remains one undo step. Bench widths are 窄 (1 m)
and 宽 (2 m), toggled by Tab or the width tile while preserving the steel/backrest style.
All width action tiles use `RiExpandWidthFill`; height and length controls keep their own icons.


装饰新增地面街道设施（仅限 z ≥ 0，需完整实心地板，可旋转、吸取、移动和保存）：
- **导向柱**：1×1 米占地、4 米高的红色三棱地铁柱，底面尖角为 30°；红柱截面另缩小 25%，黄色楔体保持原有尺寸，高度不变；黄色标识段为水平金字塔形楔体，与红柱朝向一致；后底面靠近红柱并略内凹，尖端在中高处向前突出，上下边斜收，侧视也为三角形；红柱中段保留前端填充，后边裁到黄色底面，去除后方红色条带，两侧标记使用各自正确的阅读方向，三个面都印“广州地铁”标记。文字与图标自上而下为竖排站名、广州地铁、出口字母、蓝色轨道图标，全部集中在柱体上半段；站名字号按字符数放大或缩小，以填满顶部面板。旋转旁的小出入口按钮选择绑定的出口；站名与出口改名实时重印，出口标识省略“口”后缀（例如 B口 → B），出口删除后显示“入口”。
- **公交站**：绿色候车棚，短版 4×2 米、长版 8×2 米，3 米高；带线路信息板、座椅和广告灯箱。复用现有广告素材，长版两个灯箱共用同一张固定海报；作为装饰，不增加公交模拟。

The TV's passenger information now follows `World.trainServices()` (§6.5), including the
next dispatch, the current train's approach/dwell/departure phase, and headway period changes.
Headways are seconds; the three cards round remaining seconds up to minutes. Each TV selects
its nearest track and that track's direction/terminus. The blue layout keeps a full-width
service strip and simulation date/clock below the video; it refreshes from each worker frame
and only uploads a texture when its printed information changes.

`hanger.test.mjs` covers 挂架: roof suspended and central post supports in 4/6/8m, roof attachments, sign/clock/TV mounting, rotated steel geometry, open walking space, post footing, preview identity and save/load.

装饰 → 挂架只有吊装与立柱两个变体。选中后用动作栏的旋转和短／中／长（4m／6m／8m）设置横杆；吊装两端连接屋顶或顶板，立柱款在横杆中央落一根钢柱至地面。指示牌、时钟、电视、监控可挂在横杆下，指示牌与电视的方向须沿横杆，且两根吊杆都在横杆范围内。
