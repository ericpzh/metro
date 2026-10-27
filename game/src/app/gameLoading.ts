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
