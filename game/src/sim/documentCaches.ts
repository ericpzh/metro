// Derived-index lifetime for the station state.
//
// Placement validation, collision preparation, ground windows, ceiling support,
// fence joints and the renderer's dependency maps are all cached in a
// `WeakMap` keyed by the **exact immutable** `cells` / `modules` arrays they
// were built from. A live document owns one set of those indexes.
//
// Undo history also keeps old documents alive — deliberately, as whole frames.
// A frame is cheap because it shares records, but without this registry every
// retained frame would also keep its station-sized derived indexes: on a
// 130 000-cell, 75 000-module station one validated ceiling-prop edit pinned
// ~30 MB per frame here, so a forty-frame history cost over 1 GB.
//
// The store therefore *releases* a document's derived indexes when it retires
// the document into history (`forgetDocumentCaches`, called from
// `app/store/slices/StationSlice.ts`). The frame keeps only its immutable
// records; if an undo makes it current again, every index rebuilds on demand,
// exactly as it does after opening a save.
//
// Arrays shared with the live document are left alone: settings-only edits and
// every cell edit share one of the two arrays with the frame they retire.

import type { Cell, Module } from './types.ts'

/**
 * Delete the indexes this module cached for `(cells, modules)`.
 *
 * `liveCells` / `liveModules` are the document that stays current; never delete
 * an entry keyed by them.
 */
export type DocumentCacheForget = (
  cells: readonly Cell[],
  modules: readonly Module[],
  liveCells: readonly Cell[],
  liveModules: readonly Module[],
) => void

const forgetters = new Set<DocumentCacheForget>()

/** Called once per cache owner at module initialisation. */
export function registerDocumentCache(forget: DocumentCacheForget): void {
  forgetters.add(forget)
}

let releases = 0

/** Release the derived indexes keyed by a retired station state. */
export function forgetDocumentCaches(
  cells: readonly Cell[],
  modules: readonly Module[],
  liveCells: readonly Cell[],
  liveModules: readonly Module[],
): void {
  if (cells === liveCells && modules === liveModules) return
  releases++
  for (const forget of forgetters) forget(cells, modules, liveCells, liveModules)
}

/** How many documents have been released; the store integration pins this. */
export function documentCacheReleases(): number {
  return releases
}

/** How many cache owners participate; a new station-sized cache must register. */
export function documentCacheOwners(): number {
  return forgetters.size
}
