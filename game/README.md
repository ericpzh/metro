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
    stock.ts         A/B/C/L car classification
    finishes.ts      surface finishes: the family decides behaviour, §4.3
    zones.ts         fare zones: the boundary is a barrier, §4.5
    worker.ts        the only file that touches postMessage
  render/    three.js: chunk mesher, procedural materials, module models, outline, shadows, agents
  build/     station document, cell commands, paint, undo
  persistence/ save schema (serialise / parse / migrate *.metro.json)
  app/       React shell: HUD, rails, inspector. Panels only, no sim logic
  data/      the demo station (the 动物园 save) and the art palette
test/        node --test suite (imports src/sim/*.ts directly)
bench/       crowd-tick benchmark
```

Dependency direction is one-way: `app/ → render/ → sim/`, and `sim/` imports nothing.

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
finish, the walk-speed rule, the `N`/`M`/`I` paint tools, the tactile-strip decal layer along
platform edges, and `persistence/save.ts` (`formatVersion: 1`, static). The mesher's cell-key
packing was also fixed — the old bit-shift `key()` collided neighbouring cells, which would have
made finish lookups wrong. 搪瓷板 gained a custom colour: the 材质 brush packs it into the finish
id (`wall.enamel#rrggbb`), so a painted panel keeps its own colour through the save and the
mesher gives each tint its own part and material. The brush also keeps its `N` 单块 / `M` 整面
mode: the mode is a setting of the 材质 folder, not of a tile, so picking a texture (or a fresh
搪瓷板 colour) leaves it alone and `I` 取色 hands the brush back in the mode it borrowed.

**B2's core** shipped `sim/zones.ts`, `Cell.zone`, a graph rule that emits no walk edge across a
zone line except through a gate cell, a zone drag-paint tool (a rectangle of the chosen zone over
the floor it covers), the `分区` overlay (a tint on the walkable floor plus a text label naming each
area), and an inspector zone control. Still open in B2: zone inference (a room enclosed by gates
proposed `paid`), module zone-legality feedback for ticket machines, and the gate direction UI —
the 闸机's **piece** (a working lane, or the fence machine that closes a 围栏 run, toggled with Tab;
its hand is a rotation, `R`) has landed, but its in / out / both policy and queue anchor are still
fixed.

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
out of 设备), 货架 (a stocked supermarket gondola), 办公桌 (the office desk + monitor + chair unit),
厕所隔间 (the restroom cubicle) and 洗手池 (the wash basin) are all free-standing, rotatable pieces,
and 广告牌, 电视 and 指示牌 all live under 装饰 in the build rail. 广告牌 is *wall-mounted*:
`sim/placement.ts`'s `wallMountMissing` refuses it unless the facing neighbour has a solid block at
its first course (`z + 1`), which is exactly where the 地基 auto-wall ring and the 墙 tool both start.
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

**A 电视 is a passenger-information screen, not a poster.** Its lit face is two panes: the station
board down the left — line shield, 本趟 / 下趟 / 第三趟列车开往, the countdown and the departure clock —
and a **content window** on the right where the network feed plays. `render/stationDisplay.ts` owns
both the derivation ("what is the next train, and how long until it") and the pixels of the board.

**The two panes tile the screen, with zero slack.** `TV_POSTER_RECT.x` is the split: the board column
runs from the plate's left inset **to that split**, and the window takes **everything right of it, at
full height** — so the artwork covers its whole half of the panel and no black strip survives above,
below or beside it. The insets that keep text off the edge live *inside* the cards, never on the
column's right, because slack there is dead black between the text and the picture. `stationDisplayLayout`
separates this arithmetic from the drawing so a test can prove it without a canvas: the column's right
edge *is* the window's left edge (`x + w === 1`), the text never runs under the window, and the clock
belongs to the column rather than to a plate corner the artwork would paint over. Only the window
cycles (`SceneRenderer.updateAdScreens`), on a period rolled per screen, so a row of them drifts apart
instead of flipping as one wall, and it draws only artwork cut for a landscape panel — cropping is not
stretching, and a portrait poster in a wide window would lose more than half its height.

**A 电视 reads from one side.** Its board and its window ride the same single face (the local −y), so
the panel is legible from one side and shows a plain dark back from the other — which is what the back
of a television looks like. This is a modelling constraint, not a taste: each lit pane is a plane lying
over a dark backing slab, and a pane on the slab's centre line is buried in it while a pane on the
slab's surface z-fights it. Either way the window renders as a flat black rectangle with nothing in the
console, which is why `LIT_STAND_OFF` puts every lit pane half a slab out *plus* a stand-off and why
`test/tv-screen.test.mjs` pins the depth — and the tiling — rather than leaving either to a visual
check. 指示牌 is
*ceiling-hung* like the 电视: `ceilingMountMissing` refuses either unless a solid slab sits one storey
up (`LEVEL_STEPS`, the 4 m grid), and `render/models.ts` hangs each from that slab by two rods. The
指示牌 keeps its two double-sided faces — a wayfinding board genuinely reads both ways, where a
screen does not.

**A 指示牌 is a composed board, not a printed sticker.** §5.8's custom signage is what the overhead
board *is*: `sim/sign.ts` holds its layout — an ordered list of **components**, each an arrow, the
station's own line shield, typed text or a pictogram, placed in **metres along one row** — and
`render/signFace.ts` is the only code that draws it. The lit face on the drawn model, the hover ghost,
the build rail's palette icon and the board editor all call `drawSignPanel`, so what the player
composes is the board they build, pixel for pixel; the face is drawn at a constant `PX_PER_METRE`,
which is why a 0.42 m line badge measures the same on the model as it does in the editor.

**The board is one row, and it is as long as its content.** `signPanelSize` measures the row —
`max(floor, the last mark's right edge + a quiet margin)`, clamped to `PANEL_MAX_W` — and the drawn
panel, its mesh and its texture all follow it. The height is fixed at `PANEL_MIN_H` (0.7 m): content
never flows up and down the face, because a 指示牌 is a list read left to right, and `signCentreRange`
pins every `y` to the row's centre line so that is structural rather than a habit. Positions are
metres rather than fractions of the board for exactly this reason — a board that grows must not slide
its content sideways.

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
row's type (中文 at `SIGN_SIZE.text.h`, the gloss at `SIGN_TEXT_EN_SCALE` of it). Taking the stack's
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
plate — which is why a tile carries no lettering at all, and its name is its tooltip. The tiles wear the
build rail's own blueprint square (`bpBlock`'s flat navy, dashed technical inner frame and square
corners), so a group, a palette option, a place on the board and a block in the left rail are one object
in four places.

**One gesture, and every tile in the palette has it**: a mark is dragged from the palette **into a
bin**, or from one bin into another, and the row makes room under the pointer while it hovers, so the
drop is never a surprise. Letting go off the row changes nothing. **Nothing in the palette is unique**:
a tile arms a drag whatever the board already holds, and what it lays down is another of its kind — a
second arrow, a second 出口, a second label, the same pictogram twice — so `markFor` asks the board
nothing. The board's one refusal is its own ten places (`SIGN_COMPONENT_MAX`), asked before a tile is
even armed (`full`), which costs a tile the press rather than the drag. A press that never moves is a
click, and now that no mark is unrepeatable a click can only mean *select*: the one click that does
real work is the 文字 tile's, which picks the focused board's label so the boxes have something to
edit (`pickExisting`); a 线路 tile **adds** a shield after the selection instead, because a shield has
no boxes to point anywhere.

**A board repeats whatever it likes, until it is full.** Nothing counts marks by kind: the same
5号线 shield may stand on a sign as many times as it fits — a station with ten platforms is one board,
not ten — the arrow family carries no rule at all, which is how a row gets an arrow at each end, and the
pictograms and the text box are as repeatable as the rest. What stops it is the panel's own ceiling
(`PANEL_MAX_W`, 3.4 m), and **full is measured, not counted**: `signMarkFits` lays the row out with the
mark on it and asks whether `packSignRow` had to put it on top of something already there. So the count
depends on which marks they are — **six arrows** fill a board (3.24 m of ink and the pad between them),
nine pictograms or seven shields come close, and a board of arrows takes no seventh. This is what the
palette obeys (`noRoom` in `SignEditor.tsx`), and it is why the ceiling is a design knob rather than a
bug: past it the pack folds the last marks onto one place, which the print draws as two marks stacked
where the row of bins showed two separate ones.

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
the whole catalogue — 列车, 电梯, 无障碍, 卫生间, 扶梯, 楼梯 and the 出口 plate — and every one but 出口
is a PNG in `game/src/assets/pictograms/` that `render/pictograms.ts` decodes and hands to
`render/signFace.ts` through the registry on that module (`setPictograms`). `tools/prep-sign-icons.py`
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
座椅 is the same kind of nested sub-menu: two families —
a plain stainless bench with no back and an upholstered seat with a back and arm rests that chains
into a row — each 1 m or 2 m wide, from the shared `sim/benches.ts` table. A 2 m bench is a real
two-cell run: its `w` fixes the collision envelope and its base cells (`benchCells`), the renderer
draws the whole run from the run's centre, and a legacy bench with neither `w` nor a variant is the
1 m stainless piece. Room furniture (shelf / desk / cubicle / sink / bench) may
stand inside a walled room or booth (`placementBlocked` exempts the furniture ↔ room pair, and
`moduleAt` prefers the furniture over the room around it). A store stocks one `shelf` module per layout
spot (`storeShelfSpots`: island rows plus wall runs), each wall unit turned so its perforated back
panel faces the wall and its stocked front faces the room, an office one `desk` per grid spot
(`officeDeskSpots`), a restroom one `cubicle` per back-row cell and one `sink` per front-row cell
(`restroomSpots`), and a booth one `bench` per back-row cell (`boothBenchSpots`), so every auto unit is
individually right-clickable; bulldozing the room takes its auto (`cfg.auto`) furniture but leaves
hand-placed pieces, and rooms drawn before this carry a `cfg.stocked` migration
(`ensureRoomFurniture`, via `toState`) instead of drawn units.

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
one floating on a hidden floor — and the cutaway clip applies to it too, so people no longer show
through a slab. A consist is tagged with the storey its floor block is in (`storeyBand` of the rounded
track surface), so a train berthed at the platform disappears with the platform and never hangs in the
air above it. The nav cube only ever moves the camera: no face, corner or **Home** click rewrites the
slice behind the player's back.

**The clock pauses and restarts.** **Space** toggles play/pause (the top bar's 暂停 / 播放 button does
the same), and 重启 empties the crowd, trains and queues while keeping the built station and the clock
(`World.restart`, sent as a `restart` worker message).

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

**Escalators are staircases, and they turn over.** `models.ts` builds each run as a band of
instanced steps whose treads stay world-horizontal (riser, then the yellow nosing along the
leading edge), so the incline reads as a staircase rather than a smooth ramp. `rollEscalator`
slides the band up the run every frame at `ESCALATOR_SPEED`, wrapping it at the comb plates and
driven by the sim clock (`stateIntervalMs`) so fast-forward turns the steps faster, not the crowd.

**Stairs are real steps, and the turn is walked.** The catalogue carries four staircase shapes —
straight, right-hand and left-hand 90°, and a 180° switchback — each climbing exactly one storey
like an escalator, but walked both ways. `models.ts` builds each flight as level treads with a riser
under every leading edge (never a ramp with grooves), and wears the **floor finish of its lower
landing**, so a granite hall gets a granite staircase instead of a steel one. `sim/stairs.ts` exposes
a stair's ordered flights; the graph gives every flight its own two-way capacity edge, and the
half/quarter landing between them is a real walkable node and a stair-width platform in the same
surface and slab thickness as the treads, wrapped by a balustrade that carries the flight handrails
around the turn — the block mesher skips those cells, so a landing is never a floating 1 m cube. The
**楼梯** group has four buttons, one per shape (straight, left 90°, right 90°, 180° switchback),
each placed as fixed-length equipment: its base sits on the hovered floor cell, the finished stair
previews as a translucent ghost, and **R** turns the run; **Tab** cycles its width between **one, two
and three lanes** — 0.7 / 1.4 / 2.0 m, each lane exactly one escalator band, so a wide stair is
literally that many narrow flights side by side and every lane merges with the run next to it (see
the lane rule below). Every side of a flight carries a stringer
and a handrail, and each handrail **levels off at its landing and turns down into a newel post on the
floor** — a quarter turn, so a stair rail wraps round and reaches the ground instead of stopping dead
above the last tread (the same idiom the escalator's balustrade return uses). A turning stair also
lays its half-landing
as a walkable cell, so the two
flights connect. The Wusi Square test rig keeps a single pre-placed stair — the straight run
that replaces exit A's down escalator; `carveRampOpenings`
opens the slab each flight climbs through while keeping every landing, so each stairwell is a real
hole in the ground.

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
A **turning** stair is one piece at the chosen width (its flights turn, so its landings cannot be
shared lane by lane): at 2 or 3 lanes it is wider than a cell and needs a bay of its own, exactly as
before. A station saved with an old single-piece 1.6 m stair keeps it as it is — one wide flight with
its own bay — so only newly placed straight stairs are mergeable.

**A run fits inside one tile, so runs stand flush and neighbours are buildable.** `ESCALATOR_BAND`
(0.68 m) is the escalator's clear step band, `ESCALATOR_BALUSTRADE` (0.82 m) is the spacing of its
balustrades, and the handrail's outer face lands at 0.49 m — inside the cell. The narrow stair is
built to exactly that band, so the two are the same width, and its handrail reaches 0.445 m: both
pieces fit one 1 m tile with the whole assembly, rails included, and neither ever crosses its cell
edge. Two runs in adjacent cells therefore simply sit side by side, each keeping **both of its own
balustrades** — the pair reads as a bank of two rails on the boundary, and no rail has to be dropped,
shared or owned (`test/bay.test.mjs` measures the drawn models to prove it). (The one case where a
boundary carries no rail is two lanes of the *same* stair flight, which are one staircase — see the
lane rule above.) It also means a wall, a
fence or a gate can be built right up against a run: `rampEnvelope` reserves exactly the tile the run
stands in, so the boxes of two adjacent runs *touch* and the ordinary strict-overlap rule already
allows the bank, with no exemption to maintain. A single piece wider than a cell is the exception that
proves the rule — an old 1.6 m stair, or a 2–3 lane turning stair — because its body genuinely crosses
into the next cell, so it needs a bay of its own and still collides. A run in the same column one
storey down still stacks and is still refused.

**Escalators are placed the same way.** The **扶梯** button drops a fixed one-storey escalator: its
base sits on the hovered floor cell, it rises `ESCALATOR_RUN` cells along the placement rotation, and
the finished run previews as a translucent ghost; **R** turns it and **Tab** flips its travel
direction between up and down. The placement ghost carries a bright arrow over the run pointing the
way it will carry people. Direction only orders `from`/`to` — the single one-way edge the sim reads —
so an up and a down piece share one footprint, and two runs may stand flush in adjacent tiles (the
tile rule above). The
one piece lives in `sim/escalators.ts`, and the Wusi Square test rig builds its pre-placed runs from
that exact constructor too, so the rig and the builder place the same equipment at the same
dimensions. Its handrail wraps the end of the glass at both landings — a half-turn round the end and
down onto the floor — and a flat newel plate closes the foot of each balustrade, so no rail stops
dead in mid-air.

**Ramps carve their way in.** `sim/openings.ts` (`carveRampOpenings`) removes the solid cells an
escalator, stair or lift climbs through, so a placed ramp surfaces from an opening rather than
through the slab; the landing cells are protected because the graph uses them as the ramp's nodes.
Only the run's **centreline cells** are carved (`RAMP_CORE_HALF`), so `rampOpeningAt` reserves just
the true opening and the floor beside a run is not deleted — it stays buildable. A block a ramp has
kept is marked by `rampThinCells`, so `SceneRenderer` hides the full voxel and draws a **half-metre
block** on the side away from the run, leaving the near half clear for the body and handrail (the
same hide-and-block trick a facility room uses). That is now only ever a piece wider than a cell: a
narrow stair or an escalator sweeps 0.445 / 0.49 m, so nothing beside it is reached at all, while a
**floor** is still thinned when a wide stair's 1.6 m body reaches into the
column beside it — which closes the hole the carve used to leave at the top of the stair — and a wall
a wide stair's handrail touches is thinned the same way. The 动物园
demo save carries the same carved openings, so it no longer shows escalators punching through the
concourse floor. An escalator is single-direction and carries **one passenger per step**
at 0.5 m/s over a 0.4 m pitch — 75/min, and exactly one rider per step on the run.

**Elevators are a 2 × 2 m shaft with one car.** The **电梯** button drops a base
module on the hovered floor: a 2 × 2 m assembly with a 1.5 × 1.5 m carriage
inside its walls (`sim/lifts.ts`, `LIFT_RISE = 4`) that serves the floor one
storey up and stands on all four of its floor cells. The *model* is taller than
the ride: it runs on up to the slab above its top landing, so a piece on the
platform (−8 m) serves −8 m and −4 m and tops out at the concourse ceiling
(0 m), never poking through the street. The player grows it a storey at a time — hovering
the shaft's upper half extends it up, the lower half down (`LIFT_EXTEND = 4`).
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
clamps a dropped run to the group, so the runs can only ever be side by side. A station saved on the
old two-metre bays (`exitRunColumns`) is still found: the house widens to cover where its runs really
are instead of letting them poke through the glass. The head-house
floor is a thin plate over the whole plan — it opens
only along a column a run actually descends through (`exitRunOpenings`), not that run's top-landing
row, so the plaza floor never shows through the block and the pad is never cut a row short. The
interior dividers follow the runs the same way: the head-house rails a slot between two runs
with an empty block between them (only reachable in a station saved on the old bays), and leaves runs
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
rooms, rails, 出入口, 楼梯 / 扶梯 / 电梯 and 站台门 are never swept — each is one structure with its own
teardown. See `test/sweep.test.mjs`.

**No ramps stacked.** A ramp also has a collision envelope (`rampEnvelope` / `rampBlocked`): the tile
its run stands in, dropped the truss depth below the lower landing and raised the balustrade height
above the upper one — for a single piece wider than a cell (an old 1.6 m stair) widened to its tread
width. A run
in a column another run already occupies is refused, so a second escalator can never be dropped
immediately below a first, while a run in the next column over is free ground: the two envelopes
touch, which is not an overlap.

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

A hole dug through the middle stays open rather than getting
boarded up. The platform/tunnel footprint is covered ground too: a placed rail digs its bed, so the
merge folds that footprint into the surface — the ring wraps the whole patch-plus-track area, the
drag never pours a block into the trench, and no auto wall rises through a platform screen door a
full track sliced through the patch. Single clicks
and stacked blocks stay plain, and the drag's live ghost shows the wall ring before release. The
地基 tool carries a **自动生成墙壁** toggle (on by default) in the 工具 folder — **Tab** flips it
while the 地基 tool is active: turn it off and the
same drag lays the patch as untagged bare blocks, with no ring. See
`test/walls.test.mjs`.

**Fences divide areas with gates.** The 设备 folder's 围栏 (§5.2) is a 1 m high, very thin
metal frame around a glass panel standing through the middle of its block. A single click drops
one panel turned with **R**; press-and-drag lays a straight run like the 墙 tool with the panels
following the drag direction, and right-drag lifts the run back out. The 删除 tool drags the same
straight line: press a panel, drag along the run, and release to lift every panel on it at once (a
tap still removes just the one under the pointer). The run previews as real
translucent fence models while you drag. Every panel is built from its neighbours
(`sim/fences.ts`), so a straight run is continuous, a dead end caps itself with an end post, and
an L, T or + junction turns through the shared centre post with no overhang — dragging a new
segment up to an existing end regenerates that end on the spot, dropping its old cap and post.
A run plugs straight into a 闸机 row, and it also joins a stair or escalator: `railLandingAt` makes a
fence next to a run's landing drop its end cap and butt up to the handrail instead of stopping short.
That connection needs no collision exemption: a run reserves just its own tile, so the cell beside it
is free ground and the fence's own thin box never meets the run's. The sim treats a fence cell as not
walkable, so the run
plus its gates is a barrier the crowd only crosses at a gate — paint different zones each side and the
fare line holds. See `test/fence.test.mjs`.

`test/` holds the acceptance tests. Run them with `npm test`:

Two of the drawn faces can be rendered to a PNG outside the browser, for looking at rather than
asserting: `node ../tools/render-tv-plate.mjs out.png` prints a 电视 station plate, and
`node ../tools/render-sign-panel.mjs out.png` prints 指示牌 panels — a fresh board at the floor, one
grown taller, one grown wider, and the whole catalogue on one board. Both drive the shipping draw
functions through a recording 2D context, so the picture is the real output (only text width is
approximated); neither needs WebGL.

* `determinism.test.mjs` — same seed + tick ⇒ byte-identical positions, and no unseeded
  randomness anywhere in `sim/`.
* `demo.test.mjs` — the shipped demo (动物园, Line 5) is one connected circulation: every exit
  reaches every platform and screen door and back, and a run actually boards and clears a crowd.
  Its controlled rig lives in `test/support/scenario-station.ts` for the other sim tests.
* `capacity.test.mjs` — the §7.8 capacity ladder as a comparison: one platform escalator
  jams, three fix it; a saturated platform leaves people behind.
* `layering.test.mjs` — `sim/` imports nothing and touches no DOM; `render/` never reaches
  up into `app/`; `build/` imports neither.
* `surfaces.test.mjs` — a slow floor finish is a real detour, a track bed is not a walkable
  node, paint/fill/erase are immutable, and the mesher groups by finish (B1); 搪瓷板 takes a
  custom tint encoded in its finish id without changing the wall family, and the mesher keeps
  two tints in separate parts.
* `save.test.mjs` — the `metro-save` v1 envelope round-trips the static station and names
  every failure mode (B1); a legacy line with no direction termini loads with empty ones.
* `load.test.mjs` — loading a station is a full sim reset: `World.load` clears the crowd,
  trains, server queues, clock and throughput counters and reseeds the RNG, while the edit path
  `rebuild` keeps the crowd in place; `World.restart` empties the crowd and trains but keeps the
  station document and the clock.
* `zones.test.mjs` — an ungated fare line strands the crowd (zero boardings); a gate restores
  flow; the graph has no edge across the line; the zone bucket respects a drawn boundary (B2).
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
  brush refuses a cell reserved by a ramp opening or an exit's floor (`reservedOpening`). The
  装饰 广告牌 is wall-mounted: `wallMountMissing` refuses it without a solid wall block
  at the facing neighbour's first course, and `wallSide` turns that requirement with the module's
  rotation. `autofaceWallMount` turns the panel to face that wall, so the rotation is derived rather
  than pressed. A fresh exit is named for the first free letter A ~ Z (`nextExitName`, so A口 / B口 / …),
  reusing a letter freed by a delete or rename, and falling back to 未命名口 once all 26 are taken.
  A wall-mounted ad may also stand in the face-adjacent cell when the pointer is on a wall itself
  (`wallMountStandCell`), so it can bolt to the station wall across the track.
* `openings.test.mjs` — a placed ramp carves the slab it climbs through but keeps its landings as
  graph nodes, only the run's centreline cells are carved (a block the handrail merely grazes is
  kept), a wall beside a run survives untouched (the run sweeps less than half a cell, so nothing
  beside it is reached), a single piece wider than a cell keeps its side floor cells and has them
  marked as half blocks while a wall it reaches is thinned the same way (an old 1.6 m stair, or a 2–3
  lane turning stair — a straight wide stair is lanes now, so it reaches nothing), and every cell the carve
  opens reads as reserved so a hand-built block cannot cover it back up.
* `stairs.test.mjs` — the four stair shapes, each one storey; every flight is a two-way graph edge
  between walkable landings, a switchback is walked bottom to top across its half-landing, the turn
  landings are the cells between flights, the width cycle runs one → two → three lanes (each exactly an
  escalator band, and a width that is not a whole number of lanes reads as the nearest), the lanes of a
  wide flight step along `stairRight` — the same "right of forward" a switchback's second flight uses —
  `planStairLanes` puts the hovered cell first and shifts the flight back so it butts against a stair
  on its left or its right (and flags the first candidate when nowhere fits), `stairLaneMates` pairs
  two lanes of one run — neighbours always (`sameFlight` false: their steps meet and they keep their
  rails), one staircase when they share a `cfg.flight` token — and refuses a lane set along the run,
  one on another level, one running the other
  way, a turning stair or a saved wide piece, the four stair
  buttons each build their fixed one-storey shape, a placed turning stair lays its half-landing as a
  walkable cell and carves its slab, and a carve keeps the landings while opening the slab a turning
  stair climbs through.
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
  a stair's handrails wrap round at both outer landings and land on the floor, while a switchback's
  half-landing gets no newel post in the middle of it.
* `exits.test.mjs` — the 出入口 (§5.6): the plan is the runs' group with one full block of floor at
  each end, so a 单向 / 双向 / 三向 is 3 / 4 / 5 blocks across and the runs stand side by side in
  columns 0 … bays − 1; the floor, street-opening node and glass/back walls all follow the placement
  rotation; a station saved on the old two-metre bays widens the house to cover its runs rather than
  letting them poke through the glass; the pad opens one wellway per run, exactly its own block (and
  wider only for a run wider than a block); the snap clamps the pointer into the bay group so runs can
  only be dropped side by side; and 无盖 keeps the same barrier planes as 有盖.
* `escalators.test.mjs` — the placed escalator is a fixed one-storey piece: an up run travels from
  the dropped cell to the storey above, a down run keeps the same footprint entered from the top,
  the direction cycle flips up ↔ down, two runs may not share a footprint but the next bay over is
  free, placing one carves its slab, and the scenario rig's pre-placed runs are that same piece at the
  same dimensions.
* `lift.test.mjs` — the 电梯 (§5.1): a fresh piece is a 2 × 2 m assembly that
  serves the floor one storey up; extending grows it a storey up or down in the
  same column and keeps its id; the graph joins every floor in the shaft with one car,
  both ways, skips a floorless level, and boards only at the door landing (the whole
  shaft interior is not walkable, and a rotated lift's landing follows the door it faces);
  two lifts may not share space but a 2 m gap is free; and a passenger rides —
  walks in, is pinned to the 1.5 m cabin while it moves, and steps out on the
  floor above. The car pose is deterministic and its door fraction stays in 0..1.
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
* `facility.test.mjs` — the rectangle-drag facilities: 商店 / 厕所 / 办公室 are walled rooms (one
  `shop` module type, the fit-out in `cfg.kind`) while 售票亭 is an open desk; same-fit-out drags
  extend a room, different ones clash; right-click carves wall openings (the renderer then hangs a
  3D door on a 厕所 / 办公室 opening and leaves the 商店 front open) and a room with no wall left is
  removed; the demo's shop and booth stay connected with live sim stops.
* `walls.test.mjs` — the 建造 tool's deliberate drag draws a walled floor patch: a 4 m auto wall
  ring rises on the patch's outer edge, overlapping or abutting two patches unions them (the buried
  wall goes, the new edge is walled) while a hand-placed wall survives, digging an edge moves the
  ring and a hole through the middle stays open, and 墙 lays tagged four-course columns that a
  right-click or right-drag lifts whole — an auto-generated wall answers the same column lookup, so
  the tool can open a doorway in the generated ring. The platform/tunnel footprint is covered
  ground: the ring wraps a dug rail bed instead of walling the platform edge, the drag never pours
  a block into the trench, and no auto wall rises through a platform screen door a full track
  sliced through the patch.
* `fence.test.mjs` — the 围栏 (§5.2): a 1 m high thin panel through the block middle (R turns a
  single, a drag lays a run along the drag direction); a dragged run plugs into a gate row, the
  fence cell is not a walkable node so the run plus its gates is a barrier the crowd only crosses
  at a gate, and `fenceArms` builds every joint from the neighbours — a lone panel caps both ends,
  a run end caps its free side, and an L / T / + turns through the centre with no overhang or cap;
  `railLandingAt` lets a fence connect to a stair or escalator landing.
* `storey.test.mjs` — the renderer's storey bands key every cell to the fixed 4 m grid line at or
  below it (`storeyBand`), so a floor and its 4 m auto walls share a storey while a second floor one
  storey down stays its own; a lower floor's wall reaching the floor above must not merge the two
  floors into one band.
* `shelf.test.mjs` — the 货架 (§5.7): the factory builds it with the hover rotation, it may stand
  inside a walled room or booth (either side of the shelf ↔ room pair, while shelves still collide
  with each other and other equipment does not enter rooms), `moduleAt` prefers the furniture over
  the room around it, placing a store stocks one auto shelf per layout spot with each wall unit
  turned to back its panel onto its own wall, each shelf deletes on
  its own while bulldozing the room keeps hand-placed ones, merges never stack two units on a cell,
  legacy rooms migrate once on load (a cleared `cfg.bare` room stays empty), and everything
  round-trips the save.
* `desk.test.mjs` — the 办公桌 (§5.7), same model as shelves: the factory builds it with the hover
  rotation, it may stand inside a walled room, `moduleAt` prefers it over the room, placing an
  office stocks one auto desk per grid spot, each desk deletes on its own while bulldozing keeps
  hand-placed ones, legacy offices migrate once, and everything round-trips the save.
* `restroom.test.mjs` — 厕所 fixtures and the 售票亭 staff seats (§5.7): cubicles and sinks build
  with the hover rotation and stand inside a walled room, placing a restroom stocks cubicles on the
  back row and sinks on the front (a door cell gets none) and a booth one bench per back-row cell,
  each unit deletes on its own while bulldozing keeps hand-placed ones and drops auto ones, legacy
  rooms migrate once, and everything round-trips the save.
* `vending.test.mjs` — the 自动贩卖机 (§7.4a): the factory builds it with the hover rotation, its
  1 × 1 m envelope is identical to a TVM's (so the two block each other), and `buildGraph` gives it
  the same unpaid-zone `stop` server and rate as a ticket machine under the 自动贩卖机 label.
* `bench.test.mjs` — the 座椅 variants (§5.7): the table offers two families (stainless with no back,
  backed seat) at two widths; the factory builds each with the hover rotation and a legacy bench is
  the 1 m stainless piece; a 2 m bench covers two cells in its own direction (and quarter-turned),
  blocks a piece on its second cell but not the next one over, is found by `moduleAt` from either
  cell, is refused over a track bed on either cell, and round-trips the save.
* `sign.test.mjs` — the ceiling-hung 装饰 pieces, 指示牌 and 电视 (§5.7): the factory builds the sign
  with the hover rotation; a piece needs a solid ceiling at the next storey grid line (so a B1 piece
  hangs from the concourse slab) and is refused without one, while floor-standing modules are never
  refused; neither is wall-mounted; each envelope is the full storey column, so it is found and blocks
  its cell; and both round-trip the save. The same file owns the 指示牌's **board document** (§5.8):
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
  back to the catalogue head rather than to a blank face; and all six panels fit their run, the 2.4 m
  collision envelope and the 4 m storey.
* `tv-screen.test.mjs` — the 电视's two lit panes (`render/models.ts` `buildTv`), pinned in geometry
  because the failure is silent: the content window's pane must stand clear of the dark backing slab
  that carries it, since a coplanar pane z-fights that slab and the window renders as a flat black
  rectangle with nothing in the console. Both panes are also asserted to be front-side-only on the same
  local −y face, so the back of the case reads as a blank panel, and the window is cut at exactly the
  region `TV_POSTER_RECT` reserves for it — board ends, window begins, window reaches the screen edge.
  `render/adArt.ts` is stubbed here rather than imported: it resolves its JPEGs through Vite's
  `import.meta.glob`, which plain Node has no implementation of, and nothing under test lives there.
* `station-display.test.mjs` — the 电视 board's own arithmetic (`render/stationDisplay.ts`), testable
  without a canvas: `stationDisplayLayout` keeps the content window clear of the header, the three
  cards, the service strip *and* the clock, in that order down the information column; the window
  never leaves the plate; and `tvLineStatus` reads the next train off the live poses — an approaching
  train becomes the countdown, one level with the berth reads 列车进站, one already past it is neither,
  a train on the opposite track or another line is ignored, and an unset terminus falls back to the
  line's own direction word.
* `sweep.test.mjs` — the 删除 tool's same-type drag sweep (§9.5, `app/sweep.ts`): two 闸机 of either
  rotation are one family while a 售票机 at the end of the row never joins; the palette variant is the
  match, so a 2 m 座椅 leaves the 1 m ones standing and a 横版 广告牌 leaves the portrait panels, while
  a legacy piece with no variant reads as the default it is drawn as; a room, a rail, an 出入口, a
  楼梯 and a 站台门 are never sweepable; the drag path between two move events is sampled end to end
  (a fast flick that jumps a cell still collects what it crossed, a teleport is capped but never
  skipped), so a drag along a gate row collects exactly the gates and never twice; and the whole run
  folds into one state, leaving other modules and the floor under them untouched.
* `paint-mode.test.mjs` — the 材质 folder's own setting (`app/store.ts`, §4.3): `N` 单块 / `M` 整面
  are what the brush keeps, so choosing a texture — a plain finish tile, or a fresh 搪瓷板 colour,
  which reaches the brush in the same click rather than the previous render's value — never resets
  it; the setting survives a detour through another folder on the left rail; and `I` 取色 borrows
  the brush and hands it back in the mode it was entered with.
* `level-slicing.test.mjs` — the level slice as a pure rule (`render/levelSlicing.ts`): which
  side of the edited storey a piece sits on (a lift spanning into the storey counts as active),
  显示其他层 off drawing the edited storey alone at every camera angle, ghost mode keeping the
  neighbours at 35% while a storey above keeps only its unsupported plates (a room never wears
  its own ceiling), and the crowd and the trains following the same slice.
* `sign-editor.test.mjs` — the 指示牌 board editor session (`app/SignEditor.tsx`): a sign is a
  pair of boards with a one-sided default, the preview never commits, confirming makes the pair
  current and the next sign hung carries a copy, covering the full compose→place→print flow.
* `sign-model.test.mjs` — the 指示牌 board document path (`sim/sign.ts` `buildSign`): one lit
  face per composed board with a default-front/empty-back fallback, one vs two mounted faces,
  and the shared panel sized to the longer board.
* `sign-render.test.mjs` — the 指示牌 board pixels (`render/signFace.ts` `drawSignPanel`): a
  fresh sign prints ink rather than black, per-face boards, the empty-face stand-in, panel-vs-
  plate size agreement, label row pitch and separation, every palette mark printing, the PNG
  pictograms square/white/clear, and the save round-trip.

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

## Deliberate divergences from PLAN / GAME-SPEC

* **No react-three-fiber.** The scene is a plain three.js `SceneRenderer` driven by a
  React `Viewport` component. The renderer we judge at `/lab` is the renderer the game
  keeps either way; R3F would have added a reconciler between us and the chunk mesher.
* **Inner fillets are dropped.** PLAN R2's named fallback: the mesher rounds convex
  outer corners and chamfers exposed top edges by 12.5 cm, but does not fillet concave
  inner corners.
* **The day clock is real time at 1×, not 120×** (above).
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
| Chunk mesh build, before B1 | ~3.7 ms warm, ~5 ms on the very first chunk (JIT) | < 4 ms |
| Chunk mesh build, per-face finishes (B1) | **1.9 ms** for a one-layer station floor chunk, 2.7 ms for two, 4.4 ms for a fully solid 8-layer block | < 4 ms |
| Frame | 60 fps in a windowed GPU; the headless software rasteriser used for
  CI screenshots is the limit there, not the scene | 16.6 ms |

B1's per-face materials make the mesher sort faces into one part per finish. A real station
chunk is a thin floor slab and stays well inside the budget (1.9 ms); the figure that misses
is a *fully solid* 16×16×8 block, which is geometry-bound rather than finish-bound and was
near the line before B1 too. PLAN R2's fallback if that ever gets worse is to drop the rounded
vertical corners and keep the top bevels only.

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
