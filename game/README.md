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
搪瓷板 colour) leaves it alone and `I` 取色 hands the brush back in the mode it borrowed. A **stair**
is the one module the brush finishes: its treads, their risers and the half-landing platform are a
single surface, so the pointer painting a staircase writes `stair.cfg.finish` (`paintStairSurface`)
rather than the floor under it, and 取色 on a stair reads that finish back — or, on an unpainted one,
the finish of the floor it climbs from, which is what the staircase is wearing. Right-click hands the
surface back to the floor. The finish is cosmetic there (a flight is walked at `STAIR_SPEED` whatever
it is made of) and the stringers, rails and landing frame stay steel, so a finished stair still reads
as a staircase.

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
厕所隔间 (the restroom cubicle), 洗手池 (the wash basin), 垃圾桶 (a stainless double bin) and 灭火器
(the red fire-extinguisher cabinet on four legs) are all free-standing, rotatable pieces,
and 广告牌, 电视, 指示牌, 时钟 and 监控 all live under 装饰 in the build rail. 垃圾桶 and 灭火器 are cosmetic like the
rest of the furniture — no server and no stop — and both count as room furniture, so they may stand
inside a walled 商店 / 厕所 / 办公室 / 售票亭 (`placementBlocked`'s furniture ↔ room exemption). 广告牌 is *wall-mounted*:
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

**时钟 and 监控 are the same ceiling-hung contract with different hardware.** 时钟 is a **round**
station clock: a white face with black hour marks, minute ticks and hands and *nothing* printed on
it — no numerals, no name — under a dark bezel ring, hung on a bracket from a rod off the ceiling
slab. **The face is geometry, not a printed canvas**: a slim white cylinder whose two ends are the
dials, a black **open-ended** wrap around the barrel between them, and on each end **sixty
divisions** — twelve hour marks and 48 minute ticks — with two hands and a centre boss, at
proportions measured off the reference face (hour mark 0.20 R long by 0.055 R across, minute tick
0.10 R by 0.02 R, both ending at the same inner rim; hands 0.5 R and 0.7 R). **Twelve bars alone
read as a plate with marks on it** — the minute ticks are what make the ring read as a clock. The
clock is **double-faced**: both ends carry the full dial, mirrored so 12 o'clock is up on each.

**A mark runs radially, and the turn that does it is `a − π/2`.** Every mark and both hands carry
their length along their box's local x, so one turn serves them all; aimed **across** the rim
instead, the 12 and 6 marks come out horizontal and the 3 and 9 marks vertical, which is the wrong
way round and very visible. The turn was read off the matrix rather than derived by hand, because
the hand derivation is one sign away from the wrong answer: at each clock angle `a − π/2` gives a
dot of 1.000 against the radius where `π/2 − a` gives 0.105 to 0.5. A double-faced clock is likewise
**one dial mounted twice** — the far one inside a group turned half a turn — rather than a builder
branched on a `facing` sign, which is three chances to get a sign wrong per element.
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
the reference — a dark head with its lens, a two-LED illuminator and a sun hood on a steel arm
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

**The board is one row, and it is as long as its content.** `signPanelSize` measures the row —
`max(floor, the last mark's right edge + a quiet margin)`, clamped to `PANEL_MAX_W` — and the drawn
panel, its mesh and its texture all follow it. The row keeps one end pad (`PANEL_END_PAD`) of black
at each end: the pack starts the first mark a pad from the frame and the panel ends a pad past the
last mark, so an edited board cannot lose its leading margin to the frame and both faces mirror the
same ends. The height is fixed at `PANEL_MIN_H` (0.7 m): content
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

**A room's walls are one panel thick, and its corners are square.** The wall voxels a room
raises are hidden from the chunk mesher (`SceneRenderer.setStation`'s `hiddenCells`, leaving an
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
"washroom" (`app/zoneThumbnails.ts` now renders the 分区 tiles alone).

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
air above it. The nav cube only ever moves the camera: no face, corner or **Home** click rewrites the
slice behind the player's back.

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
they are, and the pointer goes on building and picking. **隐藏墙壁** stays live, because it is a
look-through of the station's own walls rather than a way of drawing a storey.

The tile order is the folder's own reading order: 显示其他层 · 剖切 · 隐藏天花板 · 隐藏墙壁 · 热力图 ·
分区图 · 隐藏UI — the slice tools first (剖切 folding out its own **旋转** tile directly under itself), the
pair that takes station furniture away, the two overlays that paint the station, and last the one tile
that draws the station whole. **Seven tiles, and the header says 7**: the count beside a folder name is
the tiles that folder can show in the state the rail is in, so it follows a mode that adds one (工具
grows by 自动生成墙壁 and 半墙 under the 地基 tool, 视图 by 旋转 while 剖切 is on) rather than a number
written down once and left behind.

**The rail's folders answer to Shift+Q, Shift+W, Shift+E … one letter a folder.** The first folder —
工具 — is **Shift+Q**, and W E R T Y U I follow the folders below it (轨道, 设备, 装饰, 房间, 分区, 材质,
视图), each header badging its own key on hover the way a tile does. The ladder is one list, `RAIL_FOLDERS`
(`app/rail/helpers.ts`): the shell stacks the folders in that order and badges each key on its header
(`.folderKey`, the tile's own `.bpKey` — hidden until the header is hovered or focused, so a rail of
closed folders stays quiet), and the app's single keydown listener (`app/windows/AppShell.tsx`) turns a
Shift+letter into the folder it names and hands it over as `metro:folder`, because the rail owns which
folders are open and the app owns the keyboard — the same split `metro:preset` / `metro:frame` use for
the camera. Shift+W therefore pans nothing: **W** with Shift was the fast forward pan, and a key may not
both shove the camera and fold a folder, so the fast pan keeps Shift+A/S/D while a plain W is still
forward.

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
previews as a translucent ghost, and **R** turns the run; **Tab** cycles its width between **one, two
and three lanes** — 0.7 / 1.4 / 2.0 m, each lane exactly one escalator band, so a wide stair is
literally that many narrow flights side by side and every lane merges with the run next to it (see
the lane rule below). Every side of a flight carries a stringer
and a handrail, and each handrail **levels off at its landing and turns down into a newel post on the
floor** — a quarter turn, so a stair rail wraps round and reaches the ground instead of stopping dead
above the last tread (the same idiom the escalator's balustrade return uses) — unless a **wall hugs
that side from bottom to top** (`stairWallSides`). The wall is the barrier there, so the flight keeps
only the stringer it meets the wall with and grows no handrail, rail posts or newel return of its own:
a staircase in a stairwell is railed on its open side alone. The wall has to run the flight's whole
length, at the flight's own heights — a wall that stops at the half-landing, a stump that only reaches
the bottom steps, a doorway punched through one course, or a wall standing only on the storey above
all leave the rail on. A turning stair also
lays its half-landing
as a walkable cell, so the two
flights connect. The Wusi Square test rig keeps a single pre-placed stair — the straight run
that replaces exit A's down escalator; `carveRampOpenings`
opens the slab each flight climbs through while keeping every landing, so each stairwell is a real
hole in the ground.

**A switchback's two runs share their balustrades.** The returning flight of a `right180` / `left180`
is laid **one cell across per lane** (`stairSwitchbackOffset`) — as close as two *walking lines* can
stand — and its **treads, rails and collision body then slide the rest of that step**
(`stairFlightSlides` / `stairReturnSlide`) until the two balustrades meet back to back: the shared
centre rail a real 双跑楼梯 has, with no floor left between the runs at all. The paths stay on the
grid — the half-landing is one cell per lane plus the one the pair shares, and both flights join the
graph on cells — so what moves is the band, never the walk. The piece claims one block per lane plus
what the two bands really need: **2 blocks across at 0.7 m, 4 at 1.4 m, 5 at 2 m** (a 1.4 m switchback
used to take five and a 2 m one six, with a 0.64 / 0.96 m corridor down the middle). The slide is
capped at `STAIR_WALK_CLEARANCE`, so a run that is already nearly a whole cell wide — the 0.7 m one —
barely moves and its walkers keep to the middle of the flight. The two hands are two pieces, not one piece turned: the same first flight, with
the return run laid back on its right or on its left, and **R** cannot swap one for the other (a
rotation turns the whole stair about its base, so the turn keeps its hand). The half-landing is a
**walked** row of cells — its cells are the stair's interior nodes — and the crowd really crosses it:
each flight's balustrade wall (`sim/station.ts`) therefore **stops dead at the flight end that meets
an interior landing** and follows the slid band, because a wall over-running that end (as it does at an
outer landing, where it stops the crowd cutting the corner off the run) would cut the landing's own
cells apart and seal the two flights away from each other. A 180° turn lands on a row, so this is the
pair's only way through: a switchback built before this rule — or a saved one with its flights still
three cells apart — walks across it too, and tightens as far as its own layout allows. See
`test/stairs.test.mjs`.

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
shared or owned (`test/bay.test.mjs` measures the drawn models to prove it). (A boundary carries no
rail in two cases: two lanes of the *same* stair flight, which are one staircase, and a side a wall
hugs — see the lane rule above and the stair bullet.) It also means a wall, a
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

**The ground under a run fills up to its truss.** A run's body hangs below its walking line, so the
block under it would otherwise swallow the truss. `rampSlopeCuts` (`sim/openings.ts`) derives the
volume each 楼梯 / 扶梯 takes out of the ground it climbs over: the tiles `rampBodyBoxes` already
reserves for collision, with the truss depth (`RAMP_FOOT`) taken off the local walking line. The
mesher draws those blocks' tops on that plane instead (`chunkMesher`'s `slope` map), so a block under
a run is the filling under the slope — a wedge where the plane leaves through the block's floor,
clipped with Sutherland–Hodgman so nothing chords back up into the run — and the run's truss lands on
it. `rampOpeningAt` leaves the space under a run buildable for exactly that reason: a run's opening
starts at its walking line, so the 地基 tool lays a block under it and the carve keeps it. Only the
column the run's own walking line passes through is cut and a run's landing columns are left whole.
Nothing is added to the document: the cut is derived from the modules, the way the half panel beside a
wide run is (`thinWallCells`).

The last course under a truss is the one the brush may **not** lay: its top face would sit above the
walking line, where the crowd's own floor is measured. So the ground used to stop a wedge short of the
truss, with the storey below showing through. The renderer closes it instead: `rampFillKeys` names
every cut cell the station holds nothing in that stands on solid ground, `SceneRenderer` keeps that set
with the cuts (`SceneContext.slopeFills`), and `chunkMesher`'s `fill` argument draws each one as if the
block below carried on up to the truss — shaved by the same cut, solid to every neighbour so the seam is
never drawn. **Where the cut carries the run's drawn body half-width the filling *is* that body.** An
escalator's body is its truss box, narrower than the cell, so its filling is built from the rectangle
itself (`buildTrussProfile`: sharp, `ESCALATOR_BALUSTRADE` across the run, the full tile along it) in the
run's own steel — the new 钢板 finish (`RAMP_SOFFIT_FINISH`), the truss's own dark brushed colour — so the
skirt meets the truss flush instead of stepping out 9 cm either side. A stair carries no half-width: its
treads run out to the cell edge, so its filling keeps the cell's shape and the finish of the block below
it. 钢板 is a stock **ceiling** finish, so it is in the 材质 palette too — a block's bottom face can wear
the same steel anywhere. Still no cell, no tag, nothing a tool has to keep in step: dig the ground away
and the filling goes with it. The hover ghost reads it with the pending cells in place, so the wedge a
block is about to create is previewed with it (`test/ramp-fill.test.mjs`, which also fits the drawn
filling against the escalator model's own truss, `test/slope-cut.test.mjs`).

**A wedge's top is the only drawn surface that is not a cell face**, and the pointer reads the drawn
mesh: `THREE.Intersection.face.normal` is the triangle's own geometric normal, so `cell + normal` asked
for a *fractional* block — laying 地基 beside the block under an escalator committed a block at
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
That is now only ever a piece wider than a cell: a
narrow stair or an escalator sweeps 0.445 / 0.49 m, so nothing beside it is reached at all, while a
**floor** is still thinned when a wide stair's 1.6 m body reaches into the
column beside it — which closes the hole the carve used to leave at the top of the stair — and a wall
a wide stair's handrail touches is thinned the same way (both kinds draw identically now, so the
derivation reports only the side). The 动物园
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

**移动 moves a piece instead of rebuilding it.** It is neither a tool nor a second panel: select the
设备 / 装饰 piece (`Z` 选择) and press `移动` in the right inspector's `信息` card, beside what the piece
is — and that same card becomes the move's whole control surface while the piece is in the air, with
`确认` / `取消` exactly where `移动` was, over the cell the drop would use and the rule a refused cell
broke. The piece stops being *drawn* where it stood and rides the pointer as the translucent ghost a
fresh placement shows, with `R` turning it in the air and the validity tint — the same red — meaning
what it always means. Lifting is deliberately **not an edit**. The piece keeps its id and its whole
`cfg` (a 指示牌's printed boards, a 闸机's lane, a 广告牌's frozen poster) and never leaves the document,
so nothing lands on the undo stack and `取消` has nothing to restore; what lands is the piece as the
document holds it *now*, so a board edited while it was in the air survives the move. The drop is
**one** commit (one `Ctrl+Z`), and it answers the same rules a fresh placement does — floor under every
cell it stands on, no track bed, nothing already in the space, a wall behind a 广告牌, a ceiling over a
指示牌 / 电视 — asked through `moveCandidate` (`sim/placement.ts`) of a piece that already exists, so the
copy at its origin is never read as the obstacle and the ghost, the card's `确认` and the commit cannot
disagree. There are three ways out: `左键` on the ground (or `确认`, or `Enter`) drops it, and `取消` /
`Esc` / a right press puts it back where it came from. A refused cell keeps it in the air and names the
rule, exactly as a refused placement does. A ghost wears a private id (`MOVE_GHOST_ID`) because a
指示牌's printed plate and a 电视's station plate are cached per module id, and a preview may only
dispose what it minted itself. The structural pieces — 楼梯 / 扶梯 / 电梯, 出入口, rooms and 轨道 / 站台门
— are refused, by the same rule that keeps 删除 from sweeping one (the card's button says so and stays
disabled): a translation would leave behind the openings they carved and the geometry derived from
them, so they are torn down and built again. Switching tools mid-lift puts the piece back, because a
lift is not a mode to be lost in. See `test/move.test.mjs`.

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

**The 地基 tool lays a 半墙 — the same wall at half a block thick, one block at a time.** A facility
room's own walls and the panel a wide run keeps beside it have always been drawn half a block thick;
the 工具 folder's **半墙** tile (**Tab**, while the 地基 tool is active) turns a click into one of those,
so the player can put that wall anywhere. The piece is still an ordinary solid wall cell — tagged
`WALL` plus the half of the tile it keeps (`half-wall:w`, `sim/types.ts`), so the column
lift, the storey slice, `isWallBlock`, the ramp carve and the crowd all read it as a wall.
`render/chunkMesher.ts` draws those cells half a block thick, squashing the standard rounded profile
into that half and turning it into place, so the panel wears the wall's own profile and its **per-face
finishes**: both of its sides are ordinary surfaces, painted by the 材质 brush exactly where the pointer
hits them.

It lives on the 地基 tool because it *is* the wall that tool grows — so the two wall modes are
exclusive: turning 半墙 on switches **自动生成墙壁** off and that tile greys out (the store refuses it
while 半墙 owns the tool), and leaving 半墙 hands the patch its ring back. **Tab** cycles the three
things a 地基 click can lay — the generated ring, bare blocks, the one-at-a-time 半墙 — and its first
step is the one that was always there (Tab turns the ring off). A 半墙 click also never becomes a patch
or a run: one block, exactly where the click landed, whatever the pointer does afterwards. A *run* of
walls is still the 墙 tool's job.

Which half a block keeps is **R**'s business, and it is the one thing a wall's own geometry cannot
always answer. The candidates are the faces the cell opens onto first, then the rest
(`halfWallSideDirs`), so a 半墙 dropped along a patch edge hugs that edge with no key pressed — the face
a full wall would have stood on — while a partition placed in open floor, which has no edge to read,
still offers all four. (A run offers only the two sides perpendicular to it, because a side *along* the
run would leave a slot between column and column: a run's panels are one wall. Tab resets the face
cycle with the mode, since the cycle means something different in each.)

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

A hole dug through the middle stays open rather than getting
boarded up. The platform/tunnel footprint is covered ground too: a placed rail digs its bed, so the
merge folds that footprint into the surface — the ring wraps the whole patch-plus-track area, the
drag never pours a block into the trench, and no auto wall rises through a platform screen door a
full track sliced through the patch. Single clicks
and stacked blocks stay plain, and the drag's live ghost shows the wall ring before release. The
地基 tool carries a **自动生成墙壁** toggle (on by default) in the 工具 folder — **Tab** flips it
while the 地基 tool is active: turn it off and the
same drag lays the patch as untagged bare blocks, with no ring. Its **半墙** tile beside it is the
third step of that same Tab cycle (and it greys the ring tile out while it is on, since the two are
exclusive). See `test/walls.test.mjs`.

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
  boundaries rather than refused, while a broken envelope is still refused whole.
* `grid.test.mjs` — nothing in the game can put a cell off the 1 m grid. Every palette piece is
  placed at every rotation, width, direction and 闸机 door mode, every staircase shape at
  fractional legacy widths (1.2, 1.6 m), and 地基 / 墙 / 房间 / 电梯 / 站台 / 隧道 / 材质 / 分区 /
  移动 are driven through their real builders, each asserting that every cell and every module
  anchor — `from`, `to` and a switchback's flights included — stays whole. This is the guard on
  the code that *makes* stations: a save cannot be written with an off-grid block either
  (`save.test.mjs`), so a tool that learned to mint a fraction is the only way one could ever
  reach a player.
* `pick-cell.test.mjs` — the pick above every command in `grid.test.mjs` names whole cells,
  whatever angle the surface it hit is drawn at. `CameraSystem.pick` reads the drawn mesh and
  `THREE.Intersection.face.normal` is the *triangle's* geometric normal, so the two faces this game
  deliberately draws off-axis — the wedge a 楼梯 / 扶梯 leaves the block under it (its top is the
  run's sloping underside) and every rounded block edge — used to hand a tool a fraction: a 地基
  block laid beside the block under an escalator landed at (4.44, −0.15, 1.89). The test rays the
  **real chunk geometry** rather than typed-in normals — a case that only passes on made-up numbers is
  what let this through — and pins that the axis snap is the one the 材质 brush paints by
  (`faceAxis` ← `dominantFace`), so the face a stroke lands on and the cell a block lands in agree.
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
* `slope-cut.test.mjs` — the ground under a run (§5.1 / §4.2): the 地基 tool lays a block under a
  楼梯 / 扶梯 and the carve leaves it (a block already there when the run arrives survives it), the cut
  is the run's own underside — `RAMP_FOOT` below the walking line at every point across the block,
  never above it — one block per tile of the run's own column and nothing beside or past it, a stair
  cuts only the tiles its treads sweep (its landings stop the treads short), a landing column is never
  cut, a cut block is drawn as a slope with no flat cap, nothing a run cuts reaches back into its
  body on either an escalator or a straight stair, and a block out of the run's reach meshes exactly
  as it always did. It also pins the derived filling (`rampFillKeys`): a packed key really does step one
  block down by subtracting one, a filling sits only where the plane cuts over ground and never in the
  document, and the drawn ground reaches the truss with no seam against the block it continues.
* `ramp-fill.test.mjs` — the same filling through the **real renderer** (`ChunkSystem`): a single ground
  column under an escalator draws up to the truss in both slice passes, a run hanging over void fills
  nothing (no floating wedge), a block the station still holds there needs no filling, and a cut with no
  ground under it fills nothing.
* `stairs.test.mjs` — the five stair shapes, each one storey; every flight is a two-way graph edge
  between walkable landings, a switchback is walked bottom to top **across its half-landing** (in a
  stairwell with nothing else at the half height, so a sealed landing fails the test rather than
  routing round the station), the turn
  landings are the cells between flights, a switchback's runs share their balustrades — the treads slide
  until the rails meet, and the piece claims 2 / 4 / 5 blocks at 0.7 / 1.4 / 2 m, probed with a 围栏 in
  every column — and its two hands are mirror images that
  no rotation can swap, the width cycle runs one → two → three lanes (each exactly an
  escalator band, and a width that is not a whole number of lanes reads as the nearest), the lanes of a
  wide flight step along `stairRight` — the same "right of forward" a switchback's second flight uses —
  `planStairLanes` puts the hovered cell first and shifts the flight back so it butts against a stair
  on its left or its right (and flags the first candidate when nowhere fits), `stairLaneMates` pairs
  two lanes of one run — neighbours always (`sameFlight` false: their steps meet and they keep their
  rails), one staircase when they share a `cfg.flight` token — and refuses a lane set along the run,
  one on another level, one running the other
  way, a turning stair or a saved wide piece, the five stair
  buttons each build their fixed one-storey shape, a placed turning stair lays its half-landing as a
  walkable cell and carves its slab, and a carve keeps the landings while opening the slab a turning
  stair climbs through. `stairWallSides` names the sides of a flight a wall hugs from bottom to top —
  every cell of the run, each read at the height the flight is at when it passes it — so a wall that
  stops at the half-landing, a stump beside the bottom steps, a doorway through one course or a wall
  standing only on the storey above leaves the rail on, while the top course a stairwell's wall shares
  with the floor slab above still counts (the check reads solids, not wall tags).
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
  half-landing gets no newel post in the middle of it, and that a wall standing beside one side of a
  flight takes that side's handrail, rail posts and newel return with it (its stringer stays, and the
  other side is untouched) while a wall that stops part way — or one on each side — leaves or takes
  both.
* `exits.test.mjs` — the 出入口 (§5.6): the plan is the runs' group with one full block of floor at
  each end, so a 单向 / 双向 / 三向 is 3 / 4 / 5 blocks across and the runs stand side by side in
  columns 0 … bays − 1; the floor, street-opening node and glass/back walls all follow the placement
  rotation; the house's plan is `cfg.bays` alone — one full block of pad each end and no other
  width, so `exitRunOpenings` keeps the wellways of the runs that fixed span covers and the house
  never widens for a run outside it; the pad opens one wellway per run, exactly its own block (and
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
* `booth-model.test.mjs` — the 售票亭 model itself (§5.7, `render/models.ts` `buildBooth`), the one
  facility piece that is hand-built geometry rather than voxels. What it pins is the box: nothing on
  the piece leaves the cells or the height `moduleEnvelope` reserves for it (3 × 3 through 6 × 4),
  each of the four counter runs stands on its own outer face and runs into both corners, the four
  screen sheets butt at the corners against the sheets they meet and a mullion caps each joint, so
  the counter band and the screen band each run the whole way round with no gap at any sample of
  their centre lines — and the piece is the same on all four sides, sample by sample. The bug it was
  written against measured each side from a different line: the east counter and screen hung 0.55 m
  out in the next cell, the north run stood a whole cell inside the room, the capping boards stood a
  lip proud of every face, and every screen stopped a counter-depth short of its corner.
* `room-model.test.mjs` — the walled room's own model (`render/models.ts` `buildRoom`), the perimeter
  ring of 0.5 m panels that stands in for a room's wall voxels. What it pins is the square corner:
  three quarters of every corner cell are wall and the quarter the room keeps for furniture is empty
  (the ring is an L, not the diagonal wedge a `mitreCap` used to lay across that quarter, its apex one
  wall thickness past the room's own inner corner), the panel's centre line is covered at every 5 cm
  sample the whole way round with no gap at a corner, no panel leaves the room or the height
  `moduleEnvelope` reserves, and nothing in the ring is anything but a box.
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
  is a symmetric stainless double bin with two recessed mouths and one printed 可回收物 / 其它垃圾 band
  proud of its front, and the cabinet is a red steel box standing on exactly four corner legs with one
  white lettered plate spanning both doors in front of them.
* `ceiling-decor.test.mjs` — the other two ceiling-hung 装饰 pieces, 时钟 and 监控 (§5.7): the palette
  files both under 装饰 with their Chinese labels, the factory builds them with the hover rotation,
  each reserves exactly its own cell from the floor top to the storey ceiling, neither may be hung
  where there is no slab overhead while floor-standing pieces are never asked for one, neither may
  share a cell with anything, neither may stand on a track bed, both are movable and round-trip the
  save, and a drag sweep collects a run of either without taking the other. The models are measured
  too, off the **geometry** rather than a texture: the clock is a true cylinder whose face disc
  hangs at 2.4 m with a **white** material, twelve hour markers and 48 minute ticks in **black**
  resting on its plane, two hands and a boss, and an **open-ended** bezel ring proud of it, so the
  face cannot be covered by a cap and no text is printed anywhere on the piece; the camera is a
  slim fitting — under 8% of the cell it reserves — with its lens, two illuminator LEDs and hood all
  on the local −y front, and half a turn round puts the lens on the other side of its own cell.
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
* `move.test.mjs` — 移动 (§9.5, `sim/placement.ts` + `app/store.ts`), the `信息` card's action on the
  selected piece rather than a tool: it lifts whatever tool is active and leaves that tool alone; the
  flat 设备 / 装饰 pieces are movable and a 楼梯 / 扶梯 / 电梯 / 出入口 / 房间 / 轨道 / 站台门 is refused; a
  moved piece is the same piece (id, `cfg`, poster and boards all travel) and never collides with the
  copy still standing at its origin; a drop needs floor under every cell it stands on (a 2 m 座椅 needs
  both), refuses a track bed and an occupied cell, turns a 广告牌 to the wall that backs it (and lets it
  hang over the track where there is no floor in front of that wall), and requires a ceiling over a
  指示牌; `replaceEquipment` swaps the piece in place keeping the list order; and in the store a lift is
  not an edit (the piece stays in the document, nothing on the undo stack), `取消` puts it back with no
  commit, `确认` is one commit that `Ctrl+Z` undoes, a refused drop keeps the piece in the air and says
  why, a drop that changes nothing is not an edit while `R` + `确认` on the same cell is, and what lands
  is the live piece — its boards as they are *now*, not a lift-time snapshot.
* `paint-mode.test.mjs` — the 材质 folder's own setting (`app/store.ts`, §4.3): `N` 单块 / `M` 整面
  are what the brush keeps, so choosing a texture — a plain finish tile, or a fresh 搪瓷板 colour,
  which reaches the brush in the same click rather than the previous render's value — never resets
  it; the setting survives a detour through another folder on the left rail; and `I` 取色 borrows
  the brush and hands it back in the mode it was entered with.
* `rail-folders.test.mjs` — the rail's Shift+letter ladder (`app/rail/helpers.ts` `RAIL_FOLDERS`): the
  keys are Q W E R T Y U I in the order the folders are stacked, 工具 first (so Shift+Q folds the
  folder the rail already opens on), one key a folder and one folder a key, the lookup is case-blind
  because the listener hands over `KeyboardEvent.key.toLowerCase()`, and a letter no folder stands on
  falls through to the app's own switch instead of folding something.
* `halfwall.test.mjs` — the **半墙** (§4.1/§4.3), the 地基 tool's half-block mode (`Tab`,
  `build/model.ts` `addWalls`'s `side`): the column is an ordinary tagged wall — a `half-wall:w` course
  that lifts, slices and carves like any other while the mesher draws it `HALF_WALL_T` thick in the half
  the side names; **R** offers the geometry's own faces first for a single column and only the two
  perpendicular sides for a run, wrapping; the 半墙 mode switches 自动生成墙壁 off, refuses it while on
  and hands the ring back on the way out, and both settings join the ghost key; a painted face of a
  panel colours that surface and not the whole block; the brush may paint a 半墙's inner face even with a
  solid cell behind it (`facePresent`, and `M` 整面 flooding a whole run from one column); `thinWallCells`
  is the one list of thin cells the mesher, the ghost and the brush all read; a half wall **a ramp
  derived** is in it and is painted the same way (the stair panel that used to be untexturable); and a
  ramp keeps a player's 半墙 without thinning it a second time.
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
