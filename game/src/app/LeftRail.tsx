// Barrel: the rail now lives under app/rail/ (plan.md Lane B, Phase 1).
// Logic-free re-exports only (plan.md C2) so the old import paths keep working:
// App.tsx imports { Folder, LeftRail } and SignEditor.tsx imports { Icon }.
export { Folder, LeftRail } from './rail/LeftRail.tsx'
export { Icon } from './rail/shared/Icon.tsx'
