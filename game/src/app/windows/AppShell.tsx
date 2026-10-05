// Lane A split (Phase 1): moved verbatim from app/App.tsx — App() composes the
// five windows (TopBar + LeftRail + Viewport + Inspector + BottomBar) and owns
// the global keyboard shortcuts and the notice toast. Kept under the App name
// so the old import path (via the App.tsx barrel) keeps working.
import { useEffect } from 'react'
import { useStore, isEscalatorType, isGateType, isRotatableType, isStairType } from '../store.ts'
import { LeftRail } from '../LeftRail.tsx'
import { Viewport, isTypingTarget } from '../Viewport.tsx'
import { SignEditor } from '../SignEditor.tsx'
import { folderForShiftKey } from '../rail/helpers.ts'
import { TopBar } from './topbar/TopBar.tsx'
import { Inspector } from './inspector/Inspector.tsx'
import { BottomBar } from './statusbar/BottomBar.tsx'

export function App(): React.ReactElement {
  const setTool = useStore((s) => s.setTool)
  const notice = useStore((s) => s.notice)

  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => useStore.getState().setNotice(null), 3200)
    return () => window.clearTimeout(id)
  }, [notice])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useStore.getState()
      if (isTypingTarget(e.target)) return
      // While the 指示牌 board editor is up it owns the keyboard: Space, R, Tab and
      // Delete all mean something to the board being composed, not to the station
      // behind it. Its own Delete binding lives on the board (SignEditor).
      if (st.signEditorFor !== null || st.signComposing) return
      // Ctrl shortcuts for the top-bar icon actions (shown in their tooltips).
      // Handled before the single-letter tool keys so Ctrl+N never also grabs
      // the 材质 brush, etc.
      const ck = e.key.toLowerCase()
      // Shift+Q … Shift+I fold the rail's folders, one letter a row down the stack
      // (`rail/helpers.ts` `RAIL_FOLDERS`): Shift+Q is 工具, the first folder, and
      // W E R T Y U I follow the folders below it. The rail owns which folders are
      // open, so this only names the folder and hands it over. It runs before the
      // switch below because every one of these letters already means something
      // unshifted — Q/E step the storey, R turns, U hides the UI, I picks a finish
      // — and a held key repeats, which would flicker the folder it names.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        const folder = folderForShiftKey(ck)
        if (folder) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('metro:folder', { detail: folder }))
          return
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (ck === 's') {
          e.preventDefault()
          st.saveToFile()
          return
        }
        if (ck === 'n' && e.shiftKey) {
          e.preventDefault()
          st.loadReference()
          return
        }
        if (ck === 'n') {
          e.preventDefault()
          st.newStation()
          return
        }
        if (ck === 'l') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('metro:open'))
          return
        }
        if (ck === 'r') {
          e.preventDefault()
          st.restartSim()
          return
        }
        // 回到默认视角: the nav cube's own ⌂ button, on the keyboard. It is the one
        // camera key with a modifier — a plain H is 隐藏天花板 — and the Viewport owns
        // the scene, so the press is handed over as `metro:home` exactly as the
        // presets and 框选 use `metro:preset` / `metro:frame`.
        if (ck === 'h') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('metro:home'))
          return
        }
        // Undo/redo keep their bindings in the switch below; every other
        // Ctrl/⌘+letter is ignored here.
        if (ck !== 'z' && ck !== 'y') return
      }
      switch (e.key.toLowerCase()) {
        case ' ':
          // Space is the play/pause key. A focused button would also fire on
          // keyup (native Space-activates-button), so drop focus on keydown —
          // the keyup then lands on the body and cannot re-click it — and
          // always toggle. Otherwise Space right after clicking 4× would just
          // re-press 4× instead of pausing.
          e.preventDefault()
          if ((e.target as HTMLElement)?.tagName === 'BUTTON') (e.target as HTMLElement).blur()
          st.setPlaying(!st.playing)
          break
        case 'v':
          setTool('select' as const)
          break
        case 'b':
          st.setTool('delete')
          break
        case 'f':
          st.setTool('block')
          break
        case 'g':
          st.setTool('wall')
          break
        case 'j':
          st.setTool('module')
          break
        case 'r':
          if (e.ctrlKey || e.metaKey || e.altKey) break
          // While 剖切 is on, R is the cut's own quarter turn — the 旋转 tile's
          // shortcut, and the one key the cut has. It wins over the piece being
          // placed for as long as the cut is up, the way the surface itself owns
          // the pointer when the mouse is on it (`app/Viewport.tsx`); switching
          // the cut off hands R straight back.
          if (st.cutaway) st.rotateSection()
          // A piece in the air (移动) is what R turns, whatever tool is active: the
          // 信息 card lifted it, so there is no move tool to ask.
          else if (st.moveDraft) st.rotateMove()
          // The 墙 tool has no piece to turn: R picks which of a corner cell's
          // wall faces the column takes (`wallSnap` in `build/model.ts`). In the
          // 地基 tool's cut modes the same counter steps the piece to another half of
          // the tile — a 半墙 to the other half, a 三角 to the next corner — which is
          // that mode's one orientation choice. With both modes off the 地基 tool has
          // nothing of its own to turn, so the key stops there rather than turning
          // whatever piece the 设备 folder was left on.
          else if (st.tool === 'wall') st.rotateWallSnap()
          else if (st.tool === 'block') {
            if (st.halfWall || st.triangles) st.rotateWallSnap()
          } else if (st.tool === 'rail') st.rotateRail()
          else if (st.tool !== 'tunnel' && isRotatableType(st.moduleType)) st.rotateModule()
          break
        case 'tab':
          // In the 地基 tool Tab steps the cut modes — 半墙 → 三角上 → 三角下 → off — which
          // is the question a 地基 click answers: what shape does this one lay. It used
          // to toggle the generated 4 m wall ring, which is now **off when the game
          // opens** and asked for on its own tile instead: the ring is the one thing
          // this tool does that the player did not draw, so it no longer takes the
          // most-reached key in the folder. Everywhere else Tab keeps its own meaning
          // for the piece being placed: rail direction, stair width, escalator
          // direction, the 闸机's lane or fence.
          e.preventDefault()
          if (st.tool === 'block') {
            st.cycleCutMode()
          } else if (st.tool === 'rail') st.cycleRailDir()
          else if (isStairType(st.moduleType)) st.cycleStairWidth()
          else if (isEscalatorType(st.moduleType)) st.cycleEscalatorDir()
          else if (isGateType(st.moduleType)) st.cycleGateDoor()
          break
        case 'n':
          st.setTool('paint')
          st.setPaintMode('single')
          break
        case 'm':
          st.setTool('paint')
          st.setPaintMode('surface')
          break
        case 'i':
          st.setTool('paint')
          st.setPaintMode('pick')
          break
        case 'q':
          st.stepLevel(-1)
          break
        case 'e':
          st.stepLevel(1)
          break
        case 'x':
          st.setGhostOther(!st.ghostOtherLevels)
          break
        case 'c':
          st.setCutaway(!st.cutaway)
          break
        case 'h':
          st.setAutoCeiling(!st.autoCeiling)
          break
        // 隐藏UI: the editing lattice and the storey slice, off the picture
        // (`render/scene/systems/GridSystem.ts`, `render/levelSlicing.ts`).
        case 'u':
          st.setHideUI(!st.hideUI)
          break
        case 'y':
          // 隐藏剖切面: the cut stays, its sheet and direction arrow go.
          st.setHideSectionSurface(!st.hideSectionSurface)
          break
        case 'o':
          st.setOrtho(!st.ortho)
          break
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          window.dispatchEvent(new CustomEvent('metro:preset', { detail: e.key }))
          break
        case 'home':
          window.dispatchEvent(new CustomEvent('metro:frame'))
          break
        case 'delete':
        case 'backspace':
          window.dispatchEvent(new CustomEvent('metro:delete'))
          break
        case 'z':
          if (e.ctrlKey || e.metaKey) {
            if (e.shiftKey) st.redo()
            else st.undo()
          } else {
            // Z is the 选择 tool now; 分区 moved to P.
            st.setTool('select')
          }
          break
        case 'p':
          st.setTool('zone')
          break
        case 'l':
          st.setTool('rail')
          break
        case 'y':
          if (e.ctrlKey || e.metaKey) st.redo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTool])

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftRail />
        <div className="stage">
          <Viewport />
        </div>
        <Inspector />
      </div>
      <BottomBar />
      {notice && (
        <div className="toast" onClick={() => useStore.getState().setNotice(null)}>
          {notice}
        </div>
      )}
      {/* The 指示牌 board editor is a modal over everything, so the board is as big
          as the window will allow. */}
      <SignEditor />
    </div>
  )
}
