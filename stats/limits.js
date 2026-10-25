// Write-path limits, in one place so the Worker and its tests agree.
//
// These are **not** exported from `worker.js`: the Workers runtime treats every
// named export of the entry module as a handler/entrypoint and refuses to start
// with a plain number there ("Incorrect type for map entry"). Keep the numbers
// here, import them into the Worker, and import them into the tests.

/** Largest accepted write body, in bytes. */
export const MAX_BODY = 8 * 1024

/**
 * A lease is minted just before one submit and consumed by it. Six minutes
 * covers the game's five-minute tick plus its pagehide standby; anything older
 * is gone. The token itself never reaches D1 — only its SHA-256 does.
 */
export const LEASE_TTL_MS = 6 * 60 * 1000

/** 32 random bytes, hex-encoded. */
export const LEASE_TOKEN_HEX = 64

/**
 * One mint per address per second on average, with a minute of burst room. The
 * lease is the submit budget, so this is also the effective write rate.
 */
export const LEASE_RATE_LIMIT = 60

/** Width of the fixed mint window. */
export const LEASE_RATE_WINDOW_S = 60

export const REPORTS_PER_DAY = 5
export const REPORT_VOTES_PER_DAY = 100
export const REPORT_PAGE_SIZE = 40
// 3,000 Chinese characters plus JSON framing fit within this byte limit.
export const REPORT_MAX_BODY = 16 * 1024
