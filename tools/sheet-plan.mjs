// tools/sheet-plan.mjs — what each concept sheet is a picture of.
//
// One entry per sheet in `art/`, in the order the tool draws them. `id` is the
// sheet's number in the spec and matches the file name's prefix; `file` is what
// `web/public/art/` serves, so the site's `artworks.js` keeps pointing at the
// same names.
//
// A sheet is made of **panels**: rectangles of the composed sheet, each filled
// by one photograph of the demo station. `place` is that rectangle in sheet
// pixels — under `tools/shots.mjs` the sheet is 1920x1080 — and each capture is
// sized to its own panel, so a panel only ever has to fit its own box.
//
// A panel's `cam` says where the camera stands and what it frames:
//
//   from     the world direction the station is seen *from*; the distance is
//            worked out by the tool, so these are directions, not positions
//   at       the point to look at — normally a `region`'s own centre
//   region   `{x,y,z: [min,max]}` in metres to frame instead of the whole
//            station — a detail the whole station would shrink to nothing
//   up       the camera's up vector; `[0, 1, 0]` for a plan view
//   pad      breathing room around the framed region (1.06 = 6%)
//   useKept  frame only the half a 剖切 cut keeps, so a section fills its panel
//
// `view` is the game state the photograph is taken in: the store's own flags
// (`game/src/app/store/slices/ViewSlice.ts`) plus the renderer's grid toggle.
// `crowd` is how long to run the simulation at 16x before shooting, in ms, for
// the sheets that need people in them.

/** World-space centre of the demo station. */
export const STATION = [67.5, 17.5, -8]

/** The built (as opposed to track-only) part of the demo station, in metres. */
const BUILT = { x: [44, 122], y: [-4, 40], z: [-18, 1] }
/** The two platform levels and the concourse above them. */
const DEEP = { x: [44, 122], y: [-4, 40], z: [-18, -6] }
/**
 * The down platform's own box. It is deliberately **wider than the platform**:
 * the fitted frame is set by whichever half-extent is larger, so a region only
 * as deep as the platform is wide would be framed by its 6 m of depth and the
 * 108 m of platform would run off both sides of a 16:9 panel. The z range is the
 * station's own depth, which is what the panel is wide enough to hold.
 */
const PLATFORM = { x: [12, 120], y: [-6, 8], z: [-22, -6] }
/**
 * The station framed to fill a **tall** panel. A station is long, flat and thin
 * — 131 x 45 x 18 m — so a region whose depth matches the panel's own shape is
 * what actually fills the frame: a square region fills a square panel, where the
 * station's real 3:1 plan would leave two thirds of the picture empty. The z
 * range is the station's **own** — a frame reaching below the lowest slab puts
 * its near face under the building, and the shot comes back empty.
 */
const CORE = { x: [2, 133], y: [0, 40], z: [-20, 1] }

const ISO = { from: [1, -1.2, 0.85] }
const SIDE = { from: [0, -1, 0] }
const PLAN = { from: [0.001, 0, 1], up: [0, 1, 0] }
const END = { from: [1, 0, 0] }

