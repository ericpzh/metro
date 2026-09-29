// The thirteen concept sheets, in the order they are drawn in the spec.
// `lead` is the one-line read, `body` the design note behind it.
// All sheets live in ../../art and are copied into public/art at build time.

export const tagline =
  'Overcrowd’s readable doll-house dioramas, Mini Metro’s flow pressure, real Chinese metro rolling stock.'

export const artworks = [
  {
    id: '01',
    file: '01-isometric-cutaway.svg',
    nav: 'Cutaway',
    accent: '#d5202f',
    kicker: 'Concept 01 · Isometric cutaway',
    title: 'The station you are building',
    lead:
      'A B1 concourse in doll-house view with the roof cut off, and the B2 platform visible through the escalator void.',
    body: [
      'Nine readable zones: fare gates, ticket machines, retail, platform, circulation, surface entrance, advertising, floor guidance, lift.',
      'Everything here is a placeable module from the catalogue, and every person is a simulated agent with a destination.',
    ],
    tags: ['2:1 dimetric', '1 block = 1 m', 'roof cut away', 'agents with destinations'],
    alt:
      'Isometric cutaway of a metro station concourse: fare gates, ticket machines, shops, escalators down to a platform, and crowds of passengers.',
  },
  {
    id: '02',
    file: '02-vertical-section.svg',
    nav: 'Section',
    accent: '#0f6cb0',
    kicker: 'Concept 02 · Vertical section',
    title: 'Depth is not decoration',
    lead:
      'One station, four levels: an over-ground viaduct, the surface plaza, a B1 concourse, a B2 platform behind screen doors and a B3 platform.',
    body: [
      'Every level change is a walk, a queue and a capacity limit. This is the drawing that drives the whole simulation design.',
    ],
    tags: ['4 levels', 'viaduct + tunnel', 'limited by vertical circulation'],
    alt:
      'Cross-section through a station showing a viaduct, street plaza, B1 concourse and B2/B3 platforms stacked in section.',
  },
  {
    id: '03',
    file: '03-block-system.svg',
    nav: 'Blocks',
    accent: '#e8a300',
    kicker: 'Concept 03 · Block system',
    title: 'One block, six faces',
    lead:
      'One block = one cell with six faces. Faces carry surfaces: floor, ceiling, wall on each side.',
    body: [
      'An 8-neighbour autotile mask decides the rounded corners, and bevelled top edges give the chunky, toy-like silhouette.',
      'The grid is naive; the corners are not. That contrast is what makes a hand-authored station read as a drawn object rather than a voxel dump.',
    ],
    tags: ['6 faces per cell', '8-neighbour autotile', 'bevelled top edges'],
    alt:
      'Diagram of a single block cell with its six faces labelled and a rounded-corner autotiling mask.',
  },
  {
    id: '04',
    file: '04-module-catalogue.svg',
    nav: 'Modules',
    accent: '#1c8f5a',
    kicker: 'Concept 04 · Module catalogue',
    title: 'What you can place',
    lead:
      'Fifteen of the placeable modules with their real footprints and the throughput numbers the simulation actually consumes.',
    body: [
      'A module is not a decoration: it is a footprint, a capacity, a service time and a set of cells its agents can stand on.',
    ],
    tags: ['15 modules', 'real footprints', 'throughput is a number the sim reads'],
    alt:
      'Catalogue sheet of fifteen placeable station modules drawn isometrically, each with its footprint and throughput figures.',
  },
  {
    id: '05',
    file: '05-trains-and-track.svg',
    nav: 'Stock',
    accent: '#7a4bd0',
    kicker: 'Concept 05 · Rolling stock',
    title: 'The trains set the rules',
    lead:
      'A / B / C type cars following the Chinese metro classification: car width sets the platform edge, door count sets the boarding rate, power pickup decides tunnel or viaduct.',
    body: [
      'The train is not set dressing. Its dimensions propagate into platform doors, queue lanes, dwell time and the whole headway budget.',
    ],
    tags: ['type A / B / C', 'doors per side', 'catenary vs third rail'],
    alt:
      'Rolling stock sheet showing type A, B and C metro cars side by side with track, catenary and third-rail details.',
  },
  {
    id: '06',
    file: '06-crowd-demand.svg',
    nav: 'Demand',
    accent: '#e2571e',
    kicker: 'Concept 06 · Crowd demand',
    title: 'Where the crowd comes from',
    lead:
      'Time-of-day curves, calendar multipliers, transfer paths across depths, and the per-exit flow controls that shape all of it.',
    body: [
      'Demand is authored, not random: you can see the morning peak in the graph and then walk down and watch it arrive.',
    ],
    tags: ['time-of-day curves', 'calendar multipliers', 'transfers across depths'],
    alt:
      'Charts of passenger demand: time-of-day curves, calendar multipliers and transfer paths between levels.',
  },
  {
    id: '07',
    file: '07-interface.svg',
    nav: 'Interface',
    accent: '#0aa3a3',
    kicker: 'Concept 07 · Interface',
    title: 'Build rail, inspector, minimap',
    lead:
      'Build rail on the left, inspector on the right, line manager and minimap along the bottom.',
    body: [
      'The camera is the level selector: what you can see is what you are editing, so there is no separate floor picker to learn.',
    ],
    tags: ['left rail', 'right inspector', 'bottom line manager + minimap'],
    alt: 'Wireframe of the game interface: build palette, 3D viewport, inspector panel, line manager and minimap.',
  },
  {
    id: '08',
    file: '08-architecture.svg',
    nav: 'Architecture',
    accent: '#b02a6e',
    kicker: 'Concept 08 · Software shape',
    title: 'Three owners of the truth',
    lead:
      'React owns panels and state, three.js owns the scene, a worker owns three thousand agents walking to a train.',
    body: [
      'The sim runs on a fixed tick off the main thread and reports back as buffers. The renderer reads the snapshot; it never drives it.',
    ],
    tags: ['React 19 + Vite', 'three.js / react-three-fiber', 'Web Worker simulation'],
    alt:
      'Architecture diagram linking the React UI, the three.js scene and a Web Worker running the crowd simulation.',
  },
  {
    id: '09',
    file: '09-camera-and-views.svg',
    nav: 'Views',
    accent: '#4b5bdc',
    kicker: 'Concept 09 · Camera and views',
    title: 'Six ways of looking at one station',
    lead:
      'Full 360° orbit like a CAD viewport, plus true orthographic elevations.',
    body: [
      'The flat X-Z elevation is the view that tells you whether the vertical circulation actually works.',
    ],
    tags: ['360° orbit', 'orthographic elevations', 'level slicing'],
    alt:
      'A single station model shown six ways: isometric, plan, and four orthographic elevations.',
  },
  {
    id: '10',
    file: '10-queue-management.svg',
    nav: 'Queues',
    accent: '#55606c',
    kicker: 'Concept 10 · Queue management',
    title: 'The cheapest capacity in the game',
    lead:
      'A crowd that arrives as a blob blocks everything; the same crowd in single-file lanes is orderly, predictable, and fits in a quarter of the floor.',
    body: [
      'Guided lanes turn an unpredictable crush into a measured boarding rate — the one upgrade that costs floor space and buys you headroom.',
    ],
    tags: ['lane guides', 'same crowd, a quarter of the floor', 'measurable boarding rate'],
    alt:
      'Plan comparison of an unmanaged crowd blob against the same crowd organised into single-file queue lanes.',
  },
  {
    id: '11',
    file: '11-rolling-stock-3d.svg',
    nav: 'Stock 3D',
    accent: '#2f6fed',
    kicker: 'Concept 11 · Rolling stock in 3D',
    title: 'Drawn the way the game builds it',
    lead:
      'Type A, B and C consist drawn from the same isometric projection the renderer uses, with every dimension, door count and power pickup called out.',
    body: [
      'Type A: 3.0 × 3.8 × 22.0 m, five doors a side, 310 passengers crush, catenary over a viaduct. Type B: the Chinese metro workhorse, 2.8 m wide, four doors a side, third rail in tunnel. Type C: the light profile for automated branches.',
    ],
    tags: ['A: 310 pax crush', 'B: 240 pax crush', 'C: 200 pax crush', 'platform interface + power pickup'],
    alt:
      'Three-dimensional drawings of type A, B and C metro cars with their dimensions, doors and power pickup annotated.',
  },
  {
    id: '12',
    file: '12-platform-doors-flow.svg',
    nav: 'Doors',
    accent: '#d94f8a',
    kicker: 'Concept 12 · Platform: doors and flow',
    title: 'Where the platform meets the train',
    lead:
      'The boarding sequence in plan, the door positions in elevation, the passenger’s wayfinding chain from car door to street exit, and the door cadence for each stock type.',
    body: [
      'PSD openings land on the car-door centres, so the platform edge is not a texture you paint — it is a promise the layout has to keep.',
    ],
    tags: ['door pitch 4.16 m', 'PSD on car-door centres', 'alight → queue → concourse → exit'],
    alt:
      'Platform doors and passenger-flow sheet: boarding sequence in plan, door elevations, wayfinding steps and door cadence per stock type.',
  },
  {
    id: '13',
    file: '13-two-line-interchange.svg',
    nav: 'Interchange',
    accent: '#0e7c66',
    kicker: 'Concept 13 · Two lines, two depths',
    title: '24.6 metres of transfer',
    lead:
      'One line over the street, one under it: a viaduct deck at +11.6 m and a B2 island platform at −13.0 m.',
    body: [
      'The depth difference is the whole point. The transfer is a single shaft, so it can be measured as one queue rather than three.',
      'The viaduct only needs piers, so it can be built and moved after the station box is in. Cut the near quarter away and the level slicing still reads: the camera is the level selector.',
    ],
    tags: ['piers, not excavation', 'one transfer shaft', 'sandbox: no cost, no staff, no ticket price'],
    alt:
      'Cutaway of a two-line interchange: an elevated viaduct line above a B1 concourse and a B2 island platform underground.',
  },
]
