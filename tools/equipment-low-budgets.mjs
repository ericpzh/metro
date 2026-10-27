// Strict <10% geometry targets, with explicit minimum-shape exceptions agreed
// for small equipment. These limits never depend on the current Low count.
const exceptions = new Map()
const minimum = (ids, triangles, reason) => {
  for (const id of ids.split(' ')) exceptions.set(id, { triangles, reason })
}
minimum('bin', 26, 'Two open hoppers, outer cabinet faces, dark wells and sorting label.')
minimum('bench-seat-1', 20, 'Seat and back surfaces plus two supports.')
minimum('bench-steel-1', 16, 'Two-sided seat pan plus two supports.')
minimum('door-wood-1', 20, 'Four frame members and a two-sided leaf.')
minimum('psd-end', 30, 'Shortened fixed glass, separate housing/trim faces and artwork.')
minimum('tv-double', 28, 'Two back-to-back TV screens with shared housing and suspension.')
minimum('tv', 22, 'Two suspension rods, bezel, live station board, video window and status light.')
minimum('noise-barrier noise-barrier-half', 46, 'Posts and separate opaque/glazed bands, keeping all bay cutouts.')
minimum('traffic-light', 28, 'Pole, base, closed housing and three separate lenses.')
minimum('sign-ceiling', 18, 'Two suspension rods, backing and readable sign face.')
minimum('monitor-ceiling', 20, 'Two rods, housing, printed camera view and status light.')
minimum('tactile-guide', 10, 'Tile top and four continuous raised guide ribs.')
minimum('guidepost', 57, 'Three independently printed sides, shaped logo collar and triangular column sections.')
minimum('exit-virtual', 46, 'Three printed sides and shaped metro-logo collar.')
minimum('curtain-wall glass-1x1 glass-2x1 glass-3x1 glass-1x2 glass-2x2 glass-3x2', 18, 'Four frame members and one double-sided glass surface.')
minimum('road', 10, 'Road surface plus four lane/edge markings.')
minimum('pillar-slim', 16, 'Shaft and end collars, preserving height and support footprint.')
minimum('stair-block', 34, 'All four solid treads, exposed risers and closed side silhouette.')
minimum('billboard-wide billboard-standard billboard-large billboard-panorama billboard-portrait billboard-square', 6, 'Original cropped artwork, frame surface and illuminated AD label.')
minimum('linemap-stand', 16, 'Base, support and two separately oriented readable map faces.')
minimum('linemap-wall', 4, 'Frame surface and original cropped map face.')
minimum('hanger-roof', 6, 'Support bar visible from every direction.')
minimum('hanger-post', 14, 'Bar, upright and base.')
minimum('exit-doorway-1 exit-doorway-2 exit-doorway-3 exit-doorway-4', 10, 'Doorway framing and independently readable header faces.')
minimum('roof-shell', 8, 'Two pitched sheets visible from above and below.')
minimum('noise-barrier-railing', 16, 'Open railing silhouette and supports.')
minimum('light-rectangular', 6, 'Steel rim visible above/below and a two-sided luminous diffuser.')
minimum('vent', 32, 'Frame, dark duct and three louver strips visible above and below.')
minimum('roof psd-end-cover', 4, 'One sheet with both opposing faces.')

export function equipmentLowBudget(id, high) {
  const exception = exceptions.get(id)
  if (exception) return { limit: exception.triangles, reason: exception.reason }
  if (high <= 2) return { limit: 2, reason: 'A single printed quad is already the minimum usable rectangular surface.' }
  return { limit: Math.ceil(high / 10) - 1, reason: null }
}
