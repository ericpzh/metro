// Stage a verified public Unity WebGL pack (`StationGameLocal.unity`) into
// `unity/dist-web/` for `wrangler deploy -c unity/wrangler.jsonc`.
//
// Refuses any local-only `StationGameLocalWeb*` passenger profile pack so
// loopback-only assets can never be published to Cloudflare, and Brotli-compresses
// split `.wasm`/`.data` bundles into <=20 MiB `.brpartN` chunks so every response
// stays well under Cloudflare's 100 MB response limit and 25 MiB per-asset limit.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliCompressSync, constants as zc } from 'node:zlib'

const MAX_CLOUDFLARE_ASSET_BYTES = 25 * 1024 * 1024
const CHUNK_BYTES = 20 * 1024 * 1024

export function validatePublicPack(packDir) {
  const pack = resolve(packDir)
  const manifestPath = join(pack, 'manifest.json')
  const provenancePath = join(pack, 'provenance.json')
  const indexPath = join(pack, 'index.html')
  if (!existsSync(manifestPath) || !existsSync(provenancePath) || !existsSync(indexPath)) {
    throw new Error(`Incomplete Unity pack at ${pack} (missing index.html, manifest.json, or provenance.json)`)
  }
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8').replace(/^\uFEFF/, ''))
  const scene = String(provenance.Scene ?? '')
  if (scene !== 'Assets/StationDesigner/Scenes/StationGameLocal.unity') {
    throw new Error(`Refusing to stage non-public scene '${scene}'. Build a public pack with: npm run build:unity -- --scene StationGameLocal`)
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let fileCount = 0
  function checkSizes(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) checkSizes(full)
      else if (entry.isFile()) {
        fileCount += 1
        const size = statSync(full).size
        if (size >= MAX_CLOUDFLARE_ASSET_BYTES) {
          throw new Error(`Asset exceeds Cloudflare 25 MiB limit (${size} bytes): ${relative(pack, full)}`)
        }
      }
    }
  }
  checkSizes(pack)
  return { pack, scene, sourceSha: manifest.sourceSha ?? provenance.Head ?? '', fileCount }
}

function compressSplitBundles(dir) {
  const manifestPath = join(dir, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const splitFiles = manifest.splitFiles
  if (!splitFiles || typeof splitFiles !== 'object') return {}
  const compressedSummary = {}
  const nextSplitFiles = {}
  for (const [relPath, entry] of Object.entries(splitFiles)) {
    if (!entry || !Array.isArray(entry.parts) || entry.parts.length === 0) continue
    if (entry.encoding === 'br') {
      nextSplitFiles[relPath] = entry
      compressedSummary[relPath] = { bytes: entry.bytes, parts: entry.parts.length, encoding: 'br' }
      continue
    }
    const raw = Buffer.concat(entry.parts.map(part => readFileSync(join(dir, part))))
    for (const part of entry.parts) unlinkSync(join(dir, part))
    const compressed = brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } })
    const parts = []
    for (let offset = 0; offset < compressed.length; offset += CHUNK_BYTES) {
      const part = `${relPath}.brpart${parts.length}`
      writeFileSync(join(dir, part), compressed.subarray(offset, offset + CHUNK_BYTES))
      parts.push(part)
    }
    nextSplitFiles[relPath] = {
      parts,
      bytes: compressed.length,
      encoding: 'br',
      sha256: createHash('sha256').update(compressed).digest('hex'),
    }
    compressedSummary[relPath] = { rawBytes: raw.length, bytes: compressed.length, parts: parts.length, encoding: 'br' }
  }
  manifest.splitFiles = nextSplitFiles
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  return compressedSummary
}

export function resolveLatestPack(root) {
  const configPath = join(root, '.preview/unity/station-game-local.jsonc')
  if (!existsSync(configPath)) {
    throw new Error(`No Unity pack found at ${configPath}. Run: npm run build:unity -- --scene StationGameLocal`)
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const dir = config.assets?.directory
  if (!dir) throw new Error(`Missing assets.directory in ${configPath}`)
  return resolve(dirname(configPath), dir)
}

export function stageUnityDeploy(root, packDir, outDir = join(root, 'unity/dist-web')) {
  const info = validatePublicPack(packDir)
  const target = resolve(outDir)
  const staging = `${target}.tmp-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  try {
    cpSync(info.pack, staging, { recursive: true })
    const compressed = compressSplitBundles(staging)
    rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)
    return { ...info, compressed, outDir: target }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(import.meta.dirname, '../..')
  const packFlag = process.argv.indexOf('--pack')
  const packDir = packFlag >= 0 ? process.argv[packFlag + 1] : resolveLatestPack(root)
  if (!packDir) throw new Error('--pack requires a directory path')
  const result = stageUnityDeploy(root, packDir)
  console.log(JSON.stringify(result, null, 2))
}
