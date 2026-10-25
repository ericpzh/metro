import { MODULE_OPTIONS } from '../../src/app/store/catalog.ts'

// tv-double is a placement of two existing TV modules, not another physical
// model. Its coupled preview/commit is covered by tv-double and tv-pair; its
// complete two-model Low geometry is covered by model-detail. Keep every other
// palette id in the single-model audits so unknown factories still fail.
export const SINGLE_MODEL_OPTIONS = MODULE_OPTIONS.filter(option => option.id !== 'tv-double')
