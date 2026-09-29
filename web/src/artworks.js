// The thirteen concept sheets, in the order they are drawn in the spec.
//
// `panel` is where the text card may sit without covering the drawing. The
// values were measured, not guessed: each sheet was rasterised at a 1440px
// reference width and scanned with an edge-energy map for the quietest band
// that keeps the whole card on screen. `mode: 'edge'` hugs the 5% margin;
// `mode: 'free'` marks a genuinely empty pocket in the middle of the sheet.
// Re-run that search before moving a panel by hand.

export const tagline =
  'Overcrowd’s readable doll-house dioramas, Mini Metro’s flow pressure, real Chinese metro rolling stock.'

export const artworks = [
  {
    id: '01',
    file: '01-isometric-cutaway.svg',
    nav: 'Cutaway',
    accent: '#e8556a',
    panel: { mode: 'edge', side: 'right', top: '57.5%' },
    kicker: 'Concept 01 · Isometric cutaway',
    title: 'The station you are building',
    lead:
      'A B1 concourse in doll-house view with the roof cut off, and the B2 platform visible through the escalator void.',
    note:
      'Nine readable zones: fare gates, ticket machines, retail, platform, circulation, surface entrance, advertising, floor guidance, lift. Everything here is a placeable module, and every person is a simulated agent with a destination.',
    tags: ['2:1 dimetric', '1 block = 1 m', 'roof cut away'],
    alt:
      'Isometric cutaway of a metro station concourse: fare gates, ticket machines, shops, escalators down to a platform, and crowds of passengers.',
  },
  {
    id: '02',
    file: '02-vertical-section.svg',
    nav: 'Section',
    accent: '#4aa3e8',
    panel: { mode: 'edge', side: 'right', top: '39.1%' },
    kicker: 'Concept 02 · Vertical section',
    title: 'Depth is not decoration',
    lead:
      'One station, four levels: an over-ground viaduct, the surface plaza, a B1 concourse, a B2 platform behind screen doors and a B3 platform.',
    note:
      'Every level change is a walk, a queue and a capacity limit. This is the drawing that drives the whole simulation design.',
    tags: ['4 levels', 'viaduct + tunnel', 'circulation is the bottleneck'],
    alt:
      'Cross-section through a station showing a viaduct, street plaza, B1 concourse and B2/B3 platforms stacked in section.',
  },
  {
    id: '03',
    file: '03-block-system.svg',
    nav: 'Blocks',
    accent: '#f2b32c',
    panel: { mode: 'edge', side: 'left', top: '17.6%' },
    kicker: 'Concept 03 · Block system',
    title: 'One block, six faces',
    lead:
      'One block = one cell with six faces. Faces carry surfaces: floor, ceiling, wall on each side.',
    note:
      'An 8-neighbour autotile mask decides the rounded corners, and bevelled top edges give the chunky, toy-like silhouette. The grid is naive; the corners are not.',
    tags: ['6 faces per cell', '8-neighbour autotile', 'bevelled top edges'],
    alt:
      'Diagram of a single block cell with its six faces labelled and a rounded-corner autotiling mask.',
  },
  {
    id: '04',
    file: '04-module-catalogue.svg',
    nav: 'Modules',
    accent: '#46c98b',
    panel: { mode: 'free', left: '32%', top: '11.7%' },
    kicker: 'Concept 04 · Module catalogue',
    title: 'What you can place',
    lead:
      'Fifteen placeable modules with their real footprints and the throughput numbers the simulation actually consumes.',
    note:
      'A module is not a decoration: it is a footprint, a capacity, a service time and a set of cells its agents can stand on.',
    tags: ['15 modules', 'real footprints', 'throughput the sim reads'],
    alt:
      'Catalogue sheet of fifteen placeable station modules drawn isometrically, each with its footprint and throughput figures.',
  },
  {
    id: '05',
    file: '05-trains-and-track.svg',
    nav: 'Stock',
    accent: '#a98bf5',
    panel: { mode: 'edge', side: 'left', top: '20.6%' },
    kicker: 'Concept 05 · Rolling stock',
    title: 'The trains set the rules',
    lead:
      'A / B / C type cars following the Chinese metro classification: car width sets the platform edge, door count sets the boarding rate, power pickup decides tunnel or viaduct.',
    note:
      'The train is not set dressing. Its dimensions propagate into platform doors, queue lanes, dwell time and the whole headway budget.',
    tags: ['type A / B / C', 'doors per side', 'catenary vs third rail'],
    alt:
      'Rolling stock sheet showing type A, B and C metro cars side by side with track, catenary and third-rail details.',
  },
  {
    id: '06',
    file: '06-crowd-demand.svg',
    nav: 'Demand',
    accent: '#f4804a',
    panel: { mode: 'free', left: '21.5%', top: '42.7%' },
    kicker: 'Concept 06 · Crowd demand',
    title: 'Where the crowd comes from',
    lead:
      'Time-of-day curves, calendar multipliers, transfer paths across depths, and the per-exit flow controls that shape all of it.',
    note:
      'Demand is authored, not random: you can see the morning peak in the graph, then walk down to the platform and watch it arrive.',
    tags: ['time-of-day curves', 'calendar multipliers', 'transfers across depths'],
    alt:
      'Charts of passenger demand: time-of-day curves, calendar multipliers and transfer paths between levels.',
  },
  {
    id: '07',
    file: '07-interface.svg',
    nav: 'Interface',
    accent: '#35c8c8',
    panel: { mode: 'free', left: '10.5%', top: '21.4%' },
    kicker: 'Concept 07 · Interface',
    title: 'Build rail, inspector, minimap',
    lead: 'Build rail on the left, inspector on the right, line manager and minimap along the bottom.',
    note:
      'The camera is the level selector: what you can see is what you are editing, so there is no separate floor picker to learn.',
    tags: ['left rail', 'right inspector', 'camera = level selector'],
    alt:
      'Wireframe of the game interface: build palette, 3D viewport, inspector panel, line manager and minimap.',
  },
  {
    id: '08',
    file: '08-architecture.svg',
    nav: 'Architecture',
    accent: '#e2679e',
    panel: { mode: 'free', left: '10.5%', top: '27.7%' },
    kicker: 'Concept 08 · Software shape',
    title: 'Three owners of the truth',
    lead:
      'React owns panels and state, three.js owns the scene, a worker owns three thousand agents walking to a train.',
    note:
      'The sim runs on a fixed tick off the main thread and reports back as buffers. The renderer reads the snapshot; it never drives it.',
    tags: ['React + Vite', 'three.js / R3F', 'Web Worker sim'],
    alt:
      'Architecture diagram linking the React UI, the three.js scene and a Web Worker running the crowd simulation.',
  },
  {
    id: '09',
    file: '09-camera-and-views.svg',
    nav: 'Views',
    accent: '#7f8bf0',
    panel: { mode: 'free', left: '37%', top: '30.8%' },
    kicker: 'Concept 09 · Camera and views',
    title: 'Six ways of looking at one station',
    lead: 'Full 360° orbit like a CAD viewport, plus true orthographic elevations.',
    note:
      'One station model, six ways of looking at it — and the flat X-Z elevation is the view that tells you whether the vertical circulation actually works.',
    tags: ['360° orbit', 'orthographic elevations', 'level slicing'],
    alt: 'A single station model shown six ways: isometric, plan, and four orthographic elevations.',
  },
  {
    id: '10',
    file: '10-queue-management.svg',
    nav: 'Queues',
    accent: '#9aa8b8',
    panel: { mode: 'free', left: '24%', top: '45.3%' },
    kicker: 'Concept 10 · Queue management',
    title: 'The cheapest capacity in the game',
    lead:
      'A crowd that arrives as a blob blocks everything; the same crowd in single-file lanes is orderly, predictable, and fits in a quarter of the floor.',
    note:
      'Guided lanes turn an unpredictable crush into a measured boarding rate — the one upgrade that costs floor space and buys you headroom.',
    tags: ['lane guides', 'a quarter of the floor', 'measurable boarding rate'],
    alt:
      'Plan comparison of an unmanaged crowd blob against the same crowd organised into single-file queue lanes.',
  },
  {
    id: '11',
    file: '11-rolling-stock-3d.svg',
    nav: 'Stock 3D',
    accent: '#5c93f5',
    panel: { mode: 'free', left: '14.5%', top: '36%' },
    kicker: 'Concept 11 · Rolling stock in 3D',
    title: 'Drawn the way the game builds it',
    lead: 'Type A, B and C consists drawn from the same isometric projection the renderer uses.',
    note:
      'Type A: 3.0 × 3.8 × 22.0 m, five doors a side, 310 passengers crush, catenary over a viaduct. Type B: the Chinese metro workhorse, 2.8 m wide, four doors a side, third rail in tunnel. Type C: the light profile for automated branches.',
    tags: ['A: 310 pax', 'B: 240 pax', 'C: 200 pax', 'platform interface'],
    alt:
      'Three-dimensional drawings of type A, B and C metro cars with their dimensions, doors and power pickup annotated.',
  },
  {
    id: '12',
    file: '12-platform-doors-flow.svg',
    nav: 'Doors',
    accent: '#ef86ae',
    panel: { mode: 'free', left: '22%', top: '42.5%' },
    kicker: 'Concept 12 · Platform: doors and flow',
    title: 'Where the platform meets the train',
    lead:
      'Boarding sequence in plan, door positions in elevation, the passenger’s wayfinding chain from car door to street exit, and the door cadence per stock type.',
    note:
      'PSD openings land on the car-door centres, so the platform edge is not a texture you paint — it is a promise the layout has to keep.',
    tags: ['door pitch 4.16 m', 'PSD on car-door centres', 'alight → queue → exit'],
    alt:
      'Platform doors and passenger-flow sheet: boarding sequence in plan, door elevations, wayfinding steps and door cadence per stock type.',
  },
  {
    id: '13',
    file: '13-two-line-interchange.svg',
    nav: 'Interchange',
    accent: '#38b99a',
    panel: { mode: 'edge', side: 'left', top: '56.8%' },
    kicker: 'Concept 13 · Two lines, two depths',
    title: '24.6 metres of transfer',
    lead:
      'One line over the street, one under it: a viaduct deck at +11.6 m and a B2 island platform at −13.0 m.',
    note:
      'The 24.6 m between them is the whole point. The transfer is a single shaft, so it can be measured as one queue rather than three — and the viaduct only needs piers, so it can be built after the station box is in.',
    tags: ['piers, not excavation', 'one transfer shaft', 'no cost, no staff'],
    alt:
      'Cutaway of a two-line interchange: an elevated viaduct line above a B1 concourse and a B2 island platform underground.',
  },
]