export const SHEETS = [
  {
    id: '01',
    file: '01-isometric-cutaway.svg',
    // 你要搭的车站: the whole station at the build angle, cut open down the middle
    // so the concourse reads over the platforms, with the long section beneath.
    crowd: 12000,
    panels: [
      { place: [0, 0, 1920, 700], cam: { ...ISO, fov: 45, at: [67, 14, -9], fov: 45, region: { x: [2, 133], y: [-5, 40], z: [-20, 1] } }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [0, 700, 1920, 380], cam: { ...SIDE, fov: 45, at: [83, 18, -8], region: BUILT }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: false, hideWalls: true } },
    ],
  },
  {
    id: '02',
    file: '02-vertical-section.svg',
    // 挖得越深，路就越长: the section, then the plan of each level beside it.
    panels: [
      { place: [0, 0, 1180, 440], cam: { ...SIDE, fov: 45, at: [83, 18, -8], region: BUILT }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: false, hideWalls: true } },
      { place: [1180, 0, 740, 440], cam: { ...PLAN, fov: 45, at: [83, 18, -8], region: BUILT }, view: { activeZ: -4, ghostOther: false, hideWalls: true } },
      { place: [0, 440, 640, 640], cam: { ...PLAN, fov: 45, at: [66, 1, -14.5], region: PLATFORM }, view: { activeZ: -12, ghostOther: false, hideWalls: true } },
      { place: [640, 440, 640, 640], cam: { ...ISO, fov: 45, at: [90, 16, -6], region: { x: [60, 122], y: [0, 40], z: [-18, 1] } }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: false, hideWalls: true } },
      { place: [1280, 440, 640, 640], cam: { ...SIDE, fov: 45, at: [83, 12, -12], region: DEEP }, view: { cutaway: true, hideSectionSurface: true, activeZ: -12, ghostOther: false, hideWalls: true } },
    ],
  },
  {
    id: '03',
    file: '03-block-system.svg',
    // 一块方块，六个面: the block work itself, from a legible distance down to the
    // rounded corners an eight-neighbour join produces.
    panels: [
      { place: [0, 0, 1920, 560], cam: { ...ISO, fov: 45, at: [83, 14, -9], region: BUILT }, view: { activeZ: -8, ghostOther: false, autoCeiling: false } },
      { place: [0, 560, 960, 520], cam: { from: [1, -1.3, 1.1], fov: 45, at: [80, 12, -8], region: { x: [64, 96], y: [2, 34], z: [-12, 1] } }, view: { activeZ: -8, ghostOther: false, autoCeiling: false } },
      { place: [960, 560, 960, 520], cam: { from: [1, -1.3, 1.4], fov: 45, at: [66, 10, -5], region: { x: [56, 84], y: [4, 30], z: [-6, 1] } }, view: { activeZ: -4, ghostOther: false, autoCeiling: false } },
    ],
  },
  {
    id: '04',
    file: '04-module-catalogue.svg',
    // 你能放下的东西: the pieces the demo station is actually furnished with.
    crowd: 8000,
    panels: [
      { place: [0, 0, 1920, 560], cam: { ...ISO, fov: 45, at: [70, 16, -9], region: { x: [44, 100], y: [2, 40], z: [-18, 1] } }, view: { activeZ: -8, ghostOther: false, autoCeiling: false } },
      { place: [0, 560, 960, 520], cam: { from: [0.5, -1, 0.35], fov: 45, at: [62, 18, -8], region: { x: [50, 76], y: [8, 34], z: [-10, 1] } }, view: { activeZ: -8, ghostOther: false, autoCeiling: false } },
      { place: [960, 560, 960, 520], cam: { from: [0.5, -1, 0.35], fov: 45, at: [78, 3, -15], region: { x: [62, 98], y: [-4, 8], z: [-18, -11] } }, view: { activeZ: -16, ghostOther: false, autoCeiling: false } },
    ],
  },
  {
    id: '05',
    file: '05-trains-and-track.svg',
    // 车什么样，车站就跟着什么样: the consist as the station draws it, and the
    // screen doors that have to line up with it.
    panels: [
      { place: [0, 0, 1920, 420], cam: { ...SIDE, fov: 45, at: [66, 1, -14.5], region: PLATFORM }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
      { place: [0, 420, 960, 660], cam: { from: [0.35, -1, 0.2], fov: 45, at: [24, 3, -15], region: { x: [14, 40], y: [-6, 8], z: [-22, -6] } }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
      { place: [960, 420, 960, 660], cam: { from: [0.4, -1, 0.25], fov: 45, at: [100, 3, -15], region: { x: [88, 120], y: [-6, 8], z: [-22, -6] } }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
    ],
  },
  {
    id: '06',
    file: '06-crowd-demand.svg',
    // 人群都从哪儿来: a station with a real crowd in it, and the flow the sim
    // computes for the levels the crowd is walking.
    crowd: 14000,
    panels: [
      { place: [0, 0, 1920, 700], cam: { ...ISO, fov: 45, at: [67, 14, -9], fov: 45, region: { x: [2, 133], y: [-5, 40], z: [-20, 1] } }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [0, 700, 960, 380], cam: { ...SIDE, fov: 45, at: [83, 12, -12], region: DEEP }, view: { cutaway: true, hideSectionSurface: true, activeZ: -12, ghostOther: false, hideWalls: true } },
      { place: [960, 700, 960, 380], cam: { ...PLAN, fov: 45, at: [66, 1, -14.5], region: PLATFORM }, view: { activeZ: -12, ghostOther: false, hideWalls: true } },
    ],
  },
  {
    id: '07',
    file: '07-interface.svg',
    // 建造栏、检查器、小地图: the game as it is played, interface and all.
    interface: true,
    panels: [{ place: [0, 0, 1920, 1080], cam: { ...ISO, fov: 45, at: [67, 14, -9], fov: 45, region: { x: [2, 133], y: [-5, 40], z: [-20, 1] } }, view: { activeZ: -8, ghostOther: true, autoCeiling: true } }],
  },
  {
    id: '09',
    file: '09-camera-and-views.svg',
    // 看一座车站的六种方式: one station, the ways the camera can hold it.
    panels: [
      { place: [0, 0, 640, 360], cam: { ...ISO, fov: 45, at: STATION, region: CORE }, view: { activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [640, 0, 640, 360], cam: { ...PLAN, fov: 45, at: STATION, region: CORE }, view: { activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [1280, 0, 640, 360], cam: { ...SIDE, fov: 45, at: STATION, region: CORE }, view: { activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [0, 360, 640, 360], cam: { ...END, fov: 45, at: [70, 8, -9], region: BUILT }, view: { activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [640, 360, 640, 360], cam: { ...ISO, fov: 45, at: [83, 14, -9], region: BUILT }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [1280, 360, 640, 360], cam: { ...SIDE, fov: 45, at: [83, 18, -8], region: BUILT }, view: { cutaway: true, hideSectionSurface: true, activeZ: -8, ghostOther: true, autoCeiling: true } },
      { place: [0, 720, 960, 360], cam: { ...ISO, fov: 45, at: [80, 10, -12], region: { x: [48, 112], y: [0, 34], z: [-18, -6] } }, view: { activeZ: -12, ghostOther: true, autoCeiling: true } },
      { place: [960, 720, 960, 360], cam: { ...PLAN, fov: 45, at: [66, 1, -14.5], region: PLATFORM }, view: { activeZ: -16, ghostOther: true, autoCeiling: true } },
    ],
  },
  {
    id: '10',
    file: '10-queue-management.svg',
    // 游戏里最便宜的运力: the fence runs the demo's platform is arranged with.
    crowd: 12000,
    panels: [
      { place: [0, 0, 1920, 620], cam: { ...ISO, fov: 45, at: [72, 8, -12], region: { x: [46, 114], y: [-4, 20], z: [-18, -6] } }, view: { activeZ: -12, ghostOther: false, autoCeiling: false } },
      { place: [0, 620, 1920, 460], cam: { ...PLAN, fov: 45, at: [70, 3, -12], region: { x: [48, 112], y: [-4, 12], z: [-16, -9] } }, view: { activeZ: -12, ghostOther: false, autoCeiling: false } },
    ],
  },
  {
    id: '11',
    file: '11-rolling-stock-3d.svg',
    // 照游戏的建法绘制: the consist the renderer builds, close enough to read the
    // cab, the doors, the screen doors and the third rail.
    crowd: 6000,
    panels: [
      { place: [0, 0, 1920, 420], cam: { ...SIDE, fov: 45, at: [66, 1, -14.5], region: PLATFORM }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
      { place: [0, 420, 960, 660], cam: { from: [0.35, -1, 0.2], fov: 45, at: [24, 2, -15], region: { x: [14, 40], y: [-6, 8], z: [-22, -6] } }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
      { place: [960, 420, 960, 660], cam: { from: [0.6, -1, 0.3], fov: 45, at: [78, 2, -15], region: { x: [64, 92], y: [-6, 8], z: [-22, -6] } }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
    ],
  },
  {
    id: '12',
    file: '12-platform-doors-flow.svg',
    // 站台和列车怎么对上: the doors, the platform edge and the boarding order.
    crowd: 10000,
    panels: [
      { place: [0, 0, 1920, 460], cam: { from: [0.001, -1, 0.16], fov: 45, at: [66, 1, -14.5], region: PLATFORM }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
      { place: [0, 460, 960, 620], cam: { ...PLAN, fov: 45, at: [70, 1, -14], region: { x: [46, 100], y: [-8, 10], z: [-18, -10] } }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
      { place: [960, 460, 960, 620], cam: { ...END, fov: 45, at: [70, 6, -14], region: { x: [62, 78], y: [-6, 18], z: [-18, -10] } }, view: { activeZ: -16, ghostOther: false, hideWalls: true } },
    ],
  },
]

/** The sheets the site no longer shows (see web/src/artworks.js). */
export const DROPPED = ['08', '13']

/** Hide every panel, so a photograph is only the station. */
export const SHOT_CSS = `
  .topbar, .bottombar, .viewNav, .toast, .mobile,
  .main > .rail, .main > .panel { display: none !important; }
  /* The app is a grid — 48px of topbar, 1fr, 42px of bottombar — and the main
     row is rail | stage | panel. Hiding the panels is not enough: a hidden grid
     item still claims its track, so the canvas would be photographed inside a
     fraction of the window and every fit would be wrong. Collapse both grids to
     one cell and the stage is the whole window. */
  .app { grid-template-rows: 1fr !important; height: 100vh !important; overflow: hidden !important; }
  .main { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; height: 100% !important; min-height: 0 !important; }
  .stage { grid-column: 1 / -1 !important; grid-row: 1 / -1 !important; height: 100% !important; min-height: 0 !important; }
  .stage > canvas, canvas.viewport { width: 100% !important; height: 100% !important; }
`

/**
 * The interface sheet keeps the game's own layout — the build rail, the
 * inspector, the storey slider, the line card — and only takes the nav cube
 * away, because a nav cube is a camera control rather than part of the picture.
 */
export const INTERFACE_CSS = `
  .viewNav, .toast, .mobile { display: none !important; }
`
