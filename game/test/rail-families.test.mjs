// The rail's variant families (`app/store/catalog.ts`) — the one table the parent tiles,
// the sub-menus, the rail's single open slot and the contextual action row all read.
//
// The point of the table is that those four halves **cannot** disagree. They used to be
// written out four times (a menu component per family, a hand-listed parent tile per
// folder, a hand-listed open-slot mapping, and a hand-listed action anchor), and a family
// that missed one of them failed silently in the UI: a variant whose list folded away the
// moment it was picked, or a placed piece whose 旋转 tile folded out under a tile no
// folder drew. Every failure mode of that kind is a pure statement about this table, so
// it is pinned here, in Node, rather than by clicking through seven sub-menus.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CUT_MODES,
  FACILITY_OPTIONS,
  MODULE_FAMILIES,
  MODULE_OPTIONS,
  actionRowOpen,
  actionsAnchorFor,
  cutAnchor,
  cutModeOf,
  familiesIn,
  familyAnchor,
  familyFor,
  familyOptions,
  folderOptions,
  folderTiles,
  hasModuleActions,
  isDecorType,
  isEraseBrush,
  isFacilityBrush,
  isFamilyOption,
} from '../src/app/store.ts'
import { ZONE_LIST } from '../src/sim/zones.ts'
import {
  armedActionsAnchor,
  armedCut,
  armedRailTile,
  armedTiles,
  revealScrollDelta,
  showsAutoWalls,
  subMenuForModule,
  toolsFolderTiles,
  zoneFolderTiles,
} from '../src/app/rail/helpers.ts'

test('every family is one row: a key, a label, a folder and the ids it owns', () => {
  assert.equal(MODULE_FAMILIES.length, 17)
  assert.deepEqual(
    MODULE_FAMILIES.map((f) => f.key),
    ['cctv', 'tactile', 'floor-mark', 'roof', 'pillar', 'stair', 'exit', 'busstop', 'light', 'bench', 'shelf', 'billboard', 'glass', 'door', 'calligraphy', 'linemap', 'sign'],
    'the rail order: 设备 first, then 装饰',
  )
  for (const family of MODULE_FAMILIES) {
    assert.ok(family.label.length > 0, `${family.key} wears a label on its parent tile`)
    assert.equal(family.folder, ['rail', 'equipment', 'decor'].find((folder) => familiesIn(folder).includes(family)))
  }
  // The keys are unique, and the anchors they name are too: two families on one anchor
  // would open each other's list.
  assert.equal(new Set(MODULE_FAMILIES.map((f) => f.key)).size, MODULE_FAMILIES.length)
  const anchors = MODULE_FAMILIES.map((f) => familyAnchor(f.key))
  assert.equal(new Set(anchors).size, anchors.length)
  assert.deepEqual(familyAnchor('glass'), '__glass', 'the anchor is the key, marked as a tile')
  assert.deepEqual(familyAnchor('linemap'), '__linemap')
})

test('every family owns variants, and no variant belongs to two families', () => {
  const claimed = new Map()
  for (const family of MODULE_FAMILIES) {
    const options = familyOptions(family)
    assert.ok(options.length > 0, `${family.key} has a list to fold out`)
    for (const option of options) {
      assert.equal(family.owns(option.id), true, `${family.key} owns ${option.id}`)
      const owner = claimed.get(option.id)
      assert.equal(owner, undefined, `${option.id} is claimed by ${owner} as well as ${family.key}`)
      claimed.set(option.id, family.key)
    }
    // The parent tile's icon is its first variant's thumbnail, so a family with no
    // options would render a tile with no art.
    assert.ok(options[0].id.length > 0)
  }
  // The families cover exactly the palette ids that are not their own tile: every
  // claimed id is in the palette, and every family-owned palette id is claimed.
  const paletteIds = new Set(MODULE_OPTIONS.map((m) => m.id))
  for (const id of claimed.keys()) assert.equal(paletteIds.has(id), true, `${id} is a palette option`)
  for (const option of MODULE_OPTIONS) {
    const family = familyFor(option.id)
    assert.equal(
      family !== null,
      isFamilyOption(option.id),
      `${option.id}: the family predicate and the table agree`,
    )
    if (family) assert.equal(claimed.get(option.id), family.key, `${option.id} resolves to the family that owns it`)
  }
})

