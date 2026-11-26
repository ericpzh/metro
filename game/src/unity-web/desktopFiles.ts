/**
 * Desktop WebView2 native file picker bridge (`tools/unity-editor-ui/Program.cs`).
 *
 * In Unity desktop and Editor Play Mode, the React UI renders inside an offscreen
 * `CoreWebView2CompositionController` anchored to a 1x1 click-through `HWND_BOTTOM`
 * window, so Chromium's built-in `<input type="file">` picker and `<a download>`
 * cannot surface a usable OS file selector over Unity. `MetroEditorWebView.exe`
 * exposes `window.__metroDesktopFiles` backed by native Windows OpenFileDialog /
 * SaveFileDialog owned by the Unity window. WebGL browsers leave this undefined
 * and keep the standard DOM file input and blob download flows.
 */

export interface DesktopOpenFileOptions {
  title: string
  filterLabel: string
}

export interface DesktopOpenFileResult {
  ok: boolean
  cancelled?: boolean
  text?: string
  error?: string
}

export interface DesktopSaveFileOptions {
  title: string
  filterLabel: string
  suggestedName: string
  text: string
}

export interface DesktopSaveFileResult {
  ok: boolean
  cancelled?: boolean
  path?: string
  error?: string
}

export interface DesktopFileBridge {
  openSave(options: DesktopOpenFileOptions): Promise<DesktopOpenFileResult>
  saveFile(options: DesktopSaveFileOptions): Promise<DesktopSaveFileResult>
}

export function getDesktopFileBridge(hostWindow: unknown = typeof window !== 'undefined' ? window : undefined): DesktopFileBridge | null {
  if (!hostWindow || typeof hostWindow !== 'object') return null
  const candidate = (hostWindow as { __metroDesktopFiles?: unknown }).__metroDesktopFiles
  if (!candidate || typeof candidate !== 'object') return null
  const bridge = candidate as Partial<DesktopFileBridge>
  if (typeof bridge.openSave !== 'function' || typeof bridge.saveFile !== 'function') return null
  return bridge as DesktopFileBridge
}

export function buildSaveFileName(stationName: string): string {
  const safe = stationName.replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${safe || 'station'}.metro.json`
}

export async function openDesktopSaveFile(
  bridge: DesktopFileBridge,
  options: {
    english: boolean
    onOpen: (documentText: string) => void
    onError: () => void
  },
): Promise<boolean> {
  try {
    const reply = await bridge.openSave({
      title: options.english ? 'Open Station Save' : '打开车站存档',
      filterLabel: options.english ? 'Station Save Files' : '车站存档文件',
    })
    if (reply?.cancelled) return false
    if (reply?.ok && typeof reply.text === 'string' && reply.text.length > 0) {
      options.onOpen(reply.text)
      return true
    }
    options.onError()
    return false
  } catch {
    options.onError()
    return false
  }
}

export async function saveDesktopSaveFile(
  bridge: DesktopFileBridge,
  options: {
    english: boolean
    stationName: string
    docText: string
    onSaved: () => void
    onError: () => void
  },
): Promise<boolean> {
  try {
    const reply = await bridge.saveFile({
      title: options.english ? 'Save Station' : '保存车站存档',
      filterLabel: options.english ? 'Station Save Files' : '车站存档文件',
      suggestedName: buildSaveFileName(options.stationName),
      text: options.docText,
    })
    if (reply?.cancelled) return false
    if (reply?.ok) {
      options.onSaved()
      return true
    }
    options.onError()
    return false
  } catch {
    options.onError()
    return false
  }
}
