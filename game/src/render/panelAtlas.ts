import * as THREE from 'three'

export interface AtlasRegion {
  material: THREE.Material
  u: number
  v: number
  w: number
  h: number
}
interface Slot { source: THREE.Texture; x: number; y: number; w: number; h: number; version: number }
interface Page { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture | THREE.DataTexture; live: boolean; slots: Slot[]; free: Array<{ x: number; y: number; w: number; h: number }>; x: number; y: number; row: number }

/** Full-resolution lit panels share pages. Sources remain owned by their systems;
 * a TV/countdown repaint refreshes only its atlas region and keeps its UVs. */
export class PanelAtlas {
  private pages: Page[] = []
  private slots = new Map<THREE.Texture, { page: Page; slot: Slot }>()
  private materials = new Map<string, THREE.MeshBasicMaterial>()
  private planeIds = new WeakMap<THREE.Plane, number>()
  private nextPlaneId = 0
  private patch: THREE.DataTexture | null = null
  private pending = new Map<Slot, Page>()
  readonly size: number
  constructor(size = 2048) { this.size = size }
  get pendingUpdates(): boolean { return this.pending.size > 0 }

  resolve(material: THREE.Material): AtlasRegion | null {
    if (!(material instanceof THREE.MeshBasicMaterial) || material.alphaMap || material.envMap || material.vertexColors || material.aoMap || material.lightMap || material.specularMap || material.wireframe || material.alphaHash || material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null
    const source = material.map
    if (!(source instanceof THREE.CanvasTexture) || !source.flipY || source.channel !== 0 || !source.matrixAutoUpdate || source.magFilter !== THREE.LinearFilter || source.offset.lengthSq() || source.rotation || source.repeat.x !== 1 || source.repeat.y !== 1) return null
    const image = source.image as HTMLCanvasElement
    if (!image?.width || !image.height || image.width + 4 > this.size || image.height + 4 > this.size) return null
    let entry = this.slots.get(source)
    if (!entry) {
      const live = source.userData.livePanel === true
      let page = this.pages.find(p => p.live === live && p.texture.colorSpace === source.colorSpace &&
        (p.free.some(r => r.w >= image.width && r.h >= image.height) || this.fits(p, image.width, image.height)))
      if (!page) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = this.size
        const context = canvas.getContext('2d', { willReadFrequently: live })
        if (!context) return null
        const texture = live ? new THREE.DataTexture(new Uint8Array(this.size * this.size * 4), this.size, this.size) : new THREE.CanvasTexture(canvas)
        texture.colorSpace = source.colorSpace
        // Gutters prevent adjacent labels bleeding. Keep original pixel size;
        // no text or screen is downsampled to make it fit a page.
        texture.generateMipmaps = false; texture.minFilter = texture.magFilter = THREE.LinearFilter
        page = { canvas, context, texture, live, slots: [], free: [], x: 0, y: 0, row: 0 }; this.pages.push(page)
      }
      const freeIndex = page.free.findIndex(r => r.w >= image.width && r.h >= image.height)
      const free = freeIndex >= 0 ? page.free.splice(freeIndex, 1)[0] : null
      if (!free && page.x + image.width + 4 > this.size) { page.y += page.row; page.x = 0; page.row = 0 }
      const slot: Slot = { source, x: free?.x ?? page.x + 2, y: free?.y ?? page.y + 2, w: image.width, h: image.height, version: -1 }
      if (!free) { page.x += image.width + 4; page.row = Math.max(page.row, image.height + 4) }
      page.slots.push(slot); entry = { page, slot }; this.slots.set(source, entry)
      this.draw(page, slot)
    }
    const { page, slot } = entry
    const key = JSON.stringify([page.texture.uuid, material.color.getHex(), material.opacity, material.transparent,
      material.side, material.depthTest, material.depthWrite, material.alphaTest, material.blending,
      material.blendSrc, material.blendDst, material.blendEquation, material.blendSrcAlpha, material.blendDstAlpha,
      material.blendEquationAlpha, material.premultipliedAlpha, material.toneMapped, material.fog,
      material.polygonOffset, material.polygonOffsetFactor, material.polygonOffsetUnits,
      material.colorWrite, material.visible, material.forceSinglePass, material.precision, material.stencilWrite,
      material.stencilWriteMask, material.stencilFunc, material.stencilRef, material.stencilFuncMask, material.stencilFail, material.stencilZFail, material.stencilZPass,
      material.clippingPlanes?.map(p => {
        let id = this.planeIds.get(p)
        if (id === undefined) { id = ++this.nextPlaneId; this.planeIds.set(p, id) }
        return id
      }), material.clipIntersection, material.clipShadows])
    let combined = this.materials.get(key)
    if (!combined) {
      combined = material.clone(); combined.map = page.texture
      combined.clippingPlanes = material.clippingPlanes
      this.materials.set(key, combined)
    }
    return { material: combined, u: slot.x / this.size, v: 1 - (slot.y + slot.h) / this.size, w: slot.w / this.size, h: slot.h / this.size }
  }