test('a family is filed in the folder its own pieces are filed in', () => {
  for (const family of MODULE_FAMILIES) {
    for (const option of familyOptions(family)) {
      // The 装饰 folder draws what `isDecorType` files there; the 设备 folder draws the
      // rest. A family whose folder said otherwise would put its parent tile in one grid
      // and its variants in the other.
      assert.equal(
        isDecorType(option.type),
        family.folder === 'decor',
        `${family.key} / ${option.id} belongs in the ${family.folder} folder`,
      )
    }
  }
  assert.deepEqual(familiesIn('equipment').map((f) => f.key), ['stair', 'exit'])
  assert.deepEqual(familiesIn('rail').map((f) => f.key), ['roof', 'pillar'])
  assert.deepEqual(familiesIn('decor').map((f) => f.key), ['cctv', 'tactile', 'floor-mark', 'busstop', 'light', 'bench', 'shelf', 'billboard', 'glass', 'door', 'calligraphy', 'linemap', 'sign'])
  // **The id has to answer as the type does.** The rail and the placement tool hold a
  // palette **id**, not a module: `LeftRail` folds the folder open by `isDecorType(moduleType)`
  // and `EquipmentTool` asks the same predicate before its 装饰 right-click guard. A family
  // whose ids are prefixed (`sign-ceiling` / `sign-wall`) once answered only for its bare
  // `type`, so arming a 指示牌 opened 设备 instead of 装饰 and a right press skipped the guard
  // that stops a room being torn down by one click.
  for (const option of MODULE_OPTIONS) {
    assert.equal(
      isDecorType(option.id),
      isDecorType(option.type),
      `${option.id}: the palette id is filed where its own type is`,
    )
  }
})

test('a variant never appears twice: the grid holds only the plain tiles', () => {
  for (const folder of ['rail', 'equipment', 'decor']) {
    const tiles = folderOptions(folder)
    for (const option of tiles) {
      assert.equal(isFamilyOption(option.id), false, `${option.id} is a variant, so it belongs in its family's list`)
    }
    for (const family of familiesIn(folder)) {
      for (const option of familyOptions(family)) {
        assert.equal(tiles.some((t) => t.id === option.id), false, `${option.id} is drawn once`)
      }
    }
    // Everything a folder can place is either a plain tile or a variant of one of its
    // families — nothing the palette offers is left undrawable.
    const drawn = new Set([...tiles.map((t) => t.id), ...familiesIn(folder).flatMap((f) => familyOptions(f).map((o) => o.id))])
    const owned = MODULE_OPTIONS.filter((m) => (folder === 'rail' ? m.type === 'roof' || m.type === 'pillar' : folder === 'decor' ? isDecorType(m.type) : !isDecorType(m.type) && m.type !== 'roof' && m.type !== 'pillar'))
    for (const option of owned) {
      // The 设备 folder leaves the exits and the runs to their own tools; everything it
      // sweeps up must be reachable from the grid.
      if (!drawn.has(option.id)) {
        assert.ok(
          ['exit', 'stair', 'track', 'platform-edge'].some((t) => option.type === t || option.id.startsWith(t)),
          `${option.id} is neither a tile nor a variant of the ${folder} folder`,
        )
      }
    }
  }
})

