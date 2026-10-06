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
  MODULE_FAMILIES,
  MODULE_OPTIONS,
  actionRowOpen,
  actionsAnchorFor,
  familiesIn,
  familyAnchor,
  familyFor,
  familyOptions,
  folderOptions,
  hasModuleActions,
  isDecorType,
  isFamilyOption,
} from '../src/app/store.ts'
import { subMenuForModule } from '../src/app/rail/helpers.ts'

test('every family is one row: a key, a label, a folder and the ids it owns', () => {
  assert.equal(MODULE_FAMILIES.length, 7)
  assert.deepEqual(
    MODULE_FAMILIES.map((f) => f.key),
    ['stair', 'exit', 'bench', 'billboard', 'glass', 'calligraphy', 'linemap'],
    'the rail order: 设备 first, then 装饰',
  )
  for (const family of MODULE_FAMILIES) {
    assert.ok(family.label.length > 0, `${family.key} wears a label on its parent tile`)
    assert.equal(family.folder, familiesIn('equipment').includes(family) ? 'equipment' : 'decor')
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
  assert.deepEqual(familiesIn('decor').map((f) => f.key), ['bench', 'billboard', 'glass', 'calligraphy', 'linemap'])
})

test('a variant never appears twice: the grid holds only the plain tiles', () => {
  for (const folder of ['equipment', 'decor']) {
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
    const owned = MODULE_OPTIONS.filter((m) => (folder === 'decor' ? isDecorType(m.type) : !isDecorType(m.type)))
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
    assert.equal(hasModuleActions(option.id), true, `${option.id} opens an action row of its own`)
  }
})

test('an action row is open only under the family the player is picking from', () => {
  // The reported bug, as a rule: **click a 玻璃板 variant, then click 站名**. The two
  // family tiles share a grid row, and the glass piece's 旋转 row is inserted after that
  // pair — so left open it drew directly above 站名's variants, reading as 站名's (and
  // rotating a piece the player had stopped looking at).
  const glass = familyFor('glass-2x1')
  const calligraphy = familyFor('calligraphy-kai-h')
  const glassAnchor = actionsAnchorFor('glass-2x1')

  // Browsing 站名 while the glass piece is still the one being placed: the row is parked.
  assert.equal(actionRowOpen(glassAnchor, glassAnchor, 'calligraphy'), false)
  // Browsing 站名's own variants with a 站名 piece selected: the row is under it, as asked.
  const inkAnchor = actionsAnchorFor('calligraphy-kai-h')
  assert.equal(actionRowOpen(inkAnchor, inkAnchor, 'calligraphy'), true)
  // No list open at all: the piece's row shows under its own tile.
  assert.equal(actionRowOpen(glassAnchor, glassAnchor, null), true)
  // Another tile's row never opens for a piece it does not belong to.
  assert.equal(actionRowOpen(inkAnchor, glassAnchor, 'calligraphy'), false)
  assert.equal(actionRowOpen('bin', glassAnchor, null), false)
  assert.equal(actionRowOpen(glassAnchor, null, 'glass'), false, 'no piece, no row')

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
