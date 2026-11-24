import * as THREE from 'three'

/**
 * True for opaque surfaces whose draw order does not affect blending.
 * Transparent, non-depth-writing, or custom-blended surfaces must keep their
 * own draw boundaries when merged without per-surface back-to-front sorting.
 */
export function isOpaqueCanonicalSurface(material: THREE.Material): boolean {
  return !material.transparent && material.opacity >= 1 && material.depthWrite && material.blending === THREE.NormalBlending
}

/**
 * Value-based bucket key for plain untextured MeshStandardMaterial and
 * MeshBasicMaterial instances. Piece builders mint owned materials per module
 * (e.g. blue steel fence, cubicle, monitor, cctv, sink, urinal); canonicalizing
 * identical untextured render states lets EquipmentBatches and ExplodedLayout
 * merge them without changing owned-material lifecycle or visual output.
 *
 * Defaults to opaque-only (`allowTransparent = false`) so unsorted callers like
 * `ExplodedLayout` preserve independent per-mesh transparent draw boundaries.
 * Sorted transparent batchers (`EquipmentBatches`, which routes transparent
 * buckets through `sortedBatch` / `sortedEquipmentGeometry`) may pass
 * `allowTransparent = true` for normal-blended transparent materials.
 *
 * Returns `null` when the material is ineligible, carries textures, custom
 * shader hooks, or an unsupported material subclass — callers fall back to
 * `material.uuid`.
 */
export function canonicalUntexturedMaterialKey(
  material: THREE.Material,
  includeClipping: boolean,
  planeIds?: WeakMap<THREE.Plane, number>,
  nextPlaneId?: () => number,
  allowTransparent = false,
): string | null {
  if (!isOpaqueCanonicalSurface(material)) {
    if (!allowTransparent || !material.transparent || material.blending !== THREE.NormalBlending) return null
  }
  if (material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return null
  if (material.userData?.noBatchCanonical) return null
  const isStandard = material instanceof THREE.MeshStandardMaterial
  const isBasic = !isStandard && material instanceof THREE.MeshBasicMaterial
  if (!isStandard && !isBasic) return null

  if (isStandard) {
    if (
      material.map || material.alphaMap || material.envMap || material.aoMap ||
      material.lightMap || material.roughnessMap || material.metalnessMap ||
      material.normalMap || material.bumpMap || material.emissiveMap ||
      material.displacementMap
    ) {
      return null
    }
  } else {
    const basic = material as THREE.MeshBasicMaterial
    if (
      basic.map || basic.alphaMap || basic.envMap || basic.aoMap ||
      basic.lightMap || basic.specularMap
    ) {
      return null
    }
  }

  let clipKey = ''
  if (includeClipping && material.clippingPlanes?.length) {
    const ids: number[] = []
    for (const plane of material.clippingPlanes) {
      let id = planeIds?.get(plane)
      if (id === undefined && planeIds && nextPlaneId) {
        id = nextPlaneId()
        planeIds.set(plane, id)
      }
      ids.push(id ?? 0)
    }
    clipKey = `|cp:${ids.join(',')}:${material.clipIntersection ? 1 : 0}:${material.clipShadows ? 1 : 0}`
  }

  const base =
    `canon:${material.type}|c:${(material as THREE.MeshBasicMaterial).color.getHex()}` +
    `|op:${material.opacity}|tr:${material.transparent ? 1 : 0}|sd:${material.side}` +
    `|dt:${material.depthTest ? 1 : 0}|dw:${material.depthWrite ? 1 : 0}|at:${material.alphaTest}` +
    `|bl:${material.blending}:${material.blendSrc}:${material.blendDst}:${material.blendEquation}` +
    `:${material.blendSrcAlpha ?? ''}:${material.blendDstAlpha ?? ''}:${material.blendEquationAlpha ?? ''}` +
    `|pa:${material.premultipliedAlpha ? 1 : 0}|tm:${material.toneMapped ? 1 : 0}|fg:${material.fog ? 1 : 0}` +
    `|vc:${material.vertexColors ? 1 : 0}|wf:${(material as THREE.MeshBasicMaterial).wireframe ? 1 : 0}` +
    `|po:${material.polygonOffset ? 1 : 0}:${material.polygonOffsetFactor}:${material.polygonOffsetUnits}` +
    `|cw:${material.colorWrite ? 1 : 0}|vi:${material.visible ? 1 : 0}|fs:${material.forceSinglePass ? 1 : 0}` +
    `|ah:${material.alphaHash ? 1 : 0}|pr:${material.precision ?? ''}` +
    `|st:${material.stencilWrite ? 1 : 0}:${material.stencilWriteMask}:${material.stencilFunc}:${material.stencilRef}` +
    `:${material.stencilFuncMask}:${material.stencilFail}:${material.stencilZFail}:${material.stencilZPass}` +
    clipKey

  if (isStandard) {
    return (
      base +
      `|rg:${material.roughness}|mt:${material.metalness}` +
      `|em:${material.emissive.getHex()}:${material.emissiveIntensity}|fl:${material.flatShading ? 1 : 0}`
    )
  }
  return base
}