test('one order list lays the grid out, and every tile a folder owns is drawn exactly once', () => {
  // The rail is a **2-column** grid (`interleaveRows`), so `folderTiles`'s order *is* the
  // row layout: two entries, one row. 装饰's is the palette order the pieces were laid out
  // in — 指示牌 广告牌 / 座椅 站名 / 线网图 电视 / 垃圾桶 灭火器 / 时钟 监控 / 货架 办公桌 /
  // 玻璃板 门 / 厕所隔间 洗手池 / 灯具 通风口 / 导向柱 公交站 — and a family's parent tile takes its place in that order like
  // any other tile, which is why the order cannot be read out of `MODULE_OPTIONS`.
  const anchors = (folder) => folderTiles(folder).map((t) => t.anchor)
  assert.deepEqual(anchors('decor'), [
    familyAnchor('sign'), familyAnchor('billboard'),
    familyAnchor('bench'), familyAnchor('calligraphy'),
    familyAnchor('tactile'), familyAnchor('floor-mark'),
    familyAnchor('linemap'), 'tv',
    'psd-end', 'curtain-wall',
    'bin', 'extinguisher',
    'clock', familyAnchor('cctv'),
    familyAnchor('shelf'), 'desk',
    familyAnchor('glass'),
    familyAnchor('door'),
    'cubicle', 'sink',
    familyAnchor('light'), 'vent',
    'guidepost', familyAnchor('busstop'),
    'ac-unit', 'electrical-cabinet',
  ])
  assert.deepEqual(anchors('equipment'), [
    'gate', 'fence',
    'tvm', 'vending',
    'escalator', 'lift',
    familyAnchor('stair'), familyAnchor('exit'),
  ])

  for (const folder of ['rail', 'equipment', 'decor']) {
    const tiles = folderTiles(folder)
    const drawn = tiles.map((t) => t.anchor)
    assert.equal(new Set(drawn).size, drawn.length, `${folder}: no tile is drawn twice`)
    // The order lists **every** tile the folder draws — each plain tile and each of its
    // families, and nothing else: an order that forgot a tile would leave a piece the
    // palette offers unreachable, and one that named a stranger would draw a blank tile.
    const expected = new Set([
      ...folderOptions(folder).map((m) => m.id),
      ...familiesIn(folder).map((f) => familyAnchor(f.key)),
    ])
    assert.deepEqual(new Set(drawn), expected, `${folder}: the order covers the folder's tiles exactly`)
    for (const tile of tiles) {
      if (tile.kind === 'family') {
        assert.equal(tile.family.folder, folder, `${tile.anchor} is a family of the ${folder} folder`)
        assert.equal(tile.anchor, familyAnchor(tile.family.key))
      } else {
        // A family's variant is its sub-menu's tile, never the grid's.
        assert.equal(isFamilyOption(tile.option.id), false, `${tile.option.id} is a tile of its own`)
        assert.equal(tile.anchor, tile.option.id)
      }
    }
    // The folder header's count is this list's length, so it can never disagree with the
    // tiles the grid really draws.
    assert.equal(tiles.length, folderOptions(folder).length + familiesIn(folder).length)
  }
})

test('the open slot follows the family table, so a variant cannot fold its own list away', () => {
  for (const family of MODULE_FAMILIES) {
    for (const option of familyOptions(family)) {
      // This is what the rail's open-slot effect asks when a variant is picked: it has to
      // answer with the family whose list the player is looking at, or the list folds away
      // underneath the tile they just clicked.
      assert.equal(subMenuForModule(option.id), family.key, `${option.id} keeps the ${family.key} list open`)
      assert.equal(subMenuForModule(option.type), family.key, `${option.id}: a placed piece answers the same`)
    }
  }
  assert.equal(subMenuForModule('bin'), null, 'a piece of its own closes every list')
  assert.equal(subMenuForModule('gate'), null)
})

test('every piece with an action row anchors to a tile its folder really draws', () => {
  for (const option of MODULE_OPTIONS) {
    const anchor = actionsAnchorFor(option.id)
    const family = familyFor(option.id)
    if (family) {
      // A variant's 旋转 row folds out under its family's tile…
      assert.equal(anchor, familyAnchor(family.key), `${option.id} anchors to its family tile`)
      const folder = family.folder
      assert.equal(
        familiesIn(folder).some((f) => familyAnchor(f.key) === anchor),
        true,
        `${option.id}: the ${folder} folder draws ${anchor}`,
      )
    } else {
      // …and a piece of its own under its own tile, which the grid draws by construction.
      assert.equal(anchor, option.id)
    }
    // The row only opens at all when the piece has something to put in it: every piece
    // the palette offers has one (everything rotates), and a family option is no
    // exception — the 旋转 tile is the whole orientation of a wall-mounted piece.
    assert.equal(hasModuleActions(option.id), option.id !== 'light-circular', `${option.id} opens an action row of its own`)
  }
})

