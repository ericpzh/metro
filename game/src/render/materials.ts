// Procedural material detail — PLAN.md §2.3 item 4. No image files, no GLB:
// granite speckle, enamel panel seams, brushed metal and white baffles are all
// drawn into small canvases at load and repeated per metre.

import * as THREE from 'three'

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d') as CanvasRenderingContext2D
  return { c, g }
}

function tex(c: HTMLCanvasElement, repeat: number, aniso = true): THREE.Texture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  if (aniso) t.anisotropy = 4
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Light speckled granite with the dark inlay band the spec asks for. */
function graniteCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#c9ccd1'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 2600; i++) {
    const v = 150 + Math.floor(Math.random() * 90)
    g.fillStyle = `rgba(${v},${v},${v + 6},${0.15 + Math.random() * 0.35})`
    const s = Math.random() < 0.85 ? 1 : 2
    g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), s, s)
  }
  // A single dark inlay band.
  g.fillStyle = 'rgba(35,38,46,0.85)'
  g.fillRect(0, 60, 128, 4)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(0, 64, 128, 1)
  return c
}

/** Glossy coloured enamel wall panel with visible seams. */
function enamelCanvas(colour: string): HTMLCanvasElement {
  const { c, g } = canvas(128)
  const base = new THREE.Color(colour)
  g.fillStyle = `#${base.getHexString()}`
  g.fillRect(0, 0, 128, 128)
  const grad = g.createLinearGradient(0, 0, 0, 128)
  grad.addColorStop(0, 'rgba(255,255,255,0.22)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.02)')
  grad.addColorStop(1, 'rgba(0,0,0,0.16)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = 'rgba(0,0,0,0.28)'
  g.fillRect(0, 0, 2, 128)
  g.fillRect(0, 0, 128, 2)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(2, 2, 1, 126)
  return c
}

/** White linear baffle ceiling. */
function baffleCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#e8ebef'
  g.fillRect(0, 0, 128, 128)
  for (let y = 0; y < 128; y += 8) {
    g.fillStyle = y % 16 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.35)'
    g.fillRect(0, y, 128, 1)
  }
  g.fillStyle = 'rgba(0,0,0,0.05)'
  g.fillRect(0, 0, 128, 128)
  return c
}

/** Dark soil / world outside. */
function soilCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(128)
  g.fillStyle = '#232a34'
  g.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 1400; i++) {
    const v = 26 + Math.floor(Math.random() * 26)
    g.fillStyle = `rgba(${v},${v + 4},${v + 10},0.5)`
    g.fillRect(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128), 2, 2)
  }
  return c
}

/** Brushed stainless. */
function metalCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(64)
  g.fillStyle = '#9aa2ab'
  g.fillRect(0, 0, 64, 64)
  for (let i = 0; i < 900; i++) {
    const y = Math.floor(Math.random() * 64)
    const v = 140 + Math.floor(Math.random() * 70)
    g.fillStyle = `rgba(${v},${v + 4},${v + 8},0.25)`
    g.fillRect(0, y, 64, 1)
  }
  return c
}

/** Soft radial contact-shadow blob, used under modules and the crowd. */
export function contactShadowTexture(): THREE.Texture {
  const { c, g } = canvas(64)
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  grad.addColorStop(0, 'rgba(0,0,0,0.55)')
  grad.addColorStop(0.6, 'rgba(0,0,0,0.22)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface MaterialSet {
  granite: THREE.MeshStandardMaterial
  baffle: THREE.MeshStandardMaterial
  soil: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  platform: THREE.MeshStandardMaterial
  outline: THREE.MeshBasicMaterial
  blob: THREE.MeshBasicMaterial
  enamel: (colour: string) => THREE.MeshStandardMaterial
}

export function createMaterials(): MaterialSet {
  const granite = new THREE.MeshStandardMaterial({
    map: tex(graniteCanvas(), 1),
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.02,
  })
  const baffle = new THREE.MeshStandardMaterial({
    map: tex(baffleCanvas(), 1),
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  })
  const soil = new THREE.MeshStandardMaterial({
    map: tex(soilCanvas(), 1),
    vertexColors: true,
    roughness: 0.98,
    metalness: 0.0,
  })
  const metal = new THREE.MeshStandardMaterial({
    map: tex(metalCanvas(), 1),
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.75,
  })
  const platform = new THREE.MeshStandardMaterial({
    map: tex(graniteCanvas(), 1),
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.02,
  })
  // Inverted-hull outline: back faces, pushed along the normal, flat dark.
  const outline = new THREE.MeshBasicMaterial({ color: 0x11151c, side: THREE.BackSide })
  const blob = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    opacity: 0.9,
  })
  const enamelCache = new Map<string, THREE.MeshStandardMaterial>()
  const enamel = (colour: string): THREE.MeshStandardMaterial => {
    const hit = enamelCache.get(colour)
    if (hit) return hit
    const m = new THREE.MeshStandardMaterial({
      map: tex(enamelCanvas(colour), 1),
      vertexColors: true,
      roughness: 0.22,
      metalness: 0.1,
    })
    enamelCache.set(colour, m)
    return m
  }
  return { granite, baffle, soil, metal, platform, outline, blob, enamel }
}
