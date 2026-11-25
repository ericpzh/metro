import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  TOOL_POINTER_OFFSET,
  customToolCursorFor,
  readSectionHot,
  syncViewportCanvasClasses,
  toolPointerPosition,
} from '../../game/src/unity-web/viewportCursor.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function makeClassList(initial = []) {
  const set = new Set(initial)
  return {
    add(...tokens) { for (const token of tokens) set.add(token) },
    remove(...tokens) { for (const token of tokens) set.delete(token) },
    toggle(token, force) {
      if (force === undefined) {
        if (set.has(token)) { set.delete(token); return false }
        set.add(token); return true
      }
      if (force) set.add(token)
      else set.delete(token)
      return force
    },
    contains(token) { return set.has(token) },
    values() { return [...set] },
  }
}

test('customToolCursorFor matches web Viewport tool icons and suppresses during modals/eye/benchmark/section grab', () => {
  assert.equal(customToolCursorFor({ tool: 'move' }), 'move')
  assert.equal(customToolCursorFor({ tool: 'delete' }), 'delete')
  assert.equal(customToolCursorFor({ tool: 'pick' }), 'pick')

  for (const tool of ['select', 'block', 'wall', 'module', 'paint', 'zone', 'rail', 'tunnel']) {
    assert.equal(customToolCursorFor({ tool }), null, `${tool} keeps crosshair cursor`)
  }

  assert.equal(customToolCursorFor({ tool: 'delete', explodedView: true }), null)
  assert.equal(customToolCursorFor({ tool: 'move', followAgentId: 7 }), null)
  assert.equal(customToolCursorFor({ tool: 'pick', benchmarkActive: true }), null)
  assert.equal(customToolCursorFor({ tool: 'delete', sectionOn: true, sectionHot: true }), null)
  assert.equal(customToolCursorFor({ tool: 'delete', sectionOn: false, sectionHot: true }), 'delete')
})

test('readSectionHot prefers immediate edit.sectionHot and falls back to view.sectionHandle', () => {
  assert.equal(readSectionHot(null), false)
  assert.equal(readSectionHot({}), false)
  assert.equal(readSectionHot({ edit: { sectionHot: true }, view: { sectionHandle: { hovered: false, active: false } } }), true)
  assert.equal(readSectionHot({ edit: { sectionHot: false }, view: { sectionHandle: { hovered: true, active: true } } }), false)
  assert.equal(readSectionHot({ view: { sectionHandle: { hovered: true, active: false } } }), true)
  assert.equal(readSectionHot({ view: { sectionHandle: { hovered: false, active: true } } }), true)
  assert.equal(readSectionHot({ view: { sectionHandle: { hovered: false, active: false } } }), false)
})

test('toolPointerPosition scales (+5, +5) offset with UI scale', () => {
  assert.deepEqual(TOOL_POINTER_OFFSET, { x: 5, y: 5 })
  assert.deepEqual(toolPointerPosition(120, 85, { left: 20, top: 15 }), { left: 105, top: 75 })
  assert.deepEqual(toolPointerPosition(120, 85, { left: 20, top: 15 }, 1.5), { left: 108, top: 78 })
  assert.deepEqual(toolPointerPosition(40, 30, null), { left: 45, top: 35 })
})

test('syncViewportCanvasClasses toggles selectCursor, grab, and toolPointer without clobbering explodedArrangeCanvas', () => {
  const classList = makeClassList(['explodedArrangeCanvas'])
  const canvas = { classList }

  assert.equal(syncViewportCanvasClasses(canvas, { tool: 'select', explodedView: false, sectionOn: false, sectionHot: false }), null)
  assert.equal(classList.contains('viewport'), true)
  assert.equal(classList.contains('selectCursor'), true)
  assert.equal(classList.contains('toolPointer'), false)
  assert.equal(classList.contains('grab'), false)

  assert.equal(syncViewportCanvasClasses(canvas, { tool: 'select', explodedView: false, sectionOn: true, sectionHot: true }), null)
  assert.equal(classList.contains('selectCursor'), false)
  assert.equal(classList.contains('grab'), true)

  assert.equal(syncViewportCanvasClasses(canvas, { tool: 'delete', explodedView: true, sectionOn: true, sectionHot: true }), null)
  assert.equal(classList.contains('viewport'), true)
  assert.equal(classList.contains('explodedArrangeCanvas'), true)
  assert.equal(classList.contains('selectCursor'), false)
  assert.equal(classList.contains('toolPointer'), false)
  assert.equal(classList.contains('grab'), false)

  assert.equal(syncViewportCanvasClasses(canvas, { tool: 'delete', explodedView: false, sectionOn: false, sectionHot: false }), 'delete')
  assert.equal(classList.contains('selectCursor'), false)
  assert.equal(classList.contains('toolPointer'), true)
  assert.equal(classList.contains('grab'), false)
  assert.equal(classList.contains('explodedArrangeCanvas'), true)

  assert.equal(syncViewportCanvasClasses(canvas, { tool: 'delete', explodedView: false, sectionOn: true, sectionHot: true }), null)
  assert.equal(classList.contains('selectCursor'), false)
  assert.equal(classList.contains('toolPointer'), false)
  assert.equal(classList.contains('grab'), true)

  assert.equal(syncViewportCanvasClasses(canvas, { tool: 'block', explodedView: false, sectionOn: true, sectionHot: false }), null)
  assert.equal(classList.contains('selectCursor'), false)
  assert.equal(classList.contains('toolPointer'), false)
  assert.equal(classList.contains('grab'), false)
})

