/**
 * Public report board routes. The stats Worker pins English under `/en/`,
 * separate from the game's `/game/en/` path.
 */
export function reportIssuePathFor(language: string): string {
  return language === 'en' ? '/stats/en/report' : '/stats/report'
}

/** Local game dev has its own stats Worker port; production shares the apex. */
export function reportIssueHrefFor(language: string, dev: boolean): string {
  return `${dev ? 'http://127.0.0.1:5176' : ''}${reportIssuePathFor(language)}`
}
