/** The shell is in index.html so it can paint before the game bundle downloads. */
export function showGameLoading(show: boolean): void {
  const screen = document.getElementById('game-loading')
  if (screen) screen.hidden = !show
}

export function failGameLoading(): void {
  const detail = document.getElementById('loading-detail')
  if (detail) detail.textContent = document.documentElement.lang === 'en'
    ? 'The game could not load. Please reload this page to try again.'
    : '游戏加载失败，请刷新页面重试。'
}

/** Show the shell before synchronous save parsing and scene preparation begin. */
export async function openSaveWithLoading(
  file: Pick<File, 'text'>,
  open: (text: string) => boolean,
  reportReadFailure: () => void,
): Promise<void> {
  const english = document.documentElement.lang === 'en'
  const title = document.getElementById('loading-title')
  const detail = document.getElementById('loading-detail')
  if (title) title.textContent = english ? 'Loading saved station' : '正在载入存档'
  if (detail) detail.textContent = english ? 'Opening your save and building the station. Please wait.' : '正在打开存档并构建车站，请稍候。'
  showGameLoading(true)
  try {
    // Two frames let the browser paint the overlay before blocking work starts.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    const text = await file.text()
    // On success the viewport dismisses the shell after the new station's first frame.
    if (!open(text)) showGameLoading(false)
  } catch {
    showGameLoading(false)
    reportReadFailure()
  }
}
