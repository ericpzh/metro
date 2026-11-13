// Ensure every asset under unity/Assets carries a .meta file Unity can use. Unity
// creates these on import; this keeps a batch-mode scratch project and the committed
// tree in sync.
//
// A `fileFormatVersion: 2 / guid:` stub is enough for a TextAsset or a folder, but not
// for a texture: Unity re-derives the importer from the extension and, with no
// `TextureImporter:` block to read, imports the PNG as a **Cubemap**. `Resources.Load<
// Texture2D>` then returns null and the finish library draws untextured white slabs
// (plan 13 §2 — `StationFinishLibraryTests` pins this). So a `.png` gets the full
// TextureImporter block below: 2D default texture, sRGB, Repeat, mipmaps on, and
// compression left to the platform. Existing metas that carry a texture importer are
// left alone (Unity owns those settings once it has imported the asset).
import { createHash } from 'node:crypto'
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = join(import.meta.dirname, '../..')
const assets = join(root, 'unity/Assets')

const textureImporter = `TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 1
    sRGBTexture: 1
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMipmapLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 1
    aniso: 4
    mipBias: 0
    wrapU: 0
    wrapV: 0
    wrapW: 0
  nPOTScale: 1
  lightmap: 0
  compressionQuality: 50
  spriteMode: 0
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 0
  spriteTessellationMethod: 0
  spriteTessellationDetail: -1
  spriteGeometrySubdivision: -1
  textureType: 0
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 4
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 1
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  - serializedVersion: 4
    buildTarget: Standalone
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 1
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  - serializedVersion: 4
    buildTarget: WebGL
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 1
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    customData: 
    physicsShape: []
    bones: []
    spriteID: 
    internalID: 0
    vertices: []
    indices: 
    edges: []
    weights: []
    secondaryTextures: []
    spriteCustomMetadata:
      entries: []
    nameFileIdTable: {}
  mipmapLimitGroupName: 
  pSDRemoveMatte: 0
  userData: 
  assetBundleName: 
  assetBundleVariant: 
`

const isTexture = path => /\.(png|jpe?g|tga|exr)$/i.test(path)
const guidOf = text => /^guid: ([0-9a-f]{32})$/m.exec(text)?.[1] ?? null

let created = 0
let repaired = 0

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const stats = statSync(path)
    if (stats.isDirectory()) { walk(path); continue }
    if (name.endsWith('.meta')) continue
    const relativePath = relative(root, path).replaceAll('\\', '/')
    const meta = path + '.meta'
    const existing = existsSync(meta) ? readFileSync(meta, 'utf8') : null
    const guid = (existing && guidOf(existing)) || createHash('md5').update(relativePath).digest('hex')
    const header = `fileFormatVersion: 2\nguid: ${guid}\n`
    if (existing === null) {
      writeFileSync(meta, header + (isTexture(path) ? textureImporter : ''))
      created++
      console.log('meta', relativePath)
      continue
    }
    // A texture meta without an importer block imports as a Cubemap. Repair it in
    // place, keeping the GUID so any existing reference still resolves.
    if (isTexture(path) && !existing.includes('TextureImporter:')) {
      writeFileSync(meta, header + textureImporter)
      repaired++
      console.log('repaired texture meta', relativePath)
    }
  }
}

walk(assets)
console.log('created', created, 'repaired', repaired)