test('an action row is open only under the family the player is picking from', () => {
  // The reported bug, as a rule: **click a 座椅 variant, then click 站名**. The two family
  // tiles share a grid row (`RAIL_ORDER`: 座椅 beside 站名), and the bench piece's 旋转 row is
  // inserted after that pair — so left open it drew the bench's 旋转 tile **directly above
  // 站名's variants**, reading as part of 站名 (and rotating a piece the player had stopped
  // looking at).
  const bench = familyFor('bench-steel-1')
  const ink = familyFor('calligraphy-kai-h')
  assert.equal(bench?.key, 'bench')
  assert.equal(ink?.key, 'calligraphy')
  const benchAnchor = actionsAnchorFor('bench-steel-1')

  // Browsing 站名 while the bench piece is still the one being placed: the row is parked.
  assert.equal(actionRowOpen(benchAnchor, benchAnchor, 'calligraphy'), false)
  // Browsing 站名's own variants with a 站名 piece selected: the row is under it, as asked.
  const inkAnchor = actionsAnchorFor('calligraphy-kai-h')
  assert.equal(actionRowOpen(inkAnchor, inkAnchor, 'calligraphy'), true)
  // No list open at all: the piece's row shows under its own tile.
  assert.equal(actionRowOpen(benchAnchor, benchAnchor, null), true)
  // Another tile's row never opens for a piece it does not belong to.
  assert.equal(actionRowOpen(inkAnchor, benchAnchor, 'calligraphy'), false)
  assert.equal(actionRowOpen('bin', benchAnchor, null), false)
  assert.equal(actionRowOpen(benchAnchor, null, 'bench'), false, 'no piece, no row')

  // For **every** family: its own list open means its pieces' rows are open, and every
  // other family's list means they are parked — so no family can ever show a stray row.
  for (const family of MODULE_FAMILIES) {
    const anchor = familyAnchor(family.key)
    assert.equal(actionRowOpen(anchor, anchor, family.key), true, `${family.key}: its own list keeps its row`)
    for (const other of MODULE_FAMILIES) {
      if (other.key === family.key) continue
      assert.equal(actionRowOpen(anchor, anchor, other.key), false, `${family.key}: parked while ${other.key} is open`)
    }
  }
  // A paint sub-menu is not a module family: while it is open no module family claims it,
  // so every action row is parked (the grid reads the open list as a family key or null).
  assert.equal(familiesIn('decor').some((f) => f.key === 'enamel'), false)
})

/* ------------------------------------------------- the 工具 folder's cut pieces */

/** A whole armed state, so a test states only the field it is about. */
const armedState = (over = {}) => ({
  tool: 'select',
  moduleType: 'gate',
  zoneBrush: 'paid',
  paintFinish: 'floor.granite',
  halfWall: false,
  triangles: false,
  triKind: 'upper',
  ...over,
})

test('生成墙壁 is not drawn while a cut piece owns the 方块 tool', () => {
  // A 半墙 or a 三角 **is** the wall a patch would otherwise grow, so the ring's tile
  // has nothing to say while one of them is armed. It used to be drawn greyed out
  // with a tooltip explaining itself — a control the player cannot use, sitting
  // among the ones they can. It is absent instead, and back with the plain tile.
  assert.equal(cutModeOf(false, false, 'upper'), null)
  assert.equal(cutModeOf(true, false, 'upper'), 'half')
  assert.equal(cutModeOf(false, true, 'upper'), 'upper')
  assert.equal(cutModeOf(false, true, 'lower'), 'lower')
  assert.equal(cutModeOf(true, true, 'lower'), 'half', 'the two cut modes are exclusive, and 半墙 wins')
  assert.equal(armedCut(armedState({ triangles: true, triKind: 'lower' })), 'lower', 'the rail asks the same question one way')

  for (const cut of CUT_MODES) {
    assert.equal(showsAutoWalls('block', cut.id), false, `${cut.id}: the ring's tile is not in the folder`)
    assert.equal(toolsFolderTiles(), 4, `${cut.id}: the editing tools retain four main tiles`)
  }
  assert.equal(showsAutoWalls('block', null), true, 'the plain 方块 tool keeps the ring')
  assert.equal(toolsFolderTiles(), 4)
  // The tile belongs to the 方块 tool: another tool's folder shows its own ten.
  for (const tool of ['select', 'pick', 'delete', 'wall', 'paint']) {
    assert.equal(showsAutoWalls(tool, null), false, `${tool} has no ring to raise`)
    assert.equal(toolsFolderTiles(), 4)
  }
})

