// Lane A split (Phase 1): App.tsx is now a C2 barrel (plan.md) — it holds no
// logic. App lives in windows/AppShell.tsx; this re-export keeps every
// existing import path (boot.tsx) working.
export { App } from './windows/AppShell.tsx'
