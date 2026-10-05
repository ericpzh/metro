// Lane A split (Phase 1): moved verbatim from app/App.tsx — App() composes the
// five windows (TopBar + LeftRail + Viewport + Inspector + BottomBar) and owns
// the global keyboard shortcuts and the notice toast. Kept under the App name
// so the old import path (via the App.tsx barrel) keeps working.
import { useEffect } from 'react'
import { useStore, isEscalatorType, isGateType, isRotatableType, isStairType } from '../store.ts'
import { LeftRail } from '../LeftRail.tsx'
import { Viewport } from '../Viewport.tsx'
import { SignEditor } from '../SignEditor.tsx'
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
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      // While the 指示牌 board editor is up it owns the keyboard: Space, R, Tab and
      // Delete all mean something to the board being composed, not to the station
      // behind it. Its own Delete binding lives on the board (SignEditor).
      if (st.signEditorFor !== null || st.signComposing) return
      // Ctrl shortcuts for the top-bar icon actions (shown in their tooltips).
      // Handled before the single-letter tool keys so Ctrl+N never also grabs
      // the 材质 brush, etc.
      const ck = e.key.toLowerCase()
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
          if (tag === 'BUTTON') (e.target as HTMLElement).blur()
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
          // A piece in the air (移动) is what R turns, whatever tool is active: the
          // 信息 card lifted it, so there is no move tool to ask.
          if (st.moveDraft) st.rotateMove()
          // The 墙 tool has no piece to turn: R picks which of a corner cell's
          // wall faces the column takes (`wallSnap` in `build/model.ts`). In the
          // 地基 tool's **半墙** mode the same counter steps the panel to another
          // half of the tile — that mode's one orientation choice. With 半墙 off the
          // 地基 tool has nothing of its own to turn, so the key stops there rather
          // than turning whatever piece the 设备 folder was left on.
          else if (st.tool === 'wall') st.rotateWallSnap()
          else if (st.tool === 'block') {
            if (st.halfWall) st.rotateWallSnap()
          } else if (st.tool === 'rail') st.rotateRail()
          else if (st.tool !== 'tunnel' && isRotatableType(st.moduleType)) st.rotateModule()
          break
        case 'tab':
          // In the 地基 tool Tab toggles the generated 4 m wall ring on/off.
          // **半墙** has no shortcut: it is click-only. Everywhere else Tab keeps
          // its own meaning for the piece being placed: rail direction, stair
          // width, escalator direction, the 闸机's lane or fence.
          e.preventDefault()
          if (st.tool === 'block') {
            st.setAutoWalls(!st.autoWalls)
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
        case 'u':
          // 隐藏UI: the drawing lattice, not the interface — see the 视图 folder's
          // 隐藏UI tile and `render/scene/systems/GridSystem.ts`.
          st.setHideUI(!st.hideUI)
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
