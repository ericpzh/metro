// Plan 11 A6 — the only Unity → browser transport.
//
// `StationGameHost` calls `StationGameState` once per reply with the JSON envelope
// in WASM memory; this copies it out and dispatches one DOM event. The station
// shell (`game/src/unity-web/stationBridge.ts`) listens for `metro:station-state`
// and reduces the envelope. There is no C# file input and no C# download: file
// Open arrives as a `station.open` command and Save is the shell's own copy of the
// last committed document.
mergeInto(LibraryManager.library, {
  StationGameState__sig: 'vp',
  StationGameState: function (ptr) {
    window.dispatchEvent(new CustomEvent('metro:station-state', { detail: UTF8ToString(ptr) }))
  },
})