test('a cut piece owns a 旋转 row, anchored to its own tile — the same row a 座椅 owns', () => {
  // The reported gap: the cut pieces' orientation was keyboard-only (**R**), and it was
  // fixed by hand in the 工具 folder. It is the *equipment* mechanism instead: a cut
  // piece is its own tile and its own anchor (`cutAnchor`), its 旋转 arrives through the
  // one `ActionRow` a 座椅's does, and nothing in the folder asks whether a cut is on.
  for (const cut of CUT_MODES) {
    const armed = armedState({ tool: 'block', halfWall: cut.id === 'half', triangles: cut.id !== 'half', triKind: cut.id === 'lower' ? 'lower' : 'upper' })
    const { tile, actions } = armedTiles(armed)
    assert.equal(tile, cutAnchor(cut.id), `${cut.id}: the armed cut is its own tile`)
    assert.equal(actions, cutAnchor(cut.id), `${cut.id}: and its row folds out under it`)
    assert.equal(armedRailTile(armed), cutAnchor(cut.id), 'the selector the shell reads answers the same')
    assert.equal(armedActionsAnchor(armed), cutAnchor(cut.id), 'and so does the one every grid reads')
    // The row opens exactly as an equipment row does — the same two rules.
    assert.equal(actionRowOpen(cutAnchor(cut.id), armedActionsAnchor(armed), null), true, `${cut.id}: its own row is open`)
    assert.equal(actionRowOpen('wall', armedActionsAnchor(armed), null), false, `${cut.id}: the 墙 tile's row is not`)
    assert.equal(actionRowOpen(cutAnchor(cut.id), null, null), false, 'and a row with no armed piece never opens')
  }
  // A plain 方块 owns neither: the ring tile beside it is a setting of the tool.
  assert.deepEqual(armedTiles(armedState({ tool: 'block' })), { tile: 'block', actions: null })
  // Only the 方块 tool has cuts. A cut left armed in the store must not fold a row out
  // of any other tool's grid: the 墙 tool turns its own corner face with R, and a 设备
  // grid folds out the *piece's* row and nothing else.
  for (const tool of ['select', 'pick', 'delete', 'wall', 'paint', 'module', 'rail']) {
    const anchor = armedActionsAnchor(armedState({ tool, halfWall: true }))
    assert.equal(
      CUT_MODES.some((c) => cutAnchor(c.id) === anchor),
      false,
      `${tool}: a stale armed cut folds no cut row out`,
    )
  }
  // Every cut's anchor is a tile **the folder draws**: the tools grid is built from this
  // very table, so the two cannot drift — the same contract the piece anchors hold.
  const drawn = new Set(CUT_MODES.map((c) => cutAnchor(c.id)))
  for (const cut of CUT_MODES) assert.equal(drawn.has(cutAnchor(cut.id)), true, `${cut.id} is drawn where its row anchors`)
})

/* ------------------------------------------------- what the rail keeps in view */