  private fits(page: Page, w: number, h: number): boolean {
    return page.x + w + 4 <= this.size ? page.y + h + 4 <= this.size : page.y + page.row + h + 4 <= this.size
  }

  private draw(page: Page, slot: Slot, upload = true): Uint8Array | null {
    const { x, y, w, h, source } = slot, g = page.context
    g.clearRect(x - 2, y - 2, w + 4, h + 4)
    const image = source.image as CanvasImageSource
    g.drawImage(image, x, y, w, h)
    // Extrude edge pixels into the two-pixel gutter, including its corners.
    for (const [sx, sy, sw, sh, dx, dy, dw, dh] of [
      [0, 0, w, 1, x, y - 2, w, 2], [0, h - 1, w, 1, x, y + h, w, 2],
      [0, 0, 1, h, x - 2, y, 2, h], [w - 1, 0, 1, h, x + w, y, 2, h],
      [0, 0, 1, 1, x - 2, y - 2, 2, 2], [w - 1, 0, 1, 1, x + w, y - 2, 2, 2],
      [0, h - 1, 1, 1, x - 2, y + h, 2, 2], [w - 1, h - 1, 1, 1, x + w, y + h, 2, 2],
    ]) g.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
    slot.version = source.version
    let data: Uint8Array | null = null
    if (page.live) {
      const width = w + 4, height = h + 4
      const pixels = g.getImageData(x - 2, y - 2, width, height).data
      data = new Uint8Array(pixels.length)
      const backing = (page.texture as THREE.DataTexture).image.data as Uint8Array
      for (let row = 0; row < height; row++) {
        const line = pixels.subarray(row * width * 4, (row + 1) * width * 4)
        data.set(line, (height - row - 1) * width * 4)
        backing.set(line, ((this.size - y + 1 - row) * this.size + x - 2) * 4)
      }
    }
    if (upload) page.texture.needsUpdate = true
    return data
  }

  update(renderer?: THREE.WebGLRenderer): void {
    for (const page of this.pages) for (const slot of page.slots) if (slot.source.version !== slot.version) {
      if (renderer && page.live) this.pending.set(slot, page)
      else { this.draw(page, slot); this.pending.delete(slot) }
    }
    if (!renderer) return
    // Arrival/countdown and minute changes affect a wall of screens together.
    // Refresh one full-resolution panel per frame, in fair insertion order;
    // the next turn always reads its latest pixels rather than an old snapshot.
    for (const [slot, page] of this.pending) {
      this.pending.delete(slot)
      if (slot.source.version === slot.version) continue
      const data = this.draw(page, slot, false)
      // Keep the complete CPU page for first upload/context restoration, but a
      // live countdown must not re-upload its entire 16 MB atlas page.
      // The scratch buffer includes the gutters and never becomes a GPU texture:
      // copyTextureToTexture uploads its pixels straight into the retained page.
      if (!this.patch) {
        this.patch = new THREE.DataTexture()
      }
      const w = slot.w + 4, h = slot.h + 4
      this.patch.image = { data: data!, width: w, height: h }
      renderer.initTexture(page.texture)
      renderer.copyTextureToTexture(this.patch, page.texture, null,
        new THREE.Vector2(slot.x - 2, this.size - slot.y - slot.h - 2))
      break
    }
  }

  retain(textures: ReadonlySet<THREE.Texture>): void {
    for (const [texture, entry] of this.slots) if (!textures.has(texture)) {
      entry.page.slots = entry.page.slots.filter(s => s.source !== texture)
      this.pending.delete(entry.slot)
      const { x, y, w, h } = entry.slot
      entry.page.free.push({ x, y, w, h })
      this.slots.delete(texture)
    }
  }

  dispose(): void {
    for (const page of this.pages) page.texture.dispose()
    for (const material of this.materials.values()) material.dispose()
    this.pages = []; this.slots.clear(); this.materials.clear()
    this.patch?.dispose(); this.patch = null
    this.pending.clear()
    this.planeIds = new WeakMap(); this.nextPlaneId = 0
  }
}

export function atlasUV(geometry: THREE.BufferGeometry, region: AtlasRegion): void {
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) return
  for (let i = 0; i < uv.count; i++) uv.setXY(i, region.u + uv.getX(i) * region.w, region.v + uv.getY(i) * region.h)
}
