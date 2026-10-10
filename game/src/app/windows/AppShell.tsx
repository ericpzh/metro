// Lane A split (Phase 1): moved verbatim from app/App.tsx — App() composes the
// five windows (TopBar + LeftRail + Viewport + Inspector + BottomBar) and owns
// the global keyboard shortcuts and the notice toast. Kept under the App name
// so the old import path (via the App.tsx barrel) keeps working.
import { useEffect } from 'react'
import { useStore, isBenchType, isDoorType, isEscalatorType, isGateType, isRotatableType, isStairType } from '../store.ts'
import { LeftRail } from '../LeftRail.tsx'
import { Viewport, isTypingTarget } from '../Viewport.tsx'
import { SignEditor } from '../SignEditor.tsx'
import { folderForAltKey, folderForShiftKey } from '../rail/helpers.ts'
import { TopBar } from './topbar/TopBar.tsx'
import { Inspector } from './inspector/Inspector.tsx'
import { BottomBar } from './statusbar/BottomBar.tsx'
import { TimePanel } from './time/TimePanel.tsx'

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
      // Ctrl shortcuts for the top-bar icon actions (their accessible names say so).
      // Handled before the single-letter tool keys so Ctrl+N never also grabs
      // the 材质 brush, etc.
      const ck = e.key.toLowerCase()
      // Shift+Q … Shift+U fold the build rail's folders, one letter a row down the stack
      // (`rail/helpers.ts` `RAIL_FOLDERS`): Shift+Q is 工具, the first folder, and
      // W E R T Y U follow the folders below it. **Alt+Q … Alt+R** do the same for the
      // 信息栏's own stack (`INSPECTOR_FOLDERS`: 信息, 视图, 出入口, 线路) — a modifier per
      // column, so the same four letters serve both stacks without a clash. Each shell
      // owns which of its folders are open, so this only names the folder and hands it over.
      // Both run before the switch below because every one of these letters already means
      // something unmodified — Q/E step the storey, R turns, U hides the UI, P 吸取,
      // T 分区 — and a held key repeats, which would flicker the folder it names.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
        const folder = folderForShiftKey(ck)
        if (folder) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('metro:folder', { detail: folder }))
          return
        }
      }
      // The 信息栏's half of the same idea. `!e.ctrlKey` is what keeps **AltGr** out of
      // it: on a European layout AltGr *is* Ctrl+Alt, so AltGr+letter types a character
      // and must not fold a folder — the same guard the camera's Ctrl+Q/E pan uses.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat) {
        const folder = folderForAltKey(ck)
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
          window.dispatchEvent(new CustomEvent('metro:examples'))
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
          // F is the plain 方块 tile's key: it always lands on a plain block,
          // clearing any cut piece (半墙 / 三角) the tool was left in — the same
          // thing clicking the 方块 tile does.
          st.setTool('block')
          if (st.halfWall || st.triangles) st.setCutMode(null)
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
          // 方块 tool's cut modes the same counter steps the piece to another half of
          // the tile — a 半墙 to the other half, a 三角 to the next corner — which is
          // that mode's one orientation choice. With both modes off the 方块 tool has
          // nothing of its own to turn, so the key stops there rather than turning
          // whatever piece the 设备 folder was left on.
          else if (st.tool === 'wall') st.rotateWallSnap()
          else if (st.tool === 'block') {
            if (st.halfWall || st.triangles) st.rotateWallSnap()
          } else if (st.tool === 'rail') st.rotateRail()
          else if (st.tool === 'module' && isRotatableType(st.moduleType)) st.rotateModule()
          break
        case 'tab':
          // In the 方块 tool Tab raises the generated **生成墙壁** ring — the key the
          // tile wears, so the one thing this tool does that the player did not draw
          // is a keystroke away. It is **refused while a cut piece owns the tool**,
          // the same refusal the tile's own absence is: a 半墙 or a 三角 *is* the wall
          // the patch would grow, so the press does nothing rather than switching a
          // cut off behind the player's back (`setAutoWalls` holds that guard). The
          // three cut pieces are picked on their own tiles, one click each, and
          // **R** turns whichever is armed.
          // Everywhere else Tab keeps its own meaning for the piece being
          // placed: rail direction, stair or roof width, escalator direction, the 闸机's
          // lane or fence.
          e.preventDefault()
          if (st.moveDraft?.module.type === 'light') st.cycleMoveLightPosition()
          else if (st.tool === 'module' && st.moduleType === 'light-rectangular') st.cycleLightPosition()
          else if (st.tool === 'block') {
            st.setAutoWalls(!st.autoWalls)
          } else if (st.tool === 'rail') st.cycleRailDir()
          else if (st.tool === 'tunnel') st.cycleTunnelLength()
          else if (st.tool === 'module' && st.moduleType === 'bridge') st.cycleBridgeLength()
          else if (st.tool === 'module' && st.moduleType.startsWith('pillar')) st.togglePillarLength()
          else if (st.tool === 'module' && isStairType(st.moduleType)) st.cycleStairWidth()
          else if (st.tool === 'module' && isDoorType(st.moduleType)) st.toggleDoorWidth()
          else if (st.tool === 'module' && isBenchType(st.moduleType)) st.cycleBenchWidth()
          else if (st.tool === 'module' && (st.moduleType === 'roof-shell' || st.moduleType === 'roof-truss' || st.moduleType === 'roof-tapered')) st.cycleRoofWidth()
          else if (st.tool === 'module' && isEscalatorType(st.moduleType)) st.cycleEscalatorDir()
          else if (st.tool === 'module' && st.moduleType === 'lift') st.cycleLiftStyle()
          else if (st.tool === 'module' && (st.moduleType === 'hanger-roof' || st.moduleType === 'hanger-post')) st.cycleHangerLength()
          else if (st.tool === 'module' && st.moduleType === 'curtain-wall') st.cycleCurtainWidth()
          else if (st.tool === 'module' && st.moduleType === 'psd-end') st.cyclePsdEndHeight()
          else if (st.tool === 'module' && isGateType(st.moduleType)) st.cycleGateDoor()
          break
        case 'n':
          st.setTool('paint')
          st.setPaintMode('single')
          break
        case 'm':
          st.setTool('move')
          break
        case 'i':
          // `I` is the old 取色 key, kept as an alias: eyedropping moved to the
          // 工具 folder's 吸取 (`P`), which lifts equipment as well as finishes.
          st.setTool('pick')
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
          // Ctrl/⌘+**Y** is redo, beside Ctrl+Shift+Z (the guard above passes `y`
          // through with its modifier for exactly this); a plain **Y** is 隐藏剖切面
          // — the cut stays, its sheet and direction arrow go. Both live here
          // because a switch takes its first match: a second `case 'y'` below was
          // unreachable, so Ctrl+Y toggled the cut instead of redoing.
          if (e.ctrlKey || e.metaKey) st.redo()
          else st.setHideSectionSurface(!st.hideSectionSurface)
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
            // Z is the 选择 tool now; 分区 moved to T (吸取 took P).
            st.setTool('select')
          }
          break
        case 'p':
          st.setTool('pick')
          break
        case 't':
          st.setTool('zone')
          break
        case 'l':
          st.setTool('rail')
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
      {/* The 时刻 window floats over the game rather than covering it: the station it
          describes stays visible behind the panel (§9.6C). */}
      <TimePanel />
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
