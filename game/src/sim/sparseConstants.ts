// Sparse region routing & rolling local walker tuning constants (design/crowd-routing-plan.md).
// Kept in a dedicated pure-sim module so shared passenger-bake hashes on sim/constants.ts stay stable.
export const SPARSE_SECTOR_SIZE = 16
export const SPARSE_WALK_HORIZON = 16
export const SPARSE_REFILL_THRESHOLD = 4
export const SPARSE_CLAIM_STEPS = 2
export const SPARSE_CLAIM_TTL_TICKS = 4
export const SPARSE_DENSITY_DIRECT_MS = 500
export const SPARSE_DENSITY_ADJACENT_MS = 250
export const SPARSE_DENSITY_CAP_MS = 2500
export const SPARSE_CLAIM_PENALTY_MS = 650
export const SPARSE_CLAIM_CAP_MS = 1300
export const SPARSE_TURN_PENALTY_MS = 50
export const SPARSE_JITTER_MOD_MS = 100
export const SPARSE_SWITCH_MARGIN_MS = 2000
export const SPARSE_FIELD_CACHE_MAX_BYTES = 16 * 1024 * 1024
export const SPARSE_SAMPLE_REFRESH_SIM_S = 60
// Keep cold, simultaneous train arrivals from leaving riders at their doors
// for several dwells. The scheduler stops early when its required jobs finish.
export const SPARSE_MANDATORY_POP_BUDGET = 96000
export const SPARSE_MANDATORY_SCAN_BUDGET = 384000
export const SPARSE_LOCAL_REFILL_BUDGET = 384
export const SPARSE_OPTIONAL_POP_BUDGET = 2000
export const SPARSE_OPTIONAL_SCAN_BUDGET = 8000
export const SPARSE_FINE_RECOVERY_POP_BUDGET = 4000
export const SPARSE_AGE_PROMOTE_TICKS = 4