test('the armed thing names the tile the rail scrolls to', () => {
  const armed = (over) => armedRailTile(armedState(over))
  // A placed piece, plain or a variant of a family: the tile is the palette option.
  assert.equal(armed({ tool: 'module', moduleType: 'gate' }), 'gate')
  assert.equal(armed({ tool: 'module', moduleType: 'bench-seat-2' }), 'bench-seat-2')
  assert.equal(armed({ tool: 'module', moduleType: 'calligraphy-li-v' }), 'calligraphy-li-v')
  // The 轨道 folder's two tiles, and the brushes of the 分区 / 房间 and 材质 folders.
  assert.equal(armed({ tool: 'rail' }), '__platform')
  assert.equal(armed({ tool: 'tunnel' }), '__tunnel')
  assert.equal(armed({ tool: 'zone', zoneBrush: 'paid' }), 'paid')
  assert.equal(armed({ tool: 'zone', zoneBrush: 'toilet' }), 'toilet')
  assert.equal(armed({ tool: 'zone', zoneBrush: 'none' }), 'none', '无分区 is a tile of its own')
  assert.equal(armed({ tool: 'paint', paintFinish: 'wall.tile' }), 'wall.tile')
  assert.equal(armed({ tool: 'paint', paintFinish: 'wall.enamel#3fa9f5' }), 'wall.enamel', '搪瓷板 reveals the tile its colour is a shade of')
  // A cut piece is a tile too — the same derivation answers for it, which is why
  // **Tab**-ing to another cut scrolls its tile into view like any other pick.
  assert.equal(armed({ tool: 'block', halfWall: true }), cutAnchor('half'))
  assert.equal(armed({ tool: 'block', triangles: true, triKind: 'lower' }), cutAnchor('lower'))
  assert.equal(armed({ tool: 'block' }), 'block', 'a plain 方块 reveals its structure tile')
  assert.equal(armed({ tool: 'wall' }), 'wall')
  // Tools whose subject is a face, or a selection: nothing of their own to show.
  assert.equal(armed({ tool: 'select' }), null)
  assert.equal(armed({ tool: 'pick' }), null)
  assert.equal(armed({ tool: 'delete' }), null)
})

test('the 分区 folder is its zone list plus the three room brushes, 无分区 included, and that tile erases', () => {
  // The folder draws one tile per zone in `ZONE_LIST` plus the three walled-room
  // brushes (商店 / 厕所 / 办公室 — 售票亭 and 问讯处 stay in 房间), and the
  // header's count is that sum — so a new zone, a lost 无分区 tile or a missing
  // room brush moves the number with it. 无分区 is the one tile that is *not* a
  // slab: arming it takes a label off rather than writing one (`isEraseBrush`),
  // which is why the folder's grid and the card's chip row both branch on it.
  assert.equal(zoneFolderTiles(), ZONE_LIST.length + 3)
  assert.equal(ZONE_LIST[0].id, 'none', '无分区 leads: it is the state an unpainted cell is in')
  assert.equal(zoneFolderTiles(), 9)
  assert.deepEqual(
    FACILITY_OPTIONS.filter((f) => f.id !== 'ticket' && f.id !== 'info').map((f) => f.id),
    ['store', 'toilet', 'office'],
    'the three room brushes are the facility options outside 售票亭 / 问讯处',
  )
  assert.equal(isEraseBrush('none'), true)
  assert.equal(isEraseBrush('paid'), false)
  assert.equal(isEraseBrush('store'), false, 'a room brush paints a room, it does not erase')
  assert.equal(isFacilityBrush('none'), false, 'and it is not a room brush either')
  assert.equal(isFacilityBrush('toilet'), true)
  // Every other zone is a slab the folder renders: 无分区 is the only one without a
  // thumbnail of its own (`app/zoneThumbnails.ts` skips it).
  assert.equal(ZONE_LIST.filter((z) => z.id !== 'none').length, 5)
})

test('a tile already in view needs no scrolling, and one outside it does', () => {
  const box = { top: 100, bottom: 500 }
  // Fully in view, either end: the rail does not move.
  assert.equal(revealScrollDelta(box, { top: 200, bottom: 260 }), 0)
  assert.equal(revealScrollDelta(box, { top: 108, bottom: 168 }), 0, 'the pad still clears the top edge')
  assert.equal(revealScrollDelta(box, { top: 440, bottom: 492 }), 0, 'and the bottom one')
  // Below the fold: the rail scrolls down by exactly the overhang, pad included.
  assert.equal(revealScrollDelta(box, { top: 520, bottom: 580 }), 580 + 8 - 500)
  // Above it: and up by the same measure.
  assert.equal(revealScrollDelta(box, { top: 40, bottom: 100 }), 40 - 8 - 100)
  // Partly below but short enough to fit: the overhang only, so the top stays put.
  assert.equal(revealScrollDelta(box, { top: 480, bottom: 700 }), 700 + 8 - 500)
  // Taller than the box: its top is what is aligned, because that is where its label is.
  assert.equal(revealScrollDelta(box, { top: 150, bottom: 650 }), 150 - 8 - 100)
})