test('Unity web shell, C# edit state, WebView2 overlay, and desktop presenter keep tool cursor parity wired end-to-end', () => {
  const mainSrc = readFileSync(path.join(repoRoot, 'game', 'src', 'unity-web', 'main.tsx'), 'utf8')
  assert.match(mainSrc, /TfiHandDrag/)
  assert.match(mainSrc, /TbBulldozer/)
  assert.match(mainSrc, /CgColorPicker/)
  assert.match(mainSrc, /className="movePointer"/)
  assert.match(mainSrc, /className="deletePointer"/)
  assert.match(mainSrc, /className="pickerPointer"/)
  assert.match(mainSrc, /syncViewportCanvasClasses/)

  const editSessionSrc = readFileSync(path.join(repoRoot, 'unity', 'Assets', 'StationDesigner', 'Runtime', 'App', 'StationEditSession.cs'), 'utf8')
  assert.match(editSessionSrc, /\["sectionHot"\]\s*=\s*StationSectionDrag\.Hovered\s*\|\|\s*StationSectionDrag\.Current\s*!=\s*null/)

  const unityUiCss = readFileSync(path.join(repoRoot, 'game', 'src', 'unity-web', 'unity-ui.css'), 'utf8')
  assert.match(unityUiCss, /\.viewport\.selectCursor\s*\{\s*cursor:\s*default;\s*\}/)
  assert.match(unityUiCss, /width:\s*calc\(32px \* var\(--ui-scale, 1\)\)/)

  const programSrc = readFileSync(path.join(repoRoot, 'tools', 'unity-editor-ui', 'Program.cs'), 'utf8')
  assert.match(programSrc, /__metro_cursor__:/)
  assert.match(programSrc, /kind\s*=\s*"cursor"/)
  assert.match(programSrc, /getComputedStyle\(el\)\.cursor/)
  assert.match(programSrc, /--ui-scale/)

  const cursorsCs = path.join(repoRoot, 'unity', 'Assets', 'StationDesigner', 'Runtime', 'App', 'StationDesktopCursors.cs')
  assert.equal(existsSync(cursorsCs), true, 'StationDesktopCursors.cs must exist')
  assert.equal(existsSync(`${cursorsCs}.meta`), true, 'StationDesktopCursors.cs.meta must exist')
  const cursorsSrc = readFileSync(cursorsCs, 'utf8')
  for (const name of ['crosshair', 'pointer', 'grab', 'grabbing', 'move', 'text', 'ew-resize', 'ns-resize', 'not-allowed']) {
    assert.match(cursorsSrc, new RegExp(`case "${name}":`), `StationDesktopCursors must define ${name}`)
  }

  const presenterSrc = readFileSync(path.join(repoRoot, 'unity', 'Assets', 'StationDesigner', 'Runtime', 'App', 'StationDesktopUiPresenter.cs'), 'utf8')
  assert.match(presenterSrc, /case "cursor":/)
  assert.match(presenterSrc, /ApplyOverlayCursor\(\)/)
  assert.match(presenterSrc, /ResetOverlayCursor\(\)/)
  assert.match(presenterSrc, /Cursor\.SetCursor\(/)
  assert.match(presenterSrc, /Cursor\.visible\s*=\s*false/)
  assert.match(presenterSrc, /Cursor\.visible\s*=\s*true/)
})
